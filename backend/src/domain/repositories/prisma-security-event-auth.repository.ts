import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import { AuthSecurityEventType, SecurityEventAuthRepository } from './security-event-auth.repository.port';

@Injectable()
export class PrismaSecurityEventAuthRepository implements SecurityEventAuthRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async create(args: {
    userId: string | null;
    type: AuthSecurityEventType;
    ip?: string;
    device?: string;
    browser?: string;
    result?: string;
  }): Promise<void> {
    await this.prisma.securityEvent.create({
      data: {
        userId: args.userId,
        type: args.type,
        ip: args.ip ?? null,
        device: args.device ?? null,
        browser: args.browser ?? null,
        result: args.result ?? 'SUCCESS',
      },
    });
  }

  async listByUserId(
    userId: string,
    args?: { limit?: number },
  ): Promise<
    Array<{
      id: string;
      type: string;
      ip: string | null;
      device: string | null;
      browser: string | null;
      result: string;
      createdAt: Date;
    }>
  > {
    return this.prisma.securityEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: args?.limit ?? 100,
      select: {
        id: true,
        type: true,
        ip: true,
        device: true,
        browser: true,
        result: true,
        createdAt: true,
      },
    });
  }

  async listAll(
    args?: { limit?: number },
  ): Promise<
    Array<{
      id: string;
      userId: string | null;
      type: string;
      ip: string | null;
      device: string | null;
      browser: string | null;
      result: string;
      createdAt: Date;
    }>
  > {
    return this.prisma.securityEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: args?.limit ?? 200,
      select: {
        id: true,
        userId: true,
        type: true,
        ip: true,
        device: true,
        browser: true,
        result: true,
        createdAt: true,
      },
    });
  }

  async deleteOlderThan(before: Date): Promise<number> {
    const result = await this.prisma.securityEvent.deleteMany({
      where: { createdAt: { lt: before } },
    });
    return result.count;
  }

  async countByUserId(userId: string): Promise<number> {
    return this.prisma.securityEvent.count({ where: { userId } });
  }

  async countByDevice(userId: string, device: string, browser?: string): Promise<number> {
    return this.prisma.securityEvent.count({
      where: {
        userId,
        device,
        browser: browser ?? null,
        type: 'LOGIN_SUCCESS',
      },
    });
  }
}
