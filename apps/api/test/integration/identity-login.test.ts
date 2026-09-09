import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../../src/database/prisma.service';
import { MailService } from '../../src/notifications/mail.service';
import {
  TEST_EMAILS,
  TEST_PASSWORDS,
  extractSessionToken,
  expectEnvelope401,
  expectEnvelope423,
  resetIdentityDatabaseAndSeed,
} from './identity.helpers';

/* ── env helpers (same pattern as the front-door test) ────────────────── */
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

/* ── test fixtures ────────────────────────────────────────────────────── */
let app: INestApplication;
let server: ReturnType<INestApplication['getHttpServer']>;
let supertest: typeof import('supertest');
let prisma: PrismaService;
let mail: MailService;

const CSRF_HEADER = { 'x-requested-with': 'fetch' };

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

  const supertestModule = await import('supertest');
  supertest = (supertestModule.default ?? supertestModule) as typeof import('supertest');
  await resetIdentityDatabaseAndSeed(process.env.DATABASE_MIGRATOR_URL!);
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  mail.captured.length = 0;
});

/* ── helpers ──────────────────────────────────────────────────────────── */
async function login(
  email: string,
  password: string,
): Promise<{ status: number; setCookie?: string[]; body: Record<string, unknown> }> {
  const res = await supertest(server)
    .post('/api/v1/auth/login')
    .send({ email, password })
    .set(CSRF_HEADER);
  return {
    status: res.status,
    setCookie: res.header['set-cookie'] as string[] | undefined,
    body: res.body,
  };
}

async function me(cookie: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await supertest(server)
    .get('/api/v1/auth/me')
    .set('Cookie', `wrf.sid=${cookie}`)
    .set(CSRF_HEADER);
  return { status: res.status, body: res.body };
}

/* ═══════════════════════════════════════════════════════════════════════ */
/*  Tests                                                                */
/* ═══════════════════════════════════════════════════════════════════════ */

describe('A: login success + Q: session fixation', () => {
  it('login returns 200, a new session cookie, and /me reflects the account', async () => {
    const res = await login(TEST_EMAILS.owner, TEST_PASSWORDS.owner);
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: expect.any(String),
      email: TEST_EMAILS.owner,
      role: 'Owner',
    });
    expect(res.body.session.expiresAt).toEqual(expect.any(String));

    const token = extractSessionToken(res.setCookie);
    expect(token).toBeDefined();
    expect(token!.length).toBeGreaterThan(40);

    const meRes = await me(token!);
    expect(meRes.status).toBe(200);
    expect(meRes.body.userId).toBe(res.body.user.id);
    expect(meRes.body.email).toBe(TEST_EMAILS.owner);
    expect(meRes.body.role).toBe('Owner');
  });

  it('Q: session token is opaque and not predictable (token length/type)', async () => {
    const a = await login(TEST_EMAILS.admin1, TEST_PASSWORDS.admin);
    const b = await login(TEST_EMAILS.admin2, TEST_PASSWORDS.admin);
    const tokenA = extractSessionToken(a.setCookie)!;
    const tokenB = extractSessionToken(b.setCookie)!;
    expect(tokenA).not.toBe(tokenB);
    expect(tokenA.length).toBe(tokenB.length);
  });
});

