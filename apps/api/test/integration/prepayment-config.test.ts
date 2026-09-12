/**
 * Prompt 21 — Owner prepayment configuration (REQ-110/111) integration tests
 * over HTTP:
 *
 *  A) Owner config: default DISABLED; enable PERCENTAGE / FIXED; reject mixing
 *     (REQ-111 AC1) and out-of-range values; disable resets the mode.
 *  B) Booking derivation: availability + create snapshot `prepaid_minor` from
 *     the current config; reconfiguration does NOT change existing bookings.
 *  C) Tenant isolation + authorization: Owner/URL scoping, cross-owner denial,
 *     Admin/Super Admin rejection, cross-tenant booking isolation, and 401 for
 *     anonymous access.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
import { PrismaService } from '../../src/database/prisma.service';
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
const SLUG = 'prepay-test-studio';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface ConfigDto {
  enabled: boolean;
  type: 'PERCENTAGE' | 'FIXED' | null;
  percentage: number | null;
  fixedMinor: number | null;
}

interface BookingDto {
  id: string;
  status: string;
  startAt: string;
  endAt: string;
  totalPriceMinor: number;
  prepaidMinor: number;
}

let app: INestApplication;
let server: ReturnType<INestApplication['getHttpServer']>;
let supertest: typeof import('supertest');
let prisma: PrismaService;
let superuser: Client;
let businessId: string;
let serviceId: string;
let phoneSeq = 0;

const SERVICE = { name: 'Cut & Style', basePriceMinor: 4500, baseDurationMinutes: 30 };

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

function freshPhone(): string {
  phoneSeq += 1;
  return `+251${(900000000 + phoneSeq).toString().slice(-9)}`;
}

/** Future whole-minute ISO string (REQ-226: seconds = 0). */
function wholeMinuteInFuture(hoursFromNow: number): string {
  const d = new Date(Date.now() + hoursFromNow * 3_600_000);
  d.setSeconds(0, 0);
  return d.toISOString();
}

async function ownerToken(): Promise<string> {
  return login(TEST_EMAILS.owner, TEST_PASSWORDS.owner);
}

async function getConfig(
  token: string,
  bid = businessId,
): Promise<{ status: number; body: { prepayment?: ConfigDto; error?: { code: string } } }> {
  const res = await supertest(server)
    .get(`/api/v1/businesses/${bid}/prepayment-config`)
    .set(auth(token));
  return {
    status: res.status,
    body: res.body as { prepayment?: ConfigDto; error?: { code: string } },
  };
}

async function patchConfig(
  token: string,
  body: unknown,
  bid = businessId,
): Promise<{ status: number; body: { prepayment?: ConfigDto; error?: { code: string } } }> {
  const res = await supertest(server)
    .patch(`/api/v1/businesses/${bid}/prepayment-config`)
    .send(body as Record<string, unknown>)
    .set(auth(token));
  return {
    status: res.status,
    body: res.body as { prepayment?: ConfigDto; error?: { code: string } },
  };
}

async function createPublicBooking(
  overrides: Record<string, unknown> = {},
  slug = SLUG,
): Promise<{
  status: number;
  body: { created?: boolean; booking?: BookingDto; error?: { code: string } };
}> {
  const body = {
    customerName: 'Tigist Prepay',
    customerPhone: freshPhone(),
    note: 'prepayment integration',
    startAt: wholeMinuteInFuture(2),
    paymentMethod: 'BANK_TRANSFER',
    submissionKey: crypto.randomUUID(),
    services: JSON.stringify([{ serviceId, addOnIds: [] }]),
    ...overrides,
  };
  const req = supertest(server)
    .post(`/api/v1/public/businesses/${slug}/bookings`)
    .field('customerName', body.customerName as string)
    .field('customerPhone', body.customerPhone as string)
    .field('startAt', body.startAt as string)
    .field('paymentMethod', body.paymentMethod as string)
    .field('submissionKey', body.submissionKey as string)
    .field('services', body.services as string);
  if (body.note) req.field('note', body.note as string);
  const res = await req.attach('file', PNG, 'proof.png');
  return {
    status: res.status,
    body: res.body as { created?: boolean; booking?: BookingDto; error?: { code: string } },
  };
}

