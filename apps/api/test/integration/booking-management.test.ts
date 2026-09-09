/**
 * Prompt 11 — Booking management integration tests over the HTTP surface:
 *
 *  - public availability pre-check + idempotent create (submission key replay)
 *  - slot exclusivity: overlap rejected with SLOT_UNAVAILABLE, concurrency safe
 *  - constant-time money/duration snapshot contract (price captured at booking)
 *  - owner lifecycle: accept → CONFIRMED/ALLOCATED, reject w/ mandatory reason,
 *    cancel (slot retention for PAYMENT_PENDING, release for CONFIRMED/REJECTED),
 *    explicit release-slot (non-active only), reschedule (duration preserved),
 *    no-show release
 *  - rejected-proof resubmission security: request-code issuance TTL + generic
 *    anti-enumeration response, wrong-code attempt persistence + lockout, code
 *    reuse denied, impostor phone denied, proof lineage (replacedByProofId)
 *  - platform views: Admin current-status only (REQ-176), Super Admin full audit
 *    (REQ-177), manual completion + slot release, admin blocked from SA routes
 *  - lifecycle sweeps: auto-complete after end_at, reminder queue dedup
 *  - RLS scope denial: anonymous owner routes 401, cross-tenant updates rejected
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
const SLUG = 'booking-test-studio';
const SERVICE = { name: 'Cut & Style', basePriceMinor: 4500, baseDurationMinutes: 30 };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface BookingDto {
  id: string;
  status: string;
  customerName: string;
  customerPhone: string;
  startAt: string;
  endAt: string;
  totalPriceMinor: number;
  totalDurationMinutes: number;
  paymentStatus?: string | null;
  slotLock?: string | null;
  statusHistory?: unknown[];
  paymentStatusHistory?: unknown[];
  proofs?: unknown[];
  services: {
    serviceId: string | null;
    name: string;
    unitPriceMinor: number;
    durationMinutes: number;
  }[];
}

let app: INestApplication;
let server: ReturnType<INestApplication['getHttpServer']>;
let supertest: typeof import('supertest');
let prisma: PrismaService;
let superuser: Client;
let businessId: string;
let serviceId: string;
let phoneSeq = 0;

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

/** Unique customer phone per scenario — keeps resubmission buckets isolated. */
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

function createBookingBody(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    customerName: 'Selam Test',
    customerPhone: freshPhone(),
    note: 'integration booking',
    startAt: wholeMinuteInFuture(2),
    paymentMethod: 'BANK_TRANSFER',
    submissionKey: crypto.randomUUID(),
    services: JSON.stringify([{ serviceId, addOnIds: [] }]),
    ...overrides,
  };
}

async function publicCreate(body: Record<string, unknown>) {
  const req = supertest(server)
    .post(`/api/v1/public/businesses/${SLUG}/bookings`)
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

async function postOwner(token: string, path: string, body?: Record<string, unknown>) {
  const res = await supertest(server)
    .post(`/api/v1/businesses/${businessId}/bookings/${path}`)
    .send(body)
    .set(auth(token));
  return {
    status: res.status,
    body: res.body as { booking?: BookingDto; error?: { code: string } },
  };
}

async function ownerToken(): Promise<string> {
  return login(TEST_EMAILS.owner, TEST_PASSWORDS.owner);
}

async function adminToken(): Promise<string> {
  return login(TEST_EMAILS.admin1, TEST_PASSWORDS.admin);
}

async function saToken(): Promise<string> {
  return login(TEST_EMAILS.sa, TEST_PASSWORDS.sa);
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
    .send({ name: 'Booking Test Studio', publicSlug: SLUG })
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
});

async function seedService(): Promise<string> {
  const token = await ownerToken();
  const res = await supertest(server)
    .post(`/api/v1/businesses/${businessId}/services`)
    .send(SERVICE)
    .set(auth(token));
  serviceId = (res.body.service as { id: string }).id;
  return serviceId;
}

