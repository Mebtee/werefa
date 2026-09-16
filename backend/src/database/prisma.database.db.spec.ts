import { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import { PrismaDatabase } from './prisma.database';
import { loadAndValidateConfig } from '../config/app-config';

const TEST_URL = process.env.TEST_DATABASE_URL;
const RUN = process.env.RUN_DB_TESTS === 'true' && Boolean(TEST_URL);

let prisma: PrismaClient = null as unknown as PrismaClient;

beforeAll(() => {
  if (RUN) prisma = new PrismaClient({ datasources: { db: { url: TEST_URL! } } });
});

afterAll(async () => {
  if (prisma) await prisma.$disconnect();
});

/**
 * DB-gated integration suite. Runnable only when RUN_DB_TESTS=true and
 * TEST_DATABASE_URL points at the provisioned werefa_test database:
 *   npm run db:up && npm run db:provision && npm run prisma:dev && npm run test:db
 */
describe.skipIf(!RUN)('prisma.database integration (live PostgreSQL 16)', () => {
  it('ping returns ok with latency against the test database', async () => {
    const config = loadAndValidateConfig({ NODE_ENV: 'test', DATABASE_URL: TEST_URL! });
    const db = new PrismaDatabase(prisma, { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as never, config);
    const ping = await db.ping();
    expect(ping.ok).toBe(true);
    if (ping.ok) expect(ping.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('migration history table exists (prisma migrate has run against the database)', async () => {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM pg_catalog.pg_tables
      WHERE schemaname = 'public' AND tablename = '_prisma_migrations'
    `;
    expect(Number(rows[0].n)).toBe(1);
  });

  it('postgresql version supports the architecture baseline (>= 16)', async () => {
    const rows = await prisma.$queryRaw<{ server_version: string }[]>`SHOW server_version`;
    const version = rows[0].server_version;
    const major = Number(version.split('.')[0]);
    expect(major).toBeGreaterThanOrEqual(16);
  });
});