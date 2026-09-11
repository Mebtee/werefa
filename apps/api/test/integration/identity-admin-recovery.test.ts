import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../../src/database/prisma.service';
import { MailService } from '../../src/notifications/mail.service';
import { PasswordService } from '../../src/iam/password.service';
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

describe('P: admin boundary — only SuperAdmin manages Admins (REQ-217..221)', () => {
  async function loginSa() {
    // SA password is TEST_PASSWORDS.newPassword after N/O.
    return login(TEST_EMAILS.sa, TEST_PASSWORDS.newPassword);
  }
  let saCookie: string;
  let admin1Id: string;
  let admin2Id: string;

  beforeEach(async () => {
    const sa = await loginSa();
    saCookie = extractSessionToken(sa.setCookie)!;
    admin1Id = (await prisma.user.findUnique({
      where: { email: TEST_EMAILS.admin1 },
      select: { id: true },
    }))!.id;
    admin2Id = (await prisma.user.findUnique({
      where: { email: TEST_EMAILS.admin2 },
      select: { id: true },
    }))!.id;
    // Restore exactly two ACTIVE Admins (admin1 + admin2). Throwaway Admins that
    // a prior test created are removed entirely (security_event/session/reset
    // tokens cascade), so every test starts from the canonical 2-active model.
    await prisma.user.updateMany({ where: { id: admin1Id }, data: { disabledAt: null } });
    await prisma.user.updateMany({ where: { id: admin2Id }, data: { disabledAt: null } });
    await prisma.user.deleteMany({ where: { role: 'Admin', id: { notIn: [admin1Id, admin2Id] } } });
  });

  it('unauthenticated request is rejected (401)', async () => {
    await supertest(server).get('/api/v1/super-admin/admins').set(CSRF).expect(401);
  });

  it('Owner and Admin cannot access Admin lifecycle endpoints (403)', async () => {
    const owner = await loginAs('owner');
    const ownerCookie = extractSessionToken(owner.setCookie)!;
    await supertest(server)
      .get('/api/v1/super-admin/admins')
      .set('Cookie', `wrf.sid=${ownerCookie}`)
      .set(CSRF)
      .expect(403);

    const admin = await loginAs('admin');
    const adminCookie = extractSessionToken(admin.setCookie)!;
    await supertest(server)
      .get('/api/v1/super-admin/admins')
      .set('Cookie', `wrf.sid=${adminCookie}`)
      .set(CSRF)
      .expect(403);
  });

  it('more than two active Admins → 409 CONFLICT', async () => {
    const res = await supertest(server)
      .post('/api/v1/super-admin/admins')
      .send({ email: 'third-admin@werefa.test', password: 'ThirdAdmin12345' })
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(409);
    expectEnvelope409(res.body, 'maximum of two active Admin accounts');
  });

  it('SA can create an Admin under the limit; welcome email sent; duplicate email → 409', async () => {
    await supertest(server)
      .post(`/api/v1/super-admin/admins/${admin2Id}/deactivate`)
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(204);

    const createRes = await supertest(server)
      .post('/api/v1/super-admin/admins')
      .send({ email: 'welcome-admin@werefa.test', password: 'WelcomeAdmin123' })
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(201);
    expect(createRes.body.email).toBe('welcome-admin@werefa.test');

    // Welcome email — informational, correct recipient, no secrets.
    const welcome = mail.captured.filter((m) => m.subject?.includes('Admin account is ready'));
    expect(welcome.length).toBe(1);
    expect(welcome[0]!.to).toBe('welcome-admin@werefa.test');
    expect(welcome[0]!.text).toContain('welcome-admin@werefa.test');
    expect(welcome[0]!.text).not.toContain('WelcomeAdmin123');
    expect(welcome[0]!.text).not.toMatch(/token|reset|code|hash|password\s*[:=]/i);

    // Same email again → clean 409 (never a P2002/500).
    // Deactivate the just-created admin first so the active-count check passes
    // and the email-uniqueness check is the one that rejects.
    await supertest(server)
      .post(`/api/v1/super-admin/admins/${createRes.body.id as string}/deactivate`)
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(204);
    const dup = await supertest(server)
      .post('/api/v1/super-admin/admins')
      .send({ email: 'welcome-admin@werefa.test', password: 'AnotherPass123' })
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(409);
    expectEnvelope409(dup.body, 'already exists');
  });

  it('concurrent creates cannot produce a third active Admin', async () => {
    // Free one active slot (admin1 remains the only active Admin).
    await supertest(server)
      .post(`/api/v1/super-admin/admins/${admin2Id}/deactivate`)
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(204);

    const attempts = Array.from({ length: 5 }, (_, i) =>
      supertest(server)
        .post('/api/v1/super-admin/admins')
        .send({ email: `race-admin-${i + 1}@werefa.test`, password: 'RaceAdmin12345' })
        .set('Cookie', `wrf.sid=${saCookie}`)
        .set(CSRF),
    );
    const results = await Promise.all(attempts);
    const ok = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);
    expect(ok.length).toBe(1);
    expect(conflicts.length).toBe(4);

    const activeAll = await prisma.user.count({ where: { role: 'Admin', disabledAt: null } });
    expect(activeAll).toBe(2);
  });

  it('concurrent same-email create → one succeeds, the other conflicts (no 500)', async () => {
    await supertest(server)
      .post(`/api/v1/super-admin/admins/${admin2Id}/deactivate`)
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(204);

    const email = `dup-race-${Date.now()}@werefa.test`;
    const results = await Promise.all([
      supertest(server)
        .post('/api/v1/super-admin/admins')
        .send({ email, password: 'DupRacePass123' })
        .set('Cookie', `wrf.sid=${saCookie}`)
        .set(CSRF),
      supertest(server)
        .post('/api/v1/super-admin/admins')
        .send({ email, password: 'DupRacePass123' })
        .set('Cookie', `wrf.sid=${saCookie}`)
        .set(CSRF),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const rowCount = await prisma.user.count({ where: { role: 'Admin', email } });
    expect(rowCount).toBe(1);
  });

  it('SA deactivates an Admin: sessions revoked, login rejected, event recorded', async () => {
    const admin = await loginAs('admin');
    const adminCookie = extractSessionToken(admin.setCookie)!;
    await supertest(server)
      .get('/api/v1/auth/me')
      .set('Cookie', `wrf.sid=${adminCookie}`)
      .set(CSRF)
      .expect(200);

    await supertest(server)
      .post(`/api/v1/super-admin/admins/${admin1Id}/deactivate`)
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(204);

    // Existing session no longer authenticates.
    await supertest(server)
      .get('/api/v1/auth/me')
      .set('Cookie', `wrf.sid=${adminCookie}`)
      .set(CSRF)
      .expect(401);

    // Login blocked.
    const blocked = await login(TEST_EMAILS.admin1, TEST_PASSWORDS.admin);
    expect(blocked.status).toBe(403);

    // Audited.
    const deactivations = await prisma.securityEvent.count({
      where: { type: 'ADMIN_DEACTIVATE', userId: admin1Id, result: 'SUCCESS' },
    });
    expect(deactivations).toBe(1);
  });

  it('SA reactivates a disabled Admin: clears disabledAt, revokes reset tokens, event, can log in', async () => {
    await supertest(server)
      .post(`/api/v1/super-admin/admins/${admin1Id}/deactivate`)
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(204);

    // Outstanding reset token must be invalidated on reactivation.
    await prisma.passwordResetToken.create({
      data: {
        userId: admin1Id,
        tokenHash: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await supertest(server)
      .post(`/api/v1/super-admin/admins/${admin1Id}/reactivate`)
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(204);

    const row = await prisma.user.findUnique({
      where: { id: admin1Id },
      select: { disabledAt: true },
    });
    expect(row?.disabledAt).toBeNull();

    const outstanding = await prisma.passwordResetToken.count({
      where: { userId: admin1Id, usedAt: null },
    });
    expect(outstanding).toBe(0);

    const reactivations = await prisma.securityEvent.count({
      where: { type: 'ADMIN_REACTIVATE', userId: admin1Id, result: 'SUCCESS' },
    });
    expect(reactivations).toBe(1);

    // Can sign in again with the current valid password.
    const relogin = await login(TEST_EMAILS.admin1, TEST_PASSWORDS.admin);
    expect(relogin.status).toBe(200);
  });

  it('reactivation guards: active target, unknown, non-Admin, and two-active → rejected', async () => {
    // Already-active Admin cannot be reactivated.
    await supertest(server)
      .post(`/api/v1/super-admin/admins/${admin1Id}/reactivate`)
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(409);

    // Unknown target → 404.
    await supertest(server)
      .post('/api/v1/super-admin/admins/00000000-0000-0000-0000-000000000000/reactivate')
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(404);

    // Non-Admin target (Owner) → 404.
    const ownerId = (await prisma.user.findUnique({
      where: { email: TEST_EMAILS.owner },
      select: { id: true },
    }))!.id;
    await supertest(server)
      .post(`/api/v1/super-admin/admins/${ownerId}/reactivate`)
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(404);

    // Two active Admins already present → reactivating a disabled Admin → 409.
    await supertest(server)
      .post(`/api/v1/super-admin/admins/${admin2Id}/deactivate`)
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(204);
    const created = await supertest(server)
      .post('/api/v1/super-admin/admins')
      .send({ email: 'fill-two@werefa.test', password: 'FillTwoPass123' })
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(201);
    expect(created.body.id).toBeDefined();

    await supertest(server)
      .post(`/api/v1/super-admin/admins/${admin2Id}/reactivate`)
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(409);
  });

  it('reactivation RBAC: Owner/Admin → 403, unauthenticated → 401', async () => {
    // Establish an Admin session via admin2 (which stays active here).
    const admin = await login(TEST_EMAILS.admin2, TEST_PASSWORDS.admin);
    const adminCookie = extractSessionToken(admin.setCookie)!;

    await supertest(server)
      .post(`/api/v1/super-admin/admins/${admin1Id}/deactivate`)
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(204);

    await supertest(server)
      .post(`/api/v1/super-admin/admins/${admin1Id}/reactivate`)
      .set(CSRF)
      .expect(401);

    const owner = await loginAs('owner');
    const ownerCookie = extractSessionToken(owner.setCookie)!;
    await supertest(server)
      .post(`/api/v1/super-admin/admins/${admin1Id}/reactivate`)
      .set('Cookie', `wrf.sid=${ownerCookie}`)
      .set(CSRF)
      .expect(403);

    await supertest(server)
      .post(`/api/v1/super-admin/admins/${admin1Id}/reactivate`)
      .set('Cookie', `wrf.sid=${adminCookie}`)
      .set(CSRF)
      .expect(403);
  });

  it('SA changes an Admin password: clears lock, revokes sessions, event + email without secrets', async () => {
    // Active session that must be revoked.
    const admin = await loginAs('admin');
    const adminCookie = extractSessionToken(admin.setCookie)!;
    await supertest(server)
      .get('/api/v1/auth/me')
      .set('Cookie', `wrf.sid=${adminCookie}`)
      .set(CSRF)
      .expect(200);

    // Lock the Admin to prove the SA change clears it (REQ-219).
    await prisma.user.update({
      where: { id: admin1Id },
      data: { isLockedUntil: new Date(Date.now() + 60_000), failedLoginCount: 5 },
    });

    const newPw = 'ChangedPass123';
    await supertest(server)
      .post(`/api/v1/super-admin/admins/${admin1Id}/password`)
      .send({ newPassword: newPw })
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(204);

    // Old session revoked.
    await supertest(server)
      .get('/api/v1/auth/me')
      .set('Cookie', `wrf.sid=${adminCookie}`)
      .set(CSRF)
      .expect(401);

    // Old password fails; new password works.
    const oldLogin = await login(TEST_EMAILS.admin1, TEST_PASSWORDS.admin);
    expect(oldLogin.status).toBe(401);
    const newLogin = await login(TEST_EMAILS.admin1, newPw);
    expect(newLogin.status).toBe(200);

    // Lock cleared.
    const row = await prisma.user.findUnique({
      where: { id: admin1Id },
      select: { isLockedUntil: true, failedLoginCount: true },
    });
    expect(row?.isLockedUntil).toBeNull();
    expect(row?.failedLoginCount).toBe(0);

    // Audited; neither metadata nor email contains the password.
    const changes = await prisma.securityEvent.findMany({
      where: { type: 'ADMIN_PASSWORD_CHANGE', userId: admin1Id, result: 'SUCCESS' },
    });
    expect(changes.length).toBe(1);
    expect(JSON.stringify(changes[0]?.metadata ?? {})).not.toContain(newPw);

    const mails = mail.captured.filter((m) => m.subject?.includes('password was updated'));
    expect(mails.length).toBeGreaterThan(0);
    expect(mails[0]!.to).toBe(TEST_EMAILS.admin1);
    expect(mails[0]!.text).not.toContain(newPw);

    // Restore the canonical Admin credentials so later tests are unaffected.
    const pwd = app.get(PasswordService);
    const restoredHash = await pwd.hash(TEST_PASSWORDS.admin);
    await prisma.user.update({
      where: { id: admin1Id },
      data: { passwordHash: restoredHash, isLockedUntil: null, failedLoginCount: 0 },
    });
  });

  it('password-change RBAC: Owner/Admin → 403, unauthenticated → 401', async () => {
    await supertest(server)
      .post(`/api/v1/super-admin/admins/${admin1Id}/password`)
      .send({ newPassword: 'NeverPass123' })
      .set(CSRF)
      .expect(401);

    const owner = await loginAs('owner');
    const ownerCookie = extractSessionToken(owner.setCookie)!;
    await supertest(server)
      .post(`/api/v1/super-admin/admins/${admin1Id}/password`)
      .send({ newPassword: 'NeverPass123' })
      .set('Cookie', `wrf.sid=${ownerCookie}`)
      .set(CSRF)
      .expect(403);

    const admin = await loginAs('admin');
    const adminCookie = extractSessionToken(admin.setCookie)!;
    await supertest(server)
      .post(`/api/v1/super-admin/admins/${admin1Id}/password`)
      .send({ newPassword: 'NeverPass123' })
      .set('Cookie', `wrf.sid=${adminCookie}`)
      .set(CSRF)
      .expect(403);
  });

  it('SA force-logouts an Admin target: sessions revoked, FORCE_LOGOUT event, email', async () => {
    const admin = await loginAs('admin');
    const adminCookie = extractSessionToken(admin.setCookie)!;
    await supertest(server)
      .get('/api/v1/auth/me')
      .set('Cookie', `wrf.sid=${adminCookie}`)
      .set(CSRF)
      .expect(200);

    await supertest(server)
      .post(`/api/v1/super-admin/logout/${admin1Id}`)
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(204);

    await supertest(server)
      .get('/api/v1/auth/me')
      .set('Cookie', `wrf.sid=${adminCookie}`)
      .set(CSRF)
      .expect(401);

    const loggedOut = await prisma.securityEvent.count({
      where: { type: 'FORCE_LOGOUT', userId: admin1Id, result: 'SUCCESS' },
    });
    expect(loggedOut).toBe(1);

    const mails = mail.captured.filter((m) => m.subject?.includes('signed out'));
    expect(mails.some((m) => m.to === TEST_EMAILS.admin1)).toBe(true);
  });

  it('SA force-logouts an Owner target: sessions revoked and FORCE_LOGOUT recorded', async () => {
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

    await supertest(server)
      .post(`/api/v1/super-admin/logout/${ownerId}`)
      .set('Cookie', `wrf.sid=${saCookie}`)
      .set(CSRF)
      .expect(204);

    await supertest(server)
      .get('/api/v1/auth/me')
      .set('Cookie', `wrf.sid=${ownerCookie}`)
      .set(CSRF)
      .expect(401);

    const loggedOut = await prisma.securityEvent.count({
      where: { type: 'FORCE_LOGOUT', userId: ownerId, result: 'SUCCESS' },
    });
    expect(loggedOut).toBe(1);
  });

  it('force-logout RBAC: Owner/Admin → 403, unauthenticated → 401', async () => {
    await supertest(server).post(`/api/v1/super-admin/logout/${admin1Id}`).set(CSRF).expect(401);

    const owner = await loginAs('owner');
    const ownerCookie = extractSessionToken(owner.setCookie)!;
    await supertest(server)
      .post(`/api/v1/super-admin/logout/${admin1Id}`)
      .set('Cookie', `wrf.sid=${ownerCookie}`)
      .set(CSRF)
      .expect(403);

    const admin = await loginAs('admin');
    const adminCookie = extractSessionToken(admin.setCookie)!;
    await supertest(server)
      .post(`/api/v1/super-admin/logout/${admin1Id}`)
      .set('Cookie', `wrf.sid=${adminCookie}`)
      .set(CSRF)
      .expect(403);
  });

  it('Admin Forgot Password is denied with a uniform response; Owner reset unchanged', async () => {
    // Admin reset request → identical uniform message, NO ticket issued, NO email.
    const before = mail.captured.length;
    const adminRes = await supertest(server)
      .post('/api/v1/auth/password/reset/request')
      .send({ email: TEST_EMAILS.admin1 })
      .set(CSRF)
      .expect(202);
    expect(adminRes.body.message).toContain('reset link has been sent');
    expect(mail.captured.length).toBe(before);

    const denied = await prisma.securityEvent.count({
      where: { type: 'PASSWORD_RESET_DENIED', userId: admin1Id, result: 'DENIED' },
    });
    expect(denied).toBe(1);

    // Owner reset still issues a real email (no regression).
    await supertest(server)
      .post('/api/v1/auth/password/reset/request')
      .send({ email: TEST_EMAILS.owner })
      .set(CSRF)
      .expect(202);
    const ownerReset = mail.captured.filter((m) =>
      m.subject?.includes('Reset your Werefa password'),
    );
    expect(ownerReset.length).toBe(1);
    expect(ownerReset[0]!.to).toBe(TEST_EMAILS.owner);
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
