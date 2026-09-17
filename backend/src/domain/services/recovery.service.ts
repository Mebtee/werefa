import { Inject, Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import { CONFIG } from '../../config/config.constants';
import { GLOBAL_CLOCK, GlobalClock } from '../time/global-clock';
import { DOMAIN_EVENT_BUS, DomainEventBus } from '../events/domain-events';
import {
  EMERGENCY_RECOVERY_REPOSITORY,
  SESSION_REPOSITORY,
  SECURITY_EVENT_AUTH_REPOSITORY,
  USER_AUTH_REPOSITORY,
} from '../repositories/tokens';
import { UserAuthRepository } from '../repositories/user-auth.repository.port';
import { EmergencyRecoveryRepository } from '../repositories/emergency-recovery.repository.port';
import { SessionRepository } from '../repositories/session.repository.port';
import { SecurityEventAuthRepository } from '../repositories/security-event-auth.repository.port';
import { Argon2PasswordHasher } from '../../auth/password-hash';
import { generateRecoveryCode, sha256hex } from '../../auth/token-utils';
import { recoveryCodeInvalid } from './auth-errors';
import { ClientInfo } from './auth.service';

/**
 * Super Admin emergency recovery (Prompt 43; REQ-198–200).
 *
 * Only Super Admin accounts can request a code, and only via their configured
 * recovery email (recorded on the account). The request endpoint is always
 * generic: unknown emails still receive the same 200-shaped response so the
 * endpoint cannot be used to enumerate accounts. Codes are numeric, single-use,
 * short-lived (config TTL), hashed at rest, and capped at a configured number
 * of verification attempts. Confirming a code performs an immediate password
 * reset, revokes every session, and clears any lockout.
 */
@Injectable()
export class RecoveryService {
  constructor(
    @Inject(USER_AUTH_REPOSITORY) private readonly userRepo: UserAuthRepository,
    @Inject(EMERGENCY_RECOVERY_REPOSITORY) private readonly recoveryRepo: EmergencyRecoveryRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessionRepo: SessionRepository,
    @Inject(SECURITY_EVENT_AUTH_REPOSITORY) private readonly securityRepo: SecurityEventAuthRepository,
    @Inject(GLOBAL_CLOCK) private readonly clock: GlobalClock,
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Request a recovery code. Always successful-looking (200); a code is only
   * actually created when the email belongs to a Super Admin with a recovery
   * email configured.
   */
  async requestCode(input: { email: string; client: ClientInfo }): Promise<void> {
    const now = this.clock.now();
    const email = input.email.toLowerCase().trim();
    const user = await this.userRepo.findByEmail(email);

    if (user && user.role === 'SUPER_ADMIN' && user.recoveryEmail) {
      const code = generateRecoveryCode(this.config.authRecoveryCodeLength);
      await this.recoveryRepo.expireAllForUser(user.id, now);
      await this.recoveryRepo.create({
        userId: user.id,
        codeHash: sha256hex(code),
        expiresAt: new Date(now.getTime() + this.config.authRecoveryTtlMinutes * 60_000),
      });
      await this.securityRepo.create({
        userId: user.id,
        type: 'RECOVERY_CODE_REQUESTED',
        ip: input.client.ip,
        device: input.client.device,
        browser: input.client.browser,
        result: 'SUCCESS',
      });
      await this.eventBus.publish([
        { type: 'RECOVERY_CODE_EMAIL', userId: user.id, email: user.recoveryEmail, occurredAt: now },
      ]);
    }
    // Unknown email / non-Super Admin / missing recovery email: no-op, same response.
  }

  /**
   * Confirm a recovery code and immediately reset the password. Throws the
   * same generic error for unknown emails, expired codes, wrong codes,
   * exhaustion of the attempt cap and concurrent code reuse (no account-state
   * factoring). Consumption is atomic: a concurrent second use of the same
   * code loses the claim and receives the generic error (REQ-199 single use).
   */
  async confirmReset(input: { email: string; code: string; newPassword: string; client: ClientInfo }): Promise<void> {
    const now = this.clock.now();
    const email = input.email.toLowerCase().trim();
    const user = await this.userRepo.findByEmail(email);
    if (!user || user.role !== 'SUPER_ADMIN' || !user.recoveryEmail) {
      throw recoveryCodeInvalid();
    }

    const record = await this.recoveryRepo.findActiveByUserId(user.id, now);
    if (!record) {
      await this.recordFailure(user.id, input.client);
      throw recoveryCodeInvalid();
    }

    const matches = sha256hex(input.code) === record.codeHash;
    if (!matches) {
      const attempts = await this.recoveryRepo.incrementAttempts(record.id);
      if (attempts >= this.config.authRecoveryMaxAttempts) {
        await this.recoveryRepo.expireAllForUser(user.id, now);
        await this.securityRepo.create({
          userId: user.id,
          type: 'RECOVERY_CODE_FAILED',
          ip: input.client.ip,
          device: input.client.device,
          browser: input.client.browser,
          result: 'ATTEMPTS_EXCEEDED',
        });
      }
      throw recoveryCodeInvalid();
    }

    // Atomic single-use claim BEFORE acting on the account. A concurrent
    // request with the same code loses this update and stops here.
    const claimed = await this.recoveryRepo.consume(record.id, now);
    if (!claimed) {
      await this.recordFailure(user.id, input.client);
      throw recoveryCodeInvalid();
    }

    const newHash = await Argon2PasswordHasher.hash(input.newPassword);
    await this.userRepo.updatePassword(user.id, newHash, now);
    await this.sessionRepo.revokeAllByUserId(user.id);
    await this.securityRepo.create({
      userId: user.id,
      type: 'RECOVERY_CODE_VERIFIED',
      ip: input.client.ip,
      device: input.client.device,
      browser: input.client.browser,
      result: 'SUCCESS',
    });
  }

  private recordFailure(userId: string, client: ClientInfo): Promise<void> {
    return this.securityRepo.create({
      userId,
      type: 'RECOVERY_CODE_FAILED',
      ip: client.ip,
      device: client.device,
      browser: client.browser,
      result: 'INVALID_CODE',
    });
  }
}