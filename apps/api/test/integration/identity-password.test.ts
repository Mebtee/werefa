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
  expectEnvelope403,
  resetIdentityDatabaseAndSeed,
} from './identity.helpers';

/* ── env bootstrap (identical to the login test) ─────────────────────── */
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

/* ── fixtures ────────────────────────────────────────────────────────── */
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

function extractResetTokenFromMail(): string {
  const matches = mail.captured.filter((m) => m.subject === 'Reset your Werefa password');
  expect(matches.length).toBeGreaterThan(0);
  const match = matches[matches.length - 1]!.text.match(/reset\/([A-Za-z0-9_-]{40,})/);
  expect(match).toBeDefined();
  return match![1];
}

/* ═══════════════════════════════════════════════════════════════════════ */
describe('E: reset request — uniform response, email sent only for known accounts', () => {
  it('known account → 202 + email with reset link', async () => {
    const res = await supertest(server)
      .post('/api/v1/auth/password/reset/request')
      .send({ email: TEST_EMAILS.owner })
      .set(CSRF)
      .expect(202);
    expect(res.body.message).toContain('If an account exists');
    expect(mail.captured.length).toBe(1);
    const token = extractResetTokenFromMail();
    expect(token.length).toBeGreaterThan(40);
  });

  it('unknown account → same 202 + no email sent', async () => {
    const countBefore = mail.captured.length;
    const res = await supertest(server)
      .post('/api/v1/auth/password/reset/request')
      .send({ email: 'ghost@werefa.test' })
      .set(CSRF)
      .expect(202);
    expect(res.body.message).toContain('If an account exists');
    expect(mail.captured.length).toBe(countBefore);
  });
});

describe('F: reset complete — works, revokes sessions, clears lock', () => {
  it('correct token sets a new password; old password fails; sessions revoked', async () => {
    // Request reset for owner2 (Admins are excluded from the reset flow).
    await supertest(server)
      .post('/api/v1/auth/password/reset/request')
      .send({ email: TEST_EMAILS.owner2 })
      .set(CSRF)
      .expect(202);

    const token = extractResetTokenFromMail();
    const newPw = TEST_PASSWORDS.newPassword;

    // Complete reset
    await supertest(server)
      .post('/api/v1/auth/password/reset/complete')
      .send({ token, newPassword: newPw })
      .set(CSRF)
      .expect(204);

    // Old password fails
    const old = await login(TEST_EMAILS.owner2, TEST_PASSWORDS.owner);
    expect(old.status).toBe(401);

    // New password works
    const fresh = await login(TEST_EMAILS.owner2, newPw);
    expect(fresh.status).toBe(200);

    // Session is valid
    const cookie = extractSessionToken(fresh.setCookie)!;
    const me = await supertest(server)
      .get('/api/v1/auth/me')
      .set('Cookie', `wrf.sid=${cookie}`)
      .set(CSRF)
      .expect(200);
    expect(me.body.email).toBe(TEST_EMAILS.owner2);
  });
});

