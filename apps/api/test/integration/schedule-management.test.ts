/**
 * Prompt 12 — Scheduling management integration tests over the HTTP surface:
 *
 *  - owner save (ACTIVE) + current view + idempotent re-save (one ACTIVE)
 *  - pause → PENDING versions (multiple allowed), resume activates LATEST
 *    pending (SUPERSEDED others) and swaps availability
 *  - booking gate: create inside an ACTIVE window OK, outside → SLOT_UNAVAILABLE,
 *    and the slot stays blocked after a keep exception (never generally bookable)
 *  - affected sweep: ACTIVE save + resume surface warnings, persist
 *    schedule_conflict and enqueue the grouped SCHEDULE_AFFECTED_OWNER alert
 *  - keep booking: schedule_exception UPSERT, conflict RESOLVED_KEPT,
 *    same-status booking_status_history, owner detail scheduleExceptions
 *  - history pagination + PDF export (owner), super-admin history/PDF, RBAC:
 *    Admin denied both surfaces (REQ-168), super admin unconstrained by tenant
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
const SLUG = 'schedule-test-studio';
const SERVICE = { name: 'Cut & Style', basePriceMinor: 4500, baseDurationMinutes: 30 };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ADDIS_OFFSET_MIN = 180;

interface ScheduleVersionDto {
  id: string;
  status: string;
  reason: string | null;
  bookingIntervalMinutes: number;
  workingPeriods: { dayOfWeek: number; startMinutes: number; endMinutes: number }[];
}
interface AffectedBookingDto {
  bookingId: string;
  customerName: string;
  customerPhone: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  services: { name: string; durationMinutes: number }[];
  reason: string | null;
  kept: boolean;
}
interface ScheduleCurrentDto {
  version: ScheduleVersionDto | null;
  isPaused: boolean;
  warnings: AffectedBookingDto[];
  kept: AffectedBookingDto[];
}
interface BookingDto {
  id: string;
  status: string;
  startAt: string;
  endAt: string;
  scheduleExceptions?: {
    id: string;
    scheduleVersionId: string;
    reason: string | null;
    createdAt: string;
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

const ownerToken = (): Promise<string> => login(TEST_EMAILS.owner, TEST_PASSWORDS.owner);
const adminToken = (): Promise<string> => login(TEST_EMAILS.admin1, TEST_PASSWORDS.admin);
const saToken = (): Promise<string> => login(TEST_EMAILS.sa, TEST_PASSWORDS.sa);

function freshPhone(): string {
  phoneSeq += 1;
  return `+251${(900000000 + phoneSeq).toString().slice(-9)}`;
}

/** UTC-midnight of the next (strictly future) Addis calendar day with this weekday. */
function upcomingLocalMidnight(weekday: number): Date {
  const addis = new Date(Date.now() + ADDIS_OFFSET_MIN * 60_000);
  const today = new Date(Date.UTC(addis.getUTCFullYear(), addis.getUTCMonth(), addis.getUTCDate()));
  for (let i = 1; i <= 8; i += 1) {
    const d = new Date(today.getTime() + i * 86_400_000);
    if (d.getUTCDay() === weekday) return d;
  }
  throw new Error('no upcoming weekday');
}

/** Instant for a local (Addis) minute-of-day on the given local day. */
function localTime(day: Date, localMinutes: number): string {
  return new Date(day.getTime() + (localMinutes - ADDIS_OFFSET_MIN) * 60_000).toISOString();
}

function scheduleBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bookingIntervalMinutes: 30,
    workingPeriods: [{ dayOfWeek: 0, startMinutes: 540, endMinutes: 1080 }],
    ...overrides,
  };
}

async function saveSchedule(token: string, body: Record<string, unknown>) {
  const res = await supertest(server)
    .put(`/api/v1/businesses/${businessId}/schedule`)
    .send(body)
    .set(auth(token));
  return {
    status: res.status,
    body: res.body as ScheduleCurrentDto & { error?: { code: string } },
  };
}

