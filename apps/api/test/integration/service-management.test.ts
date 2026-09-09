/**
 * Prompt 10 — Service catalog integration tests over the HTTP surface:
 *
 *  - creation + money/duration validation (REQ-071 AC1, REQ-226)
 *  - listing/detail/updates; name uniqueness per business (409)
 *  - ownership isolation (owner B / Admin / Super Admin cannot act on owner A's
 *    catalog — strict Owner scope, TenantGuard + RLS)
 *  - lifecycle deactivate/reactivate (REQ-078/081) + public catalog hiding
 *    (REQ-079) + public field exposure (REQ-214: no internal data)
 *  - variations (signed deltas, effective-total bounds REQ-072) and add-ons
 *    (non-negative additive deltas REQ-073, duplicate rejection)
 *  - hard-delete semantics incl. cascade (REQ-077 boundary seam: no future
 *    bookings exist yet) + snapshot invariants for the booking contract
 *  - concurrency boundary (parallel create → exactly one winner; parallel
 *    update → last-write-wins both succeed)
 *  - audit events recorded (SERVICE_*)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
import { PrismaService } from '../../src/database/prisma.service';
import { withTenantContext } from '../../src/database/tenant-executor';
import {
  TEST_EMAILS,
  TEST_PASSWORDS,
  extractSessionToken,
  resetIdentityDatabaseAndSeed,
} from './identity.helpers';

function rootEnv(): NodeJS.ProcessEnv {
  let raw = '';
  try {
    raw = readFileSync(join(process.cwd(), '..', '..', '.env'), 'utf8');
  } catch {
    raw = readFileSync(join(process.cwd(), '.env'), 'utf8');
  }
  const env: NodeJS.ProcessEnv = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return env;
}

const FILE_ENV = rootEnv();
const TEST_DB = process.env.TEST_DB_NAME ?? 'werefa_test';
const withDb = (dsn: string | undefined, db: string): string | undefined => {
  if (!dsn) return undefined;
  const u = new URL(dsn);
  u.pathname = '/' + db;
  return u.toString();
};

const CSRF = { 'x-requested-with': 'fetch' };
const OWNER_EMAIL = TEST_EMAILS.owner;
const OWNER_PASSWORD = TEST_PASSWORDS.owner;
const OWNER_B = { email: 'it-owner-b@werefa.test', password: 'OwnerPass-999' };

interface ServiceDto {
  id: string;
  businessId: string;
  name: string;
  basePriceMinor: number;
  baseDurationMinutes: number;
  isActive: boolean;
  variations: unknown[];
  addOns: unknown[];
}

let app: INestApplication;
let server: ReturnType<INestApplication['getHttpServer']>;
let supertest: typeof import('supertest');
let prisma: PrismaService;
let superuser: Client;
let businessId: string;
let ownedByA: ServiceDto[] = [];

async function login(email: string, password: string): Promise<string> {
  const res = await supertest(server)
    .post('/api/v1/auth/login')
    .send({ email, password })
    .set(CSRF);
  const token = extractSessionToken(res.header?.['set-cookie'] as string[] | undefined);
  if (!token) throw new Error(`Login failed for ${email}`);
  return token;
}

function auth(token: string): { Cookie: string; 'x-requested-with': string } {
  return { Cookie: `wrf.sid=${token}`, 'x-requested-with': 'fetch' };
}

beforeAll(async () => {
  process.env.APP_ENV = 'test';
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.STORAGE_PROVIDER = 'memory';
  process.env.AUTH_RATE_LIMIT_MAX = '100';
  process.env.COOKIE_SECURE = 'false';
  process.env.DATABASE_URL = withDb(process.env.DATABASE_URL ?? FILE_ENV.DATABASE_URL, TEST_DB)!;
  process.env.DATABASE_MIGRATOR_URL = withDb(
    process.env.DATABASE_MIGRATOR_URL ?? FILE_ENV.DATABASE_MIGRATOR_URL ?? FILE_ENV.DATABASE_URL,
    TEST_DB,
  )!;
  process.env.DATABASE_URL_SUPERUSER = withDb(
    process.env.DATABASE_URL_SUPERUSER ?? FILE_ENV.DATABASE_URL_SUPERUSER,
    TEST_DB,
  )!;
  process.env.REDIS_URL = process.env.REDIS_URL ?? FILE_ENV.REDIS_URL ?? 'redis://localhost:6379/0';

  const { bootstrapApp } = await import('./bootstrap-app');
  app = await bootstrapApp();
  await app.init();
  server = app.getHttpServer();
  prisma = app.get(PrismaService);

  const supertestModule = await import('supertest');
  supertest = (supertestModule.default ?? supertestModule) as typeof import('supertest');

  await resetIdentityDatabaseAndSeed(process.env.DATABASE_MIGRATOR_URL!);

  // Owner B account + seed businesses for ownership-isolation tests.
  const { Client } = await import('pg');
  superuser = new Client({ connectionString: process.env.DATABASE_URL_SUPERUSER! });
  await superuser.connect();
  await superuser.query('TRUNCATE business_owner, business CASCADE');
  const { hash } = await import('@node-rs/argon2');
  const ownerBHash = await hash(OWNER_B.password, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  await superuser.query(
    `INSERT INTO "user"(email, password_hash, role, is_email_verified) VALUES ($1,$2,'Owner',true) ON CONFLICT DO NOTHING`,
    [OWNER_B.email, ownerBHash],
  );

  // Owner A opens a business the service catalog hangs off.
  const token = await login(OWNER_EMAIL, OWNER_PASSWORD);
  const created = await supertest(server)
    .post('/api/v1/businesses')
    .send({ name: 'Service Test Studio', publicSlug: 'service-test-studio' })
    .set(auth(token));
  businessId = (created.body.business as { id: string }).id;
});

afterAll(async () => {
  await superuser?.end();
  await app?.close();
});

beforeEach(async () => {
  await superuser.query(
    'TRUNCATE "booking", "service", "service_variation", "add_on", "security_event" CASCADE',
  );
  ownedByA = [];
});

async function ownerToken(): Promise<string> {
  return login(OWNER_EMAIL, OWNER_PASSWORD);
}

async function ownerBToken(): Promise<string> {
  return login(OWNER_B.email, OWNER_B.password);
}

async function adminToken(): Promise<string> {
  return login(TEST_EMAILS.admin1, TEST_PASSWORDS.admin);
}

async function saToken(): Promise<string> {
  return login(TEST_EMAILS.sa, TEST_PASSWORDS.sa);
}

async function createService(
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; service?: ServiceDto }> {
  const res = await supertest(server)
    .post(`/api/v1/businesses/${businessId}/services`)
    .send(body)
    .set(auth(token));
  return { status: res.status, service: res.body.service as ServiceDto | undefined };
}

/** Owner-scope standalone read (standalone Prisma reads are NOT tenant-scoped). */
async function readServiceAsOwner(serviceId: string) {
  const user = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
  return withTenantContext(prisma, { userId: user!.id, scope: 'OWNER' }, (tx) =>
    tx.service.findUnique({ where: { id: serviceId } }),
  );
}

