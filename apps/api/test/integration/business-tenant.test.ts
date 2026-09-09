/**
 * Prompt 09 integration tests over the HTTP surface:
 *
 *  - creation/model binding, unique slugs, reserved slugs (Prompt 09 core)
 *  - profile updates + validation
 *  - pause/resume (indefinite + scheduled), deactivate/reactivate
 *  - ownership isolation (owner B cannot touch owner A; 403 at the guard)
 *  - active business context selection (activeBusinessId on /me)
 *  - media upload (logo/cover), public serving + QR + public page
 *  - Admin read vs Super Admin write permissions (admin API)
 *  - automatic scheduled resume sweep + recorded security events
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
import { MAX_UPLOAD_BYTES } from '@werefa/shared';
import { PrismaService } from '../../src/database/prisma.service';
import { withTenantContext } from '../../src/database/tenant-executor';
import { BusinessService } from '../../src/business/business.service';
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
const OTHER_OWNER_EMAIL = 'it-owner-b@werefa.test';
const OWNER_B = { email: OTHER_OWNER_EMAIL, password: 'OwnerPass-999' };

// 1x1 PNG and a small JPEG payloads for media tests.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

let app: INestApplication;
let server: ReturnType<INestApplication['getHttpServer']>;
let supertest: typeof import('supertest');
let prisma: PrismaService;
let superuser: Client;

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

  // Second owner account for ownership-isolation tests + fresh business tables.
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
});

afterAll(async () => {
  await superuser?.end();
  await app?.close();
});

beforeEach(async () => {
  await superuser.query('TRUNCATE business_owner, business CASCADE');
});

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

interface Biz {
  id: string;
  publicSlug: string;
  name: string;
  category: string | null;
}

async function createBusiness(
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; business?: Biz }> {
  const res = await supertest(server).post('/api/v1/businesses').send(body).set(auth(token));
  return { status: res.status, business: res.body.business as Biz | undefined };
}

/**
 * Standalone reads through the global Prisma client are NOT tenant-scoped
 * (RLS applies with whatever GUC state the pooled connection happens to carry).
 * Wrap reads in an explicit owner context so they do not flake on connection
 * reuse (a rolled-back transaction leaves app.scope/app.user_id reset to "").
 */
async function readBusinessAsOwner(businessId: string) {
  const user = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
  return withTenantContext(prisma, { userId: user!.id, scope: 'OWNER' }, (tx) =>
    tx.business.findUnique({ where: { id: businessId } }),
  );
}

async function readOwnerLink() {
  const user = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
  return withTenantContext(prisma, { userId: user!.id, scope: 'OWNER' }, (tx) =>
    tx.businessOwner.findFirst({ where: { userId: user!.id } }),
  );
}

async function ownerToken(): Promise<string> {
  return login(OWNER_EMAIL, OWNER_PASSWORD);
}

async function ownerBToken(): Promise<string> {
  return login(OWNER_B.email, OWNER_B.password);
}

