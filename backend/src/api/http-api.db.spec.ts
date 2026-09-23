import { mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../test/helpers/test-app';
import { PROOF_MAX_BYTES } from '../domain/lib/proof-file';

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
    customerName: 'Awit Haile',
    customerPhone: '+251911112233',
    note: 'please confirm',
    startAt: `${DATE}T10:00:00.000Z`,
    submissionKey: 'invoice-20261120-0001',
  };
  const selection = (opts: Partial<{ variationId: string; addOnIds: string[] }> = {}) => [
    { serviceId, variationId: opts.variationId, addOnIds: opts.addOnIds ?? [] },
  ];

  let businessId = '';
  let serviceId = '';
  let variationId = '';
  let addOnId = '';
  let versionId = '';
  let booking1Id = 0;
  let booking2Id = 0;
  let businessBId = '';
  let serviceBId = '';
  let proofStorageDir = '';

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

    // Proof objects land in a throwaway dir (never the repo's ./storage).
    proofStorageDir = await mkdtemp(join(tmpdir(), 'werefa-http-proofs-'));
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
  const http = () => request(app.getHttpServer());

  // Prompt 50: booking-create + resubmission-verify are multipart — the JSON
  // payload rides in a text field named `payload` and the proof file in `proof`.
  const PROOF_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const postBookingForm = (payload: object) =>
    http()
      .post('/api/v1/customer/bookings')
      .field('payload', JSON.stringify(payload))
      .attach('proof', PROOF_PNG, { filename: 'receipt.png', contentType: 'image/png' });
  const postVerifyForm = (payload: object) =>
    http()
      .post('/api/v1/customer/resubmission/verify')
      .field('payload', JSON.stringify(payload))
      .attach('proof', PROOF_PNG, { filename: 'resub.png', contentType: 'image/png' });

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

  it('owner saves the location as part of the profile and both owner and public projections expose it (REQ-211 AC1)', async () => {
    const patched = await http()
      .patch(`/api/v1/owner/businesses/${businessId}`)
      .set(owner(OWNER_A))
      .send({ name: 'Happy Salons Test', address: 'Bole Road, Addis Ababa', latitude: 9.0108, longitude: 38.7612, phonePublic: '+251911000001' })
      .expect(200);
    expect(patched.body.coordinates).toEqual({ latitude: 9.0108, longitude: 38.7612 });
    expect(patched.body.address).toBe('Bole Road, Addis Ababa');
    expect(patched.body.phonePublic).toBe('+251911000001');

    const ownerView = await http().get(`/api/v1/owner/businesses/${businessId}`).set(owner(OWNER_A)).expect(200);
    expect(ownerView.body.coordinates).toEqual({ latitude: 9.0108, longitude: 38.7612 });

    const publicView = await http().get('/api/v1/public/businesses/happy-salons-test-1').expect(200);
    expect(publicView.body.coordinates).toEqual({ latitude: 9.0108, longitude: 38.7612 });
    expect(publicView.body.address).toBe('Bole Road, Addis Ababa');
    expect(publicView.body.phonePublic).toBe('+251911000001');
  });

  it('rejects out-of-range coordinates with a validation envelope', async () => {
    const res = await http()
      .patch(`/api/v1/owner/businesses/${businessId}`)
      .set(owner(OWNER_A))
      .send({ latitude: 91, longitude: 38.7612 })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields.latitude).toBeTruthy();

    const res2 = await http()
      .patch(`/api/v1/owner/businesses/${businessId}`)
      .set(owner(OWNER_A))
      .send({ latitude: 9.0108, longitude: -181 })
      .expect(400);
    expect(res2.body.error.code).toBe('VALIDATION_ERROR');
    expect(res2.body.error.fields.longitude).toBeTruthy();
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
    const body = { ...CREATE_BODY, selections: selection({ variationId, addOnIds: [addOnId] }) };

    const res = await postBookingForm(body).expect(201);
    expect(res.body.status).toBe('awaiting-verification');
    expect(res.body.businessSlug).toBe('happy-salons-test-1');
    expect(res.body.totalPriceMinor).toBe(13500);
    expect(res.body.paymentMethod).toBe('BANK_TRANSFER');
    expect(res.body.serviceNames).toContain('Haircut');
    expect(res.body.bookingId).toBeUndefined();
    expect(res.body.customerPhone).toBeUndefined();

    const again = await postBookingForm(body).expect(201);
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

  it('customer creates a multi-service booking via selections (REQ-070/074), snapshotted by the backend', async () => {
    await setupWorld();
    const svc2 = await http()
      .post(`/api/v1/owner/businesses/${businessId}/services`)
      .set(owner(OWNER_A))
      .send({ name: 'Deep Clean', basePriceMinor: 6000, baseDurationMinutes: 30 })
      .expect(201);
    const var2 = await http()
      .post(`/api/v1/owner/businesses/${businessId}/services/${svc2.body.id}/variations`)
      .set(owner(OWNER_A))
      .send({ name: 'Deluxe', priceDeltaMinor: 1000, durationDeltaMinutes: 10 })
      .expect(201);

    const res = await postBookingForm({
      ...CREATE_BODY,
      selections: [
        { serviceId, variationId, addOnIds: [addOnId] },
        { serviceId: svc2.body.id as string, variationId: var2.body.id as string },
      ],
      startAt: '2026-11-21T09:00:00.000Z',
      submissionKey: 'invoice-20261121-0001',
    }).expect(201);
    expect(res.body.status).toBe('awaiting-verification');
    expect(res.body.serviceNames).toEqual(['Haircut', 'Styling', 'Wash', 'Deep Clean', 'Deluxe']);
    expect(res.body.totalPriceMinor).toBe(20500);
    expect(res.body.startAt).toBe('2026-11-21T09:00:00.000Z');
    expect(res.body.endAt).toBe('2026-11-21T10:55:00.000Z');

    const mine = await http().get(`/api/v1/owner/businesses/${businessId}/bookings`).set(owner(OWNER_A)).expect(200);
    const row = mine.body.find((b: { startAt: string }) => b.startAt === '2026-11-21T09:00:00.000Z');
    expect(row).toBeTruthy();
    expect(row.totalPriceMinor).toBe(20500);

    const ownerDetail = await http()
      .get(`/api/v1/owner/businesses/${businessId}/bookings/${row.bookingId}`)
      .set(owner(OWNER_A))
      .expect(200);
    expect(ownerDetail.body.status).toBe('PAYMENT_PENDING');
    expect(ownerDetail.body.totalPriceMinor).toBe(20500);
    expect(ownerDetail.body.components.map((c: { name: string }) => c.name)).toEqual([
      'Haircut',
      'Styling',
      'Wash',
      'Deep Clean',
      'Deluxe',
    ]);
    expect(ownerDetail.body.history).toBeDefined();
  });

  it('rejects reusing a submission key for a materially different request (same key + different start or services → CONFLICT)', async () => {
    await setupWorld();
    // `invoice-20261120-0001` belongs to the DATE 10:00 booking above.
    const differentStart = await postBookingForm({
      ...CREATE_BODY,
      selections: selection({ variationId, addOnIds: [addOnId] }),
      startAt: '2026-11-20T11:00:00.000Z',
    }).expect(409);
    expect(differentStart.body.error.code).toBe('CONFLICT');
    expect(differentStart.body.error.detail).toContain('different booking request');

    const differentServices = await postBookingForm({ ...CREATE_BODY, selections: selection({}) }).expect(409);
    expect(differentServices.body.error.code).toBe('CONFLICT');
  });

  it('rejects malformed customer booking bodies with a validation envelope', async () => {
    await setupWorld();
    const post = (payload: unknown) => http().post('/api/v1/customer/bookings').field('payload', JSON.stringify(payload)).expect(400);

    await post({ ...CREATE_BODY }); // missing selections
    await post({ ...CREATE_BODY, selections: [] }); // empty selections
    await post({ ...CREATE_BODY, selections: [{ serviceId: 'not-a-uuid' }] }); // malformed service id
    await post({ ...CREATE_BODY, selections: [{ serviceId, addOnIds: ['not-a-uuid'] }] }); // malformed add-on id
    await post({ ...CREATE_BODY, selections: selection(), customerName: '' }); // blank customer name
    await post({
      ...CREATE_BODY,
      selections: Array.from({ length: 9 }, () => ({ serviceId })),
    }); // too many selections

    const bad = await http()
      .post('/api/v1/customer/bookings')
      .field('payload', JSON.stringify({ selections: selection(), customerName: 'Awit', startAt: 'not-a-date', submissionKey: 'x' }))
      .expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect(typeof bad.body.error.fields).toBe('object');
  });

  it("enforces tenant isolation: a second owner never learns about the first owner's business", async () => {
    await http().get(`/api/v1/owner/businesses/${businessId}`).set(owner(OWNER_B)).expect(404);
    await http().get(`/api/v1/owner/businesses/${businessId}/bookings`).set(owner(OWNER_B)).expect(404);
    await http().post(`/api/v1/owner/businesses/${businessId}/bookings/${booking1Id}/accept`).set(owner(OWNER_B)).expect(404);
    await http().get(`/api/v1/owner/businesses/${businessId}/schedule/current`).set(owner(OWNER_B)).expect(404);
    await http().get(`/api/v1/owner/businesses/${businessId}/services`).set(owner(OWNER_B)).expect(404);
    await http()
      .patch(`/api/v1/owner/businesses/${businessId}/services/${serviceId}`)
      .set(owner(OWNER_B))
      .send({ name: 'Stolen' })
      .expect(404);
    await http().post(`/api/v1/owner/businesses/${businessId}/services/${serviceId}/deactivate`).set(owner(OWNER_B)).expect(404);
    await http().post(`/api/v1/owner/businesses/${businessId}/services/${serviceId}/reactivate`).set(owner(OWNER_B)).expect(404);
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

  it('refuses to reschedule a CONFIRMED booking to a time outside schedule hours (REQ-106/089) and serves the reschedule picker', async () => {
    const createdRes = await postBookingForm({
      ...CREATE_BODY,
      selections: selection({ variationId, addOnIds: [addOnId] }),
      startAt: '2026-11-23T10:00:00.000Z',
      submissionKey: 'invoice-20261123-0004',
    }).expect(201);
    expect(createdRes.body.status).toBe('awaiting-verification');
    const list = await http()
      .get(`/api/v1/owner/businesses/${businessId}/bookings`)
      .set(owner(OWNER_A))
      .expect(200);
    const row = list.body.find((b: { startAt: string }) => b.startAt === '2026-11-23T10:00:00.000Z');
    expect(row).toBeTruthy();
    expect(row.actorType).toBe('CUSTOMER'); // owner list exposes the last transition actor (REQ-188/190)
    const booking3Id: number = row.bookingId;

    const accepted = await http()
      .post(`/api/v1/owner/businesses/${businessId}/bookings/${booking3Id}/accept`)
      .set(owner(OWNER_A))
      .expect(200);
    expect(accepted.body.status).toBe('CONFIRMED');
    expect(accepted.body.actorType).toBe('OWNER');

    // The available-times read offers free + fitting hourly slots for the 75-min
    // booking (Haircut 60 + Styling 10 + Wash 5). 10:00 is excluded (its own
    // occupied slot) and 17:30 falls after the 17:00 schedule close.
    const times = await http()
      .get(`/api/v1/owner/businesses/${businessId}/bookings/${booking3Id}/available-times`)
      .set(owner(OWNER_A))
      .query({ date: '2026-11-23' })
      .expect(200);
    expect(times.body.date).toBe('2026-11-23');
    expect(times.body.durationMinutes).toBe(75);
    expect(times.body.slots.some((s: { startAt: string }) => s.startAt === '2026-11-23T13:00:00.000Z')).toBe(true);
    expect(times.body.slots.some((s: { startAt: string }) => s.startAt === '2026-11-23T10:00:00.000Z')).toBe(false);
    expect(times.body.slots.some((s: { startAt: string }) => s.startAt === '2026-11-23T17:30:00.000Z')).toBe(false);

    const refused = await http()
      .post(`/api/v1/owner/businesses/${businessId}/bookings/${booking3Id}/reschedule`)
      .set(owner(OWNER_A))
      .send({ startAt: '2026-11-23T17:30:00.000Z' })
      .expect(409);
    expect(refused.body.error.code).toBe('SLOT_UNAVAILABLE');

    const stillConfirmed = await http()
      .get(`/api/v1/owner/businesses/${businessId}/bookings/${booking3Id}`)
      .set(owner(OWNER_A))
      .expect(200);
    expect(stillConfirmed.body.status).toBe('CONFIRMED');
    expect(stillConfirmed.body.startAt).toBe('2026-11-23T10:00:00.000Z');
  });

  it('customer rejection + one-time-code resubmission returns the booking to awaiting-verification', async () => {
    const body2 = {
      ...CREATE_BODY,
      selections: selection({ variationId }),
      startAt: '2026-11-22T10:00:00.000Z',
      submissionKey: 'invoice-20261122-0002',
    };
    await postBookingForm(body2).expect(201);

    const list = await http().get(`/api/v1/owner/businesses/${businessId}/bookings`).set(owner(OWNER_A)).expect(200);
    booking2Id = list.body.find((b: { bookingId: number }) => b.bookingId !== booking1Id).bookingId;

    const rejected = await http()
      .post(`/api/v1/owner/businesses/${businessId}/bookings/${booking2Id}/reject`)
      .set(owner(OWNER_A))
      .send({ reason: 'Transfer did not include the reference number.' })
      .expect(200);
    expect(rejected.body.status).toBe('REJECTED');

const request = await http()
      .post('/api/v1/customer/resubmission/request-code')
      .send({ businessSlug: 'happy-salons-test-1', phone: '+251911112233' })
      .expect(200);
    expect(request.body.expiresAt).toBeDefined();
    expect(request.body.code).toBeUndefined();

    // The code is generated with a CSPRNG and never returned, so the flow is
    // made deterministic in the test: overwrite the just-created code hash with
    // a known value, keeping exactly one active verification row.
    const issued = await prisma.resubmissionVerification.findFirstOrThrow({
      where: { businessId, bookingId: booking2Id, purpose: 'RESUBMIT_PROOF', usedAt: null },
    });
    await prisma.resubmissionVerification.update({
      where: { id: issued.id },
      data: { codeHash: createHash('sha256').update('123456').digest('hex') },
    });

    const verified = await postVerifyForm({
      businessSlug: 'happy-salons-test-1',
      phone: '+251911112233',
      code: '123456',
      submissionKey: 'invoice-20261122-0003',
    }).expect(200);
    expect(verified.body.outcome).toBe('PROOF_RECEIVED');
    expect(verified.body.booking.status).toBe('awaiting-verification');
  });

  it('returns a consistent VALIDATION_ERROR envelope for bad owner body input', async () => {
    const res = await http()
      .post(`/api/v1/owner/businesses/${businessId}/bookings/not-a-number/accept`)
      .set(owner(OWNER_A))
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(typeof res.body.error.fields).toBe('object');
  });

  it('rejects invalid service create/update input with a validation envelope', async () => {
    const res = await http()
      .post(`/api/v1/owner/businesses/${businessId}/services`)
      .set(owner(OWNER_A))
      .send({ name: '', basePriceMinor: -5, baseDurationMinutes: 0 })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields.name).toBeTruthy();
    expect(res.body.error.fields.basePriceMinor).toBeTruthy();
    expect(res.body.error.fields.baseDurationMinutes).toBeTruthy();

    await http()
      .patch(`/api/v1/owner/businesses/${businessId}/services/${serviceId}`)
      .set(owner(OWNER_A))
      .send({ basePriceMinor: -1 })
      .expect(400);
    await http()
      .patch(`/api/v1/owner/businesses/${businessId}/services/${serviceId}`)
      .set(owner(OWNER_A))
      .send({ baseDurationMinutes: 0 })
      .expect(400);
  });

  it('rejects malformed service identifiers and bad variation payloads with a validation envelope', async () => {
    const res1 = await http()
      .patch(`/api/v1/owner/businesses/${businessId}/services/not-a-uuid`)
      .set(owner(OWNER_A))
      .send({ name: 'Rename' })
      .expect(400);
    expect(res1.body.error.code).toBe('VALIDATION_ERROR');
    await http().post(`/api/v1/owner/businesses/${businessId}/services/not-a-uuid/deactivate`).set(owner(OWNER_A)).expect(400);
    await http().post(`/api/v1/owner/businesses/not-a-uuid/services`).set(owner(OWNER_A)).send({ name: 'X', basePriceMinor: 0, baseDurationMinutes: 1 }).expect(400);

    const res2 = await http()
      .post(`/api/v1/owner/businesses/${businessId}/services/${serviceId}/variations`)
      .set(owner(OWNER_A))
      .send({ name: '', priceDeltaMinor: -1, durationDeltaMinutes: -5 })
      .expect(400);
    expect(res2.body.error.code).toBe('VALIDATION_ERROR');
    expect(res2.body.error.fields.name).toBeTruthy();
    expect(res2.body.error.fields.priceDeltaMinor).toBeTruthy();

    const res3 = await http()
      .post(`/api/v1/owner/businesses/${businessId}/services/${serviceId}/addons`)
      .set(owner(OWNER_A))
      .send({ name: '', priceDeltaMinor: -1, durationDeltaMinutes: -5 })
      .expect(400);
    expect(res3.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('deactivates a service that already has an open booking, and hides/reactivates it on the public page (REQ-077/078/079/081)', async () => {
    // booking2 is PAYMENT_PENDING against the Haircut service.
    const deactivated = await http()
      .post(`/api/v1/owner/businesses/${businessId}/services/${serviceId}/deactivate`)
      .set(owner(OWNER_A))
      .expect(200);
    expect(deactivated.body.isActive).toBe(false);

    const publicServices = await http().get('/api/v1/public/businesses/happy-salons-test-1/services').expect(200);
    expect(publicServices.body.find((s: { id: string }) => s.id === serviceId)).toBeUndefined();

    const ownerList = await http().get(`/api/v1/owner/businesses/${businessId}/services`).set(owner(OWNER_A)).expect(200);
    const ownerService = ownerList.body.find((s: { id: string }) => s.id === serviceId);
    expect(ownerService.isActive).toBe(false);

    const reactivated = await http()
      .post(`/api/v1/owner/businesses/${businessId}/services/${serviceId}/reactivate`)
      .set(owner(OWNER_A))
      .expect(200);
    expect(reactivated.body.isActive).toBe(true);

    const publicAgain = await http().get('/api/v1/public/businesses/happy-salons-test-1/services').expect(200);
    expect(publicAgain.body.find((s: { id: string }) => s.id === serviceId)).toBeTruthy();
  });

  it('service price/duration edits never mutate booking component snapshots (REQ-076)', async () => {
    const before = await http().get(`/api/v1/owner/businesses/${businessId}/bookings/${booking2Id}`).set(owner(OWNER_A)).expect(200);
    expect(before.body.components).toContainEqual({ componentType: 'SERVICE', name: 'Haircut', unitPriceMinor: 10000, durationMinutes: 60 });
    expect(before.body.components).toContainEqual({ componentType: 'VARIATION', name: 'Styling', unitPriceMinor: 2000, durationMinutes: 10 });

    const updated = await http()
      .patch(`/api/v1/owner/businesses/${businessId}/services/${serviceId}`)
      .set(owner(OWNER_A))
      .send({ basePriceMinor: 22000, baseDurationMinutes: 75 })
      .expect(200);
    expect(updated.body.basePriceMinor).toBe(22000);
    expect(updated.body.baseDurationMinutes).toBe(75);

    const after = await http().get(`/api/v1/owner/businesses/${businessId}/bookings/${booking2Id}`).set(owner(OWNER_A)).expect(200);
    expect(after.body.components).toContainEqual({ componentType: 'SERVICE', name: 'Haircut', unitPriceMinor: 10000, durationMinutes: 60 });
    expect(after.body.components).toContainEqual({ componentType: 'VARIATION', name: 'Styling', unitPriceMinor: 2000, durationMinutes: 10 });
  });

  it('open conflicts: owner keeps a conflicting booking with reason; non-conflict is rejected (REQ-092/093/160/161)', async () => {
    await setupWorld();
    const body = { ...CREATE_BODY, selections: selection({ variationId, addOnIds: [addOnId] }) };
    await postBookingForm({ ...body, startAt: '2026-11-24T10:00:00.000Z', submissionKey: 'invoice-20261124-0009' }).expect(201);

    const list = await http().get(`/api/v1/owner/businesses/${businessId}/bookings`).set(owner(OWNER_A)).expect(200);
    const kept = list.body.find((b: { startAt: string }) => b.startAt === '2026-11-24T10:00:00.000Z');
    expect(kept).toBeTruthy();
    const keptId = kept.bookingId as number;

    // New ACTIVE version that drops Tuesday (2026-11-24): the booking becomes impossible (REQ-090 keeps the booking untouched).
    const saved = await http()
      .put(`/api/v1/owner/businesses/${businessId}/schedule`)
      .set(owner(OWNER_A))
      .send({
        name: 'No Tuesday',
        workingPeriods: [1, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startMinutes: 540, endMinutes: 1020 })),
        blockedPeriods: [],
        specialDates: [],
      })
      .expect(200);
    const newVersionId = saved.body.versionId as string;

    const conflicts = await http().get(`/api/v1/owner/businesses/${businessId}/schedule/conflicts`).set(owner(OWNER_A)).expect(200);
    expect(conflicts.body).toHaveLength(1);
    expect(conflicts.body[0].bookingId).toBe(keptId);
    expect(conflicts.body[0].status).toBe('PAYMENT_PENDING');
    expect(conflicts.body[0].customerName).toBe('Awit Haile');
    expect(conflicts.body[0].reason).toBe('OUTSIDE_HOURS');
    expect(conflicts.body[0].reasonDetail).toContain('Outside working hours');
    expect(conflicts.body[0].services.some((s: { name: string }) => s.name === 'Haircut')).toBe(true);

    const keptDetail = await http().get(`/api/v1/owner/businesses/${businessId}/bookings/${keptId}`).set(owner(OWNER_A)).expect(200);
    expect(keptDetail.body.status).toBe('PAYMENT_PENDING');
    expect(keptDetail.body.startAt).toBe('2026-11-24T10:00:00.000Z');

    const exc = await http()
      .post(`/api/v1/owner/businesses/${businessId}/schedule/exceptions`)
      .set(owner(OWNER_A))
      .send({ bookingId: keptId, versionId: newVersionId, reason: 'Owner keeps the slot' })
      .expect(201);
    expect(exc.body.reason).toBe('Owner keeps the slot');

    const cleared = await http().get(`/api/v1/owner/businesses/${businessId}/schedule/conflicts`).set(owner(OWNER_A)).expect(200);
    expect(cleared.body).toHaveLength(0);

    const detail = await http().get(`/api/v1/owner/businesses/${businessId}/bookings/${keptId}`).set(owner(OWNER_A)).expect(200);
    const history = detail.body.history as { toStatus: string; reason: string | null }[];
    expect(history[history.length - 1].toStatus).toBe('PAYMENT_PENDING');
    expect(history[history.length - 1].reason).toBe('Schedule exception: Owner keeps the slot');

    // A feasible booking (booking2, Sunday) cannot be kept as an exception.
    const tooGood = await http()
      .post(`/api/v1/owner/businesses/${businessId}/schedule/exceptions`)
      .set(owner(OWNER_A))
      .send({ bookingId: booking2Id, versionId: newVersionId, reason: 'no conflict here' })
      .expect(400);
    expect(tooGood.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('owner B creates a second salon to host cross-tenant availability checks', async () => {
    const res = await http()
      .post('/api/v1/owner/businesses')
      .set(owner(OWNER_B))
      .send({ slug: 'happy-salons-test-2', categoryCode: 'SALON_AND_BARBER', name: 'Second Salon', bookingIntervalMinutes: 60 })
      .expect(201);
    businessBId = res.body.id;
    const svc = await http()
      .post(`/api/v1/owner/businesses/${businessBId}/services`)
      .set(owner(OWNER_B))
      .send({ name: 'Cut', basePriceMinor: 5000, baseDurationMinutes: 60 })
      .expect(201);
    serviceBId = svc.body.id;
  });

  it('POST availability supports several services, per-selection variations, and duplicated services (REQ-070/074)', async () => {
    await setupWorld();
    const svc2 = await http()
      .post(`/api/v1/owner/businesses/${businessId}/services`)
      .set(owner(OWNER_A))
      .send({ name: 'Deep Clean', basePriceMinor: 6000, baseDurationMinutes: 30 })
      .expect(201);
    const svc3 = await http()
      .post(`/api/v1/owner/businesses/${businessId}/services`)
      .set(owner(OWNER_A))
      .send({ name: 'Polish', basePriceMinor: 4000, baseDurationMinutes: 20 })
      .expect(201);
    const var2 = await http()
      .post(`/api/v1/owner/businesses/${businessId}/services/${svc2.body.id}/variations`)
      .set(owner(OWNER_A))
      .send({ name: 'Deluxe', priceDeltaMinor: 1000, durationDeltaMinutes: 10 })
      .expect(201);
    const s2 = svc2.body.id as string;
    const s3 = svc3.body.id as string;
    const v2 = var2.body.id as string;

    const single = await http()
      .post('/api/v1/public/businesses/happy-salons-test-1/availability')
      .send({ date: DATE, selections: [{ serviceId: s2 }] })
      .expect(200);
    expect(single.body.computedDurationMinutes).toBe(30);
    expect(single.body.computedTotalPriceMinor).toBe(6000);
    expect(single.body.slots.length).toBeGreaterThan(0);

    const multi = await http()
      .post('/api/v1/public/businesses/happy-salons-test-1/availability')
      .send({ date: DATE, selections: [{ serviceId: s2, variationId: v2 }, { serviceId: s3 }] })
      .expect(200);
    expect(multi.body.computedDurationMinutes).toBe(60);
    expect(multi.body.computedTotalPriceMinor).toBe(11000);
    expect(multi.body.slots.length).toBeGreaterThan(0);

    const duplicated = await http()
      .post('/api/v1/public/businesses/happy-salons-test-1/availability')
      .send({ date: DATE, selections: [{ serviceId: s2 }, { serviceId: s2 }] })
      .expect(200);
    expect(duplicated.body.computedDurationMinutes).toBe(60);
    expect(duplicated.body.computedTotalPriceMinor).toBe(12000);
  });

  it('POST availability rejects a foreign service under the A slug (tenant isolation)', async () => {
    await setupWorld();
    const res = await http()
      .post('/api/v1/public/businesses/happy-salons-test-1/availability')
      .send({ date: DATE, selections: [{ serviceId: serviceBId }] })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields.serviceId).toBeTruthy();
  });

  it('POST /customer/bookings rejects a service that does not belong to the slug business (tenant isolation)', async () => {
    await setupWorld();
    const res = await postBookingForm({
      ...CREATE_BODY,
      selections: [{ serviceId: serviceBId }],
      startAt: '2026-11-21T09:00:00.000Z',
      submissionKey: 'invoice-20261121-0999',
    }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields.serviceId).toBeTruthy();
  });

  describe('real-Postgres concurrency (REQ-121 + slot first-wins)', () => {
    it('same submission key racing concurrently returns an idempotent 201 for both requests', async () => {
      await setupWorld();
      const body = {
        ...CREATE_BODY,
        selections: selection({ variationId, addOnIds: [addOnId] }),
        startAt: '2026-11-25T10:00:00.000Z',
        submissionKey: 'invoice-20261125-0001',
      };
      const [a, b] = await Promise.all([
        postBookingForm(body),
        postBookingForm(body),
      ]);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.bookingId).toBe(b.body.bookingId);
      expect(a.body.startAt).toBe('2026-11-25T10:00:00.000Z');
    });

    it('two different keys for the same slot concede the slot to one request (SLOT_UNAVAILABLE for the loser)', async () => {
      await setupWorld();
      const mk = (key: string) => ({
        ...CREATE_BODY,
        selections: selection({ variationId, addOnIds: [addOnId] }),
        startAt: '2026-11-26T10:00:00.000Z',
        submissionKey: key,
      });
      const [a, b] = await Promise.all([
        postBookingForm(mk('invoice-20261126-0001')),
        postBookingForm(mk('invoice-20261126-0002')),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);
      const loser = a.status === 409 ? a : b;
      expect(loser.body.error.code).toBe('SLOT_UNAVAILABLE');
    });
  });

  it('POST availability rejects an unknown service id and an unknown slug', async () => {
    await setupWorld();
    const unknownService = await http()
      .post('/api/v1/public/businesses/happy-salons-test-1/availability')
      .send({ date: DATE, selections: [{ serviceId: '11111111-0000-4000-8000-000000000000' }] })
      .expect(400);
    expect(unknownService.body.error.code).toBe('VALIDATION_ERROR');

    await http()
      .post('/api/v1/public/businesses/no-such-business/availability')
      .send({ date: DATE, selections: [{ serviceId }] })
      .expect(404);
  });

  it('POST availability rejects malformed bodies with a validation envelope', async () => {
    const post = (body: unknown) =>
      http().post('/api/v1/public/businesses/happy-salons-test-1/availability').send(body as object).expect(400);

    await post({ selections: [{ serviceId }] }); // missing date
    await post({ date: DATE, selections: [] }); // empty selections
    await post({ date: DATE }); // missing selections
    await post({ date: '2026-11-20T00:00:00.000Z', selections: [{ serviceId }] }); // non-date key
    await post({ date: '2026-02-30', selections: [{ serviceId }] }); // impossible calendar day
    await post({ date: '2026-13-01', selections: [{ serviceId }] }); // impossible month
    await post({ date: DATE, selections: [{ serviceId: 'not-a-uuid' }] }); // malformed id
    await post({ date: DATE, selections: [{ serviceId, addOnIds: ['not-a-uuid'] }] }); // malformed add-on id
    await post({
      date: DATE,
      selections: Array.from({ length: 9 }, () => ({ serviceId })),
    }); // too many selections
  });

  it('POST availability returns an empty slot list for a CLOSED special date (R086)', async () => {
    expect(businessBId).toBeTruthy();
    await http()
      .put(`/api/v1/owner/businesses/${businessBId}/schedule`)
      .set(owner(OWNER_B))
      .send({
        name: 'B open',
        workingPeriods: Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, startMinutes: 540, endMinutes: 1020 })),
        blockedPeriods: [],
        specialDates: [],
      })
      .expect(200);

    const before = await http()
      .post('/api/v1/public/businesses/happy-salons-test-2/availability')
      .send({ date: DATE, selections: [{ serviceId: serviceBId }] })
      .expect(200);
    expect(before.body.slots.length).toBeGreaterThan(0);

    await http()
      .put(`/api/v1/owner/businesses/${businessBId}/schedule`)
      .set(owner(OWNER_B))
      .send({
        name: 'B closed',
        workingPeriods: [],
        blockedPeriods: [],
        specialDates: [{ date: DATE, kind: 'CLOSED' }],
      })
      .expect(200);

    const after = await http()
      .post('/api/v1/public/businesses/happy-salons-test-2/availability')
      .send({ date: DATE, selections: [{ serviceId: serviceBId }] })
      .expect(200);
    expect(after.body.slots).toEqual([]);
    expect(after.body.computedDurationMinutes).toBe(60);
  });

  it('POST availability excludes a start claimed by an active booking (R090)', async () => {
    await setupWorld();
    // Haircut is now 75 min (REQ-076 test updated its base); 13:00 => [13:00, 14:15).
    await postBookingForm({
      ...CREATE_BODY,
      selections: selection(),
      startAt: '2026-11-27T13:00:00.000Z',
      submissionKey: 'invoice-20261127-0001',
    }).expect(201);

    const before = await http()
      .post('/api/v1/public/businesses/happy-salons-test-1/availability')
      .send({ date: '2026-11-27', selections: [{ serviceId }] })
      .expect(200);
    const starts = before.body.slots as { startAt: string }[];
    const times = starts.map((s) => s.startAt.slice(11, 16));
    expect(times).not.toContain('13:00');
    expect(times).toContain('11:00');
    expect(times).toContain('15:00');
    expect(times).toContain('09:00');
  });

  it('public schedule projection and Super Admin-only history access (REQ-167/168)', async () => {
    const pub = await http().get('/api/v1/public/businesses/happy-salons-test-1/schedule').expect(200);
    expect(pub.body.workingPeriods).toHaveLength(6);
    expect(pub.body.workingPeriods.some((w: { weekday: number }) => w.weekday === 2)).toBe(false);
    expect(pub.body.versionId).toBeUndefined();

    const saId = '20000000-0000-4000-8000-0000000000sa';
    const adminVersions = await http()
      .get(`/api/v1/admin/businesses/${businessId}/schedule/versions`)
      .set('x-actor-role', 'SUPER_ADMIN')
      .set('x-actor-id', saId)
      .expect(200);
    expect(adminVersions.body).toHaveLength(2);
    expect(adminVersions.body[0].workingPeriods).toHaveLength(7);
    expect(adminVersions.body[1].workingPeriods).toHaveLength(6);
    expect(adminVersions.body[1].snapshots).toBeUndefined();

    const adminId = '30000000-0000-4000-8000-0000000000ad';
    await http()
      .get(`/api/v1/admin/businesses/${businessId}/schedule/versions`)
      .set('x-actor-role', 'ADMIN')
      .set('x-actor-id', adminId)
      .expect(403);
    await http()
      .get(`/api/v1/admin/businesses/${businessId}/schedule/versions`)
      .set(owner(OWNER_B))
      .expect(403);
    await http()
      .get(`/api/v1/owner/businesses/${businessId}/schedule/versions`)
      .set(owner(OWNER_A))
      .expect(200);
  });

  describe('payment-proof uploads, download and lineage (Prompt 50)', () => {
    async function setPrepaidFixed(flag: boolean): Promise<void> {
      await http()
        .patch(`/api/v1/owner/businesses/${businessId}/settings`)
        .set(owner(OWNER_A))
        .send(flag ? { prepaymentMode: 'FIXED', prepaymentFixedMinor: 5000 } : { prepaymentMode: 'NONE', prepaymentFixedMinor: null })
        .expect(200);
    }

    it('owner downloads the proof file with attachment headers; other tenants and unknown ids get 404 (REQ-114/115/118)', async () => {
      await setupWorld();
      // booking2 (after reject + resubmission) holds the original (replaced) proof and the latest one.
      const detail = await http().get(`/api/v1/owner/businesses/${businessId}/bookings/${booking2Id}`).set(owner(OWNER_A)).expect(200);
      expect(detail.body.proofs.length).toBe(2);
      expect(detail.body.proofs[0].replaced).toBe(true);
      expect(detail.body.proofs[1].replaced).toBe(false);

      const proof = detail.body.proofs[1];
      expect(proof.mimeType).toBe('image/png');
      expect(proof.fileName).toBe(`payment-proof-${(proof.proofId as string).slice(0, 8)}.png`);
      expect(proof.sizeBytes).toBe(PROOF_PNG.length);

      const download = await http()
        .get(`/api/v1/owner/businesses/${businessId}/bookings/${booking2Id}/proofs/${proof.proofId}`)
        .set(owner(OWNER_A))
        .expect(200);
      expect(download.body.equals(PROOF_PNG)).toBe(true);
      expect(download.headers['content-type']).toBe('image/png');
      expect(download.headers['content-disposition']).toContain('attachment');

      await http()
        .get(`/api/v1/owner/businesses/${businessId}/bookings/${booking2Id}/proofs/${proof.proofId}`)
        .set(owner(OWNER_B))
        .expect(404);
      await http()
        .get(`/api/v1/owner/businesses/${businessId}/bookings/${booking2Id}/proofs/00000000-0000-4000-8000-000000000000`)
        .set(owner(OWNER_A))
        .expect(404);
    });

    it('rejects a booking without proof when prepayment is required and accepts it with a valid proof', async () => {
      await setupWorld();
      await setPrepaidFixed(true);
      try {
        const without = await http()
          .post('/api/v1/customer/bookings')
          .field(
            'payload',
            JSON.stringify({
              ...CREATE_BODY,
              selections: selection({ variationId }),
              startAt: '2026-11-28T10:00:00.000Z',
              submissionKey: 'invoice-20261128-0001',
            }),
          )
          .expect(400);
        expect(without.body.error.code).toBe('VALIDATION_ERROR');
        expect(without.body.error.fields.proof).toMatch(/required/i);

        const withProof = await postBookingForm({
          ...CREATE_BODY,
          selections: selection({ variationId }),
          startAt: '2026-11-28T10:00:00.000Z',
          submissionKey: 'invoice-20261128-0001',
        }).expect(201);
        expect(withProof.body.status).toBe('awaiting-verification');

        const rows = await prisma.fileObject.count({ where: { category: 'CUSTOMER_PROOF' } });
        expect(rows).toBeGreaterThan(0);
      } finally {
        await setPrepaidFixed(false);
      }
    });

    it('rejects a non-allowed declared MIME (text/plain) with 415 and stores nothing', async () => {
      await setupWorld();
      const res = await http()
        .post('/api/v1/customer/bookings')
        .field(
          'payload',
          JSON.stringify({
            ...CREATE_BODY,
            selections: selection({ variationId, addOnIds: [addOnId] }),
            startAt: '2026-11-28T09:00:00.000Z',
            submissionKey: 'invoice-20261128-0002',
          }),
        )
        .attach('proof', Buffer.from('this is not a payment proof'), { filename: 'receipt.txt', contentType: 'text/plain' })
        .expect(415);
      expect(res.body.error.code).toBe('FILE_TYPE_INVALID');
    });

    it('sniffs bytes authoritatively: a text file declared as image/png is rejected and the slot stays claimable', async () => {
      await setupWorld();
      const slot = '2026-11-28T15:00:00.000Z';
      const bad = await http()
        .post('/api/v1/customer/bookings')
        .field(
          'payload',
          JSON.stringify({
            ...CREATE_BODY,
            selections: selection({ variationId }),
            startAt: slot,
            submissionKey: 'invoice-20261128-0003',
          }),
        )
        .attach('proof', Buffer.from('say nothing, dot not do it'), { filename: 'receipt.png', contentType: 'image/png' })
        .expect(415);
      expect(bad.body.error.code).toBe('FILE_TYPE_INVALID');

      // The same slot must remain available: a valid proof now succeeds.
      const ok = await postBookingForm({
        ...CREATE_BODY,
        selections: selection({ variationId }),
        startAt: slot,
        submissionKey: 'invoice-20261128-0003',
      }).expect(201);
      expect(ok.body.status).toBe('awaiting-verification');
    });

    it('rejects a proof file larger than 5 MiB with 413 (FILE_TOO_LARGE)', async () => {
      await setupWorld();
      const big = Buffer.alloc(PROOF_MAX_BYTES + 1, 0x42);
      const res = await http()
        .post('/api/v1/customer/bookings')
        .field(
          'payload',
          JSON.stringify({
            ...CREATE_BODY,
            selections: selection({ variationId }),
            startAt: '2026-11-28T12:00:00.000Z',
            submissionKey: 'invoice-20261128-0004',
          }),
        )
        .attach('proof', big, { filename: 'huge.png', contentType: 'image/png' })
        .expect(413);
      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    });

    it('idempotent replays never orphan proof objects or duplicate file rows', async () => {
      await setupWorld();
      const payload = {
        ...CREATE_BODY,
        selections: selection({ variationId, addOnIds: [addOnId] }),
        startAt: '2026-11-28T13:00:00.000Z',
        submissionKey: 'invoice-20261128-0005',
      };
      const before = await prisma.fileObject.count({ where: { category: 'CUSTOMER_PROOF' } });
      await postBookingForm(payload).expect(201);
      await postBookingForm(payload).expect(201); // idempotent replay
      const after = await prisma.fileObject.count({ where: { category: 'CUSTOMER_PROOF' } });
      expect(after).toBe(before + 1);
    });
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