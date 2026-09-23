import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../test/helpers/test-app';

/**
 * DB-gated subscription contract tests (Prompt 52; spec §17, REQ-125…140).
 * Run via `npm run test:db`. Real werefa_test Postgres required.
 *
 * These exercise the REAL outbox writer (SubscriptionBillingService publishes
 * through the NotificationOutboxEventBus) so N15/N17 delivery rows,
 * idempotency keys, advisory-lock approvals and the time-derived booking gate
 * are all verified against the database — including a concurrent double-approve
 * that must extend the paid period exactly once.
 */
const TEST_URL = process.env.TEST_DATABASE_URL;
const RUN = process.env.RUN_DB_TESTS === 'true' && Boolean(TEST_URL);

describe.skipIf(!RUN)('Subscription & billing workflow (real DB)', () => {
  let prisma: PrismaClient;
  let app: INestApplication;

  const OWNER_A = '40000000-0000-4000-8000-00000000000a';
  const OWNER_B = '40000000-0000-4000-8000-00000000000b';
  const ADMIN_1 = '40000000-0000-4000-8000-00000000ad01';
  const ADMIN_2 = '40000000-0000-4000-8000-00000000ad02';

  let businessId = '';
  let serviceId = '';
  let proofStorageDir = '';

  const DAY = 24 * 60 * 60 * 1000;

  beforeAll(async () => {
    if (!RUN) return;
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL! } } });
    await resetDatabase();
    await prisma.user.createMany({
      data: [
        { id: OWNER_A, email: 'sub-owner-a@example.com', passwordHash: 'x'.repeat(60), role: 'OWNER' },
        { id: OWNER_B, email: 'sub-owner-b@example.com', passwordHash: 'x'.repeat(60), role: 'OWNER' },
        { id: ADMIN_1, email: 'sub-admin-1@example.com', passwordHash: 'x'.repeat(60), role: 'ADMIN' },
        { id: ADMIN_2, email: 'sub-admin-2@example.com', passwordHash: 'x'.repeat(60), role: 'ADMIN' },
      ],
    });
    await prisma.$executeRawUnsafe(`INSERT INTO "business_category" ("code", "label") VALUES ('OTHER', 'Other') ON CONFLICT DO NOTHING`);

    proofStorageDir = await mkdtemp(join(tmpdir(), 'werefa-sub-proofs-'));
    const built = await createTestApp({
      database: 'real',
      env: {
        DATABASE_URL: TEST_URL!,
        AUTH_TEST_ENABLED: 'true',
        PRODUCT_APP_TIMEZONE: 'UTC',
        PROOF_STORAGE_DIR: proofStorageDir,
      },
    });
    app = built.app;
  });

  afterAll(async () => {
    if (!RUN) return;
    await app?.close();
    await resetDatabase();
    await prisma.$disconnect();
    await rm(proofStorageDir, { recursive: true, force: true });
  });

  const owner = (id: string) => ({ 'x-actor-role': 'OWNER', 'x-actor-id': id });
  const admin = (id: string) => ({ 'x-actor-role': 'ADMIN', 'x-actor-id': id });
  const http = () => request(app.getHttpServer());

  const PROOF_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const postProof = (businessId: string, payload: object) =>
    http()
      .post(`/api/v1/owner/businesses/${businessId}/subscription/proof`)
      .set(owner(OWNER_A))
      .field('payload', JSON.stringify(payload))
      .attach('proof', PROOF_PNG, { filename: 'transfer.png', contentType: 'image/png' });

  async function createBusiness(slug: string): Promise<string> {
    const res = await http()
      .post('/api/v1/owner/businesses')
      .set(owner(OWNER_A))
      .send({ slug, categoryCode: 'OTHER', name: 'Subscription Co', bookingIntervalMinutes: 15 })
      .expect(201);
    return res.body.id;
  }

  async function createService(): Promise<void> {
    const svc = await http()
      .post(`/api/v1/owner/businesses/${businessId}/services`)
      .set(owner(OWNER_A))
      .send({ name: 'Consult', basePriceMinor: 5000, baseDurationMinutes: 60 })
      .expect(201);
    serviceId = svc.body.id;
  }

  async function setTimeline(overrides: Partial<{
    status: import('@prisma/client').SubscriptionStatus;
    trialStartedAt: Date;
    trialEndsAt: Date | null;
    trialGraceEndsAt: Date | null;
    periodEndsAt: Date | null;
    paidGraceEndsAt: Date | null;
  }>): Promise<void> {
    await prisma.subscription.update({
      where: { businessId },
      data: {
        status: overrides.status ?? 'TRIAL',
        trialStartedAt: overrides.trialStartedAt ?? new Date(Date.now() - 10 * DAY),
        trialEndsAt: overrides.trialEndsAt ?? null,
        trialGraceEndsAt: overrides.trialGraceEndsAt ?? null,
        periodEndsAt: overrides.periodEndsAt ?? null,
        paidGraceEndsAt: overrides.paidGraceEndsAt ?? null,
      },
    });
  }

  function nextDayAt10(hour = 10): string {
    const d = new Date(Date.now() + DAY);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  }

  async function expectCustomerBookingGate(status: number, hour?: number): Promise<void> {
    await http()
      .post('/api/v1/customer/bookings')
      .field(
        'payload',
        JSON.stringify({
          businessSlug: 'subscription-company',
          selections: [{ serviceId, variationIds: [], addOnIds: [] }],
          customerName: 'A',
          customerPhone: '+251911000111',
          startAt: nextDayAt10(hour),
          submissionKey: `gate-${status}-${Math.random()}`,
        }),
      )
      .attach('proof', PROOF_PNG, { filename: 'p.png', contentType: 'image/png' })
      .expect(status);
  }

  it('the owner sees a fresh TRIAL subscription with bookability + empty proof history', async () => {
    businessId = await createBusiness('subscription-company');
    await createService();

    const res = await http().get(`/api/v1/owner/businesses/${businessId}/subscription`).set(owner(OWNER_A)).expect(200);
    expect(res.body.status).toBe('TRIAL');
    expect(res.body.bookingsEnabled).toBe(true);
    expect(res.body.trialEndsAt).toBeTruthy();
    expect(res.body.periodEndsAt).toBeNull();
    expect(res.body.proofs).toEqual([]);

    const cross = await http().get(`/api/v1/owner/businesses/${businessId}/subscription`).set(owner(OWNER_B)).expect(404);
    expect(cross.body.error.code).toBe('NOT_FOUND');
  });

  it('owner uploads a proof (REQ-136); replay of the key is exactly-once, cross-business reuse conflicts', async () => {
    const created = await postProof(businessId, { submissionKey: 'sub-key-a-001' }).expect(201);
    expect(created.body.reviewState).toBe('PENDING');
    expect(created.body.requestedAt).toBeTruthy();

    const replay = await postProof(businessId, { submissionKey: 'sub-key-a-001' }).expect(201);
    expect(replay.body.id).toBe(created.body.id);
    expect(replay.body.reviewState).toBe('PENDING');

    const other = await createBusiness('subscription-other');
    const conflict = await http()
      .post(`/api/v1/owner/businesses/${other}/subscription/proof`)
      .set(owner(OWNER_A))
      .field('payload', JSON.stringify({ submissionKey: 'sub-key-a-001' }))
      .attach('proof', PROOF_PNG, { filename: 't.png', contentType: 'image/png' })
      .expect(409);
    expect(conflict.body.error.code).toBe('CONFLICT');
  });

  it('rejects bad proof type (415), oversize (413) and unparsed field (400)', async () => {
    const badMime = await http()
      .post(`/api/v1/owner/businesses/${businessId}/subscription/proof`)
      .set(owner(OWNER_A))
      .field('payload', JSON.stringify({ submissionKey: 'sub-bad-mime' }))
      .attach('proof', Buffer.from('hello'), { filename: 'x.txt', contentType: 'text/plain' })
      .expect(415);
    expect(badMime.body.error.code).toBe('FILE_TYPE_INVALID');

    await http()
      .post(`/api/v1/owner/businesses/${businessId}/subscription/proof`)
      .set(owner(OWNER_A))
      .field('payload', JSON.stringify({ submissionKey: 'sub-bad-size' }))
      .attach('proof', Buffer.alloc(6 * 1024 * 1024), { filename: 'big.png', contentType: 'image/png' })
      .expect(413);

    await http()
      .post(`/api/v1/owner/businesses/${businessId}/subscription/proof`)
      .set(owner(OWNER_A))
      .attach('proof', PROOF_PNG, { filename: 't.png', contentType: 'image/png' })
      .expect(400);
  });

  it('N17: submission notifies exactly the two ADMIN accounts (outbox rows, EMAIL suppressed)', async () => {
    const rows = await prisma.notification.findMany({
      where: { type: 'SUBSCRIPTION_PROOF_SUBMITTED' },
      include: { deliveries: true },
    });
    const emails = rows.map((r) => r.deliveries).flat();
    const adminRefs = emails.map((d) => d.recipientRef).sort();
    expect(adminRefs).toEqual([ADMIN_1, ADMIN_2].sort());
    expect(emails.every((d) => d.recipientType === 'SYSTEM' && d.channel === 'EMAIL' && d.state === 'SUPPRESSED')).toBe(true);
    const key = `admin:SUBSCRIPTION_PROOF_SUBMITTED:${businessId}:${ADMIN_1}`;
    expect(emails.some((d) => d.idempotencyKey === key)).toBe(true);
  });

  it('admin queue lists pending proofs with business + owner; owner cannot see the admin queue', async () => {
    const queue = await http().get(`/api/v1/admin/subscription/proofs?state=PENDING`).set(admin(ADMIN_1)).expect(200);
    expect(queue.body.length).toBeGreaterThanOrEqual(1);
    for (const row of queue.body) {
      expect(row.businessName).toBeTruthy();
      expect(row.ownerEmail).toBe('sub-owner-a@example.com');
      expect(row.reviewState).toBe('PENDING');
    }
    await http().get(`/api/v1/admin/subscription/proofs?state=PENDING`).set(owner(OWNER_A)).expect(403);
  });

  it('approval activates a 30-day paid period (REQ-130/137); a second approval of the same proof is 409', async () => {
    const subBefore = await prisma.subscription.findUnique({ where: { businessId } });
    const beforeEnd = subBefore?.periodEndsAt ?? null;

    const queue = await http().get(`/api/v1/admin/subscription/proofs?state=PENDING`).set(admin(ADMIN_1)).expect(200);
    const target = queue.body.find((p: { businessId: string }) => p.businessId === businessId) as { id: string };

    const approved = await http()
      .post(`/api/v1/admin/subscription/proofs/${target.id}/approve`)
      .set(admin(ADMIN_1))
      .expect(200);
    expect(approved.body.reviewState).toBe('APPROVED');
    expect(approved.body.approvedUntil).toBeTruthy();

    const subAfter = await prisma.subscription.findUnique({ where: { businessId } });
    const expectedEnd = Math.max(beforeEnd ? beforeEnd.getTime() : Date.now(), Date.now()) + 30 * DAY;
    expect(subAfter?.status).toBe('ACTIVE');
    expect(subAfter?.periodEndsAt?.getTime()).toBeGreaterThanOrEqual(expectedEnd - 60_000);
    expect(subAfter?.periodEndsAt?.getTime()).toBeLessThanOrEqual(expectedEnd + 60_000);
    expect(subAfter?.paidGraceEndsAt?.getTime()).toBe(subAfter!.periodEndsAt!.getTime() + 5 * DAY);

    await http()
      .post(`/api/v1/admin/subscription/proofs/${target.id}/approve`)
      .set(admin(ADMIN_1))
      .expect(409);

    const ownerCannotApprove = await http()
      .post(`/api/v1/admin/subscription/proofs/${target.id}/approve`)
      .set(owner(OWNER_A))
      .expect(403);
    expect(ownerCannotApprove.body.error.code).toBe('FORBIDDEN');
  });

  it('concurrent double-approve of the same proof extends exactly once (never +60d)', async () => {
    const created = await postProof(businessId, { submissionKey: 'sub-dd-001' }).expect(201);
    const proofId = created.body.id;

    const before = await prisma.subscription.findUnique({ where: { businessId } });
    // Coverage includes any remaining paid grace (REQ-131): the next approval
    // extends FROM max(periodEndsAt, paidGraceEndsAt) — never double-counts.
    const coverage = Math.max(before?.periodEndsAt?.getTime() ?? 0, before?.paidGraceEndsAt?.getTime() ?? 0);

    const [a, b] = await Promise.all([
      http().post(`/api/v1/admin/subscription/proofs/${proofId}/approve`).set(admin(ADMIN_1)),
      http().post(`/api/v1/admin/subscription/proofs/${proofId}/approve`).set(admin(ADMIN_2)),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const after = await prisma.subscription.findUnique({ where: { businessId } });
    const afterEnd = after?.periodEndsAt?.getTime() ?? 0;
    const expected = Math.max(coverage, Date.now()) + 30 * DAY;
    expect(afterEnd).toBeGreaterThanOrEqual(expected - 60_000);
    expect(afterEnd).toBeLessThanOrEqual(expected + 60_000);
    expect(afterEnd).toBeLessThan(expected + DAY); // exactly one 30-day extension
  });

  it('a rejected proof requires a reason (400) and records N15 for the owner', async () => {
    const created = await postProof(businessId, { submissionKey: 'sub-rej-001' }).expect(201);
    const proofId = created.body.id;

    await http()
      .post(`/api/v1/admin/subscription/proofs/${proofId}/reject`)
      .set(admin(ADMIN_1))
      .send({})
      .expect(400);
    await http()
      .post(`/api/v1/admin/subscription/proofs/${proofId}/reject`)
      .set(admin(ADMIN_1))
      .send({ reason: ' '.repeat(801) })
      .expect(400);

    const rejected = await http()
      .post(`/api/v1/admin/subscription/proofs/${proofId}/reject`)
      .set(admin(ADMIN_1))
      .send({ reason: 'Amount does not match the invoice.' })
      .expect(200);
    expect(rejected.body.reviewState).toBe('REJECTED');
    expect(rejected.body.rejectionReason).toBe('Amount does not match the invoice.');

    await http()
      .post(`/api/v1/admin/subscription/proofs/${proofId}/reject`)
      .set(admin(ADMIN_1))
      .send({ reason: 'again' })
      .expect(409);

    const n15 = await prisma.notification.findMany({
      where: { type: 'SUBSCRIPTION_PROOF_REJECTED' },
      include: { deliveries: true },
    });
    const ownerEmails = n15.flatMap((r) => r.deliveries).filter((d) => d.channel === 'EMAIL');
    expect(ownerEmails.length).toBe(1); // exactly the sub-rej-001 rejection
    expect(ownerEmails[0].recipientRef).toBe(OWNER_A);
    expect(ownerEmails[0].state).toBe('SUPPRESSED');
  });

  it('the booking gate is time-aware: closed after grace, open inside any grace, reopens on approval', async () => {
    await http()
      .put(`/api/v1/owner/businesses/${businessId}/schedule`)
      .set(owner(OWNER_A))
      .send({
        name: 'Week',
        workingPeriods: Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, startMinutes: 540, endMinutes: 1020 })),
        blockedPeriods: [],
        specialDates: [],
      })
      .expect(200);

    // No grace left -> subscription closes (REQ-133).
    await setTimeline({ status: 'EXPIRED', trialStartedAt: new Date(Date.now() - 40 * DAY), trialEndsAt: new Date(Date.now() - 10 * DAY), trialGraceEndsAt: new Date(Date.now() - 7 * DAY) });
    await expectCustomerBookingGate(422);
    const availDate = new Date(Date.now() + 4 * DAY).toISOString().slice(0, 10);
    const avail = await http()
      .get(`/api/v1/public/businesses/subscription-company/availability?date=${availDate}&serviceId=${serviceId}`)
      .expect(200);
    expect(avail.body.slots).toEqual([]);

    // Trial grace keeps bookings open (REQ-132).
    await setTimeline({ status: 'TRIAL_GRACE', trialStartedAt: new Date(Date.now() - 40 * DAY), trialEndsAt: new Date(Date.now() - 4 * DAY), trialGraceEndsAt: new Date(Date.now() + 2 * DAY) });
    await expectCustomerBookingGate(201, 10);

    // Paid grace keeps bookings open (REQ-132).
    await setTimeline({ status: 'PAID_GRACE', trialStartedAt: new Date(Date.now() - 60 * DAY), trialEndsAt: null, trialGraceEndsAt: null, periodEndsAt: new Date(Date.now() - 3 * DAY), paidGraceEndsAt: new Date(Date.now() + 2 * DAY) });
    await expectCustomerBookingGate(201, 12);
  });
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

async function resetDatabase(): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
  try {
    for (const table of DELETE_ORDER) {
      await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
    }
  } finally {
    await prisma.$disconnect();
  }
}