import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import { AppError } from '../../common/errors/app-error';
import { ActorContext } from '../authorization/actor-context';
import { GLOBAL_CLOCK, GlobalClock } from '../time/global-clock';
import { DOMAIN_EVENT_BUS, DomainEventBus } from '../events/domain-events';
import {
  AUDIT_EVENT_AUTH_REPOSITORY,
  SECURITY_EVENT_AUTH_REPOSITORY,
  SESSION_REPOSITORY,
  USER_AUTH_REPOSITORY,
} from '../repositories/tokens';
import { UserAuthRepository } from '../repositories/user-auth.repository.port';
import { SessionRepository } from '../repositories/session.repository.port';
import { AuditEventAuthRepository } from '../repositories/audit-event-auth.repository.port';
import { SecurityEventAuthRepository } from '../repositories/security-event-auth.repository.port';
import { Argon2PasswordHasher } from '../../auth/password-hash';
import { adminLimitReached } from './auth-errors';
import { ClientInfo } from './auth.service';

export interface AdminUserView {
  id: string;
  email: string;
  createdAt: Date;
  isDeactivated: boolean;
  activeSessions: number;
}

/**
 * Admin management (Prompt 43; REQ-217, REQ-219, REQ-220, REQ-201–206).
 *
 * All operations are Super Admin only (enforced at the controller and again
 * here). A maximum of two active Admins is enforced (REQ-217). Super Admin can
 * force-logout Owners and Admins (REQ-220) and reset Admin passwords (REQ-219).
 * Every action is recorded in the audit log; security-history deletion is
 * Super Admin only and itself audited (REQ-206).
 */
@Injectable()
export class AdminManagementService {
  constructor(
    @Inject(PRISMA_CLIENT) readonly prisma: PrismaClient,
    @Inject(USER_AUTH_REPOSITORY) private readonly userRepo: UserAuthRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessionRepo: SessionRepository,
    @Inject(SECURITY_EVENT_AUTH_REPOSITORY) private readonly securityRepo: SecurityEventAuthRepository,
    @Inject(AUDIT_EVENT_AUTH_REPOSITORY) private readonly auditRepo: AuditEventAuthRepository,
    @Inject(GLOBAL_CLOCK) private readonly clock: GlobalClock,
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
  ) {}

  private requireSuperAdmin(actor: ActorContext): void {
    if (actor.actorType !== 'SUPER_ADMIN' || !actor.actorUserId) {
      throw AppError.forbidden('This operation requires a Super Admin context.');
    }
  }

  async listAdmins(actor: ActorContext): Promise<AdminUserView[]> {
    this.requireSuperAdmin(actor);
    const admins = await this.userRepo.listAdmins();
    const views: AdminUserView[] = [];
    for (const admin of admins) {
      const activeSessions = await this.sessionRepo.countActiveByUserId(admin.id);
      views.push({
        id: admin.id,
        email: admin.email,
        createdAt: admin.createdAt,
        isDeactivated: admin.isDeactivated,
        activeSessions,
      });
    }
    return views;
  }

  async createAdmin(
    actor: ActorContext,
    input: { email: string; password: string; recoveryEmail?: string },
  ): Promise<AdminUserView> {
    this.requireSuperAdmin(actor);
    const normalizedEmail = input.email.toLowerCase().trim();
    const existing = await this.userRepo.findByEmail(normalizedEmail);
    if (existing) {
      throw AppError.validation({ email: 'An account with this email already exists.' }, 'Duplicate account.');
    }

    const passwordHash = await Argon2PasswordHasher.hash(input.password);
    const created = await this.userRepo.createAdmin({
      id: crypto.randomUUID(),
      email: normalizedEmail,
      passwordHash,
      recoveryEmail: input.recoveryEmail ? input.recoveryEmail.toLowerCase().trim() : undefined,
    });
    if (!created) throw adminLimitReached();

    await this.auditRepo.create({
      actorUserId: actor.actorUserId!,
      actorRole: 'SUPER_ADMIN',
      action: 'ADMIN_CREATED',
      detail: `Admin account created (${created.email}).`,
    });
    await this.securityRepo.create({
      userId: created.id,
      type: 'ADMIN_CREATED',
      result: 'SUCCESS',
    });
    return {
      id: created.id,
      email: created.email,
      createdAt: created.createdAt,
      isDeactivated: created.isDeactivated,
      activeSessions: 0,
    };
  }

