import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CONFIG, PRISMA_CLIENT } from '../config/config.constants';
import { AppConfig } from '../config/app-config';
import { DATABASE } from './database.port';
import { PrismaDatabase } from './prisma.database';

/**
 * Database module. Provides a Prisma client bound to the validated runtime URL
 * plus a DatabasePort implementation. Tests override the DATABASE provider with
 * an in-memory fake so the deterministic suite never requires a live server.
 */
@Global()
@Module({
  providers: [
    {
      provide: PRISMA_CLIENT,
      inject: [CONFIG],
      useFactory: (config: AppConfig) =>
        config.databaseUrl
          ? new PrismaClient({ datasources: { db: { url: config.databaseUrl } } })
          : new PrismaClient(),
    },
    {
      provide: DATABASE,
      useClass: PrismaDatabase,
    },
  ],
  exports: [DATABASE, PRISMA_CLIENT],
})
export class DatabaseModule {}

export { DATABASE, PrismaDatabase };