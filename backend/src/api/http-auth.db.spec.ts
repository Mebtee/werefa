import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../test/helpers/test-app';
import { Argon2PasswordHasher } from '../auth/password-hash';

/**
 * DB-gated end-to-end authentication/authorization/security HTTP tests
 * (Prompt 43 §33 + §34). Run via `npm run test:db`: a real Postgres
 * `werefa_test` is required (npm run db:up && db:provision && test:db).
 *
 * The app is booted with REAL session authentication (no test bridge), so
 * every authenticated call goes through login → cookie → ApiAuthGuard →
 * TenantGuard, exercising the production resolver path. A dedicated block
 * boots a second app with the dev-only test bridge to prove that channel
 * (and that the two are disjoint).
 */
const TEST_URL = process.env.TEST_DATABASE_URL;
const RUN = process.env.RUN_DB_TESTS === 'true' && Boolean(TEST_URL);

describe.skipIf(!RUN)('AUTH/Authorization HTTP end-to-end (real DB)', () => {
  let prisma: PrismaClient;
  let app: INestApplication;

  const SA_EMAIL = 'sa@example.com';
  const OWNER_A_EMAIL = 'owner-a@example.com';
  const OWNER_B_EMAIL = 'owner-b@example.com';
  const OWNER_C_EMAIL = 'owner-c@example.com';
  const ADMIN_A_EMAIL = 'admin-a@example.com';
  const PASSWORD = 'Correct-Horse-Battery-2030';
  let saPassword = PASSWORD;

  let saId = '';
  let ownerAId = '';
  let ownerBId = '';
  let ownerCId = '';
  let adminAId = '';
  let businessAId = '';

  const DELETE_ORDER = [
    'notification_delivery',
    'notification',
    'telegram_connection',
    'telegram_update',
    'report_job',
    'audit_event',
    'security_event',
    'file_object',
    'subscription_reminder',
    'subscription_status_history',
    'subscription_proof',
    'subscription',
    'payment_status_history',
    'payment_proof',
    'payment',
    'slot_lock',
    'schedule_exception',
    'resubmission_verification',
    'booking_status_history',
    'booking_component',
    'booking',
    'working_period',
    'blocked_period',
    'special_date',
    'schedule_version',
    'add_on',
    'service_variation',
    'service',
    'business_settings',
    'business_owner',
    'business',
    'session',
    'emergency_recovery',
    'user',
    'business_category',
  ];

  async function resetDatabase(): Promise<void> {
    for (const table of DELETE_ORDER) {
      await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO "business_category" ("code", "label") VALUES ('SALON_AND_BARBER', 'Salon & Barber'), ('OTHER', 'Other') ON CONFLICT DO NOTHING`,
    );
  }

  beforeAll(async () => {
    if (!RUN) return;
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL! } } });
    await resetDatabase();

    const hash = await Argon2PasswordHasher.hash(PASSWORD);
    const sa = await prisma.user.create({
      data: { email: SA_EMAIL, passwordHash: hash, role: 'SUPER_ADMIN', recoveryEmail: 'sa-recovery@example.com', isEmailVerified: true },
    });
    const ownerA = await prisma.user.create({ data: { email: OWNER_A_EMAIL, passwordHash: hash, role: 'OWNER', isEmailVerified: true } });
    const ownerB = await prisma.user.create({ data: { email: OWNER_B_EMAIL, passwordHash: hash, role: 'OWNER', isEmailVerified: true } });
    const ownerC = await prisma.user.create({ data: { email: OWNER_C_EMAIL, passwordHash: hash, role: 'OWNER', isEmailVerified: true } });
    const adminA = await prisma.user.create({ data: { email: ADMIN_A_EMAIL, passwordHash: hash, role: 'ADMIN', isEmailVerified: true } });
    saId = sa.id;
    ownerAId = ownerA.id;
    ownerBId = ownerB.id;
    ownerCId = ownerC.id;
    adminAId = adminA.id;

    const built = await createTestApp({
      database: 'real',
      env: { DATABASE_URL: TEST_URL!, PRODUCT_APP_TIMEZONE: 'UTC' },
    });
    app = built.app;
  });

  afterAll(async () => {
    if (!RUN) return;
    await app?.close();
    await resetDatabase();
    await prisma.$disconnect();
  });

  const http = () => request(app.getHttpServer());
  const cookieOf = (res: request.Response): string => {
    const raw = res.headers['set-cookie'];
    const header = Array.isArray(raw) ? raw.join(';') : String(raw ?? '');
    const match = /werefa_session=([^;]+)/.exec(header);
    if (!match) throw new Error(`No werefa_session cookie set: ${header}`);
    return `werefa_session=${match[1]}`;
  };

  async function loginC(email: string, password: string): Promise<string> {
    const res = await http().post('/api/v1/auth/login').send({ email, password }).expect(200);
    return cookieOf(res);
  }

  async function insertRecoveryCode(userId: string, code: string, opts: { expired?: boolean } = {}) {
    await prisma.emergencyRecovery.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
    const expiresAt = opts.expired
      ? new Date(Date.now() - 60_000)
      : new Date(Date.now() + 15 * 60_000);
    await prisma.emergencyRecovery.create({
      data: { userId, codeHash: createHash('sha256').update(code).digest('hex'), expiresAt },
    });
  }

  const sha256hex = (v: string) => createHash('sha256').update(v).digest('hex');

  // -------------------------------------------------------------------------
  // AUTH (REQ-035/191/192)
  // -------------------------------------------------------------------------

  describe('AUTH login/logout', () => {
    it('logs a Super Admin in and issues an httpOnly SameSite=Lax cookie', async () => {
      const res = await http().post('/api/v1/auth/login').send({ email: SA_EMAIL, password: saPassword }).expect(200);
      expect(res.body.user).toEqual({ id: saId, role: 'SUPER_ADMIN' });
      expect(typeof res.body.expiresAt).toBe('string');
      const raw = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'].join(';') : String(res.headers['set-cookie']);
      expect(raw).toContain('HttpOnly');
      expect(raw).toContain('SameSite=Lax');
      expect(raw).toContain('Path=/');
    });

    it('logs an Owner in', async () => {
      const res = await http().post('/api/v1/auth/login').send({ email: OWNER_A_EMAIL, password: PASSWORD }).expect(200);
      expect(res.body.user).toEqual({ id: ownerAId, role: 'OWNER' });
    });

    it('logs an Admin in', async () => {
      const res = await http().post('/api/v1/auth/login').send({ email: ADMIN_A_EMAIL, password: PASSWORD }).expect(200);
      expect(res.body.user).toEqual({ id: adminAId, role: 'ADMIN' });
    });

    it('returns the identical generic 401 for a wrong password and an unknown email', async () => {
      const wrong = await http().post('/api/v1/auth/login').send({ email: OWNER_A_EMAIL, password: 'nope' }).expect(401);
      const unknown = await http().post('/api/v1/auth/login').send({ email: 'missing@example.com', password: 'nope' }).expect(401);
      expect(wrong.body.error.code).toBe('UNAUTHENTICATED');
      expect(unknown.body.error.code).toBe('UNAUTHENTICATED');
      expect(wrong.body).toEqual(unknown.body);
      expect(wrong.headers['set-cookie']).toBeUndefined();
    });

    it('rejects deactivated accounts with the generic 401', async () => {
      await prisma.user.update({ where: { id: adminAId }, data: { isDeactivated: true } });
      try {
        const res = await http().post('/api/v1/auth/login').send({ email: ADMIN_A_EMAIL, password: PASSWORD }).expect(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      } finally {
        await prisma.user.update({ where: { id: adminAId }, data: { isDeactivated: false } });
      }
    });

    it('records LOGIN_SUCCESS security events with device/browser/ip (REQ-191/192)', async () => {
      await http().post('/api/v1/auth/login').send({ email: OWNER_B_EMAIL, password: PASSWORD }).expect(200);
      const events = await prisma.securityEvent.findMany({
        where: { userId: ownerBId, type: 'LOGIN_SUCCESS' },
        orderBy: { createdAt: 'desc' },
      });
      expect(events.length).toBeGreaterThan(0);
      await http().post('/api/v1/auth/login').send({ email: OWNER_B_EMAIL, password: PASSWORD }).expect(200);
      const events2 = await prisma.securityEvent.findMany({ where: { userId: ownerBId, type: 'LOGIN_SUCCESS' } });
      expect(events2.length).toBe(events.length + 1);
    });

    it('logout revokes the session; the token no longer authenticates', async () => {
      const cookie = await loginC(OWNER_B_EMAIL, PASSWORD);
      await http().get('/api/v1/owner/businesses').set('Cookie', cookie).expect(200);
      await http().post('/api/v1/auth/logout').set('Cookie', cookie).expect(204);
      await http().get('/api/v1/owner/businesses').set('Cookie', cookie).expect(401);
    });

    it('logout is idempotent and clears the cookie without a prior session', async () => {
      await http().post('/api/v1/auth/logout').expect(204);
      await http().post('/api/v1/auth/logout').expect(204);
    });
  });

  // -------------------------------------------------------------------------
  // SESSION RESTORATION (Prompt 44) — GET /auth/session
  // -------------------------------------------------------------------------

  describe('SESSION principal', () => {
    it('returns the safe principal (id/role/email) for a valid session cookie', async () => {
      const cookie = await loginC(OWNER_A_EMAIL, PASSWORD);
      const res = await http().get('/api/v1/auth/session').set('Cookie', cookie).expect(200);
      expect(res.body.user).toEqual({ id: ownerAId, role: 'OWNER', email: OWNER_A_EMAIL });
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    });

    it('denies session lookup without a cookie (401 UNAUTHENTICATED)', async () => {
      const res = await http().get('/api/v1/auth/session').expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('reflects a Super Admin role', async () => {
      const cookie = await loginC(SA_EMAIL, saPassword);
      const res = await http().get('/api/v1/auth/session').set('Cookie', cookie).expect(200);
      expect(res.body.user).toEqual({ id: saId, role: 'SUPER_ADMIN', email: SA_EMAIL });
    });

    it('stops returning the principal once the session is revoked', async () => {
      const cookie = await loginC(OWNER_A_EMAIL, PASSWORD);
      await http().get('/api/v1/auth/session').set('Cookie', cookie).expect(200);
      await http().post('/api/v1/auth/logout').set('Cookie', cookie).expect(204);
      await http().get('/api/v1/auth/session').set('Cookie', cookie).expect(401);
    });
  });

  // -------------------------------------------------------------------------
  // LOCKOUT (REQ-193/192) — 5 consecutive failures → 15 minutes
  // -------------------------------------------------------------------------

  describe('LOCKOUT', () => {
    it('rejects four consecutive failures with 401 and accumulates the counter', async () => {
      const owner = await prisma.user.findUniqueOrThrow({ where: { email: OWNER_C_EMAIL } });
      for (let i = 1; i <= 4; i++) {
        const res = await http().post('/api/v1/auth/login').send({ email: OWNER_C_EMAIL, password: 'wrong' }).expect(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      }
      const after = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
      expect(after.failedLoginAttempts).toBe(4);
      expect(after.isLockedUntil).toBeNull();
    });

    it('locks the account on the fifth failure with a +15 minute window (423)', async () => {
      const res = await http().post('/api/v1/auth/login').send({ email: OWNER_C_EMAIL, password: 'wrong' }).expect(423);
      expect(res.body.error.code).toBe('ACCOUNT_LOCKED');

      const locked = await prisma.user.findUniqueOrThrow({ where: { email: OWNER_C_EMAIL } });
      expect(locked.isLockedUntil).not.toBeNull();
      const minutes = Math.round((locked.isLockedUntil!.getTime() - Date.now()) / 60_000);
      expect(minutes).toBeGreaterThanOrEqual(13);
      expect(minutes).toBeLessThanOrEqual(17);
      expect(locked.failedLoginAttempts).toBe(0);

      const lockedEvent = await prisma.securityEvent.findFirst({ where: { userId: ownerCId, type: 'ACCOUNT_LOCKED' } });
      expect(lockedEvent?.result).toBe('LOCKED');
    });

    it('keeps rejecting logins while the lock is active, even with the right password', async () => {
      const res = await http().post('/api/v1/auth/login').send({ email: OWNER_C_EMAIL, password: PASSWORD }).expect(423);
      expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
    });

    it('allows login again once the lock has expired', async () => {
      const locked = await prisma.user.findUniqueOrThrow({ where: { email: OWNER_C_EMAIL } });
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
      if (locked.isLockedUntil && locked.isLockedUntil.getTime() > Date.now()) {
        await prisma.user.update({ where: { id: ownerCId }, data: { isLockedUntil: fiveMinAgo } });
      }
      const res = await http().post('/api/v1/auth/login').send({ email: OWNER_C_EMAIL, password: PASSWORD }).expect(200);
      expect(res.body.user.role).toBe('OWNER');
      const after = await prisma.user.findUniqueOrThrow({ where: { id: ownerCId } });
      expect(after.isLockedUntil).toBeNull();
      expect(after.failedLoginAttempts).toBe(0);
    });

    it('concurrent wrong-password attempts cannot bypass the lockout (race-safe)', async () => {
      const target = await prisma.user.findUniqueOrThrow({ where: { email: OWNER_B_EMAIL } });
      await prisma.user.update({ where: { id: target.id }, data: { failedLoginAttempts: 0, isLockedUntil: null } });
      const attempts = Array.from({ length: 8 }, () =>
        http().post('/api/v1/auth/login').send({ email: OWNER_B_EMAIL, password: 'wrong' }),
      );
      const results = await Promise.all(attempts);

      const after = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
      expect(after.isLockedUntil).not.toBeNull();
      const lockHit = results.some((r) => r.status === 423);
      expect(lockHit).toBe(true);

      const later = await http().post('/api/v1/auth/login').send({ email: OWNER_B_EMAIL, password: PASSWORD }).expect(423);
      expect(later.body.error.code).toBe('ACCOUNT_LOCKED');

      await prisma.user.update({ where: { id: target.id }, data: { isLockedUntil: new Date(Date.now() - 60_000) } });
    });
  });

  // -------------------------------------------------------------------------
  // PASSWORD CHANGE (REQ-035, REQ-218)
  // -------------------------------------------------------------------------

  describe('PASSWORD change', () => {
    it('rejects a wrong current password with a validation error', async () => {
      const cookie = await loginC(OWNER_C_EMAIL, PASSWORD);
      const res = await http()
        .post('/api/v1/auth/password/change')
        .set('Cookie', cookie)
        .send({ currentPassword: 'wrong', newPassword: 'New-Pass-2030' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.fields).toHaveProperty('currentPassword');
    });

    it('changes the password and invalidates every active session', async () => {
      const cookie1 = await loginC(OWNER_C_EMAIL, PASSWORD);
      const cookie2 = await loginC(OWNER_C_EMAIL, PASSWORD);
      await http()
        .post('/api/v1/auth/password/change')
        .set('Cookie', cookie1)
        .send({ currentPassword: PASSWORD, newPassword: 'Changed-Pass-2030' })
        .expect(204);

      await http().get('/api/v1/owner/businesses').set('Cookie', cookie1).expect(401);
      await http().get('/api/v1/owner/businesses').set('Cookie', cookie2).expect(401);

      await http().post('/api/v1/auth/login').send({ email: OWNER_C_EMAIL, password: PASSWORD }).expect(401);
      const ok = await http().post('/api/v1/auth/login').send({ email: OWNER_C_EMAIL, password: 'Changed-Pass-2030' }).expect(200);
      expect(ok.body.user.role).toBe('OWNER');
    });

    it('resets failed-login attempts on successful authentication', async () => {
      const owner = await prisma.user.findUniqueOrThrow({ where: { email: OWNER_C_EMAIL } });
      await prisma.user.update({ where: { id: owner.id }, data: { failedLoginAttempts: 3 } });
      await http().post('/api/v1/auth/login').send({ email: OWNER_C_EMAIL, password: 'Changed-Pass-2030' }).expect(200);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
      expect(after.failedLoginAttempts).toBe(0);
    });

    it('forbids Admins from changing their own password (REQ-218)', async () => {
      const cookie = await loginC(ADMIN_A_EMAIL, PASSWORD);
      const res = await http()
        .post('/api/v1/auth/password/change')
        .set('Cookie', cookie)
        .send({ currentPassword: PASSWORD, newPassword: 'Admin-Nope-2030' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // -------------------------------------------------------------------------
  // RECOVERY (REQ-198–200)
  // -------------------------------------------------------------------------

  describe('SUPER_ADMIN recovery', () => {
    it('request is generically successful even for unknown emails (no enumeration)', async () => {
      const res = await http().post('/api/v1/auth/recovery/request').send({ email: 'nobody@example.com' }).expect(200);
      expect(res.body.message).toContain('If the account exists');
    });

    it('returns the same response for a Super Admin email', async () => {
      const res = await http().post('/api/v1/auth/recovery/request').send({ email: SA_EMAIL }).expect(200);
      expect(res.body.message).toContain('If the account exists');
    });

    it('stores a hashed single-use code and publishes RECOVERY_CODE_EMAIL', async () => {
      await http().post('/api/v1/auth/recovery/request').send({ email: SA_EMAIL }).expect(200);
      const rows = await prisma.emergencyRecovery.findMany({ where: { userId: saId, usedAt: null } });
      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.codeHash).not.toBe(sha256hex('123456'));
      expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
      const events = await prisma.securityEvent.findFirst({
        where: { userId: saId, type: 'RECOVERY_CODE_REQUESTED' },
        orderBy: { createdAt: 'desc' },
      });
      expect(events).not.toBeNull();
    });

    it('confirm resets the password, revokes all sessions and consumes the code', async () => {
      await prisma.securityEvent.deleteMany({ where: { userId: saId, type: 'RECOVERY_CODE_VERIFIED' } });
      const oldCookie = await loginC(SA_EMAIL, saPassword);
      await insertRecoveryCode(saId, '111111');

      await http()
        .post('/api/v1/auth/recovery/confirm')
        .send({ email: SA_EMAIL, code: '111111', newPassword: 'Recovered-Pass-2030' })
        .expect(204);

      const consumed = await prisma.emergencyRecovery.findMany({ where: { userId: saId, usedAt: null } });
      expect(consumed).toHaveLength(0);

      await http().get('/api/v1/admin/admins').set('Cookie', oldCookie).expect(401);
      await http().post('/api/v1/auth/login').send({ email: SA_EMAIL, password: saPassword }).expect(401);
      await http().post('/api/v1/auth/login').send({ email: SA_EMAIL, password: 'Recovered-Pass-2030' }).expect(200);
      const verified = await prisma.securityEvent.findFirst({
        where: { userId: saId, type: 'RECOVERY_CODE_VERIFIED' },
        orderBy: { createdAt: 'desc' },
      });
      expect(verified).not.toBeNull();
      saPassword = 'Recovered-Pass-2030';
    });

    it('rejects a wrong code with a generic 401', async () => {
      await insertRecoveryCode(saId, '222222');
      const res = await http()
        .post('/api/v1/auth/recovery/confirm')
        .send({ email: SA_EMAIL, code: '000000', newPassword: 'X' })
        .expect(401);
      expect(res.body.error.code).toBe('TOKEN_EXPIRED');
      await prisma.emergencyRecovery.updateMany({
        where: { userId: saId, usedAt: null },
        data: { usedAt: new Date() },
      });
    });

    it('rejects an expired code', async () => {
      await insertRecoveryCode(saId, '333333', { expired: true });
      const res = await http()
        .post('/api/v1/auth/recovery/confirm')
        .send({ email: SA_EMAIL, code: '333333', newPassword: 'X' })
        .expect(401);
      expect(res.body.error.code).toBe('TOKEN_EXPIRED');
      await prisma.emergencyRecovery.updateMany({
        where: { userId: saId, usedAt: null },
        data: { usedAt: new Date() },
      });
    });

    it('a code can only be used once (REQ-199 single use)', async () => {
      await insertRecoveryCode(saId, '444444');
      await http()
        .post('/api/v1/auth/recovery/confirm')
        .send({ email: SA_EMAIL, code: '444444', newPassword: 'Single-Use-2030' })
        .expect(204);
      saPassword = 'Single-Use-2030';
      await http()
        .post('/api/v1/auth/recovery/confirm')
        .send({ email: SA_EMAIL, code: '444444', newPassword: 'Another-Pass-2030' })
        .expect(401);
    });

    it('exhausts the attempt cap and then rejects even the correct code', async () => {
      await insertRecoveryCode(saId, '555555');
      for (let i = 1; i <= 5; i++) {
        const res = await http()
          .post('/api/v1/auth/recovery/confirm')
          .send({ email: SA_EMAIL, code: '999999', newPassword: 'X' })
          .expect(401);
        expect(res.body.error.code).toBe('TOKEN_EXPIRED');
      }
      await http()
        .post('/api/v1/auth/recovery/confirm')
        .send({ email: SA_EMAIL, code: '555555', newPassword: 'X' })
        .expect(401);
      const exhausted = await prisma.securityEvent.findFirst({
        where: { userId: saId, type: 'RECOVERY_CODE_FAILED', result: 'ATTEMPTS_EXCEEDED' },
        orderBy: { createdAt: 'desc' },
      });
      expect(exhausted).not.toBeNull();
    });

    it('successful recovery clears an active lockout (REQ-194)', async () => {
      await http().post('/api/v1/auth/login').send({ email: SA_EMAIL, password: 'wrong' }).expect(401);
      await http().post('/api/v1/auth/login').send({ email: SA_EMAIL, password: 'wrong' }).expect(401);
      await http().post('/api/v1/auth/login').send({ email: SA_EMAIL, password: 'wrong' }).expect(401);
      await http().post('/api/v1/auth/login').send({ email: SA_EMAIL, password: 'wrong' }).expect(401);
      await http().post('/api/v1/auth/login').send({ email: SA_EMAIL, password: 'wrong' }).expect(423);
      const locked = await prisma.user.findUniqueOrThrow({ where: { id: saId } });
      expect(locked.isLockedUntil).not.toBeNull();

      await insertRecoveryCode(saId, '666666');
      await http()
        .post('/api/v1/auth/recovery/confirm')
        .send({ email: SA_EMAIL, code: '666666', newPassword: 'After-Lockout-2030' })
        .expect(204);
      saPassword = 'After-Lockout-2030';

      const after = await prisma.user.findUniqueOrThrow({ where: { id: saId } });
      expect(after.isLockedUntil).toBeNull();
      expect(after.failedLoginAttempts).toBe(0);
      await http().post('/api/v1/auth/login').send({ email: SA_EMAIL, password: 'After-Lockout-2030' }).expect(200);
    });
  });

  // -------------------------------------------------------------------------
  // ADMIN MANAGEMENT (REQ-201–206, REQ-217–221)
  // -------------------------------------------------------------------------

  describe('ADMIN management (Super Admin only)', () => {
    it('lists admin accounts with active-session counts', async () => {
      const cookie = await loginC(SA_EMAIL, saPassword);
      const res = await http().get('/api/v1/admin/admins').set('Cookie', cookie).expect(200);
      const admins = res.body.admins as { email: string; activeSessions: number; id: string }[];
      expect(admins.some((a) => a.email === ADMIN_A_EMAIL)).toBe(true);
      expect(JSON.stringify(admins)).not.toContain('passwordHash');
    });

    it('creates a second admin (201)', async () => {
      const cookie = await loginC(SA_EMAIL, saPassword);
      const res = await http()
        .post('/api/v1/admin/admins')
        .set('Cookie', cookie)
        .send({ email: 'admin-b@example.com', password: 'Admin-B-Pass-2030', recoveryEmail: 'admin-b-recovery@example.com' })
        .expect(201);
      expect(res.body.admin.email).toBe('admin-b@example.com');
    });

    it('rejects a third active admin with 409 (REQ-217 max 2)', async () => {
      const cookie = await loginC(SA_EMAIL, saPassword);
      const res = await http()
        .post('/api/v1/admin/admins')
        .set('Cookie', cookie)
        .send({ email: 'admin-c@example.com', password: 'Admin-C-Pass-2030' })
        .expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('rejects a duplicate email with a validation error', async () => {
      const cookie = await loginC(SA_EMAIL, saPassword);
      const res = await http()
        .post('/api/v1/admin/admins')
        .set('Cookie', cookie)
        .send({ email: 'admin-a@example.com', password: 'Admin-A-Pass-2030' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('deactivates an admin (revoking sessions) and frees a slot', async () => {
      const cookie = await loginC(SA_EMAIL, saPassword);
      const adminB = await prisma.user.findUniqueOrThrow({ where: { email: 'admin-b@example.com' } });
      await http().delete(`/api/v1/admin/admins/${adminB.id}`).set('Cookie', cookie).expect(204);

      const done = await prisma.user.findUniqueOrThrow({ where: { id: adminB.id } });
      expect(done.isDeactivated).toBe(true);

      const res = await http()
        .post('/api/v1/admin/admins')
        .set('Cookie', cookie)
        .send({ email: 'admin-c@example.com', password: 'Admin-C-Pass-2030' })
        .expect(201);
      expect(res.body.admin.email).toBe('admin-c@example.com');
    });

    it('resets an admin password (revoking all sessions) (REQ-219)', async () => {
      const cookie = await loginC(SA_EMAIL, saPassword);
      const adminC = await prisma.user.findUniqueOrThrow({ where: { email: 'admin-c@example.com' } });
      const adminCookie = await loginC('admin-c@example.com', 'Admin-C-Pass-2030');

      await http()
        .post(`/api/v1/admin/admins/${adminC.id}/password`)
        .set('Cookie', cookie)
        .send({ newPassword: 'Admin-C-Reset-2030' })
        .expect(204);

      await http().get('/api/v1/auth/security').set('Cookie', adminCookie).expect(401);
      await http().post('/api/v1/auth/login').send({ email: 'admin-c@example.com', password: 'Admin-C-Pass-2030' }).expect(401);
      await http().post('/api/v1/auth/login').send({ email: 'admin-c@example.com', password: 'Admin-C-Reset-2030' }).expect(200);
    });

    it('forces a 403 for the Super Admin resetting their own password', async () => {
      const cookie = await loginC(SA_EMAIL, saPassword);
      const res = await http()
        .post(`/api/v1/admin/admins/${saId}/password`)
        .set('Cookie', cookie)
        .send({ newPassword: 'X' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('deletion of old security history is audited', async () => {
      const cookie = await loginC(SA_EMAIL, saPassword);
      const before = await prisma.securityEvent.count();
      const res = await http()
        .delete('/api/v1/admin/security-history')
        .set('Cookie', cookie)
        .send({ olderThan: '2000-01-01T00:00:00.000Z' })
        .expect(200);
      expect(typeof res.body.deleted).toBe('number');
      expect((await prisma.securityEvent.count()) + res.body.deleted).toBe(before);
      const audit = await prisma.auditEvent.findFirst({
        where: { action: 'SECURITY_HISTORY_DELETED', actorUserId: saId },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // FORCE LOGOUT (REQ-220)
  // -------------------------------------------------------------------------

  describe('FORCE LOGOUT', () => {
    it('Super Admin force-logouts an Owner, revoking their sessions', async () => {
      const ownerCookie = await loginC(OWNER_C_EMAIL, 'Changed-Pass-2030');
      await http().get('/api/v1/owner/businesses').set('Cookie', ownerCookie).expect(200);
      const saCookie = await loginC(SA_EMAIL, saPassword);

      await http().post(`/api/v1/admin/users/${ownerCId}/force-logout`).set('Cookie', saCookie).expect(204);
      await http().get('/api/v1/owner/businesses').set('Cookie', ownerCookie).expect(401);
      const audit = await prisma.auditEvent.findFirst({
        where: { action: 'FORCED_LOGOUT', actorUserId: saId },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).not.toBeNull();
      const ev = await prisma.securityEvent.findFirst({
        where: { userId: ownerCId, type: 'FORCED_LOGOUT' },
        orderBy: { createdAt: 'desc' },
      });
      expect(ev).not.toBeNull();
    });

    it('an Admin cannot force-logout anyone (403)', async () => {
      const cookie = await loginC(ADMIN_A_EMAIL, PASSWORD);
      const res = await http().post(`/api/v1/admin/users/${ownerAId}/force-logout`).set('Cookie', cookie).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('an Owner cannot force-logout anyone (403)', async () => {
      const cookie = await loginC(OWNER_A_EMAIL, PASSWORD);
      const res = await http().post(`/api/v1/admin/users/${ownerBId}/force-logout`).set('Cookie', cookie).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('Super Admin cannot force-logout their own account (403)', async () => {
      const cookie = await loginC(SA_EMAIL, saPassword);
      const res = await http().post(`/api/v1/admin/users/${saId}/force-logout`).set('Cookie', cookie).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // -------------------------------------------------------------------------
  // TENANCY (real authenticated contexts)
  // -------------------------------------------------------------------------

  describe('TENANCY isolation (real sessions)', () => {
    it('Owner A creates a business under their own identity', async () => {
      const cookie = await loginC(OWNER_A_EMAIL, PASSWORD);
      const res = await http()
        .post('/api/v1/owner/businesses')
        .set('Cookie', cookie)
        .send({ slug: 'salon-a-live', categoryCode: 'SALON_AND_BARBER', name: 'Salon A Live', bookingIntervalMinutes: 60 })
        .expect(201);
      businessAId = res.body.id;
      expect(businessAId).toBeTruthy();
    });

    it('Owner B never sees Owner A’s business', async () => {
      const cookie = await loginC(OWNER_B_EMAIL, PASSWORD);
      const res = await http().get('/api/v1/owner/businesses').set('Cookie', cookie).expect(200);
      const businesses = res.body as { id: string }[];
      expect(Array.isArray(businesses)).toBe(true);
      expect(businesses.some((b) => b.id === businessAId)).toBe(false);
    });

    it('Owner B cannot add services to Owner A’s business (404, no existence leak)', async () => {
      const cookie = await loginC(OWNER_B_EMAIL, PASSWORD);
      const res = await http()
        .post(`/api/v1/owner/businesses/${businessAId}/services`)
        .set('Cookie', cookie)
        .send({ name: 'Sneaky', basePriceMinor: 100, baseDurationMinutes: 30 })
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('Owner B creates their own business with a unique slug', async () => {
      const cookie = await loginC(OWNER_B_EMAIL, PASSWORD);
      await http()
        .post('/api/v1/owner/businesses')
        .set('Cookie', cookie)
        .send({ slug: 'salon-b-live', categoryCode: 'OTHER', name: 'Salon B Live', bookingIntervalMinutes: 60 })
        .expect(201);
      const res = await http().get('/api/v1/owner/businesses').set('Cookie', cookie).expect(200);
      const businesses = res.body as { slug: string }[];
      expect(Array.isArray(businesses)).toBe(true);
      expect(businesses.some((b) => b.slug === 'salon-b-live')).toBe(true);
      expect(businesses.some((b) => b.slug === 'salon-a-live')).toBe(false);
    });

    it('a Super Admin cannot drive owner routes via session auth (requires an owner context)', async () => {
      const cookie = await loginC(SA_EMAIL, saPassword);
      const res = await http().get('/api/v1/owner/businesses').set('Cookie', cookie).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // -------------------------------------------------------------------------
  // ROLES / AUTHORIZATION (REQ-080-tenant, REQ-209)
  // -------------------------------------------------------------------------

  describe('ROLE gating', () => {
    it('an Owner is denied admin-management routes (403)', async () => {
      const cookie = await loginC(OWNER_A_EMAIL, PASSWORD);
      const res = await http().get('/api/v1/admin/admins').set('Cookie', cookie).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('an Admin is denied Super-Admin-only routes (403)', async () => {
      const cookie = await loginC(ADMIN_A_EMAIL, PASSWORD);
      const list = await http().get('/api/v1/admin/admins').set('Cookie', cookie).expect(403);
      expect(list.body.error.code).toBe('FORBIDDEN');
      const create = await http()
        .post('/api/v1/admin/admins')
        .set('Cookie', cookie)
        .send({ email: 'x@example.com', password: 'X' })
        .expect(403);
      expect(create.body.error.code).toBe('FORBIDDEN');
    });

    it('a Super Admin reaches platform admin + security-history routes (200)', async () => {
      const cookie = await loginC(SA_EMAIL, saPassword);
      await http().get('/api/v1/admin/admins').set('Cookie', cookie).expect(200);
      const history = await http().get('/api/v1/admin/security-history').set('Cookie', cookie).expect(200);
      expect(Array.isArray(history.body.events)).toBe(true);
    });

    it('Owners and Admins can read their own security history; it never leaks hashes', async () => {
      const ownerCookie = await loginC(OWNER_A_EMAIL, PASSWORD);
      const ownerRes = await http().get('/api/v1/auth/security').set('Cookie', ownerCookie).expect(200);
      const events = ownerRes.body.events as { type: string; result: string }[];
      expect(events.some((e) => e.type === 'LOGIN_SUCCESS')).toBe(true);
      expect(JSON.stringify(ownerRes.body)).not.toContain('passwordHash');
      expect(JSON.stringify(ownerRes.body)).not.toContain('$argon2');

      const adminCookie = await loginC(ADMIN_A_EMAIL, PASSWORD);
      const adminRes = await http().get('/api/v1/auth/security').set('Cookie', adminCookie).expect(200);
      expect(Array.isArray(adminRes.body.events)).toBe(true);
    });

    it('auth/security is unavailable without a session (401)', async () => {
      const res = await http().get('/api/v1/auth/security').expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  // -------------------------------------------------------------------------
  // DEVICE_FIRST_USE (REQ-197) + SECRETS
  // -------------------------------------------------------------------------

  describe('DEVICE_FIRST_USE and secret hygiene', () => {
    it('records a DEVICE_FIRST_USE event on a login with a novel device', async () => {
      const freshOwner = await prisma.user.create({
        data: { email: 'owner-d@example.com', passwordHash: await Argon2PasswordHasher.hash(PASSWORD), role: 'OWNER' },
      });
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'owner-d@example.com', password: PASSWORD })
        .set('User-Agent', 'DevicePrimer/9.9 (iPhone)')
        .expect(200);
      const first = await prisma.securityEvent.findFirst({ where: { userId: freshOwner.id, type: 'DEVICE_FIRST_USE' } });
      expect(first).not.toBeNull();
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'owner-d@example.com', password: PASSWORD })
        .set('User-Agent', 'DevicePrimer/9.9 (iPhone)')
        .expect(200);
      const repeated = await prisma.securityEvent.findMany({ where: { userId: freshOwner.id, type: 'DEVICE_FIRST_USE' } });
      expect(repeated).toHaveLength(1);
      await prisma.user.delete({ where: { id: freshOwner.id } });
    });

    it('login and admin responses never expose password or recovery-code material', async () => {
      const cookie = await loginC(SA_EMAIL, saPassword);
      const adminRes = await http().get('/api/v1/admin/admins').set('Cookie', cookie).expect(200);
      expect(JSON.stringify(adminRes.body)).not.toContain('passwordHash');
      expect(JSON.stringify(adminRes.body)).not.toContain('$argon2');
      expect(JSON.stringify(adminRes.body)).not.toContain('recoveryEmail');

      const history = await http().get('/api/v1/admin/security-history').set('Cookie', cookie).expect(200);
      expect(JSON.stringify(history.body)).not.toContain('codeHash');
      expect(JSON.stringify(history.body)).not.toContain('$argon2');

      const recoveryReq = await http().post('/api/v1/auth/recovery/request').send({ email: SA_EMAIL }).expect(200);
      expect(Object.keys(recoveryReq.body)).toEqual(['message']);
      expect(JSON.stringify(recoveryReq.body)).not.toContain('codeHash');
    });
  });

  // -------------------------------------------------------------------------
  // TEST AUTH BRIDGE (dev-only) is disjoint from production session auth
  // -------------------------------------------------------------------------

  describe('AUTH test bridge (dev-only)', () => {
    let bridgeApp: INestApplication;

    beforeAll(async () => {
      const built = await createTestApp({
        database: 'real',
        env: { DATABASE_URL: TEST_URL!, AUTH_TEST_ENABLED: 'true', PRODUCT_APP_TIMEZONE: 'UTC' },
      });
      bridgeApp = built.app;
    });

    afterAll(async () => {
      await bridgeApp?.close();
    });

    it('lets a spoofed Super Admin header reach admin routes without a session', async () => {
      const res = await request(bridgeApp.getHttpServer())
        .get('/api/v1/admin/admins')
        .set('x-actor-role', 'SUPER_ADMIN')
        .set('x-actor-id', saId)
        .expect(200);
      expect(Array.isArray(res.body.admins)).toBe(true);
    });

    it('lets a spoofed Owner header reach owner routes', async () => {
      const res = await request(bridgeApp.getHttpServer())
        .get('/api/v1/owner/businesses')
        .set('x-actor-role', 'OWNER')
        .set('x-actor-id', ownerAId)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('never authenticates in the session-auth app even with valid spoofed headers', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/admins')
        .set('x-actor-role', 'SUPER_ADMIN')
        .set('x-actor-id', saId)
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });
  });
});