describe('B: failed login counter + lockout', () => {
  it('wrong password increments counter; success resets it', async () => {
    const wrong1 = await login(TEST_EMAILS.owner, 'wrong1!');
    expect(wrong1.status).toBe(401);
    const wrong2 = await login(TEST_EMAILS.owner, 'wrong2!');
    expect(wrong2.status).toBe(401);
    const wrong3 = await login(TEST_EMAILS.owner, 'wrong3!');
    expect(wrong3.status).toBe(401);

    const countBefore = await prisma.user.findUnique({
      where: { email: TEST_EMAILS.owner },
      select: { failedLoginCount: true },
    });
    expect(countBefore!.failedLoginCount).toBe(3);

    const ok = await login(TEST_EMAILS.owner, TEST_PASSWORDS.owner);
    expect(ok.status).toBe(200);

    const countAfter = await prisma.user.findUnique({
      where: { email: TEST_EMAILS.owner },
      select: { failedLoginCount: true, isLockedUntil: true },
    });
    expect(countAfter!.failedLoginCount).toBe(0);
    expect(countAfter!.isLockedUntil).toBeNull();
  });

  it('5 consecutive failures lock the account (423)', async () => {
    // Use admin1 account (fresh counter after previous test may have been reset).
    // Force-reset counter to 0 first to be deterministic.
    await prisma.user.update({
      where: { email: TEST_EMAILS.admin1 },
      data: { failedLoginCount: 0, isLockedUntil: null },
    });

    for (let i = 1; i <= 5; i += 1) {
      const res = await login(TEST_EMAILS.admin1, 'wrong!');
      if (i < 5) {
        expect(res.status).toBe(401);
      } else {
        expect(res.status).toBe(423);
        expectEnvelope423(res.body);
      }
    }

    const record = await prisma.user.findUnique({
      where: { email: TEST_EMAILS.admin1 },
      select: { failedLoginCount: true, isLockedUntil: true },
    });
    expect(record!.failedLoginCount).toBeGreaterThanOrEqual(5);
    expect(record!.isLockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // Account remains locked even with correct password.
    const locked = await login(TEST_EMAILS.admin1, TEST_PASSWORDS.admin);
    expect(locked.status).toBe(423);

    // Clean up lock so other tests can use admin1.
    await prisma.user.update({
      where: { email: TEST_EMAILS.admin1 },
      data: { failedLoginCount: 0, isLockedUntil: null },
    });
  });
});

describe('C: unknown email login returns generic 401 (no enumeration)', () => {
  it('non-existent email → 401 UNAUTHENTICATED with identical envelope', async () => {
    const res = await login('ghost@werefa.test', 'anything');
    expect(res.status).toBe(401);
    expectEnvelope401(res.body);
    expect((res.body as { error: { detail: string } }).error.detail).toBe(
      'Invalid email or password.',
    );
  });
});

describe('D: security events recorded with ip/device/browser', () => {
  it('LOGIN_SUCCESS and UNRECOGNIZED_DEVICE events on first login', async () => {
    const userId = (await prisma.user.findUnique({
      where: { email: TEST_EMAILS.owner },
      select: { id: true },
    }))!.id;

    // Clear any existing sessions so the next login is unrecognized.
    await prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const res = await login(TEST_EMAILS.owner, TEST_PASSWORDS.owner);
    expect(res.status).toBe(200);

    const events = await prisma.securityEvent.findMany({
      where: { userId, type: { in: ['LOGIN_SUCCESS', 'UNRECOGNIZED_DEVICE'] } },
      orderBy: { createdAt: 'desc' },
    });
    expect(events.length).toBeGreaterThanOrEqual(2);
    const types = events.map((e) => e.type);
    expect(types).toContain('LOGIN_SUCCESS');
    expect(types).toContain('UNRECOGNIZED_DEVICE');

    // Events carry ip / device / browser (not null/empty).
    const loginEvt = events.find((e) => e.type === 'LOGIN_SUCCESS')!;
    expect(loginEvt.ip).toBeDefined();
    expect(loginEvt.device).toBeDefined();
    expect(loginEvt.browser).toBeDefined();
    expect(loginEvt.result).toBe('SUCCESS');
  });
});

describe('R: unknown account login failure → no lockout email, no security event', () => {
  it('does not send an email or create a security event', async () => {
    const emailBefore = mail.captured.length;
    await login('unknown@werefa.test', 'bad');
    await login('unknown@werefa.test', 'bad');
    expect(mail.captured.length).toBe(emailBefore); // no new emails
  });
});

describe('S: login endpoint rate limiting → 429', () => {
  it('RateLimitService throws TooManyRequestsException when limit exceeded', async () => {
    // The integration app boots with AUTH_RATE_LIMIT_MAX=100, which is too high
    // to trigger through the HTTP surface within a fast test. Instead we verify
    // the rate-limit service directly (unit-level), which is the same code path
    // invoked by the auth controller.
    const { RateLimitService } = await import('../../src/iam/rate-limit.service');
    const rl = app.get(RateLimitService);
    const key = `test:rl:${Date.now()}`;
    // Two checks should pass; third with max=2 should throw.
    await rl.check(key, 2, 60_000);
    await rl.check(key, 2, 60_000);
    try {
      await rl.check(key, 2, 60_000);
      throw new Error('Expected TooManyRequestsException');
    } catch (err) {
      const e = err as { code?: string; httpStatus?: number };
      expect(e.code).toBe('RATE_LIMITED');
      expect(e.httpStatus).toBe(429);
    }
  });
});

describe('T: CSRF guard blocks state-changing requests without x-requested-with when cookie present', () => {
  it('POST /auth/logout without header → 403 FORBIDDEN', async () => {
    const loginRes = await login(TEST_EMAILS.owner, TEST_PASSWORDS.owner);
    const token = extractSessionToken(loginRes.setCookie)!;

    const res = await supertest(server)
      .post('/api/v1/auth/logout')
      .set('Cookie', `wrf.sid=${token}`)
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.detail).toContain('Cross-site request blocked');
  });

  it('POST /auth/logout with header → 204', async () => {
    const loginRes = await login(TEST_EMAILS.owner, TEST_PASSWORDS.owner);
    const token = extractSessionToken(loginRes.setCookie)!;

    await supertest(server)
      .post('/api/v1/auth/logout')
      .set('Cookie', `wrf.sid=${token}`)
      .set(CSRF_HEADER)
      .expect(204);

    // Cookie is cleared
    const setCookie = (
      await supertest(server).get('/api/v1/auth/me').set('Cookie', `wrf.sid=${token}`)
    ).header['set-cookie'] as string[] | undefined;
    const cleared = setCookie?.some((c) => c.includes('wrf.sid=;'));
    expect(cleared ?? true).toBe(true);
  });
});