describe('A: business creation (Prompt 09 core — name, slug, category, owner link)', () => {
  it('201 creates a business owned by the caller with trial date ~+30 days', async () => {
    const token = await ownerToken();
    const { status, business } = await createBusiness(token, {
      name: 'The Catwalk',
      category: 'Salon & Barber',
    });
    expect(status).toBe(201);
    expect(business).toBeDefined();
    expect(business!.name).toBe('The Catwalk');
    expect(business!.category).toBe('Salon & Barber');
    expect(business!.publicSlug).toBe('the-catwalk'); // slug derived from name

    const owner = await readOwnerLink();
    expect(owner!.businessId).toBe(business!.id);

    const row = await readBusinessAsOwner(business!.id);
    expect(row!.trialEndsAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(row!.isPaused).toBe(false);
  });

  it('defaults category to Other and rejects invalid categories (REQ-215)', async () => {
    const token = await ownerToken();
    const def = await createBusiness(token, { name: 'Generic Studio' });
    expect(def.status).toBe(201);
    expect(def.business!.category).toBe('Other');

    const bad = await supertest(server)
      .post('/api/v1/businesses')
      .send({ name: 'X Studio', category: 'Nails' })
      .set(auth(token));
    expect(bad.status).toBe(400);
    expect((bad.body as { error: { code: string } }).error).toBeDefined();
  });

  it('400 on reserved slugs and malformed slugs', async () => {
    const token = await ownerToken();
    const reserved = await createBusiness(token, { name: 'Admin Area', publicSlug: 'admin' });
    expect(reserved.status).toBe(400);
    const malformed = await createBusiness(token, { name: 'Bad Slug', publicSlug: 'UPPER Case' });
    expect(malformed.status).toBe(400);
  });

  it('409 when an explicitly requested slug is already taken', async () => {
    const token = await ownerToken();
    const first = await createBusiness(token, { name: 'Red Salon', publicSlug: 'red-salon' });
    expect(first.status).toBe(201);
    const second = await createBusiness(token, { name: 'Blue Salon', publicSlug: 'red-salon' });
    expect(second.status).toBe(409);
  });

  it('auto-suffixed slug when the derived slug collides (no explicit slug)', async () => {
    const token = await ownerToken();
    const a = await createBusiness(token, { name: 'Mosaic' });
    const b = await createBusiness(token, { name: 'Mosaic' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.business!.publicSlug).toBe('mosaic-2');
  });

  it('403 when a non-owner (Admin) calls the owner endpoints', async () => {
    const adminToken = await login(TEST_EMAILS.admin1, TEST_PASSWORDS.admin);
    const res = await supertest(server)
      .post('/api/v1/businesses')
      .send({ name: 'Nope' })
      .set(auth(adminToken));
    expect(res.status).toBe(403);
  });
});

describe('B: profile update + validation', () => {
  it('PATCH updates profile fields and slug (QR/URL follow the slug)', async () => {
    const token = await ownerToken();
    const { business } = await createBusiness(token, { name: 'Original' });
    const res = await supertest(server)
      .patch(`/api/v1/businesses/${business!.id}`)
      .set(auth(token))
      .send({
        name: 'Renamed',
        description: 'Hello world',
        publicSlug: 'renamed-slug',
        contactEmail: 'hi@x.test',
      });
    expect(res.status).toBe(200);
    expect(res.body.business.name).toBe('Renamed');
    expect(res.body.business.publicSlug).toBe('renamed-slug');
    expect(res.body.business.description).toBe('Hello world');
    expect(res.body.business.contactEmail).toBe('hi@x.test');
    expect(res.body.business.publicUrl).toContain('/b/renamed-slug');
    expect(res.body.business.qrUrl).toContain('renamed-slug');
  });

  it('400 on invalid category / latitude / link during update', async () => {
    const token = await ownerToken();
    const { business } = await createBusiness(token, { name: 'Update Me' });
    const badCat = await supertest(server)
      .patch(`/api/v1/businesses/${business!.id}`)
      .set(auth(token))
      .send({ category: 'Spa' });
    expect(badCat.status).toBe(400);
    const badLat = await supertest(server)
      .patch(`/api/v1/businesses/${business!.id}`)
      .set(auth(token))
      .send({ latitude: 1234 });
    expect(badLat.status).toBe(400);
    const badLink = await supertest(server)
      .patch(`/api/v1/businesses/${business!.id}`)
      .set(auth(token))
      .send({ googleMapsLink: 'nope' });
    expect(badLink.status).toBe(400);
  });

  it('409 when moving to an existing slug', async () => {
    const token = await ownerToken();
    const a = await createBusiness(token, { name: 'Alpha', publicSlug: 'alpha' });
    const b = await createBusiness(token, { name: 'Beta' });
    const res = await supertest(server)
      .patch(`/api/v1/businesses/${b.business!.id}`)
      .set(auth(token))
      .send({ publicSlug: 'alpha' });
    expect(res.status).toBe(409);
    expect(a.business!.id).not.toEqual(b.business!.id);
  });
});

describe('C: ownership isolation (owner A vs owner B)', () => {
  it('owner B cannot read, update, pause or select owner A’s business (403)', async () => {
    const aToken = await ownerToken();
    const bToken = await ownerBToken();
    const { business } = await createBusiness(aToken, { name: 'A Only' });

    const read = await supertest(server)
      .get(`/api/v1/businesses/${business!.id}`)
      .set(auth(bToken));
    expect(read.status).toBe(403);

    const patch = await supertest(server)
      .patch(`/api/v1/businesses/${business!.id}`)
      .set(auth(bToken))
      .send({ name: 'Steal' });
    expect(patch.status).toBe(403);

    const pause = await supertest(server)
      .post(`/api/v1/businesses/${business!.id}/pause`)
      .set(auth(bToken))
      .send({});
    expect(pause.status).toBe(403);

    const select = await supertest(server)
      .post(`/api/v1/businesses/${business!.id}/select`)
      .set(auth(bToken));
    expect(select.status).toBe(403);

    // owner B list does not include A's business
    const list = await supertest(server).get('/api/v1/businesses').set(auth(bToken));
    expect(list.body.businesses).toEqual([]);
  });

  it('active business context switching is persisted to the session', async () => {
    const token = await ownerToken();
    const a = await createBusiness(token, { name: 'Ctx A' });
    const b = await createBusiness(token, { name: 'Ctx B' });

    const selB = await supertest(server)
      .post(`/api/v1/businesses/${b.business!.id}/select`)
      .set(auth(token));
    expect(selB.status).toBe(200);
    expect(selB.body.activeBusinessId).toBe(b.business!.id);

    const me = await supertest(server).get('/api/v1/auth/me').set(auth(token));
    expect(me.body.businessId).toBe(b.business!.id);
    expect(me.body.ownedBusinessIds).toEqual(
      expect.arrayContaining([a.business!.id, b.business!.id]),
    );

    const selA = await supertest(server)
      .post(`/api/v1/businesses/${a.business!.id}/select`)
      .set(auth(token));
    expect(selA.status).toBe(200);
    const me2 = await supertest(server).get('/api/v1/auth/me').set(auth(token));
    expect(me2.body.businessId).toBe(a.business!.id);
  });
});

describe('D: pause / resume / deactivate / reactivate lifecycle', () => {
  it('indefinite pause + resume + events', async () => {
    const token = await ownerToken();
    const { business } = await createBusiness(token, { name: 'Lifecycle One' });

    const paused = await supertest(server)
      .post(`/api/v1/businesses/${business!.id}/pause`)
      .set(auth(token))
      .send({ message: 'Holidays' });
    expect(paused.status).toBe(200);
    expect(paused.body.business.isPaused).toBe(true);
    expect(paused.body.business.pauseMessage).toBe('Holidays');
    expect(paused.body.business.pausedUntil).toBeNull();

    const evt = await prisma.securityEvent.findFirst({
      where: { businessId: business!.id, type: 'BUSINESS_PAUSE' },
    });
    expect(evt).not.toBeNull();

    const resumed = await supertest(server)
      .post(`/api/v1/businesses/${business!.id}/resume`)
      .set(auth(token));
    expect(resumed.status).toBe(200);
    expect(resumed.body.business.isPaused).toBe(false);
    expect(resumed.body.business.pauseMessage).toBeNull();

    const resumeAgain = await supertest(server)
      .post(`/api/v1/businesses/${business!.id}/resume`)
      .set(auth(token));
    expect(resumeAgain.status).toBe(409);
  });

  it('scheduled pause sets a future resume date; past dates rejected', async () => {
    const token = await ownerToken();
    const { business } = await createBusiness(token, { name: 'Scheduled Pause' });
    const until = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const paused = await supertest(server)
      .post(`/api/v1/businesses/${business!.id}/pause`)
      .set(auth(token))
      .send({ until });
    expect(paused.status).toBe(200);
    expect(paused.body.business.pausedUntil).toBe(until);

    const past = await supertest(server)
      .post(`/api/v1/businesses/${business!.id}/pause`)
      .set(auth(token))
      .send({ until: new Date(Date.now() - 1000).toISOString() });
    expect(past.status).toBe(400);
  });

  it('deactivate sets deactivatedAt + stays visible to owner; reactivate reopens', async () => {
    const token = await ownerToken();
    const { business } = await createBusiness(token, { name: 'Closable' });

    const deact = await supertest(server)
      .post(`/api/v1/businesses/${business!.id}/deactivate`)
      .set(auth(token));
    expect(deact.status).toBe(200);
    expect(deact.body.business.isDeactivated).toBe(true);
    expect(deact.body.business.deactivatedAt).toBeTruthy();
    expect(deact.body.business.isPaused).toBe(true);

    // Owner still sees it in the list (REQ-023 — deactivation, not deletion).
    const list = await supertest(server).get('/api/v1/businesses').set(auth(token));
    expect(list.body.businesses.map((b: Biz) => b.id)).toContain(business!.id);

    // Cannot pause a deactivated business.
    const pauseAttempt = await supertest(server)
      .post(`/api/v1/businesses/${business!.id}/pause`)
      .set(auth(token))
      .send({});
    expect(pauseAttempt.status).toBe(409);

    const react = await supertest(server)
      .post(`/api/v1/businesses/${business!.id}/reactivate`)
      .set(auth(token));
    expect(react.status).toBe(200);
    expect(react.body.business.isDeactivated).toBe(false);
    expect(react.body.business.isPaused).toBe(false);
  });
});

describe('E: media upload + public serving', () => {
  it('logo upload → served publicly as image/png; page exposes URLs', async () => {
    const token = await ownerToken();
    const { business } = await createBusiness(token, { name: 'Photo Studio' });

    const up = await supertest(server)
      .post(`/api/v1/businesses/${business!.id}/logo`)
      .set(auth(token))
      .attach('file', PNG, { filename: 'logo.png', contentType: 'image/png' });
    expect(up.status).toBe(200);
    expect(up.body.business.logoUrl).toContain('/api/v1/public/businesses/photo-studio/logo');
    expect(up.body.business.logoKey).toBeTruthy();

    const img = await supertest(server).get(
      `/api/v1/public/businesses/${business!.publicSlug}/logo`,
    );
    expect(img.status).toBe(200);
    expect(img.header['content-type']).toContain('image/png');
    expect(img.body.length).toBe(PNG.length);

    const page = await supertest(server).get(`/api/v1/public/businesses/${business!.publicSlug}`);
    expect(page.status).toBe(200);
    expect(page.body.business.logoUrl).toContain('/logo');
    // No internal keys on the public view.
    expect(page.body.business.logoKey).toBeUndefined();
  });

  it('rejects unsupported mime types (415-domain: 400 FILE_TYPE_INVALID) and oversized files', async () => {
    const token = await ownerToken();
    const { business } = await createBusiness(token, { name: 'Media Rules' });

    const bad = await supertest(server)
      .post(`/api/v1/businesses/${business!.id}/cover`)
      .set(auth(token))
      .attach('file', Buffer.from('not an image'), {
        filename: 'x.txt',
        contentType: 'text/plain',
      });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('FILE_TYPE_INVALID');

    const big = await supertest(server)
      .post(`/api/v1/businesses/${business!.id}/logo`)
      .set(auth(token))
      .attach('file', Buffer.alloc(MAX_UPLOAD_BYTES + 1), {
        filename: 'big.png',
        contentType: 'image/png',
      });
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('QR endpoint returns a PNG for an existing slug; 404 for unknown', async () => {
    const token = await ownerToken();
    const { business } = await createBusiness(token, { name: 'QR Owner' });
    const qr = await supertest(server).get(`/api/v1/public/businesses/${business!.publicSlug}/qr`);
    expect(qr.status).toBe(200);
    expect(qr.header['content-type']).toContain('image/png');

    const missing = await supertest(server).get('/api/v1/public/businesses/no-such-biz/qr');
    expect(missing.status).toBe(404);
  });
});

describe('F: public business page (REQ-207..216)', () => {
  it('returns the public subset and pause message; 404 for unknown slugs', async () => {
    const token = await ownerToken();
    const { business } = await createBusiness(token, {
      name: 'Public Page',
      description: 'Public desc',
    });
    await supertest(server)
      .post(`/api/v1/businesses/${business!.id}/pause`)
      .set(auth(token))
      .send({ message: 'Soon back' });

    const page = await supertest(server).get(`/api/v1/public/businesses/${business!.publicSlug}`);
    expect(page.status).toBe(200);
    expect(page.body.business.name).toBe('Public Page');
    expect(page.body.business.description).toBe('Public desc');
    expect(page.body.business.isPaused).toBe(true);
    expect(page.body.business.pauseMessage).toBe('Soon back');
    expect(page.body.business.publicUrl).toContain(`/b/${business!.publicSlug}`);

    const missing = await supertest(server).get('/api/v1/public/businesses/nonexistent');
    expect(missing.status).toBe(404);
  });
});

describe('G: automatic scheduled resume (sweep)', () => {
  it('due businesses resume only when subscription allows; recorded as AUTO_RESUME', async () => {
    const token = await ownerToken();
    const { business } = await createBusiness(token, { name: 'Auto-Resume Me' });
    const until = new Date(Date.now() + 2 * 86_400_000).toISOString();
    await supertest(server)
      .post(`/api/v1/businesses/${business!.id}/pause`)
      .set(auth(token))
      .send({ until });
    // Force the resume date into the past (service-level test of the sweep).
    await superuser.query(
      `UPDATE business SET paused_until = now() - interval '1 minute' WHERE id = $1`,
      [business!.id],
    );

    const svc = app.get(BusinessService);
    const outcome = await svc.autoResumeDueBusinesses();
    expect(outcome.resumed).toBeGreaterThanOrEqual(1);

    const row = await readBusinessAsOwner(business!.id);
    expect(row!.isPaused).toBe(false);
    expect(row!.pausedUntil).toBeNull();

    const evt = await prisma.securityEvent.findFirst({
      where: { businessId: business!.id, type: 'BUSINESS_AUTO_RESUME' },
    });
    expect(evt).not.toBeNull();
  });

  it('indefinite pauses are never auto-resumed (REQ-156)', async () => {
    const token = await ownerToken();
    const { business } = await createBusiness(token, { name: 'Stays Paused' });
    await supertest(server)
      .post(`/api/v1/businesses/${business!.id}/pause`)
      .set(auth(token))
      .send({});

    const svc = app.get(BusinessService);
    const outcome = await svc.autoResumeDueBusinesses();
    expect(outcome.resumed).toBe(0);
    expect(outcome.denied).toBe(0);

    const row = await readBusinessAsOwner(business!.id);
    expect(row!.isPaused).toBe(true);
  });
});

describe('H: Admin platform management (REQ-041/042)', () => {
  it('Admin can list and read all businesses but cannot write', async () => {
    const token = await ownerToken();
    const { business } = await createBusiness(token, {
      name: 'Platform Biz',
      publicSlug: 'platform-biz',
    });

    const adminToken = await login(TEST_EMAILS.admin1, TEST_PASSWORDS.admin);
    const list = await supertest(server).get('/api/v1/admin/businesses').set(auth(adminToken));
    expect(list.status).toBe(200);
    expect(list.body.businesses.map((b: Biz) => b.id)).toContain(business!.id);
    expect(list.body.businesses.find((b: Biz) => b.id === business!.id)?.name).toBe('Platform Biz');

    const one = await supertest(server)
      .get(`/api/v1/admin/businesses/${business!.id}`)
      .set(auth(adminToken));
    expect(one.status).toBe(200);
    expect(one.body.business.owner.email).toBe(OWNER_EMAIL);

    const patch = await supertest(server)
      .patch(`/api/v1/admin/businesses/${business!.id}`)
      .set(auth(adminToken))
      .send({ name: 'Nope' });
    expect(patch.status).toBe(403);

    const pause = await supertest(server)
      .post(`/api/v1/admin/businesses/${business!.id}/deactivate`)
      .set(auth(adminToken));
    expect(pause.status).toBe(403);
  });

  it('Super Admin can update + lifecycle-manage any business', async () => {
    const token = await ownerToken();
    const { business } = await createBusiness(token, { name: 'Managed By SA' });

    const saToken = await login(TEST_EMAILS.sa, TEST_PASSWORDS.sa);
    const patch = await supertest(server)
      .patch(`/api/v1/admin/businesses/${business!.id}`)
      .set(auth(saToken))
      .send({ description: 'SA edited me' });
    expect(patch.status).toBe(200);
    expect(patch.body.business.description).toBe('SA edited me');

    const pause = await supertest(server)
      .post(`/api/v1/admin/businesses/${business!.id}/pause`)
      .set(auth(saToken))
      .send({ message: 'Platform hold' });
    expect(pause.status).toBe(200);
    expect(pause.body.business.isPaused).toBe(true);

    const resume = await supertest(server)
      .post(`/api/v1/admin/businesses/${business!.id}/resume`)
      .set(auth(saToken));
    expect(resume.status).toBe(200);
    expect(resume.body.business.isPaused).toBe(false);
  });

  it('search filters the admin list by slug/name', async () => {
    const token = await ownerToken();
    await createBusiness(token, { name: 'Needle', publicSlug: 'needle-first' });
    await createBusiness(token, { name: 'Haystack', publicSlug: 'haystack-only' });

    const adminToken = await login(TEST_EMAILS.admin1, TEST_PASSWORDS.admin);
    const res = await supertest(server)
      .get('/api/v1/admin/businesses?search=needle')
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    const slugs = res.body.businesses.map((b: Biz) => b.publicSlug);
    expect(slugs).toContain('needle-first');
    expect(slugs).not.toContain('haystack-only');
  });
});