async function checkAvailability(): Promise<{
  status: number;
  body: { availability?: BookingDto & { available: boolean }; error?: { code: string } };
}> {
  const res = await supertest(server)
    .post(`/api/v1/public/businesses/${SLUG}/bookings/availability`)
    .send({ startAt: wholeMinuteInFuture(2), services: [{ serviceId, addOnIds: [] }] });
  return {
    status: res.status,
    body: res.body as {
      availability?: BookingDto & { available: boolean };
      error?: { code: string };
    },
  };
}

async function seedService(): Promise<string> {
  const token = await ownerToken();
  const res = await supertest(server)
    .post(`/api/v1/businesses/${businessId}/services`)
    .send(SERVICE)
    .set(auth(token));
  serviceId = (res.body.service as { id: string }).id;
  return serviceId;
}

async function createOwnedBusiness(slug: string): Promise<string> {
  const token = await ownerToken();
  const res = await supertest(server)
    .post('/api/v1/businesses')
    .send({ name: 'Prepay Test Studio 2', publicSlug: slug })
    .set(auth(token));
  return (res.body.business as { id: string }).id;
}

async function prepaidOnPayment(bookingId: string): Promise<bigint | null> {
  const row = await superuser.query<{ prepaid_minor: string | null }>(
    'SELECT prepaid_minor FROM payment WHERE booking_id = $1',
    [bookingId],
  );
  return row.rows[0]?.prepaid_minor ? BigInt(row.rows[0].prepaid_minor) : null;
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

  const { Client } = await import('pg');
  superuser = new Client({ connectionString: process.env.DATABASE_URL_SUPERUSER! });
  await superuser.connect();
  await superuser.query('TRUNCATE business_owner, business CASCADE');

  const token = await ownerToken();
  const created = await supertest(server)
    .post('/api/v1/businesses')
    .send({ name: 'Prepay Test Studio', publicSlug: SLUG })
    .set(auth(token));
  businessId = (created.body.business as { id: string }).id;
  void prisma;
});

afterAll(async () => {
  await superuser?.end();
  await app?.close();
});

beforeEach(async () => {
  await superuser.query(
    'TRUNCATE "booking", "payment", "payment_proof", "service", "service_variation", "add_on", "security_event" CASCADE',
  );
});

