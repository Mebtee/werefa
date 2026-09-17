import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import { AuditEventAuthRepository } from './audit-event-auth.repository.port';

@Injectable()
export class PrismaAuditEventAuthRepository implements AuditEventAuthRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async create(args: {
    actorUserId: string;
    actorRole: string;
    action: string;
    businessId?: string;
    detail?: string;
  }): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: args.actorUserId,
        actorRole: args.actorRole,
        action: args.action,
        businessId: args.businessId ?? null,
        detail: args.detail ?? null,
      },
    });
  }
}