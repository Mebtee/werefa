import { Inject, Injectable } from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { APP_CONFIG, type AppConfig } from '../config/environment';
import { PasswordService } from './password.service';
import { SecurityEventService } from './security-events.service';
import { SessionService } from './session.service';
import { PlatformEmailer } from '../jobs/platform-email.job';
import { clientMetadata } from './client-metadata';
import { normalizeEmail } from './validation';
import { validateNewPassword } from './password-policy';
import {
  AccountLockedException,
  AppException,
  ForbiddenException,
  UnauthenticatedException,
} from '../common/http/app-error';
import { ErrorCodes } from '@werefa/shared';
import type { ActorContext } from '../common/context/actor-context';

export interface LoginResult {
  user: { id: string; email: string; role: UserRole };
  session: { token: string; expiresAt: Date };
  unrecognizedDevice: boolean;
}

/**
 * Interactive login + password change (REQ-024, R193–R197, R035, R218).
 *
 * Concurrency-safe lockout: the failure increment is a single atomic UPDATE
 * (row lock) so parallel attempts can never race past the threshold — exactly
 * one caller transitions the account to locked and emits the lockout email.
 */
@Injectable()
export class AuthService {
  private dummyHash: Promise<string> | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly password: PasswordService,
    private readonly security: SecurityEventService,
    private readonly emailer: PlatformEmailer,
  ) {}

  async login(emailIn: string, password: string, ip?: string, ua?: string): Promise<LoginResult> {
    const meta = clientMetadata(ua, ip);
    const email = normalizeEmail(emailIn);

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Constant-time rejection for unknown accounts (no account enumeration,
      // doc 14 §5 credential stuffing). Wait, the doc forbids revealing which
      // accounts exist — identical response for unknown email and bad password.
      await this.equalizeTiming(password);
      throw new UnauthenticatedException('Invalid email or password.');
    }

    if (user.disabledAt) {
      await this.recordLoginFailure(user.id, meta, ip, 'DISABLED');
      throw new ForbiddenException('This account is disabled.');
    }

    if (user.isLockedUntil && user.isLockedUntil.getTime() > Date.now()) {
      await this.recordLoginFailure(user.id, meta, ip, 'LOCKED');
      throw new AccountLockedException();
    }

    const valid = await this.password.verify(user.passwordHash, password);
    if (!valid) {
      return this.afterFailedAttempt(user, meta, ip);
    }

    if (!user.isEmailVerified) {
      // REQ-027 — unverified accounts never reach the dashboard.
      await this.recordLoginFailure(user.id, meta, ip, 'UNVERIFIED');
      throw new AppException(ErrorCodes.VERIFICATION_REQUIRED, 401, 'Verification required', {
        detail: 'Verify your email before signing in.',
      });
    }

    // Success clears the consecutive-failure counter (REQ-193 "5 consecutive").
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, isLockedUntil: null },
    });

    const recognized = await this.sessions.recognizedBefore(user.id, meta.fingerprint);
    const created = await this.sessions.createSession(
      { id: user.id, role: user.role },
      ip,
      meta.fingerprint,
      recognized,
    );

    await this.security.record({
      type: 'LOGIN_SUCCESS',
      userId: user.id,
      ip,
      device: meta.device,
      browser: meta.browser,
      result: 'SUCCESS',
    });
    if (!recognized) {
      // REQ-197 — record only; never email, never block.
      await this.security.record({
        type: 'UNRECOGNIZED_DEVICE',
        userId: user.id,
        ip,
        device: meta.device,
        browser: meta.browser,
        result: 'SUCCESS',
      });
    }

    return {
      user: { id: user.id, email: user.email, role: user.role },
      session: { token: created.token, expiresAt: created.expiresAt },
      unrecognizedDevice: !recognized,
    };
  }

  async profileEmail(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) throw new UnauthenticatedException('Invalid session account.');
    return user.email;
  }

  /**
   * Password change (REQ-035/R35): new hash + revoke EVERY session (incl.
   * current). Admins must NOT self-serve (REQ-218); Owner/SuperAdmin may.
   */
  async changePassword(
    actor: ActorContext,
    currentPassword: string,
    newPassword: string,
    ip?: string,
    ua?: string,
  ): Promise<void> {
    const meta = clientMetadata(ua, ip);
    const user = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { id: true, passwordHash: true, role: true },
    });
    if (!user) throw new UnauthenticatedException('Invalid session account.');

    if (user.role === 'Admin') {
      await this.security.record({
        type: 'ADMIN_SELF_PASSWORD_DENIED',
        userId: user.id,
        ip,
        device: meta.device,
        browser: meta.browser,
        result: 'DENIED',
      });
      throw new ForbiddenException('Admin accounts cannot change their own password.');
    }

    const currentOk = await this.password.verify(user.passwordHash, currentPassword);
    if (!currentOk) {
      await this.security.record({
        type: 'PASSWORD_CHANGE',
        userId: user.id,
        ip,
        device: meta.device,
        browser: meta.browser,
        result: 'FAILURE',
      });
      throw new UnauthenticatedException('Current password is incorrect.');
    }

    validateNewPassword(newPassword, this.config, 'newPassword');
    const nextHash = await this.password.hash(newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: nextHash, failedLoginCount: 0, isLockedUntil: null },
    });
    await this.sessions.revokeAllForUser(user.id);

    await this.security.record({
      type: 'PASSWORD_CHANGE',
      userId: user.id,
      ip,
      device: meta.device,
      browser: meta.browser,
      result: 'SUCCESS',
    });
    // Email confirmation is NOT required by product (doc 14 §2.4); revocation is.
  }

  private async afterFailedAttempt(
    user: { id: string; email: string },
    meta: ReturnType<typeof clientMetadata>,
    ip: string | undefined,
  ): Promise<never> {
    const result = await this.prisma.$queryRaw<
      Array<{ failed_login_count: number; is_locked_until: Date | null }>
    >`
      UPDATE "user" SET
        failed_login_count = failed_login_count + 1,
        is_locked_until = CASE
          WHEN failed_login_count + 1 >= ${this.config.maxFailedLogins}
          THEN now() + make_interval(mins => ${this.config.lockoutMinutes}::int)
          ELSE is_locked_until
        END
      WHERE id = ${user.id}::uuid
        AND (is_locked_until IS NULL OR is_locked_until < now())
      RETURNING failed_login_count, is_locked_until
    `;

    if (
      result.length === 1 &&
      (result[0]?.failed_login_count ?? 0) >= this.config.maxFailedLogins
    ) {
      await this.security.record({
        type: 'ACCOUNT_LOCKED',
        userId: user.id,
        ip,
        device: meta.device,
        browser: meta.browser,
        result: 'FAILURE',
      });
      // REQ-195/196 — immediate email with IP + device/browser (async worker).
      await this.emailer.sendTo('lockout', user.email, {
        ip: ip ?? 'unknown',
        device: meta.device,
        browser: meta.browser,
        when: new Date().toISOString(),
      });
      throw new AccountLockedException();
    }

    await this.recordLoginFailure(user.id, meta, ip, 'FAILURE');
    throw new UnauthenticatedException('Invalid email or password.');
  }

  private async recordLoginFailure(
    userId: string,
    meta: ReturnType<typeof clientMetadata>,
    ip: string | undefined,
    result: string,
  ): Promise<void> {
    await this.security.record({
      type: 'LOGIN_FAILED',
      userId,
      ip,
      device: meta.device,
      browser: meta.browser,
      result,
    });
  }

  private async equalizeTiming(password: string): Promise<void> {
    if (!this.dummyHash) {
      this.dummyHash = this.password.hash('__werefa_dummy_timing_equalizer__');
    }
    await this.dummyHash.then((h) => this.password.verify(h, password));
  }
}
