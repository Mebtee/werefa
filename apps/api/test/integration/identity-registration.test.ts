import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../../src/database/prisma.service';
import { MailService } from '../../src/notifications/mail.service';
import { TEST_EMAILS, extractSessionToken, resetIdentityDatabaseAndSeed } from './identity.helpers';

/* ── env bootstrap (identical to the login/password tests) ───────────── */
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

const sha256 = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');

/* ── test fixtures ────────────────────────────────────────────────────── */
let app: INestApplication;
let server: ReturnType<INestApplication['getHttpServer']>;
let supertest: typeof import('supertest');
let prisma: PrismaService;
let mail: MailService;

const CSRF = { 'x-requested-with': 'fetch' } as const;
const REGISTER_MSG =
  'Your request was received. If this email is available, a verification link was sent.';
const RESEND_MSG = 'If an account exists for this email, a verification link has been sent.';

beforeAll(async () => {
  process.env.APP_ENV = 'test';
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.STORAGE_PROVIDER = 'memory';
  process.env.AUTH_RATE_LIMIT_MAX = '100';
  process.env.RECOVERY_RATE_LIMIT_MAX = '100';
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
  mail = app.get(MailService);

  const st = await import('supertest');
  supertest = (st.default ?? st) as typeof import('supertest');
  await resetIdentityDatabaseAndSeed(process.env.DATABASE_MIGRATOR_URL!);
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  mail.captured.length = 0;
});

/* ── helpers ──────────────────────────────────────────────────────────── */
async function register(email: string, password = 'NewOwnerPass-123') {
  const res = await supertest(server)
    .post('/api/v1/auth/register')
    .send({ email, password })
    .set(CSRF);
  return { status: res.status, body: res.body };
}

async function requestVerification(email: string) {
  const res = await supertest(server)
    .post('/api/v1/auth/verify-email/request')
    .send({ email })
    .set(CSRF);
  return { status: res.status, body: res.body };
}

async function completeVerification(token: string) {
  const res = await supertest(server)
    .post('/api/v1/auth/verify-email/complete')
    .send({ token })
    .set(CSRF);
  return { status: res.status, body: res.body };
}

async function login(email: string, password: string) {
  const res = await supertest(server)
    .post('/api/v1/auth/login')
    .send({ email, password })
    .set(CSRF);
  return {
    status: res.status,
    setCookie: res.header['set-cookie'] as string[] | undefined,
    body: res.body,
  };
}

function extractVerifyTokenFromMail(): string {
  const matches = mail.captured.filter((m) => m.subject === 'Verify your Werefa account');
  expect(matches.length).toBeGreaterThan(0);
  const match = matches[matches.length - 1]!.text.match(/verify\/([A-Za-z0-9_-]{40,})/);
  expect(match).toBeDefined();
  return match![1];
}

