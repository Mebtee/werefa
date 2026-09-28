import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../test/helpers/test-app';

/**
 * Reporting / exports HTTP end-to-end (Prompt 59; REQ-177 … REQ-190, REQ-170…172).
 * Real Postgres (`werefa_test`) via `npm run test:db`. The app boots with the
 * dev-only test auth bridge (AUTH_TEST_ENABLED) so role separation can be
 * exercised without sessions; the product timezone is pinned to UTC.
 */
const TEST_URL = process.env.TEST_DATABASE_URL;
const RUN = process.env.RUN_DB_TESTS === 'true' && Boolean(TEST_URL);

const DAY = 24 * 60 * 60 * 1000;

const SA = '30000000-0000-4000-8000-0000000000a1';
const ADMIN = '30000000-0000-4000-8000-0000000000a2';
const OWNER_A = '30000000-0000-4000-8000-0000000000a3';
const OWNER_B = '30000000-0000-4000-8000-0000000000a4';

describe.skipIf(!RUN)('reporting / exports HTTP (real DB)', () => {
  let prisma: PrismaClient;
  let app: INestApplication;

  let bizAId = '';
  let bizBId = '';
  let booking1 = 0;
  let booking2 = 0;
  let booking3 = 0;

  const now = Date.now();

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
    'session',
    'emergency_recovery',
    'user',
  ];

  async function resetDatabase(): Promise<void> {
    for (const table of DELETE_ORDER) {
      await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
    }
  }

  async function makeBooking(businessId: string, customerName: string): Promise<number> {
    // Booking start/end must be minute-aligned (DB CHECK).
    const minuteAligned = Math.floor(now / 60_000) * 60_000;
    const booking = await prisma.booking.create({
      data: {
        businessId,
        customerName,
        customerPhone: '+251911112233',
        status: 'CONFIRMED',
        startAt: new Date(minuteAligned - DAY),
        endAt: new Date(minuteAligned - DAY + 60 * 60 * 1000),
      },
    });
    return booking.id;
  }

  async function addHistory(input: {
    bookingId: number;
    businessId: string;
    fromStatus: string | null;
    toStatus: string;
    actorType: string;
    daysAgo: number;
    reason?: string;
  }): Promise<void> {
    await prisma.bookingStatusHistory.create({
      data: {
        bookingId: input.bookingId,
        businessId: input.businessId,
        fromStatus: input.fromStatus as never,
        toStatus: input.toStatus as never,
        actorType: input.actorType as never,
        occurredAt: new Date(now - input.daysAgo * DAY),
        reason: input.reason ?? null,
      },
    });
  }

  beforeAll(async () => {
    if (!RUN) return;
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL! } } });
    await resetDatabase();

    await prisma.user.createMany({
      data: [
        { id: SA, email: 'sa-report@example.com', passwordHash: 'x'.repeat(60), role: 'SUPER_ADMIN', isEmailVerified: true },
        { id: ADMIN, email: 'admin-report@example.com', passwordHash: 'x'.repeat(60), role: 'ADMIN', isEmailVerified: true },
        { id: OWNER_A, email: 'owner-a-report@example.com', passwordHash: 'x'.repeat(60), role: 'OWNER', isEmailVerified: true },
        { id: OWNER_B, email: 'owner-b-report@example.com', passwordHash: 'x'.repeat(60), role: 'OWNER', isEmailVerified: true },
      ],
    });

    const bizA = await prisma.business.create({
      data: { publicSlug: 'report-alpha', categoryCode: 'SALON_AND_BARBER', name: 'Alpha Salon' },
    });
    const bizB = await prisma.business.create({
      data: { publicSlug: 'report-beta', categoryCode: 'SALON_AND_BARBER', name: 'Beta Salon' },
    });
    bizAId = bizA.id;
    bizBId = bizB.id;
    await prisma.businessOwner.createMany({
      data: [
        { businessId: bizAId, userId: OWNER_A },
        { businessId: bizBId, userId: OWNER_B },
      ],
    });

    booking1 = await makeBooking(bizAId, 'Liya Tesfaye');
    booking2 = await makeBooking(bizAId, 'Abel Bekele');
    booking3 = await makeBooking(bizBId, 'Hana Girma');

    await addHistory({ bookingId: booking1, businessId: bizAId, fromStatus: 'PAYMENT_PENDING', toStatus: 'CONFIRMED', actorType: 'OWNER', daysAgo: 2 });
    await addHistory({ bookingId: booking1, businessId: bizAId, fromStatus: 'CONFIRMED', toStatus: 'COMPLETED', actorType: 'SYSTEM', daysAgo: 1 });
    await addHistory({ bookingId: booking2, businessId: bizAId, fromStatus: 'PAYMENT_PENDING', toStatus: 'REJECTED', actorType: 'OWNER', daysAgo: 3, reason: 'bad proof' });
    await addHistory({ bookingId: booking3, businessId: bizBId, fromStatus: 'PAYMENT_PENDING', toStatus: 'CONFIRMED', actorType: 'CUSTOMER', daysAgo: 5 });
    // Outside the 30-day default window (REQ-186).
    await addHistory({ bookingId: booking1, businessId: bizAId, fromStatus: null, toStatus: 'PAYMENT_PENDING', actorType: 'CUSTOMER', daysAgo: 40 });

    // Schedule versions for business A (REQ-170).
    await prisma.scheduleVersion.create({
      data: { businessId: bizAId, versionNo: 1, status: 'PENDING', reason: 'initial', createdAt: new Date(now - 10 * DAY) },
    });
    await prisma.scheduleVersion.create({
      data: {
        businessId: bizAId,
        versionNo: 2,
        status: 'ACTIVE',
        reason: 'holiday',
        createdAt: new Date(now - 9 * DAY),
        appliedAt: new Date(now - 9 * DAY),
      },
    });

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

  const http = () => request(app.getHttpServer());
  const actor = (role: string, id: string) => ({ 'x-actor-role': role, 'x-actor-id': id });
  const asSa = () => actor('SUPER_ADMIN', SA);
  const asAdmin = () => actor('ADMIN', ADMIN);
  const asOwnerA = () => actor('OWNER', OWNER_A);
  const asOwnerB = () => actor('OWNER', OWNER_B);

  interface Row {
    bookingId: number;
    customerName: string;
    businessName: string;
    fromStatus: string | null;
    toStatus: string;
    actorType: string;
    occurredAt: string;
  }

  it('Super Admin views the canonical history, 30-day default window, newest first (REQ-177/186/187)', async () => {
    const res = await http().get('/api/v1/admin/reports/booking-history').set(asSa()).expect(200);
    const rows = res.body.rows as Row[];
    expect(res.body.total).toBe(4); // the 40-day row is outside the default window
    expect(rows).toHaveLength(4);
    expect(rows[0].toStatus).toBe('COMPLETED'); // newest first
    expect(rows.map((r) => r.toStatus)).toEqual(['COMPLETED', 'CONFIRMED', 'REJECTED', 'CONFIRMED']);
    expect(Object.keys(rows[0]).sort()).toEqual([
      'actorType',
      'bookingId',
      'businessName',
      'customerName',
      'fromStatus',
      'occurredAt',
      'toStatus',
    ]);
    expect(rows[0].businessName).toBe('Alpha Salon');
  });

  it('filters by status (OR within category) and combines categories with AND (REQ-184/185)', async () => {
    const completed = await http().get('/api/v1/admin/reports/booking-history?status=COMPLETED').set(asSa()).expect(200);
    expect((completed.body.rows as Row[]).map((r) => r.toStatus)).toEqual(['COMPLETED']);

    const rejectedOrCompleted = await http()
      .get('/api/v1/admin/reports/booking-history?status=REJECTED,COMPLETED')
      .set(asSa())
      .expect(200);
    expect((rejectedOrCompleted.body.rows as Row[]).map((r) => r.toStatus).sort()).toEqual(['COMPLETED', 'REJECTED']);

    // AND across categories: actor + business.
    const andRows = await http()
      .get(`/api/v1/admin/reports/booking-history?actorType=OWNER&businessId=${bizAId}`)
      .set(asSa())
      .expect(200);
    expect((andRows.body.rows as Row[]).map((r) => r.bookingId).sort()).toEqual([booking1, booking2].sort());
  });

  it('scopes to one business or all businesses, and honors an explicit date range (REQ-180/179)', async () => {
    const oneBusiness = await http().get(`/api/v1/admin/reports/booking-history?businessId=${bizBId}`).set(asSa()).expect(200);
    expect((oneBusiness.body.rows as Row[]).map((r) => r.bookingId)).toEqual([booking3]);

    const range = await http()
      .get(`/api/v1/admin/reports/booking-history?from=${isoDaysAgo(6)}&to=${isoDaysAgo(4)}`)
      .set(asSa())
      .expect(200);
    expect((range.body.rows as Row[]).map((r) => r.bookingId)).toEqual([booking3]);
  });

  it('sorts deterministically, including numeric Booking ID (REQ-188/190)', async () => {
    const asc = await http()
      .get('/api/v1/admin/reports/booking-history?sortBy=bookingId&sortDirection=asc&limit=200')
      .set(asSa())
      .expect(200);
    const ids = (asc.body.rows as Row[]).map((r) => r.bookingId);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids); // non-decreasing numeric order
    expect(asc.body.rows[0].bookingId).toBe(booking1);
  });

  it('rejects malformed filters with 400 (never silently widens scope)', async () => {
    await http().get('/api/v1/admin/reports/booking-history?status=BOGUS').set(asSa()).expect(400);
    await http().get('/api/v1/admin/reports/booking-history?actorType=NOPE').set(asSa()).expect(400);
    await http().get('/api/v1/admin/reports/booking-history?businessId=not-a-uuid').set(asSa()).expect(400);
    await http().get('/api/v1/admin/reports/booking-history?sortBy=nope').set(asSa()).expect(400);
    // No multi-select: a comma-joined businessId is not a single UUID (REQ-181).
    await http()
      .get(`/api/v1/admin/reports/booking-history?businessId=${bizAId},${bizBId}`)
      .set(asSa())
      .expect(400);
  });

  it('denies Admin and unauthenticated callers (REQ-176)', async () => {
    await http().get('/api/v1/admin/reports/booking-history').set(asAdmin()).expect(403);
    await http().get('/api/v1/admin/reports/booking-history.pdf').set(asAdmin()).expect(403);
    await http().get('/api/v1/admin/reports/booking-history').expect(401);
    await http().get('/api/v1/admin/reports/booking-history').set(asOwnerA()).expect(403);
  });

  it('exports the SA booking-history PDF with the six columns and no reasons/notes (REQ-178…183)', async () => {
    const res = await http().get('/api/v1/admin/reports/booking-history.pdf').set(asSa()).expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="booking-history-\d{4}-\d{2}-\d{2}\.pdf"/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');

    const bytes = res.body as Buffer;
    expect(Buffer.isBuffer(bytes)).toBe(true);
    const text = bytes.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('Booking status history');
    for (const header of ['Date & Time', 'Booking ID', 'Customer', 'Business', 'Status change', 'Actor']) {
      expect(text).toContain(header);
    }
    expect(text).toContain('Liya Tesfaye');
    expect(text).toContain('Alpha Salon');
    expect(text).toContain('PAYMENT_PENDING -> CONFIRMED');
    // REQ-183: reasons/notes are never present.
    expect(text.toLowerCase()).not.toContain('reason');
    expect(text).not.toContain('bad proof');
  });

  it('exports an empty-but-valid PDF when the range has no rows', async () => {
    const res = await http()
      .get(`/api/v1/admin/reports/booking-history.pdf?from=2050-01-01&to=2050-01-02`)
      .set(asSa())
      .expect(200);
    const text = (res.body as Buffer).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('no rows');
  });

  it('exports the Super Admin schedule-history PDF (versions + dates only, REQ-170/172)', async () => {
    const res = await http().get(`/api/v1/admin/businesses/${bizAId}/schedule-history.pdf`).set(asSa()).expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="schedule-history-\d{4}-\d{2}-\d{2}\.pdf"/);
    const text = (res.body as Buffer).toString('latin1');
    expect(text).toContain('Schedule history');
    expect(text).toContain('v1');
    expect(text).toContain('v2');
    expect(text.toLowerCase()).not.toContain('reason');
    expect(text.toLowerCase()).not.toContain('applied by');
  });

  it('lets an owner export own-business schedule history and blocks cross-tenant/role access (REQ-166/168)', async () => {
    const own = await http().get(`/api/v1/owner/businesses/${bizAId}/schedule-history.pdf`).set(asOwnerA()).expect(200);
    expect(own.headers['content-type']).toContain('application/pdf');
    expect((own.body as Buffer).toString('latin1')).toContain('v1');

    // Another owner cannot reach business A (tenant isolation).
    await http().get(`/api/v1/owner/businesses/${bizAId}/schedule-history.pdf`).set(asOwnerB()).expect(404);
    // Admin cannot view schedule history at all (REQ-168).
    await http().get(`/api/v1/admin/businesses/${bizAId}/schedule-history.pdf`).set(asAdmin()).expect(403);
  });

  it('does not mutate history when reading or exporting (REQ-168 immutability)', async () => {
    const before = await prisma.bookingStatusHistory.count();
    await http().get('/api/v1/admin/reports/booking-history.pdf').set(asSa()).expect(200);
    await http().get(`/api/v1/admin/businesses/${bizAId}/schedule-history.pdf`).set(asSa()).expect(200);
    expect(await prisma.bookingStatusHistory.count()).toBe(before);
    expect(await prisma.scheduleVersion.count()).toBe(2);
  });
});

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
