/**
 * Email notification delivery (Prompt 57 audit coverage; live PostgreSQL).
 *
 * Exercises the EMAIL half of the single notification outbox + worker with a
 * deterministic capturing provider:
 *
 *  - Lockout email (REQ-195/196): authoritative recipient, safe IP/device
 *    payload read from the persisted security event, stable template id.
 *  - Forced logout email (REQ-220/221): authoritative recipient.
 *  - Emergency recovery (REQ-198/199): stays SUPPRESSED even when a provider is
 *    configured — the one-time code is never placed in an email payload.
 *  - Subscription N17/N15 (REQ-140/138): exactly the two active Admins / the
 *    correct business owner, with no cross-business leakage.
 *  - Customer notifications are Telegram-only: no EMAIL row is ever written.
 *  - Exactly-once idempotency and bounded-retry/dead-letter semantics that never
 *    touch business state.
 *
 * The provider double never sends real email.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../../config/app-config';
import { ownerActor } from '../authorization/actor-context';
import { TenantGuard } from '../authorization/tenant-guard';
import { PrismaBusinessRepository } from '../repositories/prisma-business.repository';
import { PrismaScheduleRepository } from '../repositories/prisma-schedule.repository';
import { PrismaSubscriptionRepository } from '../repositories/prisma-subscription.repository';
import { BusinessService } from '../services/business.service';
import { SubscriptionService } from '../services/subscription.service';
import { IntlGlobalClock } from '../time/global-clock';
import { DisabledTelegramProvider } from './disabled-telegram-provider';
import { EmailMessage, EmailProvider, EmailSendResult } from './email-provider.port';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationMessageRenderer } from './notification-message-renderer';
import { NotificationOutboxEventBus } from './notification-outbox-event-bus';

const TEST_URL = process.env.TEST_DATABASE_URL;
const RUN = process.env.RUN_DB_TESTS === 'true' && Boolean(TEST_URL);

const FIXED_NOW = new Date('2026-09-14T18:00:00.000Z');
const clock = new IntlGlobalClock('UTC', () => FIXED_NOW);

// Telegram stays disabled (this spec is email-only); retries are bounded small
// so the dead-letter path is exercised without real backoff waits.
const config = parseConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  TELEGRAM_ENABLED: 'false',
  TELEGRAM_DELIVERY_INTERVAL_MS: '3600000',
  TELEGRAM_DELIVERY_MAX_ATTEMPTS: '3',
});

const DELETE_ORDER = [
  'notification_delivery',
  'notification',
  'telegram_callback',
  'telegram_connection_token',
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
  'user',
  'business_category',
];

function resetDatabase(prisma: PrismaClient): Promise<void> {
  return prisma.$transaction(async (tx) => {
    for (const table of DELETE_ORDER) {
      await tx.$executeRawUnsafe(`DELETE FROM "${table}"`);
    }
    await tx.$executeRawUnsafe(
      `INSERT INTO "business_category" ("code", "label") VALUES ('SALON_AND_BARBER', 'Salon & Barber'), ('OTHER', 'Other') ON CONFLICT DO NOTHING`,
    );
  });
}

/** Deterministic provider: records accepted messages, can be toggled/failed. */
class FakeEmailProvider implements EmailProvider {
  configured = true;
  messages: EmailMessage[] = [];
  private toFail = 0;

  isConfigured(): boolean {
    return this.configured;
  }

  failNext(n: number): void {
    this.toFail = n;
  }

  reset(): void {
    this.messages = [];
    this.toFail = 0;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (this.toFail > 0) {
      this.toFail -= 1;
      return { ok: false, accepted: false, error: 'email transport unavailable' };
    }
    this.messages.push(message);
    return { ok: true, accepted: true };
  }
}