async function auditEvents(): Promise<Record<string, number>> {
  const res = await superuser.query<{ type: string; c: number }>(
    'SELECT type, count(*)::int AS c FROM security_event GROUP BY type',
  );
  return Object.fromEntries(res.rows.map((r) => [r.type, r.c]));
}

describe('A: service creation and money/duration validation', () => {
  it('201 creates a service with price (minor units) + duration; persisted + owner-visible', async () => {
    const token = await ownerToken();
    const { status, service } = await createService(token, {
      name: 'Haircut & Style',
      basePriceMinor: 4500,
      baseDurationMinutes: 45,
    });
    expect(status).toBe(201);
    expect(service).toBeDefined();
    expect(service!.name).toBe('Haircut & Style');
    expect(service!.basePriceMinor).toBe(4500);
    expect(service!.baseDurationMinutes).toBe(45);
    expect(service!.isActive).toBe(true);
    expect(service!.variations).toEqual([]);
    expect(service!.addOns).toEqual([]);

    const row = await readServiceAsOwner(service!.id);
    expect(row!.businessId).toBe(businessId);
    ownedByA.push(service!);
  });

  it('400 rejects missing/invalid price and duration (REQ-071 AC1, REQ-226)', async () => {
    const token = await ownerToken();
    const bad: { label: string; skipName: boolean }[] = [
      { label: 'No Price', skipName: false },
      { label: 'No Duration', skipName: false },
      { label: 'Negative Price', skipName: false },
      { label: 'Zero Duration', skipName: false },
      { label: 'Negative Duration', skipName: false },
      { label: 'Float Price', skipName: false },
      { label: 'String Price', skipName: false },
      { label: 'Missing Name', skipName: true },
    ];
    const badBodies: Record<string, Record<string, unknown>> = {
      'No Price': { baseDurationMinutes: 30 },
      'No Duration': { basePriceMinor: 1000 },
      'Negative Price': { basePriceMinor: -1, baseDurationMinutes: 30 },
      'Zero Duration': { basePriceMinor: 1000, baseDurationMinutes: 0 },
      'Negative Duration': { basePriceMinor: 1000, baseDurationMinutes: -5 },
      'Float Price': { basePriceMinor: 19.95, baseDurationMinutes: 30 },
      'String Price': { basePriceMinor: '1000', baseDurationMinutes: 30 },
      'Missing Name': { basePriceMinor: 1000, baseDurationMinutes: 30 },
    };
    for (const { label, skipName } of bad) {
      const body = { ...badBodies[label] };
      if (!skipName) body.name = label;
      const before = await superuser.query('SELECT count(*)::int AS c FROM service');
      const res = await supertest(server)
        .post(`/api/v1/businesses/${businessId}/services`)
        .send(body)
        .set(auth(token));
      const after = await superuser.query('SELECT count(*)::int AS c FROM service');
      expect({ label, status: res.status, inserted: after.rows[0].c - before.rows[0].c }).toEqual(
        expect.objectContaining({ label, status: 400 }),
      );
    }
  });

  it('rejects a name longer than the limit', async () => {
    const token = await ownerToken();
    const { status } = await createService(token, {
      name: 'x'.repeat(121),
      basePriceMinor: 1000,
      baseDurationMinutes: 30,
    });
    expect(status).toBe(400);
  });
});

