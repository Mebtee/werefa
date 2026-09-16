import { describe, expect, it, vi } from 'vitest';
import { PrismaDatabase } from './prisma.database';
import { loadAndValidateConfig } from '../config/app-config';
import { PrismaClient } from '@prisma/client';

describe('PrismaDatabase (disabled path — no live server, deterministic)', () => {
  it('runs without a DATABASE_URL and reports not-configured', async () => {
    const config = loadAndValidateConfig({ NODE_ENV: 'test' });
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
    const db = new PrismaDatabase(new PrismaClient(), logger as never, config);

    expect(db.configured).toBe(false);
    await db.onModuleInit();               // must not throw
    expect(logger.warn).toHaveBeenCalled();
    expect(await db.ping()).toEqual({ ok: false, message: 'database not configured (DATABASE_URL unset)' });
  });

  it('is configured when a DATABASE_URL is present', () => {
    const config = loadAndValidateConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://app:pass@localhost:5432/werefa',
    });
    const db = new PrismaDatabase(new PrismaClient(), { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as never, config);
    expect(db.configured).toBe(true);
  });
});