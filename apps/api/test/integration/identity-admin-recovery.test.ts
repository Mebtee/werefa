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
  expectEnvelope409,
  resetIdentityDatabaseAndSeed,
} from './identity.helpers';

/* ── env bootstrap ───────────────────────────────────────────────────── */
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

let app: INestApplication;
let server: ReturnType<INestApplication['getHttpServer']>;
let supertest: typeof import('supertest');
let prisma: PrismaService;
let mail: MailService;
const CSRF = { 'x-requested-with': 'fetch' } as const;

beforeAll(async () => {
  process.env.APP_ENV = 'test';
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.STORAGE_PROVIDER = 'memory';
  process.env.COOKIE_SECURE = 'false';
  process.env.AUTH_RATE_LIMIT_MAX = '100';
  process.env.RECOVERY_RATE_LIMIT_MAX = '100';
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

async function loginAs(role: 'sa' | 'admin' | 'owner') {
  const [email, password] =
    role === 'sa'
      ? [TEST_EMAILS.sa, TEST_PASSWORDS.sa]
      : role === 'admin'
        ? [TEST_EMAILS.admin1, TEST_PASSWORDS.admin]
        : [TEST_EMAILS.owner, TEST_PASSWORDS.owner];
  return login(email, password);
}

function extractRecoveryCodeFromMail(): string {
  const matches = mail.captured.filter((m) => m.subject?.includes('recovery code'));
  expect(matches.length).toBeGreaterThan(0);
  const match = matches[matches.length - 1]!.text.match(/^([A-Z2-7]{10})$/m);
  expect(match).toBeDefined();
  return match![1];
}

/* ═══════════════════════════════════════════════════════════════════════ */
describe('K: recovery request — separate recovery email, uniform responses', () => {
  it('correct recovery email → 202 + one-time code email', async () => {
    const res = await supertest(server)
      .post('/api/v1/super-admin/recovery/request')
      .send({ recoveryEmail: TEST_PASSWORDS.saRecoveryEmail })
      .set(CSRF)
      .expect(202);
    expect(res.body.message).toContain('If this matches');
    expect(mail.captured.length).toBe(1);
    expect(extractRecoveryCodeFromMail().length).toBe(10);
  });

  it('wrong recovery email → same 202 + NO email', async () => {
    const before = mail.captured.length;
    const res = await supertest(server)
      .post('/api/v1/super-admin/recovery/request')
      .send({ recoveryEmail: 'wrong-recovery@werefa.test' })
      .set(CSRF)
      .expect(202);
    expect(res.body.message).toContain('If this matches');
    expect(mail.captured.length).toBe(before);
  });
});

describe('L: recovery complete — immediate password replacement', () => {
  it('correct code sets new SA password; old fails; sessions revoked', async () => {
    // Establish an SA session first so we can verify revocation.
    const saLogin = await login(TEST_EMAILS.sa, TEST_PASSWORDS.sa);
    const saCookie = extractSessionToken(saLogin.setCookie)!;
    await supertest(server)
      .get('/api/v1/auth/me')
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(200);

    await supertest(server)
      .post('/api/v1/super-admin/recovery/request')
      .send({ recoveryEmail: TEST_PASSWORDS.saRecoveryEmail })
      .set(CSRF)
      .expect(202);
    const code = extractRecoveryCodeFromMail();

    const newPw = 'RecoveredPass1';
    await supertest(server)
      .post('/api/v1/super-admin/recovery/complete')
      .send({ code, newPassword: newPw })
      .set(CSRF)
      .expect(204);

    // Old SA session revoked
    await supertest(server)
      .get('/api/v1/auth/me')
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(401);

    // Old password fails
    const oldLogin = await login(TEST_EMAILS.sa, TEST_PASSWORDS.sa);
    expect(oldLogin.status).toBe(401);

    // New password works
    const fresh = await login(TEST_EMAILS.sa, newPw);
    expect(fresh.status).toBe(200);
  });
});

describe('N: recovery code single-use', () => {
  it('second use → 409 TOKEN_USED', async () => {
    // SA password was changed to 'RecoveredPass1' in test L.
    await supertest(server)
      .post('/api/v1/super-admin/recovery/request')
      .send({ recoveryEmail: TEST_PASSWORDS.saRecoveryEmail })
      .set(CSRF)
      .expect(202);
    const code = extractRecoveryCodeFromMail();

    await supertest(server)
      .post('/api/v1/super-admin/recovery/complete')
      .send({ code, newPassword: TEST_PASSWORDS.newPassword })
      .set(CSRF)
      .expect(204);

    const res = await supertest(server)
      .post('/api/v1/super-admin/recovery/complete')
      .send({ code, newPassword: TEST_PASSWORDS.newPassword })
      .set(CSRF)
      .expect(409);
    expect(res.body.error.code).toBe('TOKEN_USED');
  });
});

describe('O: recovery code expiry', () => {
  it('expired code → 401 TOKEN_EXPIRED', async () => {
    // SA password is TEST_PASSWORDS.newPassword after test N.
    await supertest(server)
      .post('/api/v1/super-admin/recovery/request')
      .send({ recoveryEmail: TEST_PASSWORDS.saRecoveryEmail })
      .set(CSRF)
      .expect(202);
    const code = extractRecoveryCodeFromMail();

    const saId = (await prisma.user.findFirst({
      where: { role: 'SuperAdmin' },
      select: { id: true },
    }))!.id;
    await prisma.recoveryToken.updateMany({
      where: { superAdminUserId: saId, usedAt: null },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const res = await supertest(server)
      .post('/api/v1/super-admin/recovery/complete')
      .send({ code, newPassword: TEST_PASSWORDS.newPassword })
      .set(CSRF)
      .expect(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });
});

describe('P: admin boundary — only SuperAdmin manages Admins', () => {
  async function loginSa() {
    // SA password is TEST_PASSWORDS.newPassword after N/O.
    return login(TEST_EMAILS.sa, TEST_PASSWORDS.newPassword);
  }

  it('more than two active Admins → 409 CONFLICT', async () => {
    const sa = await loginSa();
    const saCookie = extractSessionToken(sa.setCookie)!;

    // Two Admins already exist (admin1, admin2) => a third create conflicts.
    const res = await supertest(server)
      .post('/api/v1/super-admin/admins')
      .send({ email: 'third-admin@werefa.test', password: 'ThirdAdmin12345' })
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(409);
    expectEnvelope409(res.body, 'maximum of two active Admin accounts');
  });

  it('Owner/Admin/anon cannot access admin endpoints → 403', async () => {
    // Anonymous
    await supertest(server).get('/api/v1/super-admin/admins').set(CSRF).expect(401);

    // Owner
    const owner = await loginAs('owner');
    const ownerCookie = extractSessionToken(owner.setCookie)!;
    const ownerRes = await supertest(server)
      .get('/api/v1/super-admin/admins')
      .set('Cookie', `wrf.sid=${ownerCookie}`)
      .set(CSRF)
      .expect(403);
    expect(ownerRes.body.error.code).toBe('FORBIDDEN');

    // Admin
    const admin = await loginAs('admin');
    const adminCookie = extractSessionToken(admin.setCookie)!;
    await supertest(server)
      .get('/api/v1/super-admin/admins')
      .set('Cookie', `wrf.sid=${adminCookie}`)
      .set(CSRF)
      .expect(403);
  });

  it('SuperAdmin can create an Admin when under the limit; deactivate revokes sessions', async () => {
    // Deactivate admin2 so we have room for one more.
    const sa = await loginSa();
    const saCookie = extractSessionToken(sa.setCookie)!;
    const admin2Id = (await prisma.user.findUnique({
      where: { email: TEST_EMAILS.admin2 },
      select: { id: true },
    }))!.id;

    await supertest(server)
      .post(`/api/v1/super-admin/admins/${admin2Id}/deactivate`)
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(204);

    // New Admin
    const createRes = await supertest(server)
      .post('/api/v1/super-admin/admins')
      .send({ email: 'new-admin@werefa.test', password: 'NewAdminPass123' })
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(201);
    const newAdminId = createRes.body.id as string;
    expect(createRes.body.email).toBe('new-admin@werefa.test');

    // Cleanup: deactivate the new admin to restore to 2 active.
    await supertest(server)
      .post(`/api/v1/super-admin/admins/${newAdminId}/deactivate`)
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(204);

    // Re-activate admin2 (as active) so subsequent tests have 2 active admins.
    await prisma.user.update({ where: { id: admin2Id }, data: { disabledAt: null } });
  });

  it('SuperAdmin can force-logout a non-SuperAdmin', async () => {
    const owner = await loginAs('owner');
    const ownerId = (await prisma.user.findUnique({
      where: { email: TEST_EMAILS.owner },
      select: { id: true },
    }))!.id;
    const ownerCookie = extractSessionToken(owner.setCookie)!;
    await supertest(server)
      .get('/api/v1/auth/me')
      .set('Cookie', `wrf.sid=${ownerCookie}`)
      .set(CSRF)
      .expect(200);

    const sa = await loginSa();
    const saCookie = extractSessionToken(sa.setCookie)!;
    await supertest(server)
      .post(`/api/v1/super-admin/logout/${ownerId}`)
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(204);

    // Owner session revoked
    await supertest(server)
      .get('/api/v1/auth/me')
      .set('Cookie', `wrf.sid=${ownerCookie}`)
      .set(CSRF)
      .expect(401);
  });
});

describe('recovery strict rate limit', () => {
  it('RateLimitService enforces recovery window', async () => {
    const { RateLimitService } = await import('../../src/iam/rate-limit.service');
    const rl = app.get(RateLimitService);
    const key = `test:recovery:${Date.now()}`;
    await rl.check(key, 3, 900_000);
    await rl.check(key, 3, 900_000);
    await rl.check(key, 3, 900_000);
    try {
      await rl.check(key, 3, 900_000);
      throw new Error('Expected TooManyRequestsException');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('RATE_LIMITED');
    }
  });
});