async function getSchedule(token: string) {
  const res = await supertest(server)
    .get(`/api/v1/businesses/${businessId}/schedule`)
    .set(auth(token));
  return { status: res.status, body: res.body as ScheduleCurrentDto };
}

async function publicCreate(startAt: string) {
  const res = await supertest(server)
    .post(`/api/v1/public/businesses/${SLUG}/bookings`)
    .field('customerName', 'Selam Test')
    .field('customerPhone', freshPhone())
    .field('startAt', startAt)
    .field('paymentMethod', 'BANK_TRANSFER')
    .field('submissionKey', crypto.randomUUID())
    .field('services', JSON.stringify([{ serviceId, addOnIds: [] }]))
    .attach('file', PNG, 'proof.png');
  return {
    status: res.status,
    body: res.body as { created?: boolean; booking?: BookingDto; error?: { code: string } },
  };
}

async function postBooking(token: string, path: string, body?: Record<string, unknown>) {
  const res = await supertest(server)
    .post(`/api/v1/businesses/${businessId}/bookings/${path}`)
    .send(body)
    .set(auth(token));
  return {
    status: res.status,
    body: res.body as { booking?: BookingDto; error?: { code: string } },
  };
}

async function seedService(): Promise<void> {
  const token = await ownerToken();
  const res = await supertest(server)
    .post(`/api/v1/businesses/${businessId}/services`)
    .send(SERVICE)
    .set(auth(token));
  serviceId = (res.body.service as { id: string }).id;
}

/** Create a CONFIRMED booking at a given local Sunday minute, future-dated. */
async function createConfirmedBooking(localMinutes: number): Promise<string> {
  await seedService();
  const startAt = localTime(upcomingLocalMidnight(0), localMinutes);
  const created = await publicCreate(startAt);
  expect(created.status).toBe(200);
  expect(created.body.booking).toBeDefined();
  await postBooking(await ownerToken(), `${created.body.booking!.id}/accept`);
  return created.body.booking!.id;
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
    .send({ name: 'Schedule Test Studio', publicSlug: SLUG })
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
    'TRUNCATE "schedule_version", "booking", "service", "service_variation", "add_on", "security_event", "notification" CASCADE',
  );
  await superuser.query(
    'UPDATE business SET is_paused = false, paused_until = NULL WHERE id = $1',
    [businessId],
  );
});

describe('A: owner save (ACTIVE) + current view', () => {
  it('saving inserts one ACTIVE version with content and surfaces it via current', async () => {
    const token = await ownerToken();
    const saved = await saveSchedule(token, scheduleBody({ reason: 'repaint' }));
    expect(saved.status).toBe(200);
    expect(saved.body.isPaused).toBe(false);
    expect(saved.body.version).toMatchObject({
      status: 'ACTIVE',
      reason: 'repaint',
      bookingIntervalMinutes: 30,
      workingPeriods: [{ dayOfWeek: 0, startMinutes: 540, endMinutes: 1080 }],
    });
    expect(saved.body.warnings).toEqual([]);
    expect(saved.body.kept).toEqual([]);

    const rows = await superuser.query(
      'SELECT status FROM schedule_version WHERE business_id = $1',
      [businessId],
    );
    expect(rows.rows).toEqual([{ status: 'ACTIVE' }]);
    const wps = await superuser.query(
      'SELECT day_of_week, start_minutes, end_minutes FROM working_period WHERE business_id = $1',
      [businessId],
    );
    expect(wps.rows).toEqual([{ day_of_week: 0, start_minutes: 540, end_minutes: 1080 }]);

    const current = await getSchedule(token);
    expect(current.body.version?.id).toBe(saved.body.version?.id);
  });

  it('re-saving supersedes the previous ACTIVE so exactly one ACTIVE remains', async () => {
    const token = await ownerToken();
    await saveSchedule(token, scheduleBody());
    const second = await saveSchedule(token, scheduleBody({ bookingIntervalMinutes: 60 }));
    expect(second.body.version?.status).toBe('ACTIVE');
    expect(second.body.version?.bookingIntervalMinutes).toBe(60);
    const first = await getSchedule(token);
    expect(first.body.version?.bookingIntervalMinutes).toBe(60);

    const rows = await superuser.query(
      'SELECT status, count(*)::int AS c FROM schedule_version WHERE business_id = $1 GROUP BY status ORDER BY status',
      [businessId],
    );
    const summary = Object.fromEntries(rows.rows.map((r) => [r.status, r.c]));
    expect(summary).toEqual({ ACTIVE: 1, SUPERSEDED: 1 });
  });
});