  async deactivateAdmin(actor: ActorContext, userId: string): Promise<void> {
    this.requireSuperAdmin(actor);
    const target = await this.userRepo.findById(userId);
    if (!target || target.role !== 'ADMIN') {
      throw AppError.notFound('Admin account not found.');
    }
    await this.userRepo.deactivateUser(userId);
    await this.sessionRepo.revokeAllByUserId(userId);
    await this.auditRepo.create({
      actorUserId: actor.actorUserId!,
      actorRole: 'SUPER_ADMIN',
      action: 'ADMIN_DEACTIVATED',
      detail: `Admin account deactivated (${target.email}).`,
    });
  }

  /** Super Admin resets an Admin's password (REQ-219). */
  async resetAdminPassword(actor: ActorContext, userId: string, newPassword: string): Promise<void> {
    this.requireSuperAdmin(actor);
    if (userId === actor.actorUserId) {
      throw AppError.forbidden('Use the password/change endpoint for your own account.');
    }
    const target = await this.userRepo.findById(userId);
    if (!target || target.role !== 'ADMIN') {
      throw AppError.notFound('Admin account not found.');
    }
    const passwordHash = await Argon2PasswordHasher.hash(newPassword);
    await this.userRepo.updatePassword(userId, passwordHash, this.clock.now());
    await this.sessionRepo.revokeAllByUserId(userId);
    await this.auditRepo.create({
      actorUserId: actor.actorUserId!,
      actorRole: 'SUPER_ADMIN',
      action: 'ADMIN_PASSWORD_RESET',
      detail: `Admin password reset (${target.email}).`,
    });
  }

  /** Force logout an Owner or Admin (REQ-220); Super Admin cannot be targeted. */
  async forceLogoutUser(actor: ActorContext, userId: string, client: ClientInfo): Promise<void> {
    this.requireSuperAdmin(actor);
    const target = await this.userRepo.findById(userId);
    if (!target) throw AppError.notFound('User not found.');
    if (target.role === 'SUPER_ADMIN' && target.id === actor.actorUserId) {
      throw AppError.forbidden('A Super Admin cannot force-logout their own account.');
    }
    if (target.role === 'SUPER_ADMIN') {
      throw AppError.forbidden('A Super Admin account cannot be force-logged-out.');
    }
    await this.sessionRepo.revokeAllByUserId(userId);
    await this.auditRepo.create({
      actorUserId: actor.actorUserId!,
      actorRole: 'SUPER_ADMIN',
      action: 'FORCED_LOGOUT',
      detail: `All sessions revoked for user ${target.email}.`,
    });
    await this.securityRepo.create({
      userId,
      type: 'FORCED_LOGOUT',
      ip: client.ip,
      device: client.device,
      browser: client.browser,
      result: 'SUCCESS',
    });
    await this.eventBus.publish([
      { type: 'FORCED_LOGOUT_EMAIL', userId, email: target.email, occurredAt: this.clock.now() },
    ]);
  }

  /** Security-history deletion (REQ-201/203/206): Super Admin only, audited. */
  async deleteSecurityHistory(actor: ActorContext, olderThan: Date): Promise<number> {
    this.requireSuperAdmin(actor);
    const count = await this.securityRepo.deleteOlderThan(olderThan);
    await this.auditRepo.create({
      actorUserId: actor.actorUserId!,
      actorRole: 'SUPER_ADMIN',
      action: 'SECURITY_HISTORY_DELETED',
      detail: `Deleted ${count} security events older than ${olderThan.toISOString()}.`,
    });
    return count;
  }

  /** Own security history for the current actor. */
  async listOwnSecurityHistory(actor: ActorContext) {
    if (!actor.actorUserId) return [];
    return this.securityRepo.listByUserId(actor.actorUserId, { limit: 100 });
  }

  /** Platform-wide security history (REQ-203): Super Admin only. */
  async listPlatformSecurityHistory(actor: ActorContext) {
    this.requireSuperAdmin(actor);
    return this.securityRepo.listAll({ limit: 200 });
  }

  roleOf(actor: ActorContext): UserRole | null {
    switch (actor.actorType) {
      case 'OWNER':
        return 'OWNER';
      case 'ADMIN':
        return 'ADMIN';
      case 'SUPER_ADMIN':
        return 'SUPER_ADMIN';
      default:
        return null;
    }
  }
}