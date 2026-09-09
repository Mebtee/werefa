import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Global Prisma client (singleton). Runs as the `app` role with RLS enforced —
 * tenant context must be set per transaction (TenantContextService +
 * tenantContextSql()).
 *
 * Query/warn/error are delegated to Prisma's internal logger (pino writes the
 * app-level logs; raw SQL rows are never logged verbatim).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
  }

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV !== 'test') {
      await this.$connect();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