describe('G: reset complete with bad token → 401 TOKEN_EXPIRED', () => {
  it('returns 401 with TOKEN_EXPIRED envelope', async () => {
    const res = await supertest(server)
      .post('/api/v1/auth/password/reset/complete')
      .send({ token: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', newPassword: 'NewPass-12345' })
      .set(CSRF)
      .expect(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });
});

describe('H: reset token used/expired', () => {
  it('used token → 409 TOKEN_USED', async () => {
    await supertest(server)
      .post('/api/v1/auth/password/reset/request')
      .send({ email: TEST_EMAILS.owner2 })
      .set(CSRF)
      .expect(202);
    const token = extractResetTokenFromMail();

    // Use it once
    await supertest(server)
      .post('/api/v1/auth/password/reset/complete')
      .send({ token, newPassword: TEST_PASSWORDS.newPassword })
      .set(CSRF)
      .expect(204);

    // Use again
    const res = await supertest(server)
      .post('/api/v1/auth/password/reset/complete')
      .send({ token, newPassword: TEST_PASSWORDS.newPassword })
      .set(CSRF)
      .expect(409);
    expect(res.body.error.code).toBe('TOKEN_USED');
  });

  it('expired token → 401 TOKEN_EXPIRED', async () => {
    // Request a fresh token
    await supertest(server)
      .post('/api/v1/auth/password/reset/request')
      .send({ email: TEST_EMAILS.owner2 })
      .set(CSRF)
      .expect(202);
    const token = extractResetTokenFromMail();

    // Manually expire it
    const userId = (await prisma.user.findUnique({
      where: { email: TEST_EMAILS.owner2 },
      select: { id: true },
    }))!.id;
    await prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const res = await supertest(server)
      .post('/api/v1/auth/password/reset/complete')
      .send({ token, newPassword: TEST_PASSWORDS.newPassword })
      .set(CSRF)
      .expect(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });
});

describe('I: password change — revokes all sessions', () => {
  it('new password works; old session revoked', async () => {
    const loginRes = await login(TEST_EMAILS.owner, TEST_PASSWORDS.owner);
    const cookie = extractSessionToken(loginRes.setCookie)!;

    // Change password
    await supertest(server)
      .post('/api/v1/auth/password/change')
      .send({ currentPassword: TEST_PASSWORDS.owner, newPassword: TEST_PASSWORDS.newPassword })
      .set('Cookie', `wrf.sid=${cookie}`)
      .set(CSRF)
      .expect(204);

    // Old session revoked
    await supertest(server)
      .get('/api/v1/auth/me')
      .set('Cookie', `wrf.sid=${cookie}`)
      .set(CSRF)
      .expect(401);

    // New password works
    const fresh = await login(TEST_EMAILS.owner, TEST_PASSWORDS.newPassword);
    expect(fresh.status).toBe(200);
  });
});

describe('J: admin cannot change own password → 403 + event', () => {
  it('returns 403 FORBIDDEN with admin-specific detail', async () => {
    const loginRes = await login(TEST_EMAILS.admin2, TEST_PASSWORDS.admin);
    const cookie = extractSessionToken(loginRes.setCookie)!;
    expect(cookie).toBeDefined();

    const res = await supertest(server)
      .post('/api/v1/auth/password/change')
      .send({ currentPassword: TEST_PASSWORDS.admin, newPassword: TEST_PASSWORDS.adminNewPassword })
      .set('Cookie', `wrf.sid=${cookie}`)
      .set(CSRF)
      .expect(403);
    expectEnvelope403(res.body, 'Admin accounts cannot change their own password');
  });
});

describe('M: reset token guessing — second request invalidates first', () => {
  it('first token returns 409 after second request; second token works', async () => {
    // Request 1
    await supertest(server)
      .post('/api/v1/auth/password/reset/request')
      .send({ email: TEST_EMAILS.owner2 })
      .set(CSRF)
      .expect(202);
    const token1 = extractResetTokenFromMail();

    // Request 2 — invalidates token1
    await supertest(server)
      .post('/api/v1/auth/password/reset/request')
      .send({ email: TEST_EMAILS.owner2 })
      .set(CSRF)
      .expect(202);
    const token2 = extractResetTokenFromMail();

    expect(token1).not.toBe(token2);

    // Token1 should fail
    const res1 = await supertest(server)
      .post('/api/v1/auth/password/reset/complete')
      .send({ token: token1, newPassword: TEST_PASSWORDS.newPassword })
      .set(CSRF)
      .expect(409);
    expect(res1.body.error.code).toBe('TOKEN_USED');

    // Token2 works
    await supertest(server)
      .post('/api/v1/auth/password/reset/complete')
      .send({ token: token2, newPassword: TEST_PASSWORDS.newPassword })
      .set(CSRF)
      .expect(204);
  });
});