describe('A: owner config CRUD + validation', () => {
  it('returns DISABLED by default', async () => {
    const token = await ownerToken();
    const { status, body } = await getConfig(token);
    expect(status).toBe(200);
    expect(body.prepayment).toEqual({
      enabled: false,
      type: null,
      percentage: null,
      fixedMinor: null,
    });
  });

  it('enables PERCENTAGE 20', async () => {
    const token = await ownerToken();
    const { status, body } = await patchConfig(token, {
      enabled: true,
      type: 'PERCENTAGE',
      percentage: 20,
    });
    expect(status).toBe(200);
    expect(body.prepayment).toEqual({
      enabled: true,
      type: 'PERCENTAGE',
      percentage: 20,
      fixedMinor: null,
    });
  });

  it('switches to FIXED and clears percentage', async () => {
    const token = await ownerToken();
    await patchConfig(token, { enabled: true, type: 'PERCENTAGE', percentage: 20 });
    const { status, body } = await patchConfig(token, {
      enabled: true,
      type: 'FIXED',
      fixedMinor: 10000,
    });
    expect(status).toBe(200);
    expect(body.prepayment).toEqual({
      enabled: true,
      type: 'FIXED',
      percentage: null,
      fixedMinor: 10000,
    });
  });

  it('rejects mixing percentage and fixed (REQ-111 AC1)', async () => {
    const token = await ownerToken();
    const { status, body } = await patchConfig(token, {
      enabled: true,
      type: 'PERCENTAGE',
      percentage: 20,
      fixedMinor: 10000,
    });
    expect(status).toBe(400);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an out-of-range percentage + non-positive fixed', async () => {
    const token = await ownerToken();
    const pct = await patchConfig(token, { enabled: true, type: 'PERCENTAGE', percentage: 0 });
    expect(pct.status).toBe(400);
    expect(pct.body.error?.code).toBe('VALIDATION_ERROR');
    const fixed = await patchConfig(token, { enabled: true, type: 'FIXED', fixedMinor: 0 });
    expect(fixed.status).toBe(400);
    expect(fixed.body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('disables and resets the mode', async () => {
    const token = await ownerToken();
    await patchConfig(token, { enabled: true, type: 'FIXED', fixedMinor: 5000 });
    const { status, body } = await patchConfig(token, { enabled: false });
    expect(status).toBe(200);
    expect(body.prepayment).toEqual({
      enabled: false,
      type: null,
      percentage: null,
      fixedMinor: null,
    });
    const read = await getConfig(token);
    expect(read.body.prepayment).toEqual({
      enabled: false,
      type: null,
      percentage: null,
      fixedMinor: null,
    });
  });
});

describe('B: booking derivation + snapshot isolation', () => {
  it('availability reflects the configured deposit', async () => {
    await seedService();
    const token = await ownerToken();
    await patchConfig(token, { enabled: true, type: 'PERCENTAGE', percentage: 20 });
    const { status, body } = await checkAvailability();
    expect(status).toBe(200);
    expect(body.availability?.totalPriceMinor).toBe(SERVICE.basePriceMinor);
    expect(body.availability?.prepaidMinor).toBe(900); // 20% of 4500
  });

  it('create snapshots prepaid_minor from the config onto the payment', async () => {
    await seedService();
    const token = await ownerToken();
    await patchConfig(token, { enabled: true, type: 'PERCENTAGE', percentage: 20 });
    const { status, body } = await createPublicBooking();
    expect(status).toBe(200);
    expect(body.booking?.prepaidMinor).toBe(900);
    const db = await prepaidOnPayment(body.booking!.id);
    expect(db).toBe(900n);
  });

  it('FIXED config snapshots the fixed amount', async () => {
    await seedService();
    const token = await ownerToken();
    await patchConfig(token, { enabled: true, type: 'FIXED', fixedMinor: 10000 });
    const { status, body } = await createPublicBooking();
    expect(status).toBe(200);
    expect(body.booking?.prepaidMinor).toBe(10000);
    expect(await prepaidOnPayment(body.booking!.id)).toBe(10000n);
  });

  it('reconfiguration does not alter existing bookings', async () => {
    await seedService();
    const token = await ownerToken();
    // Book under PERCENTAGE 20.
    await patchConfig(token, { enabled: true, type: 'PERCENTAGE', percentage: 20 });
    const first = await createPublicBooking({ startAt: wholeMinuteInFuture(2) });
    expect(first.body.booking?.prepaidMinor).toBe(900);
    const firstId = first.body.booking!.id;

    // Reconfigure to FIXED 10000 and book a different slot.
    await patchConfig(token, { enabled: true, type: 'FIXED', fixedMinor: 10000 });
    const second = await createPublicBooking({ startAt: wholeMinuteInFuture(3) });
    expect(second.body.booking?.prepaidMinor).toBe(10000);

    // Disable entirely and book yet another slot.
    await patchConfig(token, { enabled: false });
    const third = await createPublicBooking({ startAt: wholeMinuteInFuture(4) });
    expect(third.body.booking?.prepaidMinor).toBe(0);

    // First booking is untouched.
    expect(await prepaidOnPayment(firstId)).toBe(900n);
  });

  it('DISABLED produces prepaidMinor 0 on availability + create', async () => {
    await seedService();
    const token = await ownerToken();
    await patchConfig(token, { enabled: false });
    const { body } = await checkAvailability();
    expect(body.availability?.prepaidMinor).toBe(0);
    const created = await createPublicBooking();
    expect(created.body.booking?.prepaidMinor).toBe(0);
  });
});

describe('C: tenant isolation + authorization', () => {
  it('a same owner can configure their second business independently', async () => {
    // A multi-business owner manages each tenant's config separately (no bleed-over).
    const token = await ownerToken();
    const otherId = await createOwnedBusiness('prepay-test-2');

    const read = await getConfig(token, otherId);
    expect(read.status).toBe(200); // same owner → allowed
    expect(read.body.prepayment).toEqual({
      enabled: false,
      type: null,
      percentage: null,
      fixedMinor: null,
    });

    const write = await patchConfig(
      token,
      { enabled: true, type: 'FIXED', fixedMinor: 5000 },
      otherId,
    );
    expect(write.status).toBe(200);
    expect(await getConfig(token, otherId).then((r) => r.body.prepayment?.fixedMinor)).toBe(5000);

    // The primary business config is untouched by the sibling's change.
    expect((await getConfig(token)).body.prepayment?.enabled).toBe(false);
  });

  it('another owner cannot read or write a business they do not own', async () => {
    const other = await login(TEST_EMAILS.owner2, TEST_PASSWORDS.owner);
    const read = await getConfig(other);
    expect(read.status).toBe(403);
    expect(read.body.error?.code).toBe('FORBIDDEN');
    const write = await patchConfig(other, { enabled: true, type: 'FIXED', fixedMinor: 5000 });
    expect(write.status).toBe(403);
    expect(write.body.error?.code).toBe('FORBIDDEN');
  });

  it('Admin and Super Admin are rejected by RolesExact(Owner)', async () => {
    const admin = await login(TEST_EMAILS.admin1, TEST_PASSWORDS.admin);
    const sa = await login(TEST_EMAILS.sa, TEST_PASSWORDS.sa);
    for (const token of [admin, sa]) {
      const read = await getConfig(token);
      expect(read.status).toBe(403);
      expect(read.body.error?.code).toBe('FORBIDDEN');
      const write = await patchConfig(token, { enabled: true, type: 'FIXED', fixedMinor: 5000 });
      expect(write.status).toBe(403);
      expect(write.body.error?.code).toBe('FORBIDDEN');
    }
  });

  it('a business B booking never consumes business A prepayment config', async () => {
    // Business B is DISABLED by default while business A has FIXED 10000.
    const token = await ownerToken();
    const otherId = await createOwnedBusiness('prepay-test-b');
    const otherServiceId = await (async () => {
      const res = await supertest(server)
        .post(`/api/v1/businesses/${otherId}/services`)
        .send(SERVICE)
        .set(auth(token));
      return (res.body.service as { id: string }).id;
    })();

    await patchConfig(token, { enabled: true, type: 'FIXED', fixedMinor: 10000 });
    await seedService();

    const b = await createPublicBooking(
      { services: JSON.stringify([{ serviceId: otherServiceId, addOnIds: [] }]) },
      'prepay-test-b',
    );
    expect(b.status).toBe(200);
    expect(b.body.booking?.prepaidMinor).toBe(0); // B never consumes A's FIXED config

    const a = await createPublicBooking();
    expect(a.status).toBe(200);
    expect(a.body.booking?.prepaidMinor).toBe(10000); // A still applies its own config
  });

  it('anonymous access to the owner config is rejected (401)', async () => {
    const res = await supertest(server)
      .get(`/api/v1/businesses/${businessId}/prepayment-config`)
      .set(CSRF);
    expect(res.status).toBe(401);
    const patch = await supertest(server)
      .patch(`/api/v1/businesses/${businessId}/prepayment-config`)
      .send({ enabled: true })
      .set(CSRF);
    expect(patch.status).toBe(401);
  });
});