describe('B: pause → PENDING versions → resume activates latest', () => {
  it('saves while paused create multiple PENDING versions that never apply', async () => {
    const token = await ownerToken();
    await supertest(server)
      .post(`/api/v1/businesses/${businessId}/pause`)
      .send({})
      .set(auth(token));
    const v1 = await saveSchedule(token, scheduleBody({ reason: 'draft-a' }));
    const v2 = await saveSchedule(
      token,
      scheduleBody({ reason: 'draft-b', bookingIntervalMinutes: 15 }),
    );
    expect(v1.body.isPaused).toBe(true);
    expect(v1.body.version?.status).toBe('PENDING');
    expect(v2.body.version?.status).toBe('PENDING');
    expect(v2.body.version?.id).not.toBe(v1.body.version?.id);

    const rows = await superuser.query(
      'SELECT status FROM schedule_version WHERE business_id = $1 ORDER BY status',
      [businessId],
    );
    expect(rows.rows.map((r) => r.status).sort()).toEqual(['PENDING', 'PENDING']);

    const current = await getSchedule(token);
    expect(current.body.isPaused).toBe(true);
    expect(current.body.version?.id).toBe(v2.body.version?.id);
  });

  it('resume activates the latest PENDING version and supersedes the rest', async () => {
    const token = await ownerToken();
    await supertest(server)
      .post(`/api/v1/businesses/${businessId}/pause`)
      .send({})
      .set(auth(token));
    await saveSchedule(token, scheduleBody({ reason: 'old-draft', bookingIntervalMinutes: 30 }));
    const latest = await saveSchedule(
      token,
      scheduleBody({
        reason: 'decided',
        bookingIntervalMinutes: 120,
        workingPeriods: [{ dayOfWeek: 0, startMinutes: 600, endMinutes: 720 }],
      }),
    );

    const resumed = await supertest(server)
      .post(`/api/v1/businesses/${businessId}/resume`)
      .set(auth(token));
    expect(resumed.status).toBe(200);

    const rows = await superuser.query(
      'SELECT status, reason FROM schedule_version WHERE business_id = $1 ORDER BY created_at',
      [businessId],
    );
    expect(rows.rows.map((r) => r.status)).toEqual(['SUPERSEDED', 'ACTIVE']);
    expect(rows.rows[1].reason).toBe('decided');

    const current = await getSchedule(token);
    expect(current.body.isPaused).toBe(false);
    expect(current.body.version?.id).toBe(latest.body.version?.id);
    expect(current.body.version?.bookingIntervalMinutes).toBe(120);
  });
});

describe('C: booking gate enforces the active schedule', () => {
  it('blocks creates outside the window (SLOT_UNAVAILABLE) and allows inside', async () => {
    const token = await ownerToken();
    await saveSchedule(token, scheduleBody());
    await seedService();

    const inside = await publicCreate(localTime(upcomingLocalMidnight(0), 600));
    expect(inside.status).toBe(200);
    expect(inside.body.created).toBe(true);

    const outside = await publicCreate(localTime(upcomingLocalMidnight(1), 600));
    expect(outside.status).toBe(409);
    expect(outside.body.error?.code).toBe('SLOT_UNAVAILABLE');
  });

  it('resume swaps the effective gate to the activated version window', async () => {
    const token = await ownerToken();
    await saveSchedule(token, scheduleBody());
    await seedService();

    await supertest(server)
      .post(`/api/v1/businesses/${businessId}/pause`)
      .send({})
      .set(auth(token));
    // While paused: tighten to 09:00–10:00.
    await saveSchedule(
      token,
      scheduleBody({ workingPeriods: [{ dayOfWeek: 0, startMinutes: 540, endMinutes: 600 }] }),
    );
    await supertest(server).post(`/api/v1/businesses/${businessId}/resume`).set(auth(token));

    const inWindow = await publicCreate(localTime(upcomingLocalMidnight(0), 550));
    expect(inWindow.status).toBe(200);

    const outWindow = await publicCreate(localTime(upcomingLocalMidnight(0), 620));
    expect(outWindow.status).toBe(409);
    expect(outWindow.body.error?.code).toBe('SLOT_UNAVAILABLE');
  });
});

