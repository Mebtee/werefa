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
  message: 'If an account exists for this email, a reset link has been sent.',
};

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Password reset via one-time email link (REQ-033 / R194).
 *
 * - Unknown accounts get the identical uniform response (no enumeration).
 * - Whole tokens stored hashed; one active token per user; single use; expiry.
 * - Successful reset clears the temporary lock (REQ-194) and revokes existing
 *   sessions (Prompt 08 §8).
 */
@Injectable()
export class PasswordResetService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
    private readonly security: SecurityEventService,
    private readonly emailer: PlatformEmailer,
  ) {}

  async request(emailIn: string, ip?: string, ua?: string): Promise<{ message: string }> {
    const meta = clientMetadata(ua, ip);
    const email = normalizeEmail(emailIn);

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true },
    });
    if (!user) {
      return UNIFORM_RESPONSE;
    }

    // Approved decision C2 (strict Admin password restriction): Admin password
    // changes flow through the Super Admin only (REQ-218/219). An Admin must
    // not be able to re-establish a password via Forgot Password — return the
    // identical uniform response so the account's role/existence is never
    // disclosed. The attempt is still audited.
    if (user.role === 'Admin') {
      await this.security.record({
        type: 'PASSWORD_RESET_DENIED',
        userId: user.id,
        ip,
        device: meta.device,
        browser: meta.browser,
        result: 'DENIED',
      });
      return UNIFORM_RESPONSE;
    }

    // Invalidate outstanding tokens (single active, doc 14 §1 R31-analog).
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = randomBytes(32).toString('base64url');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + this.config.resetTokenTtlMinutes * 60_000),
      },
    });

    await this.emailer.sendTo('password-reset', email, { token });
    await this.security.record({
      type: 'PASSWORD_RESET_REQUEST',
      userId: user.id,
      ip,
      device: meta.device,
      browser: meta.browser,
      result: 'SUCCESS',
    });
    return UNIFORM_RESPONSE;
  }

  async complete(tokenIn: string, newPassword: string, ip?: string, ua?: string): Promise<void> {
    const meta = clientMetadata(ua, ip);
    validateNewPassword(newPassword, this.config);
    const tokenHash = sha256((tokenIn ?? '').trim());

    let userId: string = '';
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.passwordResetToken.findFirst({
        where: { tokenHash },
        select: { id: true, userId: true, usedAt: true, expiresAt: true },
      });
      if (!row) {
        throw new AppException(ErrorCodes.TOKEN_EXPIRED, 401, 'Invalid reset link', {
          detail: 'This reset link is invalid or has expired.',
        });
      }
      if (row.expiresAt.getTime() < Date.now()) {
        throw new AppException(ErrorCodes.TOKEN_EXPIRED, 401, 'Reset link expired', {
          detail: 'This reset link has expired. Request a new one.',
        });
      }
      // Atomic single-use claim (row-lock serialized): a concurrent caller gets
      // 0 rows here and is rejected with TOKEN_USED.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new AppException(ErrorCodes.TOKEN_USED, 409, 'Reset link already used', {
          detail: 'This reset link has already been used.',
        });
      }

      const nextHash = await this.password.hash(newPassword);
      // REQ-194: clear the temporary lock. Prompt 08 §8: revoke all sessions.
      await tx.user.update({
        where: { id: row.userId },
        data: { passwordHash: nextHash, failedLoginCount: 0, isLockedUntil: null },
      });
      await tx.session.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      // Consume any other outstanding tokens so only the used one remains valid
      // history (single-active invariant restored after reset).
      await tx.passwordResetToken.updateMany({
        where: { userId: row.userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      userId = row.userId;
    });

    await this.security.record({
      type: 'PASSWORD_RESET_COMPLETE',
      userId,
      ip,
      device: meta.device,
      browser: meta.browser,
      result: 'SUCCESS',
    });
  }
}
