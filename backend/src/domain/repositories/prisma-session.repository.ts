import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import { SessionRecord, SessionRepository } from './session.repository.port';

@Injectable()
export class PrismaSessionRepository implements SessionRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async create(args: {
    userId: string;
    tokenHash: string;
    ip?: string;
    device?: string;
    browser?: string;
    expiresAt: Date;
  }): Promise<SessionRecord> {
    const row = await this.prisma.session.create({
      data: {
        userId: args.userId,
        tokenHash: args.tokenHash,
        ip: args.ip ?? null,
        device: args.device ?? null,
        browser: args.browser ?? null,
        expiresAt: args.expiresAt,
      },
    });
    return row as SessionRecord;
  }

  async findValidByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const row = await this.prisma.session.findUnique({
      where: { tokenHash },
    });
    if (!row) return null;
    if (row.revokedAt) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    return row as SessionRecord;
  }

  async revokeById(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllByUserId(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async deleteExpired(now: Date): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { revokedAt: { not: null } },
        ],
      },
    });
    return result.count;
  }

  async countActiveByUserId(userId: string): Promise<number> {
    return this.prisma.session.count({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
  }
}