describe('D: affected sweep + grouped owner notification', () => {
  it('an ACTIVE save surfaces warnings, persists conflicts and enqueues the alert', async () => {
    const token = await ownerToken();
    await saveSchedule(token, scheduleBody());

    const bookingId = await createConfirmedBooking(600);

    const revision = await saveSchedule(
      token,
      scheduleBody({ workingPeriods: [{ dayOfWeek: 0, startMinutes: 720, endMinutes: 1080 }] }),
    );
    expect(revision.status).toBe(200);
    expect(revision.body.warnings).toHaveLength(1);
    expect(revision.body.warnings[0]).toMatchObject({
      bookingId,
      durationMinutes: SERVICE.baseDurationMinutes,
      reason: 'Outside weekly working hours',
      services: [{ name: SERVICE.name, durationMinutes: SERVICE.baseDurationMinutes }],
      kept: false,
    });

    // A second, still-conflicting save within the 5-minute grouping window
    // merges into the same alert (grouped delivery, doc 13 §4/§8).
    const mergedRev = await saveSchedule(
      token,
      scheduleBody({ workingPeriods: [{ dayOfWeek: 0, startMinutes: 780, endMinutes: 1080 }] }),
    );
    expect(mergedRev.body.warnings[0].bookingId).toBe(bookingId);

    const conflicts = await superuser.query(
      'SELECT status, reason FROM schedule_conflict WHERE business_id = $1 AND booking_id = $2',
      [businessId, bookingId],
    );
    expect(conflicts.rows.map((r) => r.status).sort()).toEqual(['OPEN', 'OPEN']);
    expect(conflicts.rows[0].reason).toBe('Outside weekly working hours');

    const alert = await superuser.query(
      'SELECT tenant_scope, booking_id, payload FROM notification WHERE business_id = $1 AND type = $2',
      [businessId, 'SCHEDULE_AFFECTED_OWNER'],
    );
    expect(alert.rows).toHaveLength(1);
    expect(alert.rows[0].tenant_scope).toBe('SCHEDULE');
    const payload = alert.rows[0].payload;
    expect(payload.versionId).toBe(mergedRev.body.version!.id);
    expect(payload.grouped).toBe(true);
    expect(payload.entries).toHaveLength(1);
    const entry = payload.entries[0];
    expect(entry.bookingId).toBe(bookingId);
    expect(entry.customerName).toBe('Selam Test');
    expect(entry.durationMinutes).toBe(SERVICE.baseDurationMinutes);
    expect(entry.reason).toBe('Outside weekly working hours');
    expect(entry.managementUrl).toBe(`/manage/#/businesses/${businessId}/bookings/${bookingId}`);
    expect(typeof entry.occurredAt).toBe('string');

    const fresh = await getSchedule(token);
    expect(fresh.body.warnings).toHaveLength(1);
    expect(fresh.body.warnings[0].bookingId).toBe(bookingId);
  });

  it('resume after a paused change also recomputes affected bookings', async () => {
    const token = await ownerToken();
    await saveSchedule(token, scheduleBody());
    const bookingId = await createConfirmedBooking(600);

    await supertest(server)
      .post(`/api/v1/businesses/${businessId}/pause`)
      .send({})
      .set(auth(token));
    await saveSchedule(
      token,
      scheduleBody({ workingPeriods: [{ dayOfWeek: 0, startMinutes: 720, endMinutes: 1080 }] }),
    );
    await supertest(server).post(`/api/v1/businesses/${businessId}/resume`).set(auth(token));

    const current = await getSchedule(token);
    expect(current.body.version?.status).toBe('ACTIVE');
    expect(current.body.warnings).toHaveLength(1);
    expect(current.body.warnings[0].bookingId).toBe(bookingId);
    expect(current.body.warnings[0].reason).toBe('Outside weekly working hours');

    const alerts = await superuser.query(
      'SELECT payload FROM notification WHERE business_id = $1 AND type = $2',
      [businessId, 'SCHEDULE_AFFECTED_OWNER'],
    );
    expect(alerts.rows.length).toBeGreaterThanOrEqual(1);
    expect(alerts.rows[0].payload.entries[0].bookingId).toBe(bookingId);
  });
});

