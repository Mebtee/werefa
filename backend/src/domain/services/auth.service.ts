import { Inject, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AppConfig } from '../../config/app-config';
import { CONFIG } from '../../config/config.constants';
import { AppError } from '../../common/errors/app-error';
import { ActorContext } from '../authorization/actor-context';
import { GLOBAL_CLOCK, GlobalClock } from '../time/global-clock';
import { DOMAIN_EVENT_BUS, DomainEventBus } from '../events/domain-events';
import {
  SecurityEventAuthRepository,
} from '../repositories/security-event-auth.repository.port';
import {
  SECURITY_EVENT_AUTH_REPOSITORY,
  SESSION_REPOSITORY,
  USER_AUTH_REPOSITORY,
} from '../repositories/tokens';
import { UserAuthRepository } from '../repositories/user-auth.repository.port';
import { SessionRepository } from '../repositories/session.repository.port';
import { Argon2PasswordHasher } from '../../auth/password-hash';
import { generateOpaqueToken, sha256hex } from '../../auth/token-utils';
import { LOCKOUT_DURATION_MINUTES, MAX_FAILED_LOGIN_ATTEMPTS } from './auth-constants';
import { accountLocked, invalidCredentials } from './auth-errors';

export interface ClientInfo {
  ip?: string;
  device?: string;
  browser?: string;
}

export interface LoginOutcome {
  actor: ActorContext;
  userId: string;
  role: UserRole;
  sessionToken: string;
  expiresAt: Date;
}

/** Safe principal projection returned to an authenticated client (no secrets). */
export interface SessionPrincipal {
  id: string;
  role: UserRole;
  email: string;
}