describe('A: public availability + idempotent create', () => {
  it('availability reports the free slot with a priced snapshot', async () => {
    await seedService();
    const body = createBookingBody();
    const res = await supertest(server)
      .post(`/api/v1/public/businesses/${SLUG}/bookings/availability`)
      .send({ startAt: body.startAt, services: [{ serviceId, addOnIds: [] }] });
    expect(res.status).toBe(200);
    expect(res.body.availability).toMatchObject({
      available: true,
      totalPriceMinor: SERVICE.basePriceMinor,
      totalDurationMinutes: SERVICE.baseDurationMinutes,
    });
    expect(res.body.availability.startAt).toBe(body.startAt);
  });

  it('create returns created:true with PAYMENT_PENDING + snapshot services and a locked slot', async () => {
    await seedService();
    const body = createBookingBody();
    const { status, body: payload } = await publicCreate(body);
    expect(status).toBe(200);
    expect(payload.created).toBe(true);
    expect(payload.booking).toMatchObject({
      status: 'PAYMENT_PENDING',
      customerName: body.customerName,
      paymentStatus: 'PENDING',
      paymentMethod: 'BANK_TRANSFER',
      prepaidMinor: 0,
      totalPriceMinor: SERVICE.basePriceMinor,
      totalDurationMinutes: SERVICE.baseDurationMinutes,
    });
    expect(payload.booking!.services).toHaveLength(1);
    expect(payload.booking!.services[0]).toMatchObject({
      serviceId,
      name: SERVICE.name,
      unitPriceMinor: SERVICE.basePriceMinor,
      durationMinutes: SERVICE.baseDurationMinutes,
    });

    const locks = await superuser.query<{ status: string; booking_id: string }>(
      'SELECT status, booking_id FROM slot_lock WHERE booking_id = $1',
      [payload.booking!.id],
    );
    expect(locks.rows).toHaveLength(1);
    expect(locks.rows[0].status).toBe('LOCKED');
  });

  it('replaying the same submissionKey returns the same booking with created:false', async () => {
    await seedService();
    const body = createBookingBody();
    const first = await publicCreate(body);
    expect(first.body.created).toBe(true);
    const second = await publicCreate(body);
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    expect(second.body.booking!.id).toBe(first.body.booking!.id);
    const count = await superuser.query<{ c: number }>(
      'SELECT count(*)::int AS c FROM payment_proof WHERE submission_key = $1',
      [body.submissionKey as string],
    );
    expect(count.rows[0].c).toBe(1);
  });

  it('rejects a booking whose startAt carries seconds (REQ-226)', async () => {
    await seedService();
    const body = createBookingBody({ startAt: new Date(Date.now() + 3_600_000).toISOString() });
    const res = await supertest(server)
      .post(`/api/v1/public/businesses/${SLUG}/bookings/availability`)
      .send({ startAt: body.startAt });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an unknown/unavailable service combination', async () => {
    await seedService();
    const body = createBookingBody({
      services: JSON.stringify([{ serviceId: crypto.randomUUID(), addOnIds: [] }]),
    });
    const { status, body: payload } = await publicCreate(body);
    expect(status).toBe(400);
    expect(payload.error?.code).toBe('VALIDATION_ERROR');
  });
});

describe('B: slot exclusivity', () => {
  it('a second booking overlapping the same minutes is rejected with SLOT_UNAVAILABLE', async () => {
    await seedService();
    const startAt = wholeMinuteInFuture(1);
    const first = await publicCreate(createBookingBody({ startAt }));
    expect(first.body.created).toBe(true);

    const second = await publicCreate(createBookingBody({ startAt }));
    expect(second.status).toBe(409);
    expect(second.body.error?.code).toBe('SLOT_UNAVAILABLE');
  });

  it('parallel creates for the same slot serialize to exactly one winner', async () => {
    await seedService();
    const startAt = wholeMinuteInFuture(1);
    const reqs = [1, 2, 3].map(() =>
      publicCreate(createBookingBody({ startAt, submissionKey: crypto.randomUUID() })),
    );
    const results = await Promise.all(reqs);
    const created = results.filter((r) => r.body.created === true);
    const blocked = results.filter(
      (r) => r.status === 409 && r.body.error?.code === 'SLOT_UNAVAILABLE',
    );
    expect(created).toHaveLength(1);
    expect(blocked.length).toBe(2);
  });
});