describe('E: keep booking exception (REQ-160/161/163)', () => {
  it('keeps a conflicted booking, marks the conflict resolved, and never reopens the slot', async () => {
    const token = await ownerToken();
    await saveSchedule(token, scheduleBody());
    const bookingId = await createConfirmedBooking(600);
    await saveSchedule(
      token,
      scheduleBody({ workingPeriods: [{ dayOfWeek: 0, startMinutes: 720, endMinutes: 1080 }] }),
    );

    const kept = await supertest(server)
      .post(`/api/v1/businesses/${businessId}/schedule/bookings/${bookingId}/keep`)
      .send({ reason: '  owner promised at counter  ' })
      .set(auth(token));
    expect(kept.status).toBe(200);
    expect(kept.body).toMatchObject({ ok: true, bookingId });
    expect(kept.body.exception.reason).toBe('owner promised at counter');

    const exceptions = await superuser.query(
      'SELECT reason, created_by_user_id FROM schedule_exception WHERE booking_id = $1',
      [bookingId],
    );
    expect(exceptions.rows).toHaveLength(1);
    expect(exceptions.rows[0]).toMatchObject({ reason: 'owner promised at counter' });
    expect(exceptions.rows[0].created_by_user_id).not.toBeNull();

    const conflicts = await superuser.query(
      'SELECT status, resolved_by_user_id FROM schedule_conflict WHERE booking_id = $1',
      [bookingId],
    );
    expect(conflicts.rows).toHaveLength(1);
    expect(conflicts.rows[0].status).toBe('RESOLVED_KEPT');
    expect(conflicts.rows[0].resolved_by_user_id).not.toBeNull();

    const historyRows = await superuser.query(
      'SELECT from_status, to_status, actor_type, reason FROM booking_status_history WHERE booking_id = $1',
      [bookingId],
    );
    const keptTransition = historyRows.rows.find((r) => r.reason === 'kept under changed schedule');
    expect(keptTransition).toMatchObject({
      from_status: 'CONFIRMED',
      to_status: 'CONFIRMED',
      actor_type: 'OWNER',
    });

    const current = await getSchedule(token);
    expect(current.body.warnings).toHaveLength(0);
    expect(current.body.kept).toHaveLength(1);
    expect(current.body.kept[0]).toMatchObject({ bookingId, kept: true });

    // The exception exempts THIS booking from warnings — never makes the time
    // generally bookable: a fresh create at the same slot still fails.
    const retry = await publicCreate(localTime(upcomingLocalMidnight(0), 600));
    expect(retry.status).toBe(409);
    expect(retry.body.error?.code).toBe('SLOT_UNAVAILABLE');
  });

  it('owner booking detail surfaces the scheduleExceptions', async () => {
    const token = await ownerToken();
    await saveSchedule(token, scheduleBody());
    const bookingId = await createConfirmedBooking(600);
    await saveSchedule(
      token,
      scheduleBody({ workingPeriods: [{ dayOfWeek: 0, startMinutes: 720, endMinutes: 1080 }] }),
    );
    await supertest(server)
      .post(`/api/v1/businesses/${businessId}/schedule/bookings/${bookingId}/keep`)
      .send({})
      .set(auth(token));

    const detail = await supertest(server)
      .get(`/api/v1/businesses/${businessId}/bookings/${bookingId}`)
      .set(auth(token));
    expect(detail.status).toBe(200);
    const exceptions = (detail.body.booking as BookingDto).scheduleExceptions;
    expect(exceptions).toHaveLength(1);
    expect(exceptions![0]).toMatchObject({ reason: null });
    expect(typeof exceptions![0].createdAt).toBe('string');
  });
});