/**
 * Authentication service (Prompt 43; spec §20, REQ-035/191/192/193/196/217/218/219).
 *
 * Login enforces a 5-consecutive-failure → 15-minute lockout (REQ-193) with an
 * atomic counter increment. Failed logins never reveal whether an email exists
 * (generic 401); lockout failures are explicit (423). Every attempt writes a
 * SecurityEvent row recording date/time, IP, device and browser (REQ-191/192).
 * Successful login issues a server-side session (opaque token, hashed at rest).
 *
 * Password change (Owner/Super Admin only) invalidates every session (REQ-035);
 * Admins cannot change their own passwords (REQ-218).
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_AUTH_REPOSITORY) private readonly userRepo: UserAuthRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessionRepo: SessionRepository,
    @Inject(SECURITY_EVENT_AUTH_REPOSITORY) private readonly securityRepo: SecurityEventAuthRepository,
    @Inject(GLOBAL_CLOCK) private readonly clock: GlobalClock,
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async login(input: { email: string; password: string; client: ClientInfo }): Promise<LoginOutcome> {
    const now = this.clock.now();
    const email = input.email.toLowerCase().trim();
    const user = await this.userRepo.findByEmail(email);

    if (!user) {
      await this.recordFailure(null, 'NO_ACCOUNT', input.client);
      throw invalidCredentials();
    }
    if (user.isDeactivated) {
      await this.recordFailure(user.id, 'DEACTIVATED', input.client);
      throw invalidCredentials();
    }
    if (user.isLockedUntil && user.isLockedUntil.getTime() > now.getTime()) {
      await this.recordFailure(user.id, 'ACCOUNT_LOCKED', input.client);
      throw accountLocked();
    }

    const valid = await Argon2PasswordHasher.verify(user.passwordHash, input.password);
    if (!valid) {
      const attempts = await this.userRepo.incrementFailedLoginAttempts(user.id);
      if (attempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
        const lockedUntil = new Date(now.getTime() + LOCKOUT_DURATION_MINUTES * 60_000);
        await this.userRepo.setLockedUntil(user.id, lockedUntil);
        await this.securityRepo.create({
          userId: user.id,
          type: 'ACCOUNT_LOCKED',
          ip: input.client.ip,
          device: input.client.device,
          browser: input.client.browser,
          result: 'LOCKED',
        });
        await this.recordFailure(user.id, 'LOCKOUT_TRIGGERED', input.client);
        await this.eventBus.publish([
          { type: 'LOCKOUT_EMAIL', userId: user.id, email: user.email, occurredAt: now },
        ]);
        throw accountLocked();
      }
      await this.recordFailure(user.id, 'BAD_PASSWORD', input.client);
      throw invalidCredentials();
    }

    await this.userRepo.recordSuccessfulLogin(user.id, now);

    // REQ-197: successful login from a new/unrecognized device is recorded
    // (never an email). The device/browser classification is coarse on purpose.
    // The count runs BEFORE inserting the current LOGIN_SUCCESS so a fresh
    // device/browser combination is correctly seen as "first use".
    const isNewDevice =
      !!input.client.device && (await this.securityRepo.countByDevice(user.id, input.client.device, input.client.browser)) === 0;

    await this.securityRepo.create({
      userId: user.id,
      type: 'LOGIN_SUCCESS',
      ip: input.client.ip,
      device: input.client.device,
      browser: input.client.browser,
      result: 'SUCCESS',
    });

    if (isNewDevice) {
      await this.securityRepo.create({
        userId: user.id,
        type: 'DEVICE_FIRST_USE',
        ip: input.client.ip,
        device: input.client.device,
        browser: input.client.browser,
        result: 'SUCCESS',
      });
    }

    const outcome = await this.issueSession(user.id, user.role, input.client);
    return outcome;
  }

  /** Create a server-side session row and return the opaque token. */
  async issueSession(userId: string, role: UserRole, client: ClientInfo): Promise<LoginOutcome> {
    const now = this.clock.now();
    const token = generateOpaqueToken();
    const expiresAt = new Date(now.getTime() + this.config.authSessionTtlHours * 3_600_000);
    await this.sessionRepo.create({
      userId,
      tokenHash: sha256hex(token),
      ip: client.ip,
      device: client.device,
      browser: client.browser,
      expiresAt,
    });
    return {
      actor: this.toActor(userId, role),
      userId,
      role,
      sessionToken: token,
      expiresAt,
    };
  }

  /** Resolve the ActorContext for a session token; throws UNAUTHENTICATED on any failure. */
  async resolveActorFromToken(token: string | undefined): Promise<ActorContext> {
    if (!token) throw AppError.unauthenticated('Authentication is required.');
    const record = await this.sessionRepo.findValidByTokenHash(sha256hex(token));
    if (!record) throw AppError.unauthenticated('Authentication is required.');
    const user = await this.userRepo.findById(record.userId);
    if (!user || user.isDeactivated) throw AppError.unauthenticated('Authentication is required.');
    return this.toActor(user.id, user.role);
  }

  /**
   * Safe principal projection for the current session (Prompt 44 session
   * restoration). Returns null when the actor is not an internal user, so the
   * HTTP layer never fabricates an identity.
   */
  async principalFor(actor: ActorContext): Promise<SessionPrincipal | null> {
    if (!actor.actorUserId) return null;
    if (actor.actorType !== 'OWNER' && actor.actorType !== 'ADMIN' && actor.actorType !== 'SUPER_ADMIN') {
      return null;
    }
    const user = await this.userRepo.findById(actor.actorUserId);
    if (!user || user.isDeactivated) return null;
    return { id: user.id, role: user.role, email: user.email };
  }

  /** Revoke the session identified by the raw token (idempotent; never throws on invalid). */
  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    const record = await this.sessionRepo.findValidByTokenHash(sha256hex(token));
    if (record) await this.sessionRepo.revokeById(record.id);
  }

  /** Change password and invalidate every session (REQ-035). Admins cannot change their own (REQ-218). */
  async changePassword(
    actor: ActorContext,
    input: { currentPassword: string; newPassword: string },
  ): Promise<void> {
    if (actor.actorType === 'ADMIN') {
      throw AppError.forbidden('Admins cannot change their own password.');
    }
    if (actor.actorType !== 'OWNER' && actor.actorType !== 'SUPER_ADMIN') {
      throw AppError.forbidden('This role cannot change a password.');
    }
    if (!actor.actorUserId) throw AppError.unauthenticated('Authentication is required.');

    const user = await this.userRepo.findById(actor.actorUserId);
    if (!user) throw AppError.unauthenticated('Authentication is required.');
    const valid = await Argon2PasswordHasher.verify(user.passwordHash, input.currentPassword);
    if (!valid) {
      throw AppError.validation({ currentPassword: 'Current password is incorrect.' }, 'Password mismatch.');
    }
    if (input.newPassword.length < 1 || input.newPassword.length > 128) {
      throw AppError.validation({ newPassword: 'Password length must be 1–128 characters.' });
    }

    const now = this.clock.now();
    const newHash = await Argon2PasswordHasher.hash(input.newPassword);
    await this.userRepo.updatePassword(actor.actorUserId, newHash, now);
    await this.sessionRepo.revokeAllByUserId(actor.actorUserId);
    await this.securityRepo.create({
      userId: actor.actorUserId,
      type: 'PASSWORD_CHANGED',
      result: 'SUCCESS',
    });
  }

  private toActor(userId: string, role: UserRole): ActorContext {
    switch (role) {
      case 'ADMIN':
        return { actorType: 'ADMIN', actorUserId: userId };
      case 'SUPER_ADMIN':
        return { actorType: 'SUPER_ADMIN', actorUserId: userId };
      case 'OWNER':
      default:
        return { actorType: 'OWNER', actorUserId: userId };
    }
  }

  private recordFailure(userId: string | null, result: string, client: ClientInfo): Promise<void> {
    return this.securityRepo.create({
      userId,
      type: 'LOGIN_FAILURE',
      ip: client.ip,
      device: client.device,
      browser: client.browser,
      result,
    });
  }
}