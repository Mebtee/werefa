import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient, User } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import { UserAuthRepository, UserWithOwners } from './user-auth.repository.port';

@Injectable()
export class PrismaUserAuthRepository implements UserAuthRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async findByEmail(email: string): Promise<UserWithOwners | null> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        businesses: { select: { businessId: true, createdAt: true } },
      },
    });
    return user as UserWithOwners | null;
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async incrementFailedLoginAttempts(userId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ failed_login_attempts: number }[]>`
      UPDATE "user"
      SET "failed_login_attempts" = "failed_login_attempts" + 1,
          "updated_at" = NOW()
      WHERE "id" = ${userId}::uuid
      RETURNING "failed_login_attempts"
    `;
    return rows[0]?.failed_login_attempts ?? 0;
  }

  async recordSuccessfulLogin(userId: string, now: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: 0, lastLoginAt: now, isLockedUntil: null },
    });
  }

  async setLockedUntil(userId: string, lockedUntil: Date | null): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { isLockedUntil: lockedUntil, failedLoginAttempts: lockedUntil ? 0 : undefined },
    });
  }

  async updatePassword(userId: string, passwordHash: string, now: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, passwordChangedAt: now, isLockedUntil: null, failedLoginAttempts: 0 },
    });
  }

  async countActiveAdmins(): Promise<number> {
    return this.prisma.user.count({ where: { role: 'ADMIN', isDeactivated: false } });
  }

  async listAdmins() {
    return this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createAdmin(args: { id: string; email: string; passwordHash: string; recoveryEmail?: string }): Promise<User | null> {
    // Serialize admin creation so the two-active-admin cap cannot be raced
    // past (REQ-038). The advisory lock is on a fixed key, not per-user.
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('werefa_admin_create'))`;
      const active = await tx.user.count({ where: { role: 'ADMIN', isDeactivated: false } });
      if (active >= 2) return null;
      return tx.user.create({
        data: {
          id: args.id,
          email: args.email.toLowerCase(),
          passwordHash: args.passwordHash,
          role: 'ADMIN',
          recoveryEmail: args.recoveryEmail,
        },
      });
    });
    return created as User | null;
  }

  async deactivateUser(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { isDeactivated: true },
    });
  }

  async setRecoveryEmail(userId: string, email: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { recoveryEmail: email.toLowerCase() },
    });
  }
}
