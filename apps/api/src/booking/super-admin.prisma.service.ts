import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from '../config/environment';

/**
 * Elevated Prisma client connected as `app_superadmin` (bootstrap-roles +
 * rls.sql `*_superadmin_all FOR ALL ... TO app_superadmin`). Used ONLY by the
 * Admin / Super Admin booking views (REQ-176/177/227–230): a role with full
 * `USING(true)` visibility for cross-business reads/manual completion, while
 * the regular `app` role stays RLS-scoped. Auditing is deliberate: every read
 * and mutation goes through BookingAdminService which records security events.
 *
 * Credentials: reuses the `app` username's password unless
 * `DATABASE_SUPERADMIN_URL` is set (same convention as bootstrap-roles).
 */
@Injectable()
export class SuperAdminPrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({ datasourceUrl: superadminDsn(config.databaseUrl) });
    void config;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

function superadminDsn(baseUrl: string): string {
  const explicit = process.env.DATABASE_SUPERADMIN_URL;
  if (explicit) return explicit;
  const url = new URL(baseUrl);
  url.username = 'app_superadmin';
  return url.toString();
}
