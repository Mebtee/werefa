import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { APP_CONFIG, type AppConfig } from '../config/environment';
import { PasswordService } from './password.service';
import { SecurityEventService } from './security-events.service';
import { SessionService } from './session.service';
import { PlatformEmailer } from '../jobs/platform-email.job';
import { clientMetadata } from './client-metadata';
import { normalizeEmail } from './validation';
import { validateNewPassword } from './password-policy';
import { ConflictException, ForbiddenException, NotFoundException } from '../common/http/app-error';

export interface AdminListItem {
  id: string;
  email: string;
  disabledAt: Date | null;
  createdAt: Date;
}

/**
 * Stable PostgreSQL advisory-lock key serializing the Admin account model
 * (Prompt 18, Task A). Every mutation that must respect the maximum-two-active
 * Admins invariant acquires this transaction-scoped lock, so concurrent
 * create/reactivate requests are applied serially instead of racing the
 * count-then-write check.
 */
const ADMIN_MODEL_ADVISORY_LOCK = BigInt(2_847_534_901_640);

/**
 * Super Admin — Admin account lifecycle + forced logout (REQ-217..221).
 *
 * Exactly one Super Admin (REQ-037); exactly two ADMIN accounts (REQ-038);
 * only Super Admin manages them (REQ-039). Every operation is audited.
 */
@Injectable()
export class SuperAdminService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
    private readonly sessions: SessionService,
    private readonly security: SecurityEventService,
    private readonly emailer: PlatformEmailer,
  ) {}

  async listAdmins(): Promise<{ admins: AdminListItem[] }> {
    const admins = await this.prisma.user.findMany({
      where: { role: 'Admin' },
      select: { id: true, email: true, disabledAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return { admins };
  }

  async createAdmin(
    emailIn: string,
    password: string,
    ip?: string,
    ua?: string,
  ): Promise<{ id: string; email: string }> {
    const meta = clientMetadata(ua, ip);
    const email = normalizeEmail(emailIn);
    validateNewPassword(password, this.config, 'password');

    const created = await this.prisma.$transaction(async (tx) => {
      // Serialize Admin-model mutations so concurrent count-then-create cannot
      // exceed the maximum two active Admins (Prompt 18, Task A).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_MODEL_ADVISORY_LOCK})`;

      const activeCount = await tx.user.count({
        where: { role: 'Admin', disabledAt: null },
      });
      if (activeCount >= 2) {
        throw new ConflictException('Reached the maximum of two active Admin accounts.');
      }
      const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) {
        throw new ConflictException('A platform account with this email already exists.');
      }

      const hash = await this.password.hash(password);
      const user = await tx.user.create({
        data: { email, passwordHash: hash, role: 'Admin', isEmailVerified: true },
        select: { id: true, email: true },
      });
      await this.security.record(
        {
          type: 'ADMIN_CREATE',
          userId: user.id,
          ip,
          device: meta.device,
          browser: meta.browser,
          result: 'SUCCESS',
        },
        tx,
      );
      return user;
    });

    try {
      await this.emailer.sendTo('admin-welcome', email, { email });
    } catch {
      // Email is informational; a capture-provider failure must not roll back a
      // successfully created Admin (Prompt 18, Task C).
    }
    return created;
  }

  /** REQ-217 — restore a deactivated Admin, honouring the two-active invariant. */
  async reactivateAdmin(adminId: string, ip?: string, ua?: string): Promise<void> {
    const meta = clientMetadata(ua, ip);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_MODEL_ADVISORY_LOCK})`;

      const target = await tx.user.findFirst({
        where: { id: adminId, role: 'Admin' },
        select: { id: true, disabledAt: true },
      });
      if (!target) throw new NotFoundException('Admin account not found.');
      if (target.disabledAt === null) {
        throw new ConflictException('Admin account is already active.');
      }

      const activeCount = await tx.user.count({
        where: { role: 'Admin', disabledAt: null },
      });
      if (activeCount >= 2) {
        throw new ConflictException('Reached the maximum of two active Admin accounts.');
      }

      await tx.user.update({ where: { id: target.id }, data: { disabledAt: null } });
      // A previous (denied or pre-deactivation) reset flow must not leave a token
      // that could outlive the Admin's reactivation.
      await tx.passwordResetToken.updateMany({
        where: { userId: target.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await this.security.record(
        {
          type: 'ADMIN_REACTIVATE',
          userId: target.id,
          ip,
          device: meta.device,
          browser: meta.browser,
          result: 'SUCCESS',
        },
        tx,
      );
    });
  }

  async deactivateAdmin(adminId: string, ip?: string, ua?: string): Promise<void> {
    const meta = clientMetadata(ua, ip);
    const target = await this.prisma.user.findFirst({
      where: { id: adminId, role: 'Admin' },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('Admin account not found.');

    const data: Prisma.UserUpdateInput = { disabledAt: new Date() };
    await this.prisma.user.update({ where: { id: target.id }, data });
    await this.sessions.revokeAllForUser(target.id);
    await this.security.record({
      type: 'ADMIN_DEACTIVATE',
      userId: target.id,
      ip,
      device: meta.device,
      browser: meta.browser,
      result: 'SUCCESS',
    });
  }

  /** REQ-219 — Super Admin sets a new Admin password (logs Admin out everywhere). */
  async changeAdminPassword(
    adminId: string,
    newPassword: string,
    ip?: string,
    ua?: string,
  ): Promise<void> {
    const meta = clientMetadata(ua, ip);
    const target = await this.prisma.user.findFirst({
      where: { id: adminId, role: 'Admin' },
      select: { id: true, email: true },
    });
    if (!target) throw new NotFoundException('Admin account not found.');
    validateNewPassword(newPassword, this.config, 'newPassword');

    const hash = await this.password.hash(newPassword);
    await this.prisma.user.update({
      where: { id: target.id },
      data: { passwordHash: hash, failedLoginCount: 0, isLockedUntil: null },
    });
    await this.sessions.revokeAllForUser(target.id);
    await this.security.record({
      type: 'ADMIN_PASSWORD_CHANGE',
      userId: target.id,
      ip,
      device: meta.device,
      browser: meta.browser,
      result: 'SUCCESS',
    });
    await this.emailer.sendTo('admin-password-changed', target.email, {
      ip: ip ?? 'unknown',
      device: meta.device,
      browser: meta.browser,
      when: new Date().toISOString(),
    });
  }

  /** REQ-220/221 — force-log-out an Owner/Admin; immediate email. */
  async forceLogout(userId: string, ip?: string, ua?: string): Promise<void> {
    const meta = clientMetadata(ua, ip);
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, email: true },
    });
    if (!target) throw new NotFoundException('Account not found.');
    if (target.role === 'SuperAdmin') {
      throw new ForbiddenException('The Super Admin account cannot be force-logged-out.');
    }
    if (target.role !== 'Owner' && target.role !== 'Admin') {
      throw new ConflictException('Only Owner and Admin accounts can be force-logged-out.');
    }

    await this.sessions.revokeAllForUser(target.id);
    await this.security.record({
      type: 'FORCE_LOGOUT',
      userId: target.id,
      ip,
      device: meta.device,
      browser: meta.browser,
      result: 'SUCCESS',
    });
    await this.emailer.sendTo('forced-logout', target.email, {
      ip: ip ?? 'unknown',
      device: meta.device,
      browser: meta.browser,
      when: new Date().toISOString(),
    });
  }
}
