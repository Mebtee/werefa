/**
 * Prompt 15 — Security history & platform administration (Domain 18,
 * REQ-201..206, doc 22) over HTTP:
 *
 *  A) Owner scope: own events + owned-business events (REQ-201); filters.
 *  B) Admin scope: own events only; admins never see each other's rows
 *     (REQ-202 + platform-level isolation enforced at the service layer).
 *  C) Super Admin scope: platform-wide list/detail (REQ-203); role/business/
 *     filters; email + sanitized metadata.
 *  D) Pagination + deterministic ordering (newest first, stable tie-break).
 *  E) Parameter validation (bogus uuid/date/type/pageSize → 400).
 *  F) Deletion: SA-only (REQ-205); the SECURITY_EVENT_DELETED audit survives
 *     with the deleted event referenced in sanitized metadata (REQ-206).
 *  G) Cross-role denial: Owner/Admin can never reach the SA endpoints.
 *
 * `beforeEach` TRUNCATEs security_event (sessions survive), so each test
 * re-seeds its own events through the same APIs end users call.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
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
// Local second owner so cross-tenant (Owner A vs Owner B) isolation can be
// exercised without touching the shared identity seed used by other suites.
const OWNER2_EMAIL = 'owner2@werefa.test';
const withDb = (dsn: string | undefined, db: string): string | undefined => {
  if (!dsn) return undefined;
  const u = new URL(dsn);
  u.pathname = '/' + db;
  return u.toString();
};

const CSRF = { 'x-requested-with': 'fetch' };

interface EventDto {
  id: string;
  type: string;
  createdAt: string;
  result: string | null;
  ip: string | null;
  device: string | null;
  browser: string | null;
  userId: string | null;
  businessId: string | null;
  userEmail?: string | null;
  metadata?: Record<string, unknown> | null;
}

let app: INestApplication;
let server: ReturnType<INestApplication['getHttpServer']>;
let supertest: typeof import('supertest');
let superuser: Client;
let ownerToken: string;
let admin1Token: string;
let admin2Token: string;
let saToken: string;
let ownerUserId: string;
let owner2UserId: string;
let admin1UserId: string;
let admin2UserId: string;

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

async function getEvents(
  token: string,
  path: string,
  query = '',
): Promise<{ events: EventDto[]; total: number }> {
  const res = await supertest(server).get(`${path}${query}`).set(auth(token));
  expect(res.status).toBe(200);
  return res.body as { events: EventDto[]; total: number };
}

async function createOwnerBusiness(): Promise<string> {
  const slug = `sec-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const res = await supertest(server)
    .post('/api/v1/businesses')
    .send({ name: `Security Biz ${slug}`, publicSlug: slug })
    .set(auth(ownerToken));
  expect(res.status).toBe(201);
  return (res.body.business as { id: string }).id;
}

beforeAll(async () => {
  process.env.APP_ENV = 'test';
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.STORAGE_PROVIDER = 'memory';
  process.env.AUTH_RATE_LIMIT_MAX = '100';
  process.env.COOKIE_SECURE = 'false';
  process.env.TELEGRAM_ENABLED = 'false';
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

  const supertestModule = await import('supertest');
  supertest = (supertestModule.default ?? supertestModule) as typeof import('supertest');

  await resetIdentityDatabaseAndSeed(process.env.DATABASE_MIGRATOR_URL!);

  const { Client } = await import('pg');
  superuser = new Client({ connectionString: process.env.DATABASE_URL_SUPERUSER! });
  await superuser.connect();

  // Local second owner (same password material as the canonical owner) so the
  // cross-tenant window can be proven to exclude another owner's rows.
  await superuser.query(
    `INSERT INTO "user"(email, password_hash, role, is_email_verified)
     SELECT $1, password_hash, 'Owner', true FROM "user" WHERE email = $2`,
    [OWNER2_EMAIL, TEST_EMAILS.owner],
  );

  ownerUserId = (
    await superuser.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [
      TEST_EMAILS.owner,
    ])
  ).rows[0].id;
  owner2UserId = (
    await superuser.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [OWNER2_EMAIL])
  ).rows[0].id;
  admin1UserId = (
    await superuser.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [
      TEST_EMAILS.admin1,
    ])
  ).rows[0].id;
  admin2UserId = (
    await superuser.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [
      TEST_EMAILS.admin2,
    ])
  ).rows[0].id;

  ownerToken = await login(TEST_EMAILS.owner, TEST_PASSWORDS.owner);
  admin1Token = await login(TEST_EMAILS.admin1, TEST_PASSWORDS.admin);
  admin2Token = await login(TEST_EMAILS.admin2, TEST_PASSWORDS.admin);
  saToken = await login(TEST_EMAILS.sa, TEST_PASSWORDS.sa);
});

afterAll(async () => {
  await superuser?.end();
  await app?.close();
});

beforeEach(async () => {
  // business/business_owner are deliberately NOT truncated — `session`
  // references business (active_business_id) and a CASCADE TRUNCATE would
  // revoke the beforeAll cookies. Tests re-seed events after this wipe.
  await superuser.query(
    'TRUNCATE "subscription_payment", "subscription_status_history", "subscription", ' +
      '"notification_delivery", "notification", "security_event" CASCADE',
  );
});

describe('A: owner history (REQ-201)', () => {
  it('lists the owner account events and owned-business events, newest first', async () => {
    await login(TEST_EMAILS.owner, TEST_PASSWORDS.owner);
    const businessId = await createOwnerBusiness();

    const { events, total } = await getEvents(ownerToken, '/api/v1/owner/security-events');
    expect(total).toBeGreaterThanOrEqual(2);
    const types = new Set(events.map((e) => e.type));
    expect(types.has('LOGIN_SUCCESS')).toBe(true);
    expect(types.has('BUSINESS_CREATE')).toBe(true);

    const ids = events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of events) {
      const inWindow = e.userId === ownerUserId || e.businessId === businessId;
      expect(inWindow).toBe(true);
    }
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1]!.createdAt >= events[i]!.createdAt).toBe(true);
    }
  });

  it('filters by type and inclusive date range', async () => {
    await login(TEST_EMAILS.owner, TEST_PASSWORDS.owner);
    await createOwnerBusiness();

    const all = await getEvents(ownerToken, '/api/v1/owner/security-events');
    expect(all.total).toBeGreaterThan(0);

    const typed = await getEvents(
      ownerToken,
      '/api/v1/owner/security-events',
      '?type=LOGIN_SUCCESS',
    );
    expect(typed.total).toBeGreaterThan(0);
    expect(typed.events.every((e) => e.type === 'LOGIN_SUCCESS')).toBe(true);

    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const ranged = await getEvents(
      ownerToken,
      '/api/v1/owner/security-events',
      `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(ranged.total).toBe(all.total);
  });

  it('never exposes another owner’s events and ignores spoofed business context', async () => {
    await login(TEST_EMAILS.owner, TEST_PASSWORDS.owner);
    await login(OWNER2_EMAIL, TEST_PASSWORDS.owner);
    const owner2BusinessId = await createOwnerBusinessAs(OWNER2_EMAIL, TEST_PASSWORDS.owner);

    const { events, total } = await getEvents(ownerToken, '/api/v1/owner/security-events');
    expect(total).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.userId).not.toBe(owner2UserId);
      expect(e.businessId).not.toBe(owner2BusinessId);
    }

    // Spoofed business context on the owner endpoint is inert (the server
    // derives the window from the session, never from query params).
    const spoofed = await getEvents(
      ownerToken,
      '/api/v1/owner/security-events',
      `?businessId=${owner2BusinessId}`,
    );
    expect(spoofed.total).toBe(total);
  });
});

/** Create a business on behalf of a specific owner; returns its id. */
async function createOwnerBusinessAs(email: string, password: string): Promise<string> {
  const token = await login(email, password);
  const slug = `sec-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const res = await supertest(server)
    .post('/api/v1/businesses')
    .send({ name: `Security Biz ${slug}`, publicSlug: slug })
    .set(auth(token));
  expect(res.status).toBe(201);
  return (res.body.business as { id: string }).id;
}

describe('B: admin own history (REQ-202) + isolation', () => {
  it('never exposes another admins rows', async () => {
    await login(TEST_EMAILS.admin1, TEST_PASSWORDS.admin);
    await login(TEST_EMAILS.admin2, TEST_PASSWORDS.admin);

    const { events, total } = await getEvents(admin1Token, '/api/v1/admin/security-events');
    expect(total).toBeGreaterThanOrEqual(1);
    for (const e of events) {
      expect(e.userId).toBe(admin1UserId);
    }

    const admin2 = await getEvents(admin2Token, '/api/v1/admin/security-events');
    expect(admin2.total).toBeGreaterThanOrEqual(1);
    for (const e of admin2.events) {
      expect(e.userId).toBe(admin2UserId);
    }
    const admin1Ids = new Set(events.map((e) => e.id));
    for (const e of admin2.events) expect(admin1Ids.has(e.id)).toBe(false);
  });

  it('has no scoped-out business/user/role filter knobs for admins', async () => {
    await login(TEST_EMAILS.admin1, TEST_PASSWORDS.admin);
    const unfiltered = await getEvents(admin1Token, '/api/v1/admin/security-events');
    expect(unfiltered.total).toBeGreaterThan(0);

    const withKnobs = await getEvents(
      admin1Token,
      '/api/v1/admin/security-events',
      '?businessId=0b0b0b0b-0000-0000-0000-000000000000&userId=0b0b0b0b-0000-0000-0000-000000000000&role=Owner',
    );
    // The knobs are ignored entirely — the server-side window is unchanged.
    expect(withKnobs.total).toBe(unfiltered.total);
  });
});

describe('C: super admin platform history (REQ-203)', () => {
  it('lists every recorded event across actors with email', async () => {
    await login(TEST_EMAILS.owner, TEST_PASSWORDS.owner);
    await createOwnerBusiness();
    await login(TEST_EMAILS.admin1, TEST_PASSWORDS.admin);
    await login(TEST_EMAILS.admin2, TEST_PASSWORDS.admin);

    const { events } = await getEvents(saToken, '/api/v1/super-admin/security-events');
    const types = new Set(events.map((e) => e.type));
    expect(types.has('LOGIN_SUCCESS')).toBe(true);
    expect(types.has('BUSINESS_CREATE')).toBe(true);

    const ownerRow = events.find((e) => e.type === 'BUSINESS_CREATE');
    expect(ownerRow?.userEmail).toBe(TEST_EMAILS.owner);
    expect(ownerRow?.businessId).toBeTruthy();
  });

  it('filters by role and business (platform scope)', async () => {
    await login(TEST_EMAILS.owner, TEST_PASSWORDS.owner);
    const businessId = await createOwnerBusiness();
    await login(TEST_EMAILS.admin1, TEST_PASSWORDS.admin);
    await login(TEST_EMAILS.admin2, TEST_PASSWORDS.admin);

    const admins = await getEvents(saToken, '/api/v1/super-admin/security-events', '?role=Admin');
    expect(admins.total).toBeGreaterThanOrEqual(2);
    for (const e of admins.events) {
      expect(e.userEmail).toBeTruthy();
      expect(e.userEmail).not.toBe(TEST_EMAILS.owner);
    }

    const byBusiness = await getEvents(
      saToken,
      '/api/v1/super-admin/security-events',
      `?businessId=${businessId}`,
    );
    expect(byBusiness.total).toBeGreaterThan(0);
    expect(byBusiness.events.every((e) => e.businessId === businessId)).toBe(true);
  });

  it('returns event detail for the platform scope', async () => {
    const businessId = await createOwnerBusiness();
    const { events } = await getEvents(
      saToken,
      '/api/v1/super-admin/security-events',
      '?type=BUSINESS_CREATE',
    );
    expect(events.length).toBeGreaterThan(0);
    const target = events[0];

    const res = await supertest(server)
      .get(`/api/v1/super-admin/security-events/${target.id}`)
      .set(auth(saToken));
    expect(res.status).toBe(200);
    expect((res.body.event as EventDto).id).toBe(target.id);
    expect((res.body.event as EventDto).businessId).toBe(businessId);
  });
});

describe('D: pagination and ordering', () => {
  it('pages deterministically with a stable total', async () => {
    await login(TEST_EMAILS.owner, TEST_PASSWORDS.owner);
    await createOwnerBusiness();
    await login(TEST_EMAILS.admin1, TEST_PASSWORDS.admin);
    await login(TEST_EMAILS.admin2, TEST_PASSWORDS.admin);
    await login(TEST_EMAILS.sa, TEST_PASSWORDS.sa);

    const all = await getEvents(saToken, '/api/v1/super-admin/security-events');
    const page0 = await getEvents(
      saToken,
      '/api/v1/super-admin/security-events',
      '?page=0&pageSize=2',
    );
    const page1 = await getEvents(
      saToken,
      '/api/v1/super-admin/security-events',
      '?page=1&pageSize=2',
    );

    expect(all.total).toBeGreaterThanOrEqual(5);
    expect(page0.events).toHaveLength(2);
    expect(page0.total).toBe(all.total);

    const idsPage0 = new Set(page0.events.map((e) => e.id));
    for (const e of page1.events) expect(idsPage0.has(e.id)).toBe(false);
    expect(page0.events[1]!.createdAt >= page1.events[0]!.createdAt).toBe(true);
  });
});

describe('E: parameter validation', () => {
  it('rejects malformed filters with 400 field errors', async () => {
    const expectations: Array<[string, string]> = [
      ['/api/v1/super-admin/security-events?businessId=not-a-uuid', 'businessId'],
      ['/api/v1/super-admin/security-events?userId=abc', 'userId'],
      ['/api/v1/super-admin/security-events?role=Hacker', 'role'],
      ['/api/v1/super-admin/security-events?type=NOT_A_TYPE', 'type'],
      ['/api/v1/super-admin/security-events?from=garbage-date', 'from'],
      ['/api/v1/super-admin/security-events?pageSize=201', 'pageSize'],
      ['/api/v1/super-admin/security-events?page=-1', 'page'],
    ];
    for (const [url, field] of expectations) {
      const res = await supertest(server).get(url).set(auth(saToken));
      expect(res.status).toBe(400);
      const env = res.body as { error: { code: string; fields: { field: string }[] } };
      expect(env.error.code).toBe('VALIDATION_ERROR');
      expect(env.error.fields.some((f) => f.field === field)).toBe(true);
    }
  });
});

describe('F: super admin deletion (REQ-205/206)', () => {
  it('deletes a single event and the deletion itself is audited', async () => {
    await login(TEST_EMAILS.owner, TEST_PASSWORDS.owner);
    await createOwnerBusiness();

    const { events } = await getEvents(saToken, '/api/v1/super-admin/security-events');
    expect(events.length).toBeGreaterThan(0);
    const target = events[0]!;

    const del = await supertest(server)
      .delete(`/api/v1/super-admin/security-events/${target.id}`)
      .set(auth(saToken));
    expect(del.status).toBe(204);

    const res = await supertest(server)
      .get(`/api/v1/super-admin/security-events/${target.id}`)
      .set(auth(saToken));
    expect(res.status).toBe(404);

    const audits = await getEvents(
      saToken,
      '/api/v1/super-admin/security-events',
      '?type=SECURITY_EVENT_DELETED',
    );
    expect(audits.total).toBe(1);
    const audit = audits.events[0]!;
    expect(audit.metadata).toMatchObject({
      deletedEventId: target.id,
      deletedType: target.type,
    });
    expect(audit.userId).toBe(target.userId);
    expect(audit.businessId).toBe(target.businessId);
  });

  it('is Super-Admin-only: Owner and Admin are denied', async () => {
    await login(TEST_EMAILS.owner, TEST_PASSWORDS.owner);
    await createOwnerBusiness();
    const { events } = await getEvents(saToken, '/api/v1/super-admin/security-events');
    const target = events[0]!;

    for (const token of [ownerToken, admin1Token]) {
      const res = await supertest(server)
        .delete(`/api/v1/super-admin/security-events/${target.id}`)
        .set(auth(token));
      expect(res.status).toBe(403);
    }
    const after = await getEvents(saToken, '/api/v1/super-admin/security-events');
    expect(after.events.some((e) => e.id === target.id)).toBe(true);
  });

  it('returns 404 when the event does not exist', async () => {
    const res = await supertest(server)
      .delete('/api/v1/super-admin/security-events/00000000-0000-0000-0000-000000000000')
      .set(auth(saToken));
    expect(res.status).toBe(404);
  });

  it('is concurrency-safe: two identical deletes yield one 204 + one 404 and a single audit', async () => {
    await login(TEST_EMAILS.owner, TEST_PASSWORDS.owner);
    await createOwnerBusiness();
    const { events } = await getEvents(saToken, '/api/v1/super-admin/security-events');
    const target = events[0]!;

    const [a, b] = await Promise.all([
      supertest(server)
        .delete(`/api/v1/super-admin/security-events/${target.id}`)
        .set(auth(saToken)),
      supertest(server)
        .delete(`/api/v1/super-admin/security-events/${target.id}`)
        .set(auth(saToken)),
    ]);
    expect([a.status, b.status].sort()).toEqual([204, 404]);

    const audits = await getEvents(
      saToken,
      '/api/v1/super-admin/security-events',
      '?type=SECURITY_EVENT_DELETED&pageSize=200',
    );
    const matching = audits.events.filter(
      (e: { metadata: { deletedEventId?: string } }) => e.metadata?.deletedEventId === target.id,
    );
    expect(matching).toHaveLength(1);
  });
});

describe('G: cross-role denial', () => {
  it('Owner cannot read the admin or super-admin history', async () => {
    const adminRes = await supertest(server)
      .get('/api/v1/admin/security-events')
      .set(auth(ownerToken));
    expect(adminRes.status).toBe(403);
    const saRes = await supertest(server)
      .get('/api/v1/super-admin/security-events')
      .set(auth(ownerToken));
    expect(saRes.status).toBe(403);
  });

  it('Admin cannot read the owner history (exact owner scope)', async () => {
    const res = await supertest(server).get('/api/v1/owner/security-events').set(auth(admin1Token));
    expect(res.status).toBe(403);
  });

  it('rejects unauthenticated access', async () => {
    for (const path of [
      '/api/v1/owner/security-events',
      '/api/v1/admin/security-events',
      '/api/v1/super-admin/security-events',
    ]) {
      const res = await supertest(server).get(path).set(CSRF);
      expect(res.status).toBe(401);
    }
  });
});

describe('H: retention purge boundaries (REQ-204, doc 22 §5)', () => {
  let retentionJob: import('../../src/jobs/retention-security-events.job').JobRegistrar;

  beforeAll(async () => {
    const { JobRegistrar } = await import('../../src/jobs/retention-security-events.job');
    retentionJob = app.get(JobRegistrar);
  });

  async function insertRawEvent(type: string, createdAt: Date): Promise<string> {
    const id = crypto.randomUUID();
    await superuser.query(
      `INSERT INTO "security_event"(id, type, result, created_at, user_id)
       VALUES ($1, $2, 'SUCCESS', $3, $4)`,
      [id, type, createdAt, ownerUserId],
    );
    return id;
  }

  it('purges strictly-older than 1 year, retains the exact boundary and recent rows, and audits once', async () => {
    const fixedNow = new Date('2026-09-10T12:00:00.000Z');
    const cutoff = new Date(fixedNow.getTime() - 365 * 86_400_000);

    const oldId = await insertRawEvent('age-500d', new Date(cutoff.getTime() - 135 * 86_400_000));
    const boundaryId = await insertRawEvent('age-exactly-365d', cutoff);
    const withinId = await insertRawEvent('age-364d', new Date(cutoff.getTime() + 86_400_000));
    const recentId = await insertRawEvent('age-60s', new Date(fixedNow.getTime() - 60_000));

    const purged = await retentionJob.runRetention(365, fixedNow);
    expect(purged).toBe(1);

    const { rows } = await superuser.query<{ id: string; type: string }>(
      `SELECT id, type FROM "security_event" ORDER BY type`,
    );
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(oldId);
    expect(ids).toContain(boundaryId);
    expect(ids).toContain(withinId);
    expect(ids).toContain(recentId);

    const audit = rows.find((r) => r.type === 'SECURITY_EVENT_PURGE');
    expect(audit).toBeTruthy();
    const meta = (
      await superuser.query<{
        metadata: { purgedCount: number; olderThanDays: number; cutoff: string };
      }>(`SELECT metadata FROM "security_event" WHERE type = 'SECURITY_EVENT_PURGE'`)
    ).rows[0]?.metadata;
    expect(meta).toMatchObject({
      purgedCount: 1,
      olderThanDays: 365,
      cutoff: cutoff.toISOString(),
    });
  });

  it('is idempotent on retry: no additional purge and no duplicate audit row', async () => {
    const fixedNow = new Date('2026-09-10T12:00:00.000Z');
    const cutoff = new Date(fixedNow.getTime() - 365 * 86_400_000);
    await insertRawEvent('age-400d', new Date(cutoff.getTime() - 35 * 86_400_000));

    expect(await retentionJob.runRetention(365, fixedNow)).toBe(1);
    expect(await retentionJob.runRetention(365, fixedNow)).toBe(0);
    expect(await retentionJob.runRetention(365, fixedNow)).toBe(0);

    const { rows } = await superuser.query<{ type: string }>(
      `SELECT type FROM "security_event" WHERE type = 'SECURITY_EVENT_PURGE'`,
    );
    expect(rows).toHaveLength(1);
  });
});
