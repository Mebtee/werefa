import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../test/helpers/test-app';

/**
 * Fresh-database business setup hardening (Prompt 67).
 *
 * Regression coverage for the "Setup failed / Internal server error" failure:
 * `business_category` shipped with ZERO rows on every fresh database, so the
 * first real `POST /owner/businesses` violated `business_category_code_fkey`
 * (Prisma P2003) and the global exception filter rendered it as an opaque
 * HTTP 500. Reference data is now provisioned by the migration
 * `20260927120000_seed_business_category_reference_data`.
 *
 * These tests deliberately do NOT seed `business_category` themselves. They read
 * the rows the migration produced, which is what makes them a provisioning
 * regression test rather than a restatement of the seed. Run via
 * `npm run test:db` against a provisioned werefa_test
 * (`npm run db:up && npm run db:provision && npm run test:db`).
 */
const TEST_URL = process.env.TEST_DATABASE_URL;
const RUN = process.env.RUN_DB_TESTS === 'true' && Boolean(TEST_URL);

const CATEGORY_CODES = ['SALON_AND_BARBER', 'OTHER'] as const;

describe.skipIf(!RUN)('business category reference data + first-business setup (real DB)', () => {
  let prisma: PrismaClient;
  let app: INestApplication;

  const OWNER = '6f1c0000-0000-4000-8000-00000000c0de';

  /**
   * FK-safe removal of everything this spec creates. A created business also owns
   * subscription, settings and owner-membership rows, so they go first. Run before
   * AND after the suite so repeated runs against the same werefa_test start clean.
   */
  async function cleanup(): Promise<void> {
    const ids = await prisma.business.findMany({
      where: { publicSlug: { startsWith: 'refdata-' } },
      select: { id: true },
    });
    for (const { id } of ids) {
      await prisma.$executeRawUnsafe(`DELETE FROM "subscription" WHERE "business_id" = $1::uuid`, id);
      await prisma.$executeRawUnsafe(`DELETE FROM "business_owner" WHERE "business_id" = $1::uuid`, id);
      await prisma.$executeRawUnsafe(`DELETE FROM "business_settings" WHERE "business_id" = $1::uuid`, id);
      await prisma.$executeRawUnsafe(`DELETE FROM "business" WHERE "id" = $1::uuid`, id);
    }
    await prisma.user.deleteMany({ where: { id: OWNER } });
  }

  beforeAll(async () => {
    if (!RUN) return;
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL! } } });
    await cleanup();
    const built = await createTestApp({
      database: 'real',
      env: {
        DATABASE_URL: TEST_URL!,
        AUTH_TEST_ENABLED: 'true',
        PRODUCT_APP_TIMEZONE: 'UTC',
      },
    });
    app = built.app;
    await prisma.user.upsert({
      where: { id: OWNER },
      update: {},
      create: { id: OWNER, email: 'refdata-owner@example.com', passwordHash: 'x'.repeat(60), role: 'OWNER' },
    });
  });

  afterAll(async () => {
    if (!RUN) return;
    await app?.close();
    await cleanup();
    await prisma.$disconnect();
  });

  const http = () => request(app.getHttpServer());
  const owner = () => ({ 'x-actor-role': 'OWNER', 'x-actor-id': OWNER });

  // 1 + 2: the migration provisions exactly the two canonical categories.
  it('provisions the SALON_AND_BARBER reference row', async () => {
    const row = await prisma.businessCategory.findUnique({ where: { code: 'SALON_AND_BARBER' } });
    expect(row).not.toBeNull();
    expect(row?.label).toBe('Salon & Barber');
  });

  it('provisions the OTHER reference row', async () => {
    const row = await prisma.businessCategory.findUnique({ where: { code: 'OTHER' } });
    expect(row).not.toBeNull();
    expect(row?.label).toBe('Other');
  });

  it('provisions no categories beyond the canonical two', async () => {
    const rows = await prisma.businessCategory.findMany({ orderBy: { code: 'asc' } });
    expect(rows.map((r) => r.code).sort()).toEqual([...CATEGORY_CODES].sort());
  });

  // 4 + 8: the exact call that used to fail with P2003 / HTTP 500.
  it('creates a business with SALON_AND_BARBER and no longer fails with P2003', async () => {
    const res = await http()
      .post('/api/v1/owner/businesses')
      .set(owner())
      .send({ slug: 'refdata-salon', categoryCode: 'SALON_AND_BARBER', name: 'Refdata Salon' });

    expect(res.status).toBe(201);
    expect(res.body.category).toEqual({ code: 'SALON_AND_BARBER', label: 'Salon & Barber' });

    const row = await prisma.business.findUnique({
      where: { publicSlug: 'refdata-salon' },
      include: { category: true, owners: true },
    });
    expect(row).not.toBeNull();
    expect(row?.categoryCode).toBe('SALON_AND_BARBER');
    expect(row?.publicSlug).toBe('refdata-salon');
    expect(row?.name).toBe('Refdata Salon');
    expect(row?.owners.map((o) => o.userId)).toEqual([OWNER]);
  });

  // 5: the second canonical category is equally usable.
  it('creates a business with OTHER', async () => {
    const res = await http()
      .post('/api/v1/owner/businesses')
      .set(owner())
      .send({ slug: 'refdata-other', categoryCode: 'OTHER', name: 'Refdata Other' });

    expect(res.status).toBe(201);
    expect(res.body.category).toEqual({ code: 'OTHER', label: 'Other' });

    const row = await prisma.business.findUnique({ where: { publicSlug: 'refdata-other' } });
    expect(row?.categoryCode).toBe('OTHER');
  });

  // 7: the created business is publicly retrievable (no owner data leaked).
  it('public business lookup returns the newly created business', async () => {
    const res = await http().get('/api/v1/public/businesses/refdata-salon');

    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('refdata-salon');
    expect(res.body.name).toBe('Refdata Salon');
    expect(res.body.category).toEqual({ code: 'SALON_AND_BARBER', label: 'Salon & Barber' });
    expect(res.body).not.toHaveProperty('id');
    expect(res.body).not.toHaveProperty('ownerId');
  });

  // The FK itself still protects integrity: a code that is NOT provisioned is
  // still rejected by DTO validation before it can reach the database.
  it('rejects a category code that is not provisioned', async () => {
    const res = await http()
      .post('/api/v1/owner/businesses')
      .set(owner())
      .send({ slug: 'refdata-bogus', categoryCode: 'NOT_A_CATEGORY', name: 'Bogus' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // The empty-table failure mode itself: with reference data present the insert
  // cannot raise P2003. Assert the constraint exists and is RESTRICT so a future
  // migration cannot quietly drop the guarantee this task depends on.
  it('keeps the business_category foreign key in place', async () => {
    const rows = await prisma.$queryRaw<{ conname: string; confdeltype: string }[]>`
      SELECT conname, confdeltype
      FROM pg_constraint
      WHERE conname = 'business_category_code_fkey'
    `;
    expect(rows).toHaveLength(1);
    // 'r' = RESTRICT
    expect(rows[0].confdeltype).toBe('r');
  });

  // 6: re-applying the seed must not create duplicates. Deliberately the LAST
  // test in this file: it re-inserts the rows, so running it earlier would mask
  // the missing-reference-data failure of the business-creation tests above.
  it('reference provisioning is idempotent (re-seeding creates no duplicates)', async () => {
    const before = await prisma.businessCategory.count();
    for (let i = 0; i < 3; i += 1) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "business_category" ("code", "label") VALUES ('SALON_AND_BARBER', 'Salon & Barber'), ('OTHER', 'Other') ON CONFLICT ("code") DO NOTHING`,
      );
    }
    const after = await prisma.businessCategory.count();
    expect(after).toBe(before);
    expect(after).toBe(2);
    const codes = await prisma.businessCategory.findMany({ select: { code: true } });
    expect(new Set(codes.map((c) => c.code)).size).toBe(codes.length);
  });
});