describe('F: history + PDF export + RBAC', () => {
  it('owner history paginates and filters order correctly', async () => {
    const token = await ownerToken();
    await saveSchedule(token, scheduleBody({ reason: 'v1' }));
    await saveSchedule(token, scheduleBody({ reason: 'v2' }));

    const all = await supertest(server)
      .get(`/api/v1/businesses/${businessId}/schedule/history?page=0&pageSize=50`)
      .set(auth(token));
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(2);
    expect(all.body.versions).toHaveLength(2);
    expect(all.body.versions[0].reason).toBe('v2');

    const one = await supertest(server)
      .get(`/api/v1/businesses/${businessId}/schedule/history?page=0&pageSize=1`)
      .set(auth(token));
    expect(one.body.versions).toHaveLength(1);
    expect(one.body.versions[0].reason).toBe('v2');

    const tooMany = await supertest(server)
      .get(`/api/v1/businesses/${businessId}/schedule/history?pageSize=201`)
      .set(auth(token));
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('owner PDF export streams a neutral document', async () => {
    const token = await ownerToken();
    await saveSchedule(token, scheduleBody({ reason: 'v1' }));
    const res = await supertest(server)
      .get(`/api/v1/businesses/${businessId}/schedule/history/pdf`)
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    const body = res.body as Buffer;
    const text = body.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).not.toMatch(/reason/i);
  });

  it('super admin reads history + PDF across tenants; admin is denied (REQ-168)', async () => {
    const owner = await ownerToken();
    await saveSchedule(owner, scheduleBody({ reason: 'v1' }));

    const sa = await supertest(server)
      .get(`/api/v1/super-admin/businesses/${businessId}/schedule/history`)
      .set(auth(await saToken()));
    expect(sa.status).toBe(200);
    expect(sa.body.total).toBe(1);

    const saPdf = await supertest(server)
      .get(`/api/v1/super-admin/businesses/${businessId}/schedule/history/pdf`)
      .set(auth(await saToken()));
    expect(saPdf.status).toBe(200);
    expect((saPdf.body as Buffer).toString('latin1').startsWith('%PDF-1.4')).toBe(true);

    const adminOwnerSurface = await supertest(server)
      .get(`/api/v1/businesses/${businessId}/schedule`)
      .set(auth(await adminToken()));
    expect(adminOwnerSurface.status).toBe(403);

    const adminSaSurface = await supertest(server)
      .get(`/api/v1/super-admin/businesses/${businessId}/schedule/history`)
      .set(auth(await adminToken()));
    expect(adminSaSurface.status).toBe(403);
  });

  it('validation floors: inverted windows and bad interval are rejected without side effects', async () => {
    const token = await ownerToken();
    const before = await getSchedule(token);
    const inverted = await saveSchedule(
      token,
      scheduleBody({ workingPeriods: [{ dayOfWeek: 0, startMinutes: 720, endMinutes: 540 }] }),
    );
    expect(inverted.status).toBe(400);
    expect(inverted.body.error.code).toBe('SCHEDULE_INVALID');

    const interval = await saveSchedule(token, scheduleBody({ bookingIntervalMinutes: 4 }));
    expect(interval.status).toBe(400);
    expect(interval.body.error.code).toBe('SCHEDULE_INVALID');

    const after = await getSchedule(token);
    expect(after.body.version?.id).toBe(before.body.version?.id);
  });
});