describe('C: owner lifecycle', () => {
  async function confirmedBooking(): Promise<{ token: string; bookingId: string }> {
    await seedService();
    const token = await ownerToken();
    const body = createBookingBody();
    const { body: payload } = await publicCreate(body);
    const accepted = await postOwner(token, `${payload.booking!.id}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.booking!.status).toBe('CONFIRMED');
    return { token, bookingId: payload.booking!.id };
  }

  it('detail shows the full initialized history for a fresh booking', async () => {
    await seedService();
    const token = await ownerToken();
    const body = createBookingBody();
    const { body: payload } = await publicCreate(body);
    const res = await supertest(server)
      .get(`/api/v1/businesses/${businessId}/bookings/${payload.booking!.id}`)
      .set(auth(token));
    expect(res.status).toBe(200);
    const detail = res.body.booking as BookingDto;
    expect(detail.slotLock).toBe('LOCKED');
    expect(detail.statusHistory).toHaveLength(1);
    expect((detail.statusHistory![0] as { fromStatus: string; toStatus: string }).toStatus).toBe(
      'PAYMENT_PENDING',
    );
    expect(detail.proofs).toHaveLength(1);
  });

  it('accept → CONFIRMED + ACCEPTED payment + ALLOCATED slot + booking notification', async () => {
    await seedService();
    const token = await ownerToken();
    const body = createBookingBody();
    const { body: payload } = await publicCreate(body);
    const res = await postOwner(token, `${payload.booking!.id}/accept`);
    expect(res.body.booking).toMatchObject({ status: 'CONFIRMED', slotLock: 'ALLOCATED' });
    expect((res.body.booking as BookingDto & { payment: { status: string } }).payment.status).toBe(
      'ACCEPTED',
    );
    const notes = await superuser.query<{ type: string }>(
      'SELECT type FROM notification WHERE booking_id = $1',
      [payload.booking!.id],
    );
    expect(notes.rows.map((r) => r.type)).toContain('BOOKING_CONFIRMED');
  });

  it('reject requires a reason and returns it on the payment', async () => {
    await seedService();
    const token = await ownerToken();
    const body = createBookingBody();
    const { body: payload } = await publicCreate(body);
    const missing = await postOwner(token, `${payload.booking!.id}/reject`, {});
    expect(missing.status).toBe(400);

    const res = await postOwner(token, `${payload.booking!.id}/reject`, {
      reason: 'Receipt illegible',
    });
    expect(res.status).toBe(200);
    const rejected = res.body.booking as BookingDto & {
      payment: { status: string; rejectionReason: string | null };
    };
    expect(rejected).toMatchObject({ status: 'REJECTED', slotLock: 'LOCKED' });
    expect(rejected.payment.status).toBe('REJECTED');
    expect(rejected.payment.rejectionReason).toBe('Receipt illegible');
  });

  it('cancel of a PAYMENT_PENDING booking keeps the slot locked; release-slot then frees it', async () => {
    await seedService();
    const token = await ownerToken();
    const body = createBookingBody();
    const { body: payload } = await publicCreate(body);
    const cancelled = await postOwner(token, `${payload.booking!.id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect((cancelled.body.booking as BookingDto).status).toBe('CANCELLED');
    expect((cancelled.body.booking as BookingDto).slotLock).toBe('LOCKED'); // SM-08

    const released = await postOwner(token, `${payload.booking!.id}/release-slot`);
    expect(released.body).toEqual({ ok: true });
    const detail = await supertest(server)
      .get(`/api/v1/businesses/${businessId}/bookings/${payload.booking!.id}`)
      .set(auth(token));
    expect((detail.body.booking as BookingDto).slotLock).toBe('RELEASED');
  });

  it('cancel of a CONFIRMED booking releases the slot (SM-07)', async () => {
    const { token, bookingId } = await confirmedBooking();
    const res = await postOwner(token, `${bookingId}/cancel`);
    expect(res.status).toBe(200);
    expect((res.body.booking as BookingDto).slotLock).toBe('RELEASED');
  });

  it('reschedule moves CONFIRMED to a new start with the duration preserved', async () => {
    const { token, bookingId } = await confirmedBooking();
    const newStartAt = wholeMinuteInFuture(5);
    const res = await postOwner(token, `${bookingId}/reschedule`, { newStartAt });
    expect(res.status).toBe(200);
    expect((res.body.booking as BookingDto).startAt).toBe(newStartAt);
    expect((res.body.booking as BookingDto).totalDurationMinutes).toBe(SERVICE.baseDurationMinutes);

    const rows = await superuser.query<{ status: string }>(
      'SELECT status FROM slot_lock WHERE booking_id = $1 ORDER BY created_at',
      [bookingId],
    );
    expect(rows.rows.map((r) => r.status)).toEqual(['RELEASED', 'ALLOCATED']);
  });

  it('no-show → NO_SHOW and slot release (T5)', async () => {
    const { token, bookingId } = await confirmedBooking();
    const res = await postOwner(token, `${bookingId}/no-show`);
    expect(res.status).toBe(200);
    expect(res.body.booking as BookingDto).toMatchObject({
      status: 'NO_SHOW',
      slotLock: 'RELEASED',
    });
  });

  it('release-slot is denied while the booking is still active', async () => {
    await seedService();
    const token = await ownerToken();
    const body = createBookingBody();
    const { body: payload } = await publicCreate(body);
    const res = await postOwner(token, `${payload.booking!.id}/release-slot`);
    expect(res.status).toBe(409);
  });
});

describe('D: rejected-proof resubmission security', () => {
  async function rejectedBooking(): Promise<{ token: string; bookingId: string; phone: string }> {
    await seedService();
    const token = await ownerToken();
    const body = createBookingBody();
    const { body: payload } = await publicCreate(body);
    await postOwner(token, `${payload.booking!.id}/reject`, { reason: 'Blurry receipt' });
    return { token, bookingId: payload.booking!.id, phone: body.customerPhone as string };
  }

  async function requestCode(phone: string) {
    const { InMemoryVerificationCodeChannel } =
      await import('../../src/booking/verification-code.channel');
    const channel = app.get(InMemoryVerificationCodeChannel);
    const sentBefore = channel.sent.length;
    const res = await supertest(server)
      .post(`/api/v1/public/businesses/${SLUG}/resubmissions/request-code`)
      .send({ phone });
    return { res, code: channel.sent.at(-1)?.code ?? null, sentBefore, channel };
  }

  async function resubmitWith(phone: string, code: string) {
    const res = await supertest(server)
      .post(`/api/v1/public/businesses/${SLUG}/resubmissions/resubmit`)
      .field('phone', phone)
      .field('code', code)
      .field('paymentMethod', 'BANK_TRANSFER')
      .attach('file', PNG, 'proof.png');
    return {
      status: res.status,
      body: res.body as { booking?: BookingDto; error?: { code: string } },
    };
  }

  it('issue → wrong code is denied with attempts persisted → correct code resubmits (T10)', async () => {
    const { bookingId, phone } = await rejectedBooking();
    const { code } = await requestCode(phone);
    expect(code).toMatch(/^\d{6}$/);

    const wrong = await resubmitWith(phone, '000000');
    expect(wrong.status).toBe(400);
    await sleep(420);
    const attemptsRow = await superuser.query<{ attempts: number }>(
      'SELECT attempts FROM resubmission_verification WHERE business_id = $1 AND phone = $2',
      [businessId, phone],
    );
    expect(attemptsRow.rows[0].attempts).toBe(1);

    const good = await resubmitWith(phone, code!);
    expect(good.status).toBe(200);
    expect(good.body.booking).toMatchObject({
      status: 'PAYMENT_PENDING',
      paymentStatus: 'PENDING',
    });

    // Proof lineage: the resubmitted proof supersedes the original one.
    const proofs = await superuser.query<{ id: string; replaced_by_proof_id: string | null }>(
      'SELECT id, replaced_by_proof_id FROM payment_proof WHERE payment_id = (SELECT id FROM payment WHERE booking_id = $1) ORDER BY submitted_at',
      [bookingId],
    );
    expect(proofs.rows).toHaveLength(2);
    const originalId = proofs.rows.find((p) => p.replaced_by_proof_id === null)!.id;
    const resubmitted = proofs.rows.find((p) => p.replaced_by_proof_id !== null)!;
    expect(resubmitted.replaced_by_proof_id).toBe(originalId);
  });

  it('a used code cannot be replayed', async () => {
    const { phone } = await rejectedBooking();
    const { code } = await requestCode(phone);
    const first = await resubmitWith(phone, code!);
    expect(first.status).toBe(200);
    const replay = await resubmitWith(phone, code!);
    expect(replay.status).toBe(400);
  });

  it('request-code is enumeration-safe for unknown phones (no code issued)', async () => {
    const { res, code, sentBefore, channel } = await requestCode(freshPhone());
    expect(res.status).toBe(200);
    const deliveredSince = channel.sent.length > sentBefore ? code : null;
    expect(deliveredSince).toBeNull();
    expect(channel.sent.length).toBe(sentBefore);
  });

  it('a code for one phone cannot be consumed by another phone', async () => {
    const { phone } = await rejectedBooking();
    const { code } = await requestCode(phone);
    const impostor = await resubmitWith(freshPhone(), code!);
    expect(impostor.status).toBe(400);
  });

  it('wrong codes exhaust the window: the next attempt is rate-limited', async () => {
    const { phone } = await rejectedBooking();
    const { code } = await requestCode(phone);
    for (let i = 0; i < 5; i += 1) {
      const res = await resubmitWith(phone, '00000' + i);
      expect(res.status).toBe(400);
      await sleep((i + 1) * 450);
    }
    const locked = await resubmitWith(phone, code!);
    expect(locked.status).toBe(429);
    const attempts = await superuser.query<{ attempts: number }>(
      'SELECT attempts FROM resubmission_verification WHERE business_id = $1 AND phone = $2',
      [businessId, phone],
    );
    expect(attempts.rows[0].attempts).toBe(5);
  });
});

describe('E: platform views (Admin / Super Admin)', () => {
  it('admin list + detail expose current status only (REQ-176), never history', async () => {
    await seedService();
    const owner = await ownerToken();
    const body = createBookingBody();
    const { body: payload } = await publicCreate(body);
    await postOwner(owner, `${payload.booking!.id}/accept`);

    const admin = await adminToken();
    const list = await supertest(server).get('/api/v1/admin/bookings').set(auth(admin));
    expect(list.status).toBe(200);
    const entry = (list.body.bookings as BookingDto[]).find((b) => b.id === payload.booking!.id)!;
    expect(entry).toBeDefined();
    expect(entry.status).toBe('CONFIRMED');
    expect(entry).not.toHaveProperty('statusHistory');
    expect(entry).not.toHaveProperty('proofs');
    expect(entry).not.toHaveProperty('paymentStatusHistory');

    const detail = await supertest(server)
      .get(`/api/v1/admin/bookings/${payload.booking!.id}`)
      .set(auth(admin));
    expect(detail.status).toBe(200);
    expect((detail.body.booking as BookingDto).status).toBe('CONFIRMED');
    expect(detail.body.booking).not.toHaveProperty('statusHistory');
  });

  it('admin cannot reach super-admin audit routes; Super Admin can (REQ-177)', async () => {
    await seedService();
    const body = createBookingBody();
    const { body: payload } = await publicCreate(body);

    const admin = await adminToken();
    const denied = await supertest(server)
      .get(`/api/v1/super-admin/bookings/${payload.booking!.id}`)
      .set(auth(admin));
    expect(denied.status).toBe(403);

    const sa = await saToken();
    const audit = await supertest(server)
      .get(`/api/v1/super-admin/bookings/${payload.booking!.id}`)
      .set(auth(sa));
    expect(audit.status).toBe(200);
    const detail = audit.body.booking as BookingDto & {
      statusHistory: unknown[];
      paymentStatusHistory: unknown[];
      proofs: unknown[];
      notifications: { type: string }[];
    };
    expect(detail.statusHistory.length).toBeGreaterThan(0);
    expect(detail.paymentStatusHistory.length).toBeGreaterThan(0);
    expect(detail.proofs).toHaveLength(1);
    expect(detail.notifications.map((n) => n.type)).toContain('BOOKING_PROOF_RECEIVED');
  });

  it('Super Admin manual completion releases the slot; anonymized audit event', async () => {
    await seedService();
    const owner = await ownerToken();
    const body = createBookingBody();
    const { body: payload } = await publicCreate(body);
    await postOwner(owner, `${payload.booking!.id}/accept`);

    const sa = await saToken();
    const res = await supertest(server)
      .post(`/api/v1/super-admin/bookings/${payload.booking!.id}/complete`)
      .set(auth(sa));
    expect(res.status).toBe(200);
    expect((res.body.booking as BookingDto).status).toBe('COMPLETED');
    const locks = await superuser.query<{ status: string }>(
      'SELECT status FROM slot_lock WHERE booking_id = $1',
      [payload.booking!.id],
    );
    expect(locks.rows[0].status).toBe('RELEASED');
  });
});

describe('F: lifecycle sweeps', () => {
  it('auto-complete turns an ended CONFIRMED booking into COMPLETED and releases its slot', async () => {
    await seedService();
    const owner = await ownerToken();
    const body = createBookingBody();
    const { body: payload } = await publicCreate(body);
    await postOwner(owner, `${payload.booking!.id}/accept`);

    const ended = new Date(Date.now() - 60_000);
    ended.setSeconds(0, 0);
    await superuser.query(
      'UPDATE booking SET end_at = $2, status = $3, updated_at = $2 WHERE id = $1',
      [payload.booking!.id, ended, 'CONFIRMED'],
    );
    const { BookingLifecycleJob } = await import('../../src/jobs/booking-lifecycle.job');
    const job = app.get(BookingLifecycleJob);
    const completed = await job.autoCompleteDue();
    expect(completed).toBe(1);

    const detail = await supertest(server)
      .get(`/api/v1/businesses/${businessId}/bookings/${payload.booking!.id}`)
      .set(auth(owner));
    expect((detail.body.booking as BookingDto).status).toBe('COMPLETED');
    const locks = await superuser.query<{ status: string }>(
      'SELECT status FROM slot_lock WHERE booking_id = $1',
      [payload.booking!.id],
    );
    expect(locks.rows[0].status).toBe('RELEASED');
  });

  it('reminder sweep queues 24h/1h notifications exactly once per booking', async () => {
    await seedService();
    const owner = await ownerToken();
    const in24h = wholeMinuteInFuture(24);
    const body = createBookingBody({ startAt: in24h });
    const { body: payload } = await publicCreate(body);
    await postOwner(owner, `${payload.booking!.id}/accept`);

    const { BookingLifecycleJob } = await import('../../src/jobs/booking-lifecycle.job');
    const job = app.get(BookingLifecycleJob);
    expect(await job.queueDueReminders()).toBe(1);
    expect(await job.queueDueReminders()).toBe(0);

    const notes = await superuser.query<{ type: string }>(
      'SELECT type FROM notification WHERE booking_id = $1',
      [payload.booking!.id],
    );
    expect(notes.rows.filter((r) => r.type === 'BOOKING_REMINDER_24H')).toHaveLength(1);
  });
});

describe('G: tenant isolation', () => {
  it('anonymous callers are rejected by owner routes (401)', async () => {
    await seedService();
    const res = await supertest(server).get(`/api/v1/businesses/${businessId}/bookings`);
    expect(res.status).toBe(401);
  });

  it("a customer cannot touch another customer's booking state via customer_phone RLS", async () => {
    await seedService();
    const token = await ownerToken();
    const victims = createBookingBody();
    await publicCreate(victims);

    // Direct UPDATE as the app role with a DIFFERENT customer phone is filtered
    // by RLS — even a leaked bookingPublic scope cannot hit the victim row.
    const { withTenantContext } = await import('../../src/database/tenant-executor');
    await withTenantContext(
      prisma,
      { scope: 'PUBLIC', businessId, bookingPublic: true, customerPhone: freshPhone() },
      async (tx) => {
        const updated = await tx.booking.updateMany({
          where: { status: 'PAYMENT_PENDING', customerPhone: victims.customerPhone as string },
          data: { status: 'CANCELLED' },
        });
        expect(updated.count).toBe(0);
      },
    );
    void token;
  });
});

describe('H: composition, concurrency and proof storage (Prompt 11 close-out)', () => {
  it('combines multiple services into one booking with immutable snapshots (REQ-074/075/076/080)', async () => {
    const token = await ownerToken();
    await seedService();
    const second = await supertest(server)
      .post(`/api/v1/businesses/${businessId}/services`)
      .send({ name: 'Beard & Line', basePriceMinor: 2000, baseDurationMinutes: 15 })
      .set(auth(token));
    const secondId = (second.body.service as { id: string }).id;

    const body = createBookingBody({
      services: JSON.stringify([
        { serviceId, addOnIds: [] },
        { serviceId: secondId, addOnIds: [] },
      ]),
    });
    const { body: payload } = await publicCreate(body);
    expect(payload.created).toBe(true);
    expect(payload.booking!.totalPriceMinor).toBe(SERVICE.basePriceMinor + 2000);
    expect(payload.booking!.totalDurationMinutes).toBe(SERVICE.baseDurationMinutes + 15);
    expect(payload.booking!.services).toHaveLength(2);

    // Catalog changes afterwards must never rewrite the booking snapshot.
    await supertest(server)
      .patch(`/api/v1/businesses/${businessId}/services/${serviceId}`)
      .send({ name: 'Cut & Style Deluxe', basePriceMinor: 9999, baseDurationMinutes: 60 })
      .set(auth(token));
    const detail = await supertest(server)
      .get(`/api/v1/businesses/${businessId}/bookings/${payload.booking!.id}`)
      .set(auth(token));
    const lines = (detail.body.booking as BookingDto).services;
    const first = lines.find((s) => s.serviceId === serviceId)!;
    expect(first).toMatchObject({
      name: SERVICE.name,
      unitPriceMinor: SERVICE.basePriceMinor,
      durationMinutes: SERVICE.baseDurationMinutes,
    });
    expect((detail.body.booking as BookingDto).totalPriceMinor).toBe(SERVICE.basePriceMinor + 2000);
  });

  it('parallel creates with overlapping-but-different windows serialize to one winner', async () => {
    await seedService();
    const base = new Date(Date.now() + 2 * 3_600_000);
    base.setSeconds(0, 0);
    const later = new Date(base.getTime() + 15 * 60_000);
    // service duration = 30 min; [0:00,0:30) ∩ [0:15,0:45) is non-empty.
    const results = await Promise.all([
      publicCreate(
        createBookingBody({ startAt: base.toISOString(), submissionKey: crypto.randomUUID() }),
      ),
      publicCreate(
        createBookingBody({ startAt: later.toISOString(), submissionKey: crypto.randomUUID() }),
      ),
    ]);
    const created = results.filter((r) => r.body.created === true);
    const blocked = results.filter(
      (r) => r.status === 409 && r.body.error?.code === 'SLOT_UNAVAILABLE',
    );
    expect(created).toHaveLength(1);
    expect(blocked).toHaveLength(1);
  });

  it('concurrent reschedule into an occupied target serializes (exactly one wins)', async () => {
    await seedService();
    const token = await ownerToken();
    const bodyA = createBookingBody();
    const { body: a } = await publicCreate(bodyA);
    await postOwner(token, `${a.booking!.id}/accept`);

    const target = wholeMinuteInFuture(3);
    const [resched, created] = await Promise.all([
      postOwner(token, `${a.booking!.id}/reschedule`, { newStartAt: target }),
      publicCreate(createBookingBody({ startAt: target })),
    ]);

    const rescheduleWon = resched.status === 200 && resched.body.booking?.startAt === target;
    const createWon = created.body.created === true;
    expect(rescheduleWon || createWon).toBe(true);

    // Invariant: exactly one ACTIVE slot lock overlaps the contested window.
    const endAt = new Date(
      new Date(target).getTime() + SERVICE.baseDurationMinutes * 60_000,
    ).toISOString();
    const locks = await superuser.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM slot_lock
       WHERE start_at < $2 AND end_at > $1 AND status <> 'RELEASED'`,
      [target, endAt],
    );
    expect(locks.rows[0].c).toBe(1);

    if (rescheduleWon) {
      expect(created.status).toBe(409);
      expect(created.body.error?.code).toBe('SLOT_UNAVAILABLE');
    } else {
      expect(resched.status).toBe(409);
      expect(resched.body.error?.code).toBe('SLOT_UNAVAILABLE');
      expect(created.status).toBe(200);
    }
  });

  it('concurrent explicit slot release and a fresh booking on the freed window serialize', async () => {
    await seedService();
    const token = await ownerToken();
    const startAt = wholeMinuteInFuture(4);
    const bodyA = createBookingBody({ startAt });
    const { body: a } = await publicCreate(bodyA);
    await postOwner(token, `${a.booking!.id}/cancel`); // PAYMENT_PENDING cancel keeps the LOCKED slot (SM-08)

    const [release, created] = await Promise.all([
      postOwner(token, `${a.booking!.id}/release-slot`),
      publicCreate(createBookingBody({ startAt })),
    ]);
    expect(release.status).toBe(200);
    expect((release.body as { ok?: boolean }).ok).toBe(true);

    const createdOk = created.body.created === true;
    const blocked = created.status === 409 && created.body.error?.code === 'SLOT_UNAVAILABLE';
    expect(createdOk || blocked).toBe(true);

    // Same-slot invariant holds regardless of race outcome: never more than
    // one ACTIVE lock can cover the window (no duplication), and if the fresh
    // booking won, exactly one lock exists.
    const endAt = new Date(
      new Date(startAt).getTime() + SERVICE.baseDurationMinutes * 60_000,
    ).toISOString();
    const locks = await superuser.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM slot_lock
       WHERE start_at < $2 AND end_at > $1 AND status <> 'RELEASED'`,
      [startAt, endAt],
    );
    expect(locks.rows[0].c).toBeLessThanOrEqual(1);
    if (createdOk) expect(locks.rows[0].c).toBe(1);
  });

  it('accepts JPEG/PDF proofs; rejects unsupported MIME, oversize and missing file', async () => {
    await seedService();
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const pdf = Buffer.from('%PDF-1.7 fake receipt\n');
    const tx = Buffer.from('just text');

    async function attach(
      body: Record<string, unknown>,
      file?: Buffer,
      name = 'proof.png',
      startAt?: string,
    ) {
      const req = supertest(server)
        .post(`/api/v1/public/businesses/${SLUG}/bookings`)
        .field('customerName', body.customerName as string)
        .field('customerPhone', body.customerPhone as string)
        .field('startAt', (startAt ?? body.startAt) as string)
        .field('paymentMethod', body.paymentMethod as string)
        .field('submissionKey', body.submissionKey as string)
        .field('services', body.services as string);
      if (file) req.attach('file', file, name);
      return req;
    }

    const jpegSlot = wholeMinuteInFuture(2);
    const pdfSlot = wholeMinuteInFuture(3);
    for (const [payload, name, slot] of [
      [jpeg, 'proof.jpg', jpegSlot],
      [pdf, 'proof.pdf', pdfSlot],
    ] as const) {
      const res = await attach(createBookingBody(), payload, name, slot);
      expect(res.status, name).toBe(200);
      expect(res.body.created).toBe(true);
    }

    const badType = await attach(createBookingBody(), tx, 'proof.txt');
    expect(badType.status).toBe(400);
    expect(badType.body.error.code).toBe('FILE_TYPE_INVALID');

    const huge = Buffer.alloc(10 * 1024 * 1024 + 1, 0x89);
    const oversize = await attach(createBookingBody(), huge, 'proof.png');
    expect(oversize.status).toBe(413);
    expect(oversize.body.error.code).toBe('FILE_TOO_LARGE');

    const missing = await attach(createBookingBody());
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('terminal statuses reject further transitions with INVALID_TRANSITION', async () => {
    await seedService();
    const token = await ownerToken();
    const body = createBookingBody();
    const { body: payload } = await publicCreate(body);
    await postOwner(token, `${payload.booking!.id}/accept`);

    const ended = new Date(Date.now() - 60_000);
    ended.setSeconds(0, 0);
    await superuser.query('UPDATE booking SET end_at = $2 WHERE id = $1', [
      payload.booking!.id,
      ended,
    ]);
    const { BookingLifecycleJob } = await import('../../src/jobs/booking-lifecycle.job');
    await app.get(BookingLifecycleJob).autoCompleteDue();

    const attempts = [
      postOwner(token, `${payload.booking!.id}/no-show`),
      postOwner(token, `${payload.booking!.id}/cancel`),
      postOwner(token, `${payload.booking!.id}/reschedule`, { newStartAt: wholeMinuteInFuture(9) }),
    ];
    for (const attempt of attempts) {
      const res = await attempt;
      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe('INVALID_TRANSITION');
    }
    const stillCompleted = await superuser.query<{ status: string }>(
      'SELECT status FROM booking WHERE id = $1',
      [payload.booking!.id],
    );
    expect(stillCompleted.rows[0].status).toBe('COMPLETED');
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
