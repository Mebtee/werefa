import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Logger } from 'pino';
import { AppConfig } from '../config/app-config';
import { CONFIG } from '../config/config.constants';
import { LOGGER } from '../common/logging/logging.module';
import { PRISMA_CLIENT } from '../config/config.constants';
import { DatabasePing, DatabasePort } from './database.port';

/**
 * Real PostgreSQL implementation of the database port.
 *
 * Runtime role: the 'app' Prisma user (RLS-enforced; doc 07 §1/§4). Connection
 * details come from validated configuration. Startup is fail-fast when a
 * DATABASE_URL is provided: an unreachable database aborts boot with a
 * redacted, actionable error instead of serving half-broken.
 */
@Injectable()
export class PrismaDatabase implements DatabasePort, OnModuleInit, OnApplicationShutdown {
  private readonly supportsPing: boolean;

  constructor(
    @Inject(PRISMA_CLIENT) readonly client: PrismaClient,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    this.supportsPing = Boolean(config.databaseUrl);
  }

  get configured(): boolean {
    return this.supportsPing;
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.databaseUrl) {
      this.logger.warn('database disabled: DATABASE_URL is not configured (local development only)');
      return;
    }
    try {
      await this.client.$connect();
      this.logger.info('database connected (postgresql)');
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error({ err }, 'database connection failed at startup');
      throw new Error(
        `PostgreSQL connection failed at startup. Check DATABASE_URL host/port/credentials and that the database is running. ${detail}`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }

  async ping(): Promise<DatabasePing> {
    if (!this.supportsPing) {
      return { ok: false, message: 'database not configured (DATABASE_URL unset)' };
    }
    const start = Date.now();
    try {
      await this.client.$queryRaw`SELECT 1`;
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
}