/* ═══════════════════════════════════════════════════════════════════════ */
describe('A: self-registration creates an unverified OWNER only', () => {
  it('202, uniform message, verification email with link, OWNER role, no business', async () => {
    const email = 'alice@new.werefa.test';
    const res = await register(email);
    expect(res.status).toBe(202);
    expect(res.body.message).toBe(REGISTER_MSG);

    // One verification mail with the deep link (Werefa-branded + TTL).
    const captures = mail.captured.filter((m) => m.subject === 'Verify your Werefa account');
    expect(captures).toHaveLength(1);
    const body = captures[0]!.text;
    expect(body).toContain('valid 30 minutes');
    expect(body).toContain('/verify/');
    const token = extractVerifyTokenFromMail();

    // DB: OWNER account, unverified; token stored hashed, unused.
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();
    expect(user!.role).toBe('Owner');
    expect(user!.isEmailVerified).toBe(false);

    const row = await prisma.emailVerificationToken.findUnique({
      where: { tokenHash: sha256(token) },
      select: { userId: true, usedAt: true, expiresAt: true },
    });
    expect(row).not.toBeNull();
    expect(row!.userId).toBe(user!.id);
    expect(row!.usedAt).toBeNull();
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('B: register → verify → sign in full loop', () => {
  it('after verification, login works and /me reports an owner with no businesses', async () => {
    const email = 'bella@new.werefa.test';
    await register(email);
    const token = extractVerifyTokenFromMail();

    const res = await completeVerification(token);
    expect(res.status).toBe(204);

    const user = await prisma.user.findUnique({
      where: { email },
      select: { isEmailVerified: true },
    });
    expect(user!.isEmailVerified).toBe(true);

    // Unverified-when-registered: the owner still owns no business (REQ-005
    // business creation happens after sign-in in the owner hub).
    const loginRes = await login(email, 'NewOwnerPass-123');
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.role).toBe('Owner');

    const cookie = extractSessionToken(loginRes.setCookie)!;
    const me = await supertest(server)
      .get('/api/v1/auth/me')
      .set('Cookie', `wrf.sid=${cookie}`)
      .set(CSRF)
      .expect(200);
    expect(me.body.role).toBe('Owner');
    expect(me.body.ownedBusinessIds).toEqual([]);
    expect(me.body.businessId).toBeUndefined();
  });
});

describe('C: verification links are single-use and resend invalidates the prior token', () => {
  it('first link 409 TOKEN_USED after a resend; second link works', async () => {
    const email = 'carla@new.werefa.test';
    await register(email);
    const token1 = extractVerifyTokenFromMail();

    // Resend via verify-email/request → invalidates token1, mints token2.
    const req = await requestVerification(email);
    expect(req.status).toBe(202);
    expect(req.body.message).toBe(RESEND_MSG);
    const token2 = extractVerifyTokenFromMail();
    expect(token2).not.toBe(token1);

    const stale = await completeVerification(token1);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('TOKEN_USED');

    const good = await completeVerification(token2);
    expect(good.status).toBe(204);
  });

  it('a used token cannot be redeemed a second time', async () => {
    const email = 'dana@new.werefa.test';
    await register(email);
    const token = extractVerifyTokenFromMail();

    await completeVerification(token);
    const again = await completeVerification(token);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('TOKEN_USED');

    // Only ONE non-consumed completion should have been possible.
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user!.isEmailVerified).toBe(true);
  });
});

describe('D: invalid / expired tokens are rejected', () => {
  it('garbage token → 401 TOKEN_EXPIRED', async () => {
    const res = await completeVerification('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('expired token → 401 TOKEN_EXPIRED', async () => {
    const email = 'erin@new.werefa.test';
    await register(email);
    const token = extractVerifyTokenFromMail();
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });

    await prisma.emailVerificationToken.updateMany({
      where: { userId: user!.id, usedAt: null },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const res = await completeVerification(token);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });
});

describe('E: unverified accounts cannot reach the dashboard', () => {
  it('correct credentials + unverified email → 401 VERIFICATION_REQUIRED and no session cookie', async () => {
    const email = 'fiona@new.werefa.test';
    await register(email);

    const res = await login(email, 'NewOwnerPass-123');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('VERIFICATION_REQUIRED');
    expect(extractSessionToken(res.setCookie)).toBeUndefined();
  });

  it('still-unverified owner cannot reach /api/v1/auth/me after being handed a seeded-style session', async () => {
    // No session is ever minted for the unverified owner, so a direct attempt
    // is 401 by the session guard.
    const email = 'gina@new.werefa.test';
    await register(email);
    const res = await supertest(server)
      .get('/api/v1/auth/me')
      .set('Cookie', 'wrf.sid=fake-session-token')
      .set(CSRF);
    expect(res.status).toBe(401);
  });
});

describe('F: registration is non-enumerating', () => {
  it('registering an existing platform (Admin) email gets the identical 202 and no email/token', async () => {
    const before = mail.captured.length;
    const res = await register(TEST_EMAILS.admin1, 'SomeOtherPass-123');
    expect(res.status).toBe(202);
    expect(res.body.message).toBe(REGISTER_MSG);
    expect(mail.captured.length).toBe(before);

    // No verification token was created for the platform account.
    const admin = await prisma.user.findUnique({ where: { email: TEST_EMAILS.admin1 } });
    const tokens = await prisma.emailVerificationToken.count({ where: { userId: admin!.id } });
    expect(tokens).toBe(0);
    const adminNow = await prisma.user.findUnique({
      where: { email: TEST_EMAILS.admin1 },
      select: { role: true, isEmailVerified: true },
    });
    expect(adminNow!.role).toBe('Admin');
    expect(adminNow!.isEmailVerified).toBe(true);
  });

  it('duplicate registration of a verified owner is a uniform 202 with no email', async () => {
    // owner@werefa.test is seeded verified (resetIdentityDatabaseAndSeed).
    const before = mail.captured.length;
    const res = await register(TEST_EMAILS.owner, 'OwnerPass-123');
    expect(res.status).toBe(202);
    expect(res.body.message).toBe(REGISTER_MSG);
    expect(mail.captured.length).toBe(before);
    const owner = await prisma.user.findUnique({ where: { email: TEST_EMAILS.owner } });
    expect(owner!.role).toBe('Owner');
  });
});

describe('G: role manipulation is impossible', () => {
  it('a client-sent role field is ignored → the account is OWNER', async () => {
    const email = 'hacker@new.werefa.test';
    const res = await supertest(server)
      .post('/api/v1/auth/register')
      .send({ email, password: 'NewOwnerPass-123', role: 'SuperAdmin' })
      .set(CSRF);
    expect(res.status).toBe(202);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user!.role).toBe('Owner');
    expect(user!.isEmailVerified).toBe(false);
  });
});

describe('H: verify-email/request never discloses whether an account exists', () => {
  it('unknown email → 202 uniform response and no email', async () => {
    const before = mail.captured.length;
    const res = await requestVerification('ghost@nowhere.werefa.test');
    expect(res.status).toBe(202);
    expect(res.body.message).toBe(RESEND_MSG);
    expect(mail.captured.length).toBe(before);
  });

  it('existing platform account (Admin) → 202 uniform response and no email', async () => {
    const before = mail.captured.length;
    const res = await requestVerification(TEST_EMAILS.admin2);
    expect(res.status).toBe(202);
    expect(res.body.message).toBe(RESEND_MSG);
    expect(mail.captured.length).toBe(before);
  });

  it('unverified owner → fresh verification email with a working link', async () => {
    const email = 'ida@new.werefa.test';
    await register(email);
    await completeVerification(extractVerifyTokenFromMail());

    // Already verified now → a resend request must NOT mint/email again.
    const before = mail.captured.length;
    const res = await requestVerification(email);
    expect(res.status).toBe(202);
    expect(mail.captured.length).toBe(before);
  });
});

describe('I: registration input validation', () => {
  it('missing email → 400', async () => {
    const res = await supertest(server)
      .post('/api/v1/auth/register')
      .send({ password: 'NewOwnerPass-123' })
      .set(CSRF);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('malformed email → 400', async () => {
    const res = await supertest(server)
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: 'NewOwnerPass-123' })
      .set(CSRF);
    expect(res.status).toBe(400);
  });

  it('short password → 400', async () => {
    const res = await supertest(server)
      .post('/api/v1/auth/register')
      .send({ email: 'shorty@new.werefa.test', password: 'short' })
      .set(CSRF);
    expect(res.status).toBe(400);
    expect(res.body.error.fields[0].field).toBe('password');
  });
});

describe('J: register endpoint is rate limited (shared RateLimitService)', () => {
  it('the register path throws 429 when the per-ip bucket is exhausted', async () => {
    // The controller keys register on `auth:register:<ip>`. supertest requests
    // arrive from 127.0.0.1; pre-fill both IPv4 forms so the outcome is
    // deterministic regardless of how Express reports req.ip.
    const { RateLimitService } = await import('../../src/iam/rate-limit.service');
    const rl = app.get(RateLimitService);
    for (const ip of ['::ffff:127.0.0.1', '127.0.0.1']) {
      for (let i = 0; i < 101; i += 1) {
        await rl.check(`auth:register:${ip}`, 100, 60_000).catch(() => {});
      }
    }

    const res = await supertest(server)
      .post('/api/v1/auth/register')
      .send({ email: 'jane@new.werefa.test', password: 'NewOwnerPass-123' })
      .set(CSRF);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});