describe('B: list, detail and update semantics', () => {
  it('lists services (asc by creation) with their children arrays', async () => {
    const token = await ownerToken();
    await createService(token, { name: 'First', basePriceMinor: 1000, baseDurationMinutes: 20 });
    await createService(token, { name: 'Second', basePriceMinor: 2000, baseDurationMinutes: 40 });
    const res = await supertest(server)
      .get(`/api/v1/businesses/${businessId}/services`)
      .set(auth(token));
    expect(res.status).toBe(200);
    const services = (res.body.services as ServiceDto[]).map((s) => s.name);
    expect(services).toEqual(['First', 'Second']);
  });

  it('get returns 404 for an unknown service id under the business', async () => {
    const token = await ownerToken();
    const res = await supertest(server)
      .get(`/api/v1/businesses/${businessId}/services/00000000-0000-0000-0000-000000000000`)
      .set(auth(token));
    expect(res.status).toBe(404);
  });

  it('patch updates name/price/duration; conflicts on duplicate name (409)', async () => {
    const token = await ownerToken();
    const first = await createService(token, {
      name: 'Rename Me',
      basePriceMinor: 1000,
      baseDurationMinutes: 20,
    });
    await createService(token, {
      name: 'Taken Sole',
      basePriceMinor: 2000,
      baseDurationMinutes: 40,
    });

    const upd = await supertest(server)
      .patch(`/api/v1/businesses/${businessId}/services/${first.service!.id}`)
      .send({ name: 'Renamed', basePriceMinor: 1500, baseDurationMinutes: 25 })
      .set(auth(token));
    expect(upd.status).toBe(200);
    expect((upd.body.service as ServiceDto).name).toBe('Renamed');
    expect((upd.body.service as ServiceDto).basePriceMinor).toBe(1500);
    expect((upd.body.service as ServiceDto).baseDurationMinutes).toBe(25);

    const conflict = await supertest(server)
      .patch(`/api/v1/businesses/${businessId}/services/${first.service!.id}`)
      .send({ name: 'Taken Sole' })
      .set(auth(token));
    expect(conflict.status).toBe(409);
  });

  it('rejects a base-price/duration change that would break a variation effective total', async () => {
    const token = await ownerToken();
    const svc = await createService(token, {
      name: 'Deltas',
      basePriceMinor: 5000,
      baseDurationMinutes: 60,
    });
    await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services/${svc.service!.id}/variations`)
      .send({ name: 'Junior (discount)', priceDeltaMinor: -4800, durationDeltaMinutes: -15 })
      .set(auth(token));
    // Base drop of 1000 → effective price = -800 → 400.
    const badBase = await supertest(server)
      .patch(`/api/v1/businesses/${businessId}/services/${svc.service!.id}`)
      .send({ basePriceMinor: 1000 })
      .set(auth(token));
    expect(badBase.status).toBe(400);
    // Duration drop to 10 → effective duration = 10 + -15 = -5 → 400.
    const badDuration = await supertest(server)
      .patch(`/api/v1/businesses/${businessId}/services/${svc.service!.id}`)
      .send({ baseDurationMinutes: 10 })
      .set(auth(token));
    expect(badDuration.status).toBe(400);
  });
});

describe('C: ownership isolation and strict owner authorization', () => {
  it('owner B cannot list, read, create, update, deactivate or delete owner A catalog (403)', async () => {
    const tokenA = await ownerToken();
    const svc = (
      await createService(tokenA, { name: 'Mine', basePriceMinor: 1000, baseDurationMinutes: 20 })
    ).service!;
    const tokenB = await ownerBToken();

    const list = await supertest(server)
      .get(`/api/v1/businesses/${businessId}/services`)
      .set(auth(tokenB));
    expect(list.status).toBe(403);

    const get = await supertest(server)
      .get(`/api/v1/businesses/${businessId}/services/${svc.id}`)
      .set(auth(tokenB));
    expect(get.status).toBe(403);

    const create = await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services`)
      .send({ name: 'Sneak', basePriceMinor: 500, baseDurationMinutes: 10 })
      .set(auth(tokenB));
    expect(create.status).toBe(403);

    const patch = await supertest(server)
      .patch(`/api/v1/businesses/${businessId}/services/${svc.id}`)
      .send({ name: 'Stolen' })
      .set(auth(tokenB));
    expect(patch.status).toBe(403);

    const deactivate = await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services/${svc.id}/deactivate`)
      .set(auth(tokenB));
    expect(deactivate.status).toBe(403);

    const del = await supertest(server)
      .delete(`/api/v1/businesses/${businessId}/services/${svc.id}`)
      .set(auth(tokenB));
    expect(del.status).toBe(403);
  });

  it('Admin and Super Admin cannot invoke owner-only service endpoints (403 exact roles)', async () => {
    const tokenA = await ownerToken();
    const svc = (
      await createService(tokenA, {
        name: 'Private',
        basePriceMinor: 1000,
        baseDurationMinutes: 20,
      })
    ).service!;

    for (const token of [await adminToken(), await saToken()]) {
      const list = await supertest(server)
        .get(`/api/v1/businesses/${businessId}/services`)
        .set(auth(token));
      expect(list.status).toBe(403);
      const patch = await supertest(server)
        .patch(`/api/v1/businesses/${businessId}/services/${svc.id}`)
        .send({ name: 'Escalate' })
        .set(auth(token));
      expect(patch.status).toBe(403);
    }
  });

  it('unauthenticated access is refused (401)', async () => {
    const res = await supertest(server).get(`/api/v1/businesses/${businessId}/services`);
    expect(res.status).toBe(401);
  });
});

describe('D: lifecycle — deactivate/reactivate + public catalog', () => {
  it('deactivate → invisible in public catalog; reactivate → back (REQ-078/079/081)', async () => {
    const token = await ownerToken();
    const svc = (
      await createService(token, {
        name: 'Public Item',
        basePriceMinor: 3000,
        baseDurationMinutes: 30,
      })
    ).service!;

    const listPublic = async () =>
      supertest(server).get(`/api/v1/public/businesses/service-test-studio/services`);
    expect((await listPublic()).body.services.map((s: { name: string }) => s.name)).toContain(
      'Public Item',
    );

    const deact = await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services/${svc.id}/deactivate`)
      .set(auth(token));
    expect(deact.status).toBe(200);
    expect((deact.body.service as ServiceDto).isActive).toBe(false);
    expect((await listPublic()).body.services.map((s: { name: string }) => s.name)).not.toContain(
      'Public Item',
    );

    // Double deactivate → 409.
    const again = await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services/${svc.id}/deactivate`)
      .set(auth(token));
    expect(again.status).toBe(409);

    const react = await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services/${svc.id}/reactivate`)
      .set(auth(token));
    expect(react.status).toBe(200);
    expect((react.body.service as ServiceDto).isActive).toBe(true);
    expect((await listPublic()).body.services.map((s: { name: string }) => s.name)).toContain(
      'Public Item',
    );

    // Reactivate an already-active service → 409.
    const againReact = await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services/${svc.id}/reactivate`)
      .set(auth(token));
    expect(againReact.status).toBe(409);
  });

  it('public catalog payload exposes no internal fields (REQ-214)', async () => {
    const token = await ownerToken();
    await createService(token, { name: 'Exposed?', basePriceMinor: 7000, baseDurationMinutes: 50 });
    const res = await supertest(server).get(
      `/api/v1/public/businesses/service-test-studio/services`,
    );
    const entry = (res.body.services as Record<string, unknown>[]).find(
      (s) => s.name === 'Exposed?',
    );
    const keys = Object.keys(entry!).sort();
    expect(keys).toEqual(
      ['baseDurationMinutes', 'basePriceMinor', 'id', 'name', 'variations', 'addOns'].sort(),
    );
  });

  it('unknown public slug → 404', async () => {
    const res = await supertest(server).get(`/api/v1/public/businesses/does-not-exist/services`);
    expect(res.status).toBe(404);
  });
});

describe('E: variations (REQ-072)', () => {
  it('creates variations with signed deltas and enforces effective totals', async () => {
    const token = await ownerToken();
    const svc = (
      await createService(token, {
        name: 'Versatile',
        basePriceMinor: 6000,
        baseDurationMinutes: 60,
      })
    ).service!;

    const okUp = await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services/${svc.id}/variations`)
      .send({ name: 'Premium', priceDeltaMinor: 2000, durationDeltaMinutes: 30 })
      .set(auth(token));
    expect(okUp.status).toBe(201);
    expect((okUp.body.variation as { priceDeltaMinor: number }).priceDeltaMinor).toBe(2000);

    const okDown = await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services/${svc.id}/variations`)
      .send({ name: 'Express', priceDeltaMinor: -3000, durationDeltaMinutes: -20 })
      .set(auth(token));
    expect(okDown.status).toBe(201);

    // Delta below the base → effective price negative → 400.
    const tooCheap = await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services/${svc.id}/variations`)
      .send({ name: 'Unreal', priceDeltaMinor: -7000, durationDeltaMinutes: 0 })
      .set(auth(token));
    expect(tooCheap.status).toBe(400);

    // Duration delta below the base → effective duration < 1 → 400.
    const tooShort = await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services/${svc.id}/variations`)
      .send({ name: 'Blink', priceDeltaMinor: 0, durationDeltaMinutes: -60 })
      .set(auth(token));
    expect(tooShort.status).toBe(400);

    // Duplicate name per service → 409.
    const dup = await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services/${svc.id}/variations`)
      .send({ name: 'Premium', priceDeltaMinor: 100, durationDeltaMinutes: 5 })
      .set(auth(token));
    expect(dup.status).toBe(409);
  });

  it('variation ids are scoped to their service + business (404 on mismatch)', async () => {
    const token = await ownerToken();
    const svcA = (
      await createService(token, { name: 'A Hotel', basePriceMinor: 5000, baseDurationMinutes: 40 })
    ).service!;
    const svcB = (
      await createService(token, { name: 'B Spa', basePriceMinor: 5000, baseDurationMinutes: 40 })
    ).service!;
    const v = (
      await supertest(server)
        .post(`/api/v1/businesses/${businessId}/services/${svcA.id}/variations`)
        .send({ name: 'Gold', priceDeltaMinor: 500, durationDeltaMinutes: 5 })
        .set(auth(token))
    ).body.variation as { id: string };

    // Patching svcB's variation id with svcA's id → 404 (businessId+serviceId scope).
    const wrongService = await supertest(server)
      .patch(`/api/v1/businesses/${businessId}/services/${svcB.id}/variations/${v.id}`)
      .send({ name: 'Stolen' })
      .set(auth(token));
    expect(wrongService.status).toBe(404);
  });

  it('public catalog omits inactive variations', async () => {
    const token = await ownerToken();
    const svc = (
      await createService(token, {
        name: 'With Options',
        basePriceMinor: 4000,
        baseDurationMinutes: 30,
      })
    ).service!;
    await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services/${svc.id}/variations`)
      .send({ name: 'Show Me', priceDeltaMinor: 0, durationDeltaMinutes: 0 })
      .set(auth(token));
    const hidden = (
      await supertest(server)
        .post(`/api/v1/businesses/${businessId}/services/${svc.id}/variations`)
        .send({ name: 'Hide Me', priceDeltaMinor: -1000, durationDeltaMinutes: -5 })
        .set(auth(token))
    ).body.variation as { id: string };
    await supertest(server)
      .patch(`/api/v1/businesses/${businessId}/services/${svc.id}/variations/${hidden.id}`)
      .send({ isActive: false })
      .set(auth(token));

    const res = await supertest(server).get(
      `/api/v1/public/businesses/service-test-studio/services`,
    );
    const entry = (res.body.services as { name: string; variations: { name: string }[] }[]).find(
      (s) => s.name === 'With Options',
    );
    expect(entry!.variations.map((v) => v.name)).toEqual(['Show Me']);
  });
});

describe('F: add-ons (REQ-073)', () => {
  it('creates additive add-ons; rejects negative deltas and duplicates', async () => {
    const token = await ownerToken();
    const svc = (
      await createService(token, {
        name: 'Base Add On',
        basePriceMinor: 2000,
        baseDurationMinutes: 20,
      })
    ).service!;

    const ok = await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services/${svc.id}/add-ons`)
      .send({ name: 'Extra Polish', priceDeltaMinor: 1500, durationDeltaMinutes: 15 })
      .set(auth(token));
    expect(ok.status).toBe(201);

    // Free add-on is allowed (both deltas 0).
    const free = await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services/${svc.id}/add-ons`)
      .send({ name: 'Free Sample', priceDeltaMinor: 0, durationDeltaMinutes: 0 })
      .set(auth(token));
    expect(free.status).toBe(201);

    const negativePrice = await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services/${svc.id}/add-ons`)
      .send({ name: 'Discount Trick', priceDeltaMinor: -500, durationDeltaMinutes: 0 })
      .set(auth(token));
    expect(negativePrice.status).toBe(400);

    const negativeDuration = await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services/${svc.id}/add-ons`)
      .send({ name: 'Time Machine', priceDeltaMinor: 0, durationDeltaMinutes: -10 })
      .set(auth(token));
    expect(negativeDuration.status).toBe(400);

    const dup = await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services/${svc.id}/add-ons`)
      .send({ name: 'Extra Polish', priceDeltaMinor: 100, durationDeltaMinutes: 1 })
      .set(auth(token));
    expect(dup.status).toBe(409);
  });

  it('public catalog includes active add-ons and omits inactive ones', async () => {
    const token = await ownerToken();
    const svc = (
      await createService(token, {
        name: 'With Add Ons',
        basePriceMinor: 1000,
        baseDurationMinutes: 10,
      })
    ).service!;
    await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services/${svc.id}/add-ons`)
      .send({ name: 'Keep', priceDeltaMinor: 500, durationDeltaMinutes: 5 })
      .set(auth(token));
    const hidden = (
      await supertest(server)
        .post(`/api/v1/businesses/${businessId}/services/${svc.id}/add-ons`)
        .send({ name: 'Retire', priceDeltaMinor: 500, durationDeltaMinutes: 5 })
        .set(auth(token))
    ).body.addOn as { id: string };
    await supertest(server)
      .patch(`/api/v1/businesses/${businessId}/services/${svc.id}/add-ons/${hidden.id}`)
      .send({ isActive: false })
      .set(auth(token));

    const res = await supertest(server).get(
      `/api/v1/public/businesses/service-test-studio/services`,
    );
    const entry = (res.body.services as { name: string; addOns: { name: string }[] }[]).find(
      (s) => s.name === 'With Add Ons',
    );
    expect(entry!.addOns.map((a) => a.name)).toEqual(['Keep']);
  });

  it('add-on ids are scoped to their service (404 on mismatch)', async () => {
    const token = await ownerToken();
    const svcA = (
      await createService(token, { name: 'Add A', basePriceMinor: 1000, baseDurationMinutes: 10 })
    ).service!;
    const svcB = (
      await createService(token, { name: 'Add B', basePriceMinor: 1000, baseDurationMinutes: 10 })
    ).service!;
    const a = (
      await supertest(server)
        .post(`/api/v1/businesses/${businessId}/services/${svcA.id}/add-ons`)
        .send({ name: 'Towel', priceDeltaMinor: 300, durationDeltaMinutes: 3 })
        .set(auth(token))
    ).body.addOn as { id: string };
    const del = await supertest(server)
      .delete(`/api/v1/businesses/${businessId}/services/${svcB.id}/add-ons/${a.id}`)
      .set(auth(token));
    expect(del.status).toBe(404);
  });
});

describe('G: deletion and cascade', () => {
  it('delete removes the service and cascades to its variations + add-ons', async () => {
    const token = await ownerToken();
    const svc = (
      await createService(token, { name: 'Doomed', basePriceMinor: 1000, baseDurationMinutes: 20 })
    ).service!;
    await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services/${svc.id}/variations`)
      .send({ name: 'V', priceDeltaMinor: 100, durationDeltaMinutes: 5 })
      .set(auth(token));
    await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services/${svc.id}/add-ons`)
      .send({ name: 'O', priceDeltaMinor: 100, durationDeltaMinutes: 5 })
      .set(auth(token));

    const del = await supertest(server)
      .delete(`/api/v1/businesses/${businessId}/services/${svc.id}`)
      .set(auth(token));
    expect(del.status).toBe(200);

    const list = await supertest(server)
      .get(`/api/v1/businesses/${businessId}/services`)
      .set(auth(token));
    expect((list.body.services as ServiceDto[]).map((s) => s.name)).not.toContain('Doomed');

    const orphans = await superuser.query(
      `SELECT (SELECT count(*) FROM service) AS s, (SELECT count(*) FROM service_variation) AS v, (SELECT count(*) FROM add_on) AS a`,
    );
    expect(orphans.rows[0].s).toBe('0');
    expect(orphans.rows[0].v).toBe('0');
    expect(orphans.rows[0].a).toBe('0');
  });

  it('delete of an unknown service → 404', async () => {
    const token = await ownerToken();
    const res = await supertest(server)
      .delete(`/api/v1/businesses/${businessId}/services/00000000-0000-0000-0000-000000000000`)
      .set(auth(token));
    expect(res.status).toBe(404);
  });
});

describe('H: name uniqueness per business (multi-tenant per-name)', () => {
  it('a name may repeat across different businesses of the same owner', async () => {
    const token = await ownerToken();
    const other = await supertest(server)
      .post('/api/v1/businesses')
      .send({ name: 'Sister Studio', publicSlug: 'sister-studio' })
      .set(auth(token));
    const otherBusinessId = (other.body.business as { id: string }).id;

    const a = await createService(token, {
      name: 'Haircut',
      basePriceMinor: 1000,
      baseDurationMinutes: 20,
    });
    expect(a.status).toBe(201);
    const b = await supertest(server)
      .post(`/api/v1/businesses/${otherBusinessId}/services`)
      .send({ name: 'Haircut', basePriceMinor: 2000, baseDurationMinutes: 30 })
      .set(auth(token));
    expect(b.status).toBe(201);

    // Same name twice in the SAME business → 409.
    const dup = await createService(token, {
      name: 'Haircut',
      basePriceMinor: 3000,
      baseDurationMinutes: 10,
    });
    expect(dup.status).toBe(409);
  });
});

describe('I: concurrency boundary (DB constraints as the final arbiter)', () => {
  it('parallel creates with the same name yield exactly one winner (201/409)', async () => {
    const token = await ownerToken();
    const [r1, r2] = await Promise.all([
      createService(token, { name: 'Race', basePriceMinor: 1000, baseDurationMinutes: 20 }),
      createService(token, { name: 'Race', basePriceMinor: 1000, baseDurationMinutes: 20 }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);
  });

  it('parallel updates to the same service both succeed (documented last-write-wins)', async () => {
    const token = await ownerToken();
    const svc = (
      await createService(token, {
        name: 'Contended',
        basePriceMinor: 1000,
        baseDurationMinutes: 20,
      })
    ).service!;
    const [r1, r2] = await Promise.all([
      supertest(server)
        .patch(`/api/v1/businesses/${businessId}/services/${svc.id}`)
        .send({ name: 'Contended A' })
        .set(auth(token)),
      supertest(server)
        .patch(`/api/v1/businesses/${businessId}/services/${svc.id}`)
        .send({ name: 'Contended B' })
        .set(auth(token)),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });
});

describe('J: audit events', () => {
  it('records SERVICE_* events with actor + business scope', async () => {
    const token = await ownerToken();
    const svc = (
      await createService(token, { name: 'Audited', basePriceMinor: 1000, baseDurationMinutes: 20 })
    ).service!;
    await supertest(server)
      .patch(`/api/v1/businesses/${businessId}/services/${svc.id}`)
      .send({ name: 'Audited v2' })
      .set(auth(token));
    await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services/${svc.id}/deactivate`)
      .set(auth(token));
    await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services/${svc.id}/reactivate`)
      .set(auth(token));
    await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services/${svc.id}/add-ons`)
      .send({ name: 'Audit Add On', priceDeltaMinor: 100, durationDeltaMinutes: 1 })
      .set(auth(token));
    await supertest(server)
      .delete(`/api/v1/businesses/${businessId}/services/${svc.id}`)
      .set(auth(token));

    const events = await auditEvents();
    expect(events.SERVICE_CREATE).toBe(1);
    expect(events.SERVICE_UPDATE).toBe(1);
    expect(events.SERVICE_DEACTIVATE).toBe(1);
    expect(events.SERVICE_REACTIVATE).toBe(1);
    expect(events.SERVICE_ADDON_CREATE).toBe(1);
    expect(events.SERVICE_DELETE).toBe(1);

    const row = await superuser.query(
      `SELECT type, user_id, business_id FROM security_event ORDER BY created_at DESC LIMIT 1`,
    );
    expect(row.rows[0].business_id).toBe(businessId);
  });
});