describe.skipIf(!RUN)('email notification delivery (live PostgreSQL)', () => {
  let prisma: PrismaClient;
  let email: FakeEmailProvider;
  let outbox: NotificationOutboxEventBus;
  let delivery: NotificationDeliveryService;
  let businessService: BusinessService;
  let seq = 0;

  const businessRepo = () => new PrismaBusinessRepository(prisma);

  async function makeUser(
    role: 'OWNER' | 'ADMIN' | 'SUPER_ADMIN',
    recoveryEmail?: string,
  ): Promise<{ id: string; email: string }> {
    seq += 1;
    return prisma.user.create({
      data: {
        email: `email-spec-${role.toLowerCase()}-${seq}@example.com`,
        passwordHash: 'x'.repeat(60),
        role,
        isEmailVerified: true,
        ...(recoveryEmail ? { recoveryEmail } : {}),
      },
      select: { id: true, email: true },
    });
  }

  async function makeBusiness(ownerId: string, slugSuffix: string): Promise<{ id: string }> {
    return businessService.createBusiness(ownerActor(ownerId), {
      slug: `email-spec-${slugSuffix}`,
      categoryCode: 'SALON_AND_BARBER',
      name: `Email Spec ${slugSuffix}`,
      bookingIntervalMinutes: 60,
    });
  }

  beforeAll(async () => {
    if (!RUN) return;
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL! } } });
    email = new FakeEmailProvider();
    await resetDatabase(prisma);

    const subRepo = new PrismaSubscriptionRepository(prisma);
    const sRepo = new PrismaScheduleRepository(prisma);
    const guard = new TenantGuard(businessRepo());
    const subscriptionService = new SubscriptionService(prisma, subRepo, sRepo, clock, guard);
    businessService = new BusinessService(prisma, businessRepo(), subRepo, guard, subscriptionService, clock);

    outbox = new NotificationOutboxEventBus(prisma, config, email);
    delivery = new NotificationDeliveryService(
      prisma,
      config,
      new DisabledTelegramProvider(),
      new NotificationMessageRenderer(),
      outbox,
      email,
    );
  });

  afterAll(async () => {
    if (RUN && prisma) await prisma.$disconnect();
  });

  it('delivers a lockout email to the authoritative user with the canonical safe payload (REQ-195/196)', async () => {
    email.reset();
    const user = await makeUser('OWNER');
    await prisma.securityEvent.create({
      data: {
        userId: user.id,
        type: 'ACCOUNT_LOCKED',
        ip: '203.0.113.7',
        device: 'Desktop',
        browser: 'Firefox',
        result: 'LOCKED',
      },
    });

    await outbox.publish([{ type: 'LOCKOUT_EMAIL', userId: user.id, email: user.email, occurredAt: FIXED_NOW }]);

    const key = `system:LOCKOUT_EMAIL:${user.id}`;
    const row = await prisma.notificationDelivery.findUnique({ where: { idempotencyKey: key } });
    expect(row).not.toBeNull();
    expect(row!.channel).toBe('EMAIL');
    expect(row!.recipientType).toBe('SYSTEM');
    expect(row!.recipientRef).toBe(user.id);
    expect(row!.state).toBe('PENDING');

    const result = await delivery.sweep(FIXED_NOW);
    expect(result.sent).toBe(1);

    const message = email.messages.find((m) => m.idempotencyKey === key);
    expect(message).toBeDefined();
    expect(message!.to).toBe(user.email);
    expect(message!.template).toBe('security.lockout');
    expect(message!.subject).toBe('Werefa account locked');
    expect(message!.data).toEqual({ ip: '203.0.113.7', device: 'Desktop', browser: 'Firefox' });
    // No credential-shaped keys ever enter an email payload.
    expect(Object.keys(message!.data).some((k) => /pass|token|secret|code/i.test(k))).toBe(false);

    const after = await prisma.notificationDelivery.findUnique({ where: { id: row!.id } });
    expect(after!.state).toBe('SENT');
    expect(after!.sentAt).not.toBeNull();
  });

  it('is exactly-once: repeated lockout publishes create one delivery row (REQ "retries bounded")', async () => {
    email.reset();
    const user = await makeUser('OWNER');

    await outbox.publish([{ type: 'LOCKOUT_EMAIL', userId: user.id, email: user.email, occurredAt: FIXED_NOW }]);
    await outbox.publish([{ type: 'LOCKOUT_EMAIL', userId: user.id, email: user.email, occurredAt: new Date(FIXED_NOW.getTime() + 1000) }]);
    await outbox.publish([{ type: 'LOCKOUT_EMAIL', userId: user.id, email: user.email, occurredAt: new Date(FIXED_NOW.getTime() + 2000) }]);

    const key = `system:LOCKOUT_EMAIL:${user.id}`;
    const rows = await prisma.notificationDelivery.findMany({ where: { idempotencyKey: key } });
    expect(rows).toHaveLength(1);

    const notifications = await prisma.notification.count({ where: { type: 'LOCKOUT_EMAIL', deliveries: { some: { id: rows[0]!.id } } } });
    expect(notifications).toBe(1);

    // Drain the single pending row so later sweeps see a clean slate.
    await delivery.sweep(FIXED_NOW);
  });

  it('delivers a forced-logout email to the affected account (REQ-220/221)', async () => {
    email.reset();
    const user = await makeUser('OWNER');

    await outbox.publish([{ type: 'FORCED_LOGOUT_EMAIL', userId: user.id, email: user.email, occurredAt: FIXED_NOW }]);

    const key = `system:FORCED_LOGOUT_EMAIL:${user.id}`;
    const row = await prisma.notificationDelivery.findUnique({ where: { idempotencyKey: key } });
    expect(row!.channel).toBe('EMAIL');
    expect(row!.recipientRef).toBe(user.id);
    expect(row!.state).toBe('PENDING');

    const result = await delivery.sweep(FIXED_NOW);
    expect(result.sent).toBe(1);

    const message = email.messages.find((m) => m.idempotencyKey === key);
    expect(message!.to).toBe(user.email);
    expect(message!.template).toBe('security.forced-logout');
    expect(message!.subject).toBe('Werefa sessions signed out');
  });

  it('keeps the emergency recovery email SUPPRESSED even when a provider is configured (REQ-198/199)', async () => {
    email.reset();
    const admin = await makeUser('SUPER_ADMIN', 'sa-recovery@example.com');

    await outbox.publish([
      { type: 'RECOVERY_CODE_EMAIL', userId: admin.id, email: 'sa-recovery@example.com', occurredAt: FIXED_NOW },
    ]);

    const key = `system:RECOVERY_CODE_EMAIL:${admin.id}`;
    const row = await prisma.notificationDelivery.findUnique({ where: { idempotencyKey: key } });
    expect(row!.channel).toBe('EMAIL');
    expect(row!.recipientRef).toBe(admin.id);
    expect(row!.state).toBe('SUPPRESSED');
    // The one-time code is never carried in a payload.
    expect(row!.payloadRef).toBeNull();

    await delivery.sweep(FIXED_NOW);
    expect(email.messages.find((m) => m.idempotencyKey === key)).toBeUndefined();

    const after = await prisma.notificationDelivery.findUnique({ where: { id: row!.id } });
    expect(after!.state).toBe('SUPPRESSED');
  });

  it('records email deliveries as SUPPRESSED when no provider is configured', async () => {
    email.reset();
    email.configured = false;
    try {
      const user = await makeUser('OWNER');
      await outbox.publish([{ type: 'LOCKOUT_EMAIL', userId: user.id, email: user.email, occurredAt: FIXED_NOW }]);

      const key = `system:LOCKOUT_EMAIL:${user.id}`;
      const row = await prisma.notificationDelivery.findUnique({ where: { idempotencyKey: key } });
      expect(row!.state).toBe('SUPPRESSED');

      await delivery.sweep(FIXED_NOW);
      expect(email.messages.find((m) => m.idempotencyKey === key)).toBeUndefined();
    } finally {
      email.configured = true;
    }
  });

  it('retries a provider failure with bounded backoff then dead-letters without touching account state', async () => {
    email.reset();
    const user = await makeUser('OWNER');
    await outbox.publish([{ type: 'FORCED_LOGOUT_EMAIL', userId: user.id, email: user.email, occurredAt: FIXED_NOW }]);

    const key = `system:FORCED_LOGOUT_EMAIL:${user.id}`;
    const row = await prisma.notificationDelivery.findUnique({ where: { idempotencyKey: key } });

    email.failNext(config.telegramDeliveryMaxAttempts);
    for (let attempt = 1; attempt <= config.telegramDeliveryMaxAttempts; attempt++) {
      await prisma.notificationDelivery.update({ where: { id: row!.id }, data: { nextAttemptAt: FIXED_NOW } });
      await delivery.sweep(FIXED_NOW);
      const current = await prisma.notificationDelivery.findUnique({ where: { id: row!.id } });
      expect(current!.attempts).toBe(attempt);
      expect(current!.lastError).toBe('email transport unavailable');
    }

    const final = await prisma.notificationDelivery.findUnique({ where: { id: row!.id } });
    expect(final!.state).toBe('DEAD_LETTERED');
    // Domain state is never rolled back by delivery failure.
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
    expect(email.messages.find((m) => m.idempotencyKey === key)).toBeUndefined();
  });

  it('sends the subscription proof-submitted email to exactly the active Admin accounts (REQ-140)', async () => {
    email.reset();
    const owner = await makeUser('OWNER');
    const business = await makeBusiness(owner.id, 'submit');
    const admin1 = await makeUser('ADMIN');
    const admin2 = await makeUser('ADMIN');
    const deactivated = await makeUser('ADMIN');
    await prisma.user.update({ where: { id: deactivated.id }, data: { isDeactivated: true } });

    const proofId = 'email-proof-submitted-1';
    await outbox.publish([
      { type: 'SUBSCRIPTION_PROOF_SUBMITTED', businessId: business.id, proofId, occurredAt: FIXED_NOW },
    ]);

    const rows = await prisma.notificationDelivery.findMany({
      where: { notification: { type: 'SUBSCRIPTION_PROOF_SUBMITTED' } },
      orderBy: { idempotencyKey: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.channel === 'EMAIL' && r.state === 'PENDING')).toBe(true);
    expect(new Set(rows.map((r) => r.recipientRef))).toEqual(new Set([admin1.id, admin2.id]));
    expect(rows.every((r) => r.payloadRef === JSON.stringify({ s: proofId }))).toBe(true);
    expect(rows.map((r) => r.idempotencyKey).sort()).toEqual(
      [admin1.id, admin2.id].map((id) => `admin:SUBSCRIPTION_PROOF_SUBMITTED:${business.id}:${id}`).sort(),
    );

    await delivery.sweep(FIXED_NOW);
    const delivered = email.messages.filter((m) => m.template === 'subscription.proof-submitted');
    expect(new Set(delivered.map((m) => m.to))).toEqual(new Set([admin1.email, admin2.email]));
    expect(delivered.every((m) => m.subject === 'Werefa subscription payment proof received')).toBe(true);
    expect(delivered.some((m) => m.to === deactivated.email)).toBe(false);
  });

  it('sends the subscription rejection email only to the affected business owner (REQ-138, no cross-business leakage)', async () => {
    email.reset();
    const ownerA = await makeUser('OWNER');
    const businessA = await makeBusiness(ownerA.id, 'reject-a');
    const ownerB = await makeUser('OWNER');
    await makeBusiness(ownerB.id, 'reject-b');

    const proofId = 'email-proof-rejected-a';
    await outbox.publish([
      { type: 'SUBSCRIPTION_PROOF_REJECTED', businessId: businessA.id, proofId, occurredAt: FIXED_NOW },
    ]);

    const rows = await prisma.notificationDelivery.findMany({
      where: { notification: { type: 'SUBSCRIPTION_PROOF_REJECTED' } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.channel).toBe('EMAIL');
    expect(rows[0]!.recipientRef).toBe(ownerA.id);

    await delivery.sweep(FIXED_NOW);
    const delivered = email.messages.filter((m) => m.template === 'subscription.proof-rejected');
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.to).toBe(ownerA.email);
    expect(delivered.some((m) => m.to === ownerB.email)).toBe(false);
  });

  it('never writes an EMAIL delivery for a customer notification (Telegram-only, REQ-056)', async () => {
    email.reset();
    const owner = await makeUser('OWNER');
    const business = await makeBusiness(owner.id, 'booking');

    await outbox.publish([
      {
        type: 'BOOKING_CONFIRMED',
        businessId: business.id,
        bookingId: 424242,
        customerPhone: '+251900000000',
        occurredAt: FIXED_NOW,
      },
    ]);

    const emailRows = await prisma.notificationDelivery.findMany({
      where: { channel: 'EMAIL', notification: { type: 'BOOKING_CONFIRMED' } },
    });
    expect(emailRows).toHaveLength(0);
  });
});
