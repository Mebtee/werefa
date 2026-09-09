import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { APP_CONFIG, type AppConfig } from '../config/environment';
import { PasswordService } from './password.service';
import { SecurityEventService } from './security-events.service';
import { PlatformEmailer } from '../jobs/platform-email.job';
import { clientMetadata } from './client-metadata';
import { normalizeEmail } from './validation';
import { validateNewPassword } from './password-policy';
import { AppException } from '../common/http/app-error';
import { ErrorCodes } from '@werefa/shared';

const UNIFORM_RESPONSE = {
  message: 'If this matches the emergency recovery email, a code has been sent.',
};

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Human-typable one-time code (50 bits of entropy). */
function newRecoveryCode(): string {
  const bytes = randomBytes(10);
  let code = '';
  for (let i = 0; i < 10; i += 1) {
    code += BASE32[bytes[i]! & 31];
  }
  return code;
}

/**
 * Super Admin emergency recovery (REQ-198/199/200).
 *
 * Separate recovery email, one-time code, strict rate limiting (RL enforced at
 * the controller), immediate password replacement, revocation of all SA
 * sessions. Normal-user password reset never touches this boundary (separate
 * token table + separate identity gate).
 */
@Injectable()
export class RecoveryService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
    private readonly security: SecurityEventService,
    private readonly emailer: PlatformEmailer,
  ) {}

  async request(recoveryEmailIn: string, ip?: string, ua?: string): Promise<{ message: string }> {
    const meta = clientMetadata(ua, ip);
    const recoveryEmail = normalizeEmail(recoveryEmailIn);

    const sa = await this.prisma.user.findFirst({
      where: { role: 'SuperAdmin' },
      select: { id: true, recoveryEmail: true },
    });
    const matches = !!sa?.recoveryEmail && normalizeEmail(sa.recoveryEmail) === recoveryEmail;
    if (!sa || !matches || !sa.recoveryEmail) {
      // Uniform response; no token, no event — recovery boundary stays opaque.
      return UNIFORM_RESPONSE;
    }

    await this.prisma.recoveryToken.updateMany({
      where: { superAdminUserId: sa.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const code = newRecoveryCode();
    await this.prisma.recoveryToken.create({
      data: {
        superAdminUserId: sa.id,
        codeHash: sha256(code),
        expiresAt: new Date(Date.now() + this.config.recoveryCodeTtlMinutes * 60_000),
      },
    });

    await this.emailer.sendTo('recovery-code', sa.recoveryEmail, { code });
    await this.security.record({
      type: 'RECOVERY_REQUEST',
      userId: sa.id,
      ip,
      device: meta.device,
      browser: meta.browser,
      result: 'SUCCESS',
    });
    return UNIFORM_RESPONSE;
  }

  async complete(codeIn: string, newPassword: string, ip?: string, ua?: string): Promise<void> {
    const meta = clientMetadata(ua, ip);
    validateNewPassword(newPassword, this.config);
    const codeHash = sha256(((codeIn ?? '').trim() || '').toUpperCase());

    const sa = await this.prisma.user.findFirst({
      where: { role: 'SuperAdmin' },
      select: { id: true },
    });
    if (!sa) {
      throw new AppException(ErrorCodes.TOKEN_EXPIRED, 401, 'Recovery code invalid', {
        detail: 'The recovery code is invalid or has expired.',
      });
    }

    let userId = '';
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.recoveryToken.findFirst({
        where: { superAdminUserId: sa.id, codeHash },
        select: { id: true, usedAt: true, expiresAt: true },
      });
      if (!row || row.expiresAt.getTime() < Date.now()) {
        throw new AppException(ErrorCodes.TOKEN_EXPIRED, 401, 'Recovery code invalid', {
          detail: 'The recovery code is invalid or has expired.',
        });
      }
      const claimed = await tx.recoveryToken.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new AppException(ErrorCodes.TOKEN_USED, 409, 'Recovery code already used', {
          detail: 'This recovery code has already been used.',
        });
      }

      // REQ-200: immediate password replacement + clear lock + revoke SA sessions.
      const nextHash = await this.password.hash(newPassword);
      await tx.user.update({
        where: { id: sa.id },
        data: { passwordHash: nextHash, failedLoginCount: 0, isLockedUntil: null },
      });
      await tx.session.updateMany({
        where: { userId: sa.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.recoveryToken.updateMany({
        where: { superAdminUserId: sa.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      userId = sa.id;
    });

    await this.security.record({
      type: 'RECOVERY_COMPLETE',
      userId,
      ip,
      device: meta.device,
      browser: meta.browser,
      result: 'SUCCESS',
    });
  }
}