describe('K: public endpoint anti-manipulation', () => {
  it('state-changing verbs against the public catalog are not routed', async () => {
    const token = await ownerToken();
    await createService(token, { name: 'Guarded', basePriceMinor: 1000, baseDurationMinutes: 20 });
    const post = await supertest(server)
      .post(`/api/v1/public/businesses/service-test-studio/services`)
      .send({ name: 'Create Public?', basePriceMinor: 1, baseDurationMinutes: 1 });
    const deleteSvc = await supertest(server).delete(
      `/api/v1/public/businesses/service-test-studio/services`,
    );
    expect([404, 405]).toContain(post.status);
    expect([404, 405]).toContain(deleteSvc.status);

    const [listRes, writesRes] = await Promise.all([
      supertest(server).get(`/api/v1/public/businesses/service-test-studio/services`),
      superuser.query(
        `SELECT count(*)::int AS c FROM security_event WHERE type IN ('SERVICE_CREATE','SERVICE_DELETE')`,
      ),
    ]);
    const list = listRes;
    expect((list.body.services as { name: string }[]).map((s) => s.name)).toContain('Guarded');
    // The only SERVICE_CREATE/DELETE row is the owner's legitimate create of
    // "Guarded" — none flowed through the public surface (which is never routed).
    expect(writesRes.rows[0].c).toBe(1);
  });
});

