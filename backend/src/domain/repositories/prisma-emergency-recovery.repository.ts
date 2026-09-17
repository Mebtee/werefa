import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import { EmergencyRecoveryRecord, EmergencyRecoveryRepository } from './emergency-recovery.repository.port';

@Injectable()
export class PrismaEmergencyRecoveryRepository implements EmergencyRecoveryRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async create(args: { userId: string; codeHash: string; expiresAt: Date }): Promise<EmergencyRecoveryRecord> {
    const row = await this.prisma.emergencyRecovery.create({
      data: {
        userId: args.userId,
        codeHash: args.codeHash,
        expiresAt: args.expiresAt,
      },
    });
    return row as EmergencyRecoveryRecord;
  }

  async findActiveByUserId(userId: string, now: Date): Promise<EmergencyRecoveryRecord | null> {
    const row = await this.prisma.emergencyRecovery.findFirst({
      where: {
        userId,
        usedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });
    return (row as EmergencyRecoveryRecord | null) ?? null;
  }

  async incrementAttempts(recoveryId: string): Promise<number> {
    const row = await this.prisma.$queryRaw<{ attempts: number }[]>`
      UPDATE "emergency_recovery"
      SET "attempts" = "attempts" + 1
      WHERE "id" = ${recoveryId}::uuid
      RETURNING "attempts"
    `;
    return row[0]?.attempts ?? 0;
  }

  async consume(recoveryId: string, now: Date): Promise<boolean> {
    const result = await this.prisma.$executeRaw`
      UPDATE "emergency_recovery"
      SET "used_at" = ${now}::timestamptz
      WHERE "id" = ${recoveryId}::uuid AND "used_at" IS NULL
    `;
    return result === 1;
  }

  async expireAllForUser(userId: string, now: Date): Promise<void> {
    await this.prisma.emergencyRecovery.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now },
    });
  }
}
