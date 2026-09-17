import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaUserAuthRepository } from './repositories/prisma-user-auth.repository';
import { PrismaSessionRepository } from './repositories/prisma-session.repository';
import { PrismaEmergencyRecoveryRepository } from './repositories/prisma-emergency-recovery.repository';
import { PrismaSecurityEventAuthRepository } from './repositories/prisma-security-event-auth.repository';
import { PrismaAuditEventAuthRepository } from './repositories/prisma-audit-event-auth.repository';
import { Argon2PasswordHasher } from '../auth/password-hash';
import { generateOpaqueToken, sha256hex } from '../auth/token-utils';

/**
 * DB-gated authentication/authorization persistence + schema invariants
 * (Prompt 43 §34). Run via `npm run test:db`: needs a real Postgres
 * `werefa_test` (npm run db:up && db:provision && test:db).
 *
 * These tests pin down the identity, session, lockout, recovery, admin-cap,
 * forced-logout and security-event invariants at the repository/schema layer —
 * including the raw-SQL paths (uuid casts, atomic single-use).
 */
const TEST_URL = process.env.TEST_DATABASE_URL;
const RUN = process.env.RUN_DB_TESTS === 'true' && Boolean(TEST_URL);

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

describe.skipIf(!RUN)('auth repositories + schema invariants (live PostgreSQL)', () => {
  let prisma: PrismaClient;
  const userRepo = () => new PrismaUserAuthRepository(prisma);
  const sessionRepo = () => new PrismaSessionRepository(prisma);
  const recoveryRepo = () => new PrismaEmergencyRecoveryRepository(prisma);
  const securityRepo = () => new PrismaSecurityEventAuthRepository(prisma);
  const auditRepo = () => new PrismaAuditEventAuthRepository(prisma);

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
  });

  afterAll(async () => {
    if (RUN) {
      await resetDatabase();
      await prisma.$disconnect();
    }
  });

  async function createUser(overrides: Partial<{ email: string; role: 'OWNER' | 'ADMIN' | 'SUPER_ADMIN'; recoveryEmail: string }> = {}) {
    const hash = await Argon2PasswordHasher.hash('pw');
    return prisma.user.create({
      data: {
        email: overrides.email ?? `u-${crypto.randomUUID()}@example.com`,
        passwordHash: hash,
        role: overrides.role ?? 'OWNER',
        recoveryEmail: overrides.recoveryEmail,
      },
    });
  }

  /**
   * Move a session safely into the past. The schema CHECK
   * (`expires_at > created_at`) forbids writing a past expiry against a
   * now-created row, so both timestamps are shifted together.
   */
  async function expireSession(sessionId: string): Promise<void> {
    await prisma.$executeRaw`
      UPDATE "session"
      SET "created_at" = NOW() - INTERVAL '2 hours', "expires_at" = NOW() - INTERVAL '1 hour'
      WHERE "id" = ${sessionId}::uuid
    `;
  }

  // -------------------------------------------------------------------------
  // Identity + role invariants
  // -------------------------------------------------------------------------

  describe('identity and role constraints', () => {
    it('enforces unique emails at the database level', async () => {
      await createUser({ email: 'dup@example.com' });
      await expect(createUser({ email: 'dup@example.com' })).rejects.toThrow();
    });

    it('normalizes email casing when resolving identity', async () => {
      const user = await createUser({ email: 'mixed@example.com' });
      const found = await userRepo().findByEmail('MiXeD@Example.COM');
      expect(found?.id).toBe(user.id);
    });

    it('allows at most one SUPER_ADMIN row (REQ-037 partial unique index)', async () => {
      await createUser({ email: 'sa-1@example.com', role: 'SUPER_ADMIN' });
      await expect(createUser({ email: 'sa-2@example.com', role: 'SUPER_ADMIN' })).rejects.toThrow();
    });

    it('allows multiple ADMINS and OWNERS', async () => {
      await createUser({ email: 'adm-1@example.com', role: 'ADMIN' });
      await createUser({ email: 'adm-2@example.com', role: 'ADMIN' });
      await createUser({ email: 'own-1@example.com', role: 'OWNER' });
      expect(await prisma.user.count({ where: { role: 'ADMIN' } })).toBeGreaterThanOrEqual(2);
    });

    it('stores password hashes as argon2id and never as plaintext', async () => {
      const user = await createUser({ email: 'hash@example.com' });
      expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
      expect(await Argon2PasswordHasher.verify(user.passwordHash, 'pw')).toBe(true);
      expect(await Argon2PasswordHasher.verify(user.passwordHash, 'not-pw')).toBe(false);
    });

    it('updatePassword rewrites the hash, marks passwordChangedAt and clears lockout', async () => {
      const user = await createUser({ email: 'pwchange@example.com' });
      await userRepo().setLockedUntil(user.id, new Date(Date.now() + 60_000));
      const now = new Date();
      const newHash = await Argon2PasswordHasher.hash('brand-new');
      await userRepo().updatePassword(user.id, newHash, now);

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.passwordHash).toBe(newHash);
      expect(after.passwordChangedAt).not.toBeNull();
      expect(after.isLockedUntil).toBeNull();
      expect(after.failedLoginAttempts).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  describe('session persistence', () => {
    it('creates a session and resolves it by token hash', async () => {
      const user = await createUser();
      const token = generateOpaqueToken();
      const expiresAt = new Date(Date.now() + 3_600_000);
      await sessionRepo().create({ userId: user.id, tokenHash: sha256hex(token), expiresAt });

      const found = await sessionRepo().findValidByTokenHash(sha256hex(token));
      expect(found?.userId).toBe(user.id);
      expect(found?.revokedAt).toBeNull();
    });

    it('does not resolve revoked or expired sessions', async () => {
      const user = await createUser();
      const revokedToken = generateOpaqueToken();
      const revoked = await sessionRepo().create({
        userId: user.id,
        tokenHash: sha256hex(revokedToken),
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      await sessionRepo().revokeById(revoked.id);
      expect(await sessionRepo().findValidByTokenHash(sha256hex(revokedToken))).toBeNull();

      const expiredToken = generateOpaqueToken();
      const expired = await sessionRepo().create({
        userId: user.id,
        tokenHash: sha256hex(expiredToken),
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      await expireSession(expired.id);
      expect(await sessionRepo().findValidByTokenHash(sha256hex(expiredToken))).toBeNull();
    });

    it('counts only active sessions and deletes expired/revoked ones', async () => {
      const user = await createUser();
      const valid = await sessionRepo().create({
        userId: user.id,
        tokenHash: sha256hex(generateOpaqueToken()),
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      const expired = await sessionRepo().create({
        userId: user.id,
        tokenHash: sha256hex(generateOpaqueToken()),
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      await expireSession(expired.id);
      const revokedToken = generateOpaqueToken();
      const revoked = await sessionRepo().create({
        userId: user.id,
        tokenHash: sha256hex(revokedToken),
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      await sessionRepo().revokeById(revoked.id);
      void valid;

      expect(await sessionRepo().countActiveByUserId(user.id)).toBe(1);
      const removed = await sessionRepo().deleteExpired(new Date());
      expect(removed).toBeGreaterThanOrEqual(2);
      expect(await prisma.session.findUnique({ where: { id: expired.id } })).toBeNull();
      expect(await prisma.session.findUnique({ where: { id: revoked.id } })).toBeNull();
    });

    it('revokeAllByUserId only affects the target user (forced logout)', async () => {
      const owner = await createUser();
      const other = await createUser();
      const ownerToken = generateOpaqueToken();
      const otherToken = generateOpaqueToken();
      await sessionRepo().create({ userId: owner.id, tokenHash: sha256hex(ownerToken), expiresAt: new Date(Date.now() + 3_600_000) });
      await sessionRepo().create({ userId: other.id, tokenHash: sha256hex(otherToken), expiresAt: new Date(Date.now() + 3_600_000) });

      await sessionRepo().revokeAllByUserId(owner.id);
      expect(await sessionRepo().findValidByTokenHash(sha256hex(ownerToken))).toBeNull();
      expect(await sessionRepo().findValidByTokenHash(sha256hex(otherToken))).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Lockout
  // -------------------------------------------------------------------------

  describe('lockout state', () => {
    it('increments failed attempts atomically and returns the new count', async () => {
      const user = await createUser();
      expect(await userRepo().incrementFailedLoginAttempts(user.id)).toBe(1);
      expect(await userRepo().incrementFailedLoginAttempts(user.id)).toBe(2);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.failedLoginAttempts).toBe(2);
    });

    it('records a successful login by resetting attempts, lock and lastLoginAt', async () => {
      const user = await createUser();
      await userRepo().incrementFailedLoginAttempts(user.id);
      await userRepo().setLockedUntil(user.id, new Date(Date.now() + 60_000));
      const now = new Date();
      await userRepo().recordSuccessfulLogin(user.id, now);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.failedLoginAttempts).toBe(0);
      expect(row.isLockedUntil).toBeNull();
      expect(row.lastLoginAt?.getTime()).toBe(now.getTime());
    });

    it('setLockedUntil persists the lock window and resets the counter', async () => {
      const user = await createUser();
      await userRepo().incrementFailedLoginAttempts(user.id);
      await userRepo().incrementFailedLoginAttempts(user.id);
      const until = new Date(Date.now() + 15 * 60_000);
      await userRepo().setLockedUntil(user.id, until);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.isLockedUntil?.getTime()).toBe(until.getTime());
      expect(row.failedLoginAttempts).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Recovery codes
  // -------------------------------------------------------------------------

  describe('emergency recovery persistence', () => {
    beforeEach(async () => {
      await resetDatabase();
    });

    it('creates an active code and finds it by user', async () => {
      const sa = await createUser({ role: 'SUPER_ADMIN', recoveryEmail: 'rec@example.com' });
      const created = await recoveryRepo().create({
        userId: sa.id,
        codeHash: sha256hex('123456'),
        expiresAt: new Date(Date.now() + 15 * 60_000),
      });
      const active = await recoveryRepo().findActiveByUserId(sa.id, new Date());
      expect(active?.id).toBe(created.id);
      expect(active?.codeHash).toBe(sha256hex('123456'));
      expect(active?.attempts).toBe(0);
    });

    it('increments verification attempts atomically', async () => {
      const sa = await createUser({ role: 'SUPER_ADMIN', recoveryEmail: 'rec2@example.com' });
      const created = await recoveryRepo().create({
        userId: sa.id,
        codeHash: sha256hex('000000'),
        expiresAt: new Date(Date.now() + 15 * 60_000),
      });
      expect(await recoveryRepo().incrementAttempts(created.id)).toBe(1);
      expect(await recoveryRepo().incrementAttempts(created.id)).toBe(2);
    });

    it('atomically consumes a code exactly once (REQ-199 single use)', async () => {
      const sa = await createUser({ role: 'SUPER_ADMIN', recoveryEmail: 'rec3@example.com' });
      const created = await recoveryRepo().create({
        userId: sa.id,
        codeHash: sha256hex('654321'),
        expiresAt: new Date(Date.now() + 15 * 60_000),
      });
      const first = await Promise.all([
        recoveryRepo().consume(created.id, new Date()),
        recoveryRepo().consume(created.id, new Date()),
      ]);
      expect(first.filter(Boolean)).toHaveLength(1);
      expect(await recoveryRepo().consume(created.id, new Date())).toBe(false);
      expect(await recoveryRepo().findActiveByUserId(sa.id, new Date())).toBeNull();
    });

    it('does not return expired codes as active', async () => {
      const sa = await createUser({ role: 'SUPER_ADMIN', recoveryEmail: 'rec4@example.com' });
      await recoveryRepo().create({
        userId: sa.id,
        codeHash: sha256hex('111111'),
        expiresAt: new Date(Date.now() - 1000),
      });
      expect(await recoveryRepo().findActiveByUserId(sa.id, new Date())).toBeNull();
    });

    it('expireAllForUser invalidates every active code', async () => {
      const sa = await createUser({ role: 'SUPER_ADMIN', recoveryEmail: 'rec5@example.com' });
      await recoveryRepo().create({ userId: sa.id, codeHash: sha256hex('a'), expiresAt: new Date(Date.now() + 600_000) });
      await recoveryRepo().create({ userId: sa.id, codeHash: sha256hex('b'), expiresAt: new Date(Date.now() + 600_000) });
      await recoveryRepo().expireAllForUser(sa.id, new Date());
      expect(await recoveryRepo().findActiveByUserId(sa.id, new Date())).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Admin cap (serialized)
  // -------------------------------------------------------------------------

  describe('admin lifecycle constraints', () => {
    beforeEach(async () => {
      await resetDatabase();
    });

    it('creates up to two active admins and refuses the third', async () => {
      const first = await userRepo().createAdmin({ id: crypto.randomUUID(), email: 'a1@example.com', passwordHash: 'x' });
      const second = await userRepo().createAdmin({ id: crypto.randomUUID(), email: 'a2@example.com', passwordHash: 'x' });
      const third = await userRepo().createAdmin({ id: crypto.randomUUID(), email: 'a3@example.com', passwordHash: 'x' });
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(third).toBeNull();
      expect(await userRepo().countActiveAdmins()).toBe(2);
    });

    it('serializes concurrent admin creation so the cap cannot be raced (REQ-038)', async () => {
      await resetDatabase();
      const attempts = Array.from({ length: 5 }, (_, i) =>
        userRepo().createAdmin({ id: crypto.randomUUID(), email: `race-${i}@example.com`, passwordHash: 'x' }),
      );
      const results = await Promise.all(attempts);
      expect(results.filter((r) => r !== null)).toHaveLength(2);
      expect(await userRepo().countActiveAdmins()).toBe(2);
    });

    it('deactivating an admin frees a cap slot', async () => {
      await resetDatabase();
      const a = await userRepo().createAdmin({ id: crypto.randomUUID(), email: 'd1@example.com', passwordHash: 'x' });
      await userRepo().createAdmin({ id: crypto.randomUUID(), email: 'd2@example.com', passwordHash: 'x' });
      await userRepo().deactivateUser(a!.id);
      expect(await userRepo().countActiveAdmins()).toBe(1);
      const replacement = await userRepo().createAdmin({ id: crypto.randomUUID(), email: 'd3@example.com', passwordHash: 'x' });
      expect(replacement).not.toBeNull();
    });

    it('setRecoveryEmail normalizes and persists the recovery address', async () => {
      const sa = await createUser({ role: 'SUPER_ADMIN' });
      await userRepo().setRecoveryEmail(sa.id, 'Recovery@Example.COM');
      const row = await prisma.user.findUniqueOrThrow({ where: { id: sa.id } });
      expect(row.recoveryEmail).toBe('recovery@example.com');
    });
  });

  // -------------------------------------------------------------------------
  // Security + audit events
  // -------------------------------------------------------------------------

  describe('security and audit events', () => {
    beforeEach(async () => {
      await resetDatabase();
    });

    it('stores security events with ip/device/browser and lists them newest-first', async () => {
      const user = await createUser();
      await securityRepo().create({ userId: user.id, type: 'LOGIN_SUCCESS', ip: '1.2.3.4', device: 'Desktop', browser: 'Chrome', result: 'SUCCESS' });
      await securityRepo().create({ userId: user.id, type: 'LOGIN_FAILURE', device: 'Desktop', browser: 'Chrome', result: 'BAD_PASSWORD' });
      const events = await securityRepo().listByUserId(user.id, { limit: 10 });
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('LOGIN_FAILURE');
      expect(events[1]).toMatchObject({ ip: '1.2.3.4', device: 'Desktop', browser: 'Chrome', result: 'SUCCESS' });
    });

    it('counts prior logins per device/browser (REQ-197 device-first-use signal)', async () => {
      const user = await createUser();
      expect(await securityRepo().countByDevice(user.id, 'Mobile', 'Safari')).toBe(0);
      await securityRepo().create({ userId: user.id, type: 'LOGIN_SUCCESS', device: 'Mobile', browser: 'Safari', result: 'SUCCESS' });
      expect(await securityRepo().countByDevice(user.id, 'Mobile', 'Safari')).toBe(1);
      expect(await securityRepo().countByDevice(user.id, 'Desktop', 'Safari')).toBe(0);
    });

    it('records security events with a null user (unknown-account login failures)', async () => {
      await securityRepo().create({ userId: null, type: 'LOGIN_FAILURE', result: 'NO_ACCOUNT' });
      const events = await securityRepo().listAll({ limit: 50 });
      expect(events.some((e) => e.type === 'LOGIN_FAILURE' && e.userId === null)).toBe(true);
    });

    it('deletes security history older than an instant and returns the count', async () => {
      const user = await createUser();
      const old = await securityRepo().create({ userId: user.id, type: 'LOGIN_SUCCESS', result: 'SUCCESS' });
      void old;
      await prisma.securityEvent.updateMany({ where: { userId: user.id }, data: { createdAt: new Date('2020-01-01T00:00:00.000Z') } });
      const deleted = await securityRepo().deleteOlderThan(new Date('2021-01-01T00:00:00.000Z'));
      expect(deleted).toBeGreaterThanOrEqual(1);
      expect(await securityRepo().countByUserId(user.id)).toBe(0);
    });

    it('audit events persist actor role, action and detail', async () => {
      const sa = await createUser({ role: 'SUPER_ADMIN' });
      await auditRepo().create({ actorUserId: sa.id, actorRole: 'SUPER_ADMIN', action: 'ADMIN_CREATED', detail: 'created' });
      const row = await prisma.auditEvent.findFirst({ where: { actorUserId: sa.id, action: 'ADMIN_CREATED' } });
      expect(row).not.toBeNull();
      expect(row?.actorRole).toBe('SUPER_ADMIN');
      expect(row?.detail).toBe('created');
    });
  });

  // -------------------------------------------------------------------------
  // Tenant relationships via identity
  // -------------------------------------------------------------------------

  describe('tenant relationships', () => {
    it('resolves a user’s business memberships and no one else’s', async () => {
      const ownerA = await createUser({ email: 'tenant-a@example.com' });
      await createUser({ email: 'tenant-b@example.com' });
      const business = await prisma.business.create({
        data: { publicSlug: `tenant-${crypto.randomUUID()}`, categoryCode: 'SALON_AND_BARBER', name: 'Tenant Salon' },
      });
      await prisma.businessOwner.create({ data: { businessId: business.id, userId: ownerA.id } });

      const a = await userRepo().findByEmail('tenant-a@example.com');
      const b = await userRepo().findByEmail('tenant-b@example.com');
      expect(a?.businesses.map((x) => x.businessId)).toEqual([business.id]);
      expect(b?.businesses).toHaveLength(0);
    });
  });
});