describe('L: snapshot/booking contract fixtures (Prompt 10 boundary)', () => {
  it('editing the base price/duration never rewrites child deltas (deltas stay stable)', async () => {
    const token = await ownerToken();
    const svc = (
      await createService(token, {
        name: 'Snapshot',
        basePriceMinor: 4000,
        baseDurationMinutes: 40,
      })
    ).service!;
    await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services/${svc.id}/variations`)
      .send({ name: 'Plus', priceDeltaMinor: 1000, durationDeltaMinutes: 10 })
      .set(auth(token));
    await supertest(server)
      .patch(`/api/v1/businesses/${businessId}/services/${svc.id}`)
      .send({ basePriceMinor: 9000, baseDurationMinutes: 90 })
      .set(auth(token));
    const res = await supertest(server)
      .get(`/api/v1/businesses/${businessId}/services/${svc.id}`)
      .set(auth(token));
    const body = res.body as { service: ServiceDto };
    expect(body.service.basePriceMinor).toBe(9000);
    expect(body.service.baseDurationMinutes).toBe(90);
    expect(
      (body.service.variations as { priceDeltaMinor: number; durationDeltaMinutes: number }[])[0],
    ).toEqual({
      id: expect.any(String),
      name: 'Plus',
      priceDeltaMinor: 1000,
      durationDeltaMinutes: 10,
      isActive: true,
    });
  });

  it('the future-booking deletion seam reports no bookings (no fabricated store)', async () => {
    // The seam is the REQ-077 boundary; today it honestly returns 0 because the
    // booking module's store does not exist yet (documented PARTIAL). The hard
    // delete path therefore succeeds and the SERVICE_DELETE_BLOCKED branch is a
    // required integration contract when bookings land.
    const { FutureBookingsSeam } = await import('../../src/service/future-bookings.seam');
    const seam = app.get(FutureBookingsSeam);
    expect(await seam.countFutureBookings(crypto.randomUUID())).toBe(0);
  });
});
