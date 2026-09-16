import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../test/helpers/test-app';

/**
 * DB-gated end-to-end HTTP contract tests (Prompt 42 §22). Run via
 * `npm run test:db` (scripts/run-db-tests.mjs). A real Postgres `werefa_test`
 * database is required: npm run db:up && npm run db:provision && npm run test:db.
 *
 * The app is booted with its real Prisma client bound to TEST_DATABASE_URL and
 * the test auth resolver enabled (AUTH_TEST_ENABLED=true, test env only). The
 * product timezone is pinned to UTC so slot/date math is deterministic.
 */
const TEST_URL = process.env.TEST_DATABASE_URL;
const RUN = process.env.RUN_DB_TESTS === 'true' && Boolean(TEST_URL);

describe.skipIf(!RUN)('HTTP API end-to-end (real DB)', () => {
  let prisma: PrismaClient;
  let app: INestApplication;

  const OWNER_A = '10000000-0000-4000-8000-00000000000a';
  const OWNER_B = '10000000-0000-4000-8000-00000000000b';

  const DATE = '2026-11-20';
  const CREATE_BODY = {
    businessSlug: 'happy-salons-test-1',
    serviceId: '',
    variationIds: [] as string[],
    addOnIds: [] as string[],
    customerName: 'Awit Haile',
    customerPhone: '+251911112233',
    note: 'please confirm',
    startAt: `${DATE}T10:00:00.000Z`,
    submissionKey: 'invoice-20261120-0001',
  };

  let businessId = '';
  let serviceId = '';
  let variationId = '';
  let addOnId = '';
  let versionId = '';
  let booking1Id = 0;
  let booking2Id = 0;

  beforeAll(async () => {
    if (!RUN) return;
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL! } } });
    await resetDatabase();
    await prisma.user.createMany({
      data: [
        { id: OWNER_A, email: 'owner-a@example.com', passwordHash: 'x'.repeat(60), role: 'OWNER' },
        { id: OWNER_B, email: 'owner-b@example.com', passwordHash: 'x'.repeat(60), role: 'OWNER' },
      ],
    });
    await prisma.$executeRawUnsafe(`INSERT INTO "business_category" ("code", "label") VALUES ('SALON_AND_BARBER', 'Salon & Barber'), ('OTHER', 'Other') ON CONFLICT DO NOTHING`);

    const built = await createTestApp({
      database: 'real',
      env: { DATABASE_URL: TEST_URL!, AUTH_TEST_ENABLED: 'true', PRODUCT_APP_TIMEZONE: 'UTC' },
    });
    app = built.app;
  });

  afterAll(async () => {
    if (!RUN) return;
    await app?.close();
    await resetDatabase();
    await prisma.$disconnect();
  });

  const owner = (id: string) => ({ 'x-actor-role': 'OWNER', 'x-actor-id': id });
  const http = () => request(app.getHttpServer());

  async function createBusiness(): Promise<void> {
    const res = await http()
      .post('/api/v1/owner/businesses')
      .set(owner(OWNER_A))
      .send({ slug: 'happy-salons-test-1', categoryCode: 'SALON_AND_BARBER', name: 'Happy Salons Test', bookingIntervalMinutes: 60 })
      .expect(201);
    businessId = res.body.id;
  }

  async function createCatalog(): Promise<void> {
    const svc = await http()
      .post(`/api/v1/owner/businesses/${businessId}/services`)
      .set(owner(OWNER_A))
      .send({ name: 'Haircut', basePriceMinor: 10000, baseDurationMinutes: 60 })
      .expect(201);
    serviceId = svc.body.id;

    const varRes = await http()
      .post(`/api/v1/owner/businesses/${businessId}/services/${serviceId}/variations`)
      .set(owner(OWNER_A))
      .send({ name: 'Styling', priceDeltaMinor: 2000, durationDeltaMinutes: 10 })
      .expect(201);
    variationId = varRes.body.id;

    const addonRes = await http()
      .post(`/api/v1/owner/businesses/${businessId}/services/${serviceId}/addons`)
      .set(owner(OWNER_A))
      .send({ name: 'Wash', priceDeltaMinor: 1500, durationDeltaMinutes: 5 })
      .expect(201);
    addOnId = addonRes.body.id;
  }

  async function saveSchedule(): Promise<void> {
    const res = await http()
      .put(`/api/v1/owner/businesses/${businessId}/schedule`)
      .set(owner(OWNER_A))
      .send({
        name: 'Autumn',
        workingPeriods: Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, startMinutes: 540, endMinutes: 1020 })),
        blockedPeriods: [],
        specialDates: [],
      })
      .expect(200);
    versionId = res.body.versionId;
  }

  async function setupWorld(): Promise<void> {
    if (businessId) return;
    await createBusiness();
    await createCatalog();
    await saveSchedule();
  }

  it('owner creates a business with TRIAL and country category', async () => {
    await createBusiness();
    expect(businessId).toBeTruthy();
    const res = await http().get(`/api/v1/owner/businesses/${businessId}`).set(owner(OWNER_A)).expect(200);
    expect(res.body.slug).toBe('happy-salons-test-1');
    expect(res.body.category.code).toBe('SALON_AND_BARBER');
    expect(res.body.isPaused).toBe(false);
  });

  it('owner creates services, variations and add-ons', async () => {
    await createCatalog();
    const res = await http().get(`/api/v1/owner/businesses/${businessId}/services`).set(owner(OWNER_A)).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].basePriceMinor).toBe(10000);
    expect(res.body[0].variations).toHaveLength(1);
    expect(res.body[0].addOns).toHaveLength(1);
  });

  it('owner saves a schedule version (activated immediately)', async () => {
    await saveSchedule();
    expect(versionId).toBeTruthy();
    const current = await http().get(`/api/v1/owner/businesses/${businessId}/schedule/current`).set(owner(OWNER_A)).expect(200);
    expect(current.body.workingPeriods).toHaveLength(7);
    expect(current.body.status).toBe('ACTIVE');
    const versions = await http().get(`/api/v1/owner/businesses/${businessId}/schedule/versions`).set(owner(OWNER_A)).expect(200);
    expect(versions.body).toHaveLength(1);
  });

  it('exposes a public business page, services and availability (numeric prices, no ids at business level)', async () => {
    const page = await http().get('/api/v1/public/businesses/happy-salons-test-1').expect(200);
    expect(page.body.slug).toBe('happy-salons-test-1');
    expect(page.body.branding).toEqual({ logoUrl: null, coverUrl: null });
    expect(page.body.id).toBeUndefined();

    const services = await http().get('/api/v1/public/businesses/happy-salons-test-1/services').expect(200);
    expect(services.body).toHaveLength(1);
    expect(services.body[0].basePriceMinor).toBe(10000);

    const avail = await http()
      .get('/api/v1/public/businesses/happy-salons-test-1/availability')
      .query({ date: DATE, serviceId, variationIds: variationId, addOnIds: addOnId })
      .expect(200);
    expect(avail.body.slots.length).toBeGreaterThan(0);
    expect(avail.body.computedDurationMinutes).toBe(75);
    expect(avail.body.computedTotalPriceMinor).toBe(13500);
  });

  it('customer creates a booking (idempotent by submissionKey) with a customer-safe payload', async () => {
    await setupWorld();
    const body = { ...CREATE_BODY, serviceId, variationIds: [variationId], addOnIds: [addOnId] };

    const res = await http().post('/api/v1/customer/bookings').send(body).expect(201);
    expect(res.body.status).toBe('awaiting-verification');
    expect(res.body.businessSlug).toBe('happy-salons-test-1');
    expect(res.body.totalPriceMinor).toBe(13500);
    expect(res.body.paymentMethod).toBe('BANK_TRANSFER');
    expect(res.body.serviceNames).toContain('Haircut');
    expect(res.body.bookingId).toBeUndefined();
    expect(res.body.customerPhone).toBeUndefined();

    const again = await http().post('/api/v1/customer/bookings').send(body).expect(201);
    expect(again.body.startAt).toBe(res.body.startAt);
    expect(again.body.status).toBe(res.body.status);
  });

  it('customer status shows the created booking without internal ids', async () => {
    const res = await http()
      .get('/api/v1/customer/status')
      .query({ slug: 'happy-salons-test-1', phone: '+251911112233' })
      .expect(200);
    expect(res.body.bookings).toHaveLength(1);
    expect(res.body.bookings[0].status).toBe('awaiting-verification');
    expect(res.body.bookings[0].bookingId).toBeUndefined();
  });

  it('owner lists and inspects bookings with history and proof timeline', async () => {
    const list = await http().get(`/api/v1/owner/businesses/${businessId}/bookings`).set(owner(OWNER_A)).expect(200);
    expect(list.body).toHaveLength(1);
    booking1Id = list.body[0].bookingId;
    expect(list.body[0].status).toBe('PAYMENT_PENDING');
    expect(list.body[0].customerName).toBe('Awit Haile');

    const detail = await http().get(`/api/v1/owner/businesses/${businessId}/bookings/${booking1Id}`).set(owner(OWNER_A)).expect(200);
    expect(detail.body.history.length).toBeGreaterThan(0);
    expect(detail.body.history[detail.body.history.length - 1].toStatus).toBe('PAYMENT_PENDING');
    expect(detail.body.proofs.length).toBeGreaterThan(0);
  });

  it("enforces tenant isolation: a second owner never learns about the first owner's business", async () => {
    await http().get(`/api/v1/owner/businesses/${businessId}`).set(owner(OWNER_B)).expect(404);
    await http().get(`/api/v1/owner/businesses/${businessId}/bookings`).set(owner(OWNER_B)).expect(404);
    await http().post(`/api/v1/owner/businesses/${businessId}/bookings/${booking1Id}/accept`).set(owner(OWNER_B)).expect(404);
    await http().get(`/api/v1/owner/businesses/${businessId}/schedule/current`).set(owner(OWNER_B)).expect(404);
  });

  it('owner accepts proof → confirmed, then reschedules and cancels with full history', async () => {
    const accepted = await http().post(`/api/v1/owner/businesses/${businessId}/bookings/${booking1Id}/accept`).set(owner(OWNER_A)).expect(200);
    expect(accepted.body.status).toBe('CONFIRMED');

    const rescheduled = await http()
      .post(`/api/v1/owner/businesses/${businessId}/bookings/${booking1Id}/reschedule`)
      .set(owner(OWNER_A))
      .send({ startAt: '2026-11-21T11:00:00.000Z' })
      .expect(200);
    expect(rescheduled.body.status).toBe('CONFIRMED');
    expect(rescheduled.body.startAt).toBe('2026-11-21T11:00:00.000Z');

    const cancelled = await http().post(`/api/v1/owner/businesses/${businessId}/bookings/${booking1Id}/cancel`).set(owner(OWNER_A)).expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');

    const detail = await http().get(`/api/v1/owner/businesses/${businessId}/bookings/${booking1Id}`).set(owner(OWNER_A)).expect(200);
    const toStatuses = detail.body.history.map((h: { toStatus: string }) => h.toStatus);
    expect(toStatuses).toEqual(['PAYMENT_PENDING', 'CONFIRMED', 'CANCELLED']);

    await http().post(`/api/v1/owner/businesses/${businessId}/bookings/${booking1Id}/release-slot`).set(owner(OWNER_A)).expect(204);
  });

  it('customer rejection + one-time-code resubmission returns the booking to awaiting-verification', async () => {
    const body2 = {
      ...CREATE_BODY,
      serviceId,
      variationIds: [variationId] as string[],
      addOnIds: [] as string[],
      startAt: '2026-11-22T10:00:00.000Z',
      submissionKey: 'invoice-20261122-0002',
    };
    await http().post('/api/v1/customer/bookings').send(body2).expect(201);

    const list = await http().get(`/api/v1/owner/businesses/${businessId}/bookings`).set(owner(OWNER_A)).expect(200);
    booking2Id = list.body.find((b: { bookingId: number }) => b.bookingId !== booking1Id).bookingId;

    const rejected = await http()
      .post(`/api/v1/owner/businesses/${businessId}/bookings/${booking2Id}/reject`)
      .set(owner(OWNER_A))
      .send({ reason: 'Transfer did not include the reference number.' })
      .expect(200);
    expect(rejected.body.status).toBe('REJECTED');

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const request = await http()
        .post('/api/v1/customer/resubmission/request-code')
        .send({ businessSlug: 'happy-salons-test-1', phone: '+251911112233' })
        .expect(200);
      expect(request.body.expiresAt).toBeDefined();
      expect(request.body.code).toBeUndefined();

      const verified = await http()
        .post('/api/v1/customer/resubmission/verify')
        .send({ businessSlug: 'happy-salons-test-1', phone: '+251911112233', code: '100000', submissionKey: 'invoice-20261122-0003' })
        .expect(200);
      expect(verified.body.outcome).toBe('PROOF_RECEIVED');
      expect(verified.body.booking.status).toBe('awaiting-verification');
    } finally {
      randomSpy.mockRestore();
    }

    const detail = await http().get(`/api/v1/owner/businesses/${businessId}/bookings/${booking2Id}`).set(owner(OWNER_A)).expect(200);
    expect(detail.body.status).toBe('PAYMENT_PENDING');
    const toStatuses = detail.body.history.map((h: { toStatus: string }) => h.toStatus);
    expect(toStatuses).toEqual(['PAYMENT_PENDING', 'REJECTED', 'PAYMENT_PENDING']);
  });

  it('returns a consistent VALIDATION_ERROR envelope for bad owner body input', async () => {
    const res = await http()
      .post(`/api/v1/owner/businesses/${businessId}/bookings/not-a-number/accept`)
      .set(owner(OWNER_A))
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(typeof res.body.error.fields).toBe('object');
  });
});

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