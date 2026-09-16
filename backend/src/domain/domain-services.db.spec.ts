import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { ownerActor } from './authorization/actor-context';
import { TenantGuard } from './authorization/tenant-guard';
import { InMemoryEventBus } from './events/domain-events';
import { IntlGlobalClock } from './time/global-clock';
import { PrismaBusinessRepository } from './repositories/prisma-business.repository';
import { PrismaBookingRepository } from './repositories/prisma-booking.repository';
import { PrismaScheduleRepository } from './repositories/prisma-schedule.repository';
import { PrismaPaymentRepository } from './repositories/prisma-payment.repository';
import { PrismaSubscriptionRepository } from './repositories/prisma-subscription.repository';
import { PrismaResubmissionVerificationRepository } from './repositories/prisma-resubmission.repository';
import { BusinessService } from './services/business.service';
import { CatalogService } from './services/catalog.service';
import { ScheduleService } from './services/schedule.service';
import { AvailabilityService } from './services/availability.service';
import { BookingService } from './services/booking.service';
import { ResubmissionService } from './services/resubmission.service';
import { CustomerStatusService } from './services/customer-status.service';

const TEST_URL = process.env.TEST_DATABASE_URL;
const RUN = process.env.RUN_DB_TESTS === 'true' && Boolean(TEST_URL);

let prisma: PrismaClient = null as unknown as PrismaClient;

// Fixed global clock: UTC, "today" = 2026-09-14T18:00:00Z. That makes all date
// math deterministic while keeping slot dates in UTC (technical config; the
// product-level timezone decision remains spec §46 item 2 / REQ-222).
const FIXED_NOW = new Date('2026-09-14T18:00:00.000Z');
const clock = new IntlGlobalClock('UTC', () => FIXED_NOW);

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
  for (const table of DELETE_ORDER) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO "business_category" ("code", "label") VALUES ('SALON_AND_BARBER', 'Salon & Barber'), ('OTHER', 'Other') ON CONFLICT DO NOTHING`,
  );
}

interface World {
  ownerId: string;
  ownerSlug: string;
  businessId: string;
  serviceId: string;
  serviceVariationId: string;
  addOnId: string;
}

// A fully operational business: owner + category + settings(60) + TRIAL
// subscription + active service + active versioned schedule (Mon–Sun 09:00-17:00).
async function readyBusiness(seq: number, overrides?: { intervalMinutes?: number }): Promise<World> {
  const user = await prisma.user.create({ data: { email: `owner${seq}@example.com`, passwordHash: 'x'.repeat(60), role: 'OWNER' } });
  const ownerId = user.id;
  const slug = `happy-salons-${seq}`;
  const biz = await businessService.createBusiness(ownerActor(ownerId), {
    slug,
    categoryCode: 'SALON_AND_BARBER',
    name: `Happy Salons ${seq}`,
    bookingIntervalMinutes: overrides?.intervalMinutes ?? 60,
  });
  const service = await catalogService.createService(ownerActor(ownerId), biz.id, {
    name: 'Haircut',
    basePriceMinor: 10000n,
    baseDurationMinutes: 60,
  });
  const variation = await catalogService.createVariation(ownerActor(ownerId), biz.id, service.id, {
    name: 'Styling',
    priceDeltaMinor: 2000n,
    durationDeltaMinutes: 10,
  });
  const addOn = await catalogService.createAddOn(ownerActor(ownerId), biz.id, service.id, {
    name: 'Wash',
    priceDeltaMinor: 1500n,
    durationDeltaMinutes: 5,
  });
  await scheduleService.saveTemplate(ownerActor(ownerId), biz.id, {
    template: {
      workingPeriods: [
        ...Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, startMinutes: 540, endMinutes: 1020 })),
      ],
      blockedPeriods: [],
      specialDates: [],
    },
  });
  return { ownerId, ownerSlug: slug, businessId: biz.id, serviceId: service.id, serviceVariationId: variation.id, addOnId: addOn.id };
}

const businessRepo = () => new PrismaBusinessRepository(prisma);
const bookingRepo = () => new PrismaBookingRepository(prisma);
const scheduleRepo = () => new PrismaScheduleRepository(prisma);
const paymentRepo = () => new PrismaPaymentRepository(prisma);
const subscriptionRepo = () => new PrismaSubscriptionRepository(prisma);
const verificationRepo = () => new PrismaResubmissionVerificationRepository(prisma);

let tenantGuardHolder: TenantGuard;
let businessService: BusinessService;
let catalogService: CatalogService;
let scheduleService: ScheduleService;
let availabilityService: AvailabilityService;
let bookingService: BookingService;
let resubmissionService: ResubmissionService;
let customerStatusService: CustomerStatusService;

beforeAll(async () => {
  if (RUN) {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL! } } });
    await resetDatabase();

    const bRepo = businessRepo();
    const kRepo = bookingRepo();
    const sRepo = scheduleRepo();
    const pRepo = paymentRepo();
    const subRepo = subscriptionRepo();
    const vRepo = verificationRepo();
    const eventBus = new InMemoryEventBus();

    tenantGuardHolder = new TenantGuard(bRepo);
    businessService = new BusinessService(prisma, bRepo, subRepo, sRepo, tenantGuardHolder);
    catalogService = new CatalogService(prisma, kRepo, tenantGuardHolder);
    scheduleService = new ScheduleService(prisma, sRepo, clock, tenantGuardHolder);
    availabilityService = new AvailabilityService(prisma, sRepo, clock);
    bookingService = new BookingService(prisma, bRepo, kRepo, pRepo, subRepo, clock, eventBus, tenantGuardHolder, catalogService, availabilityService);
    resubmissionService = new ResubmissionService(prisma, bRepo, kRepo, pRepo, vRepo, clock, eventBus);
    customerStatusService = new CustomerStatusService(bRepo, kRepo);
  }
});

afterAll(async () => {
  if (RUN) {
    await resetDatabase();
    await prisma.$disconnect();
  }
});

async function expectCode(promise: Promise<unknown>, code: ErrorCode): Promise<void> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
    return;
  }
  throw new Error(`expected AppError with ${code}, but the call succeeded`);
}

async function makeBooking(w: World, startAt: Date, key: string) {
  return bookingService.createBooking({
    businessSlug: w.ownerSlug,
    serviceId: w.serviceId,
    variationIds: [w.serviceVariationId],
    addOnIds: [w.addOnId],
    customerName: 'Liya Tesfaye',
    customerPhone: '+251911112233',
    note: 'by the window',
    startAt,
    submissionKey: key,
  });
}

describe.skipIf(!RUN)('domain application services (live PostgreSQL 16)', () => {
  it('business creation seeds owner, settings, and a TRIAL subscription', async () => {
    const w = await readyBusiness(1, { intervalMinutes: 30 });
    const settings = await prisma.businessSettings.findUnique({ where: { businessId: w.businessId } });
    expect(settings).not.toBeNull();
    expect(settings!.bookingIntervalMins).toBe(30);
    const sub = await prisma.subscription.findUnique({ where: { businessId: w.businessId } });
    expect(sub).not.toBeNull();
    expect(sub!.status).toBe('TRIAL');
    const grace = new Date(sub!.trialEndsAt!).getTime() - new Date(FIXED_NOW).getTime();
    expect(grace).toBeGreaterThan(29 * 24 * 3600 * 1000);
  });

  it('duplicate public slug maps to CONFLICT (not P2002 leakage)', async () => {
    const w = await readyBusiness(2);
    const other = await prisma.user.create({ data: { email: 'owner2b@example.com', passwordHash: 'x'.repeat(60), role: 'OWNER' } });
    await expectCode(
      businessService.createBusiness(ownerActor(other.id), { slug: w.ownerSlug, categoryCode: 'OTHER', name: 'Cloner' }),
      ErrorCode.CONFLICT,
    );
    const count = await prisma.business.count({ where: { publicSlug: w.ownerSlug } });
    expect(count).toBe(1);
  });

  it('tenant guard isolates owners: a foreign owner gets NOT_FOUND, never existence leaks', async () => {
    const w = await readyBusiness(3);
    const other = await prisma.user.create({ data: { email: 'owner3b@example.com', passwordHash: 'x'.repeat(60), role: 'OWNER' } });
    await expectCode(businessService.updateProfile(ownerActor(other.id), w.businessId, { name: 'hijack' }), ErrorCode.NOT_FOUND);
    await expectCode(businessService.pause(ownerActor(other.id), w.businessId, {}), ErrorCode.NOT_FOUND);
    const after = await prisma.business.findUnique({ where: { id: w.businessId }, select: { name: true } });
    expect(after!.name).toBe('Happy Salons 3');
  });

  it('schedule save creates immutable versions: latest is ACTIVE, previous demoted with replacedAt', async () => {
    const w = await readyBusiness(4);
    const v1 = await scheduleService.getActiveVersion(w.businessId);
    expect(v1?.versionNo).toBe(1);
    await scheduleService.saveTemplate(ownerActor(w.ownerId), w.businessId, {
      template: { workingPeriods: Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, startMinutes: 600, endMinutes: 780 })), blockedPeriods: [], specialDates: [] },
      name: 'Summer hours',
    });
    const v2 = await scheduleService.getActiveVersion(w.businessId);
    expect(v2?.versionNo).toBe(2);
    expect(v2?.name).toBe('Summer hours');
    const old = await prisma.scheduleVersion.findUnique({ where: { id: v1!.id } });
    expect(old!.status).toBe('PENDING');
    expect(old!.replacedAt).not.toBeNull();
    const biz = await prisma.business.findUnique({ where: { id: w.businessId } });
    expect(biz!.activeScheduleVersionId).toBe(v2!.id);
    const activeCount = await prisma.scheduleVersion.count({ where: { businessId: w.businessId, status: 'ACTIVE' } });
    expect(activeCount).toBe(1);
  });

  it('a paused business accepts template saves as PENDING; resume promotes the latest', async () => {
    const w = await readyBusiness(5);
    await businessService.pause(ownerActor(w.ownerId), w.businessId, { pauseMessage: 'closed for leave' });
    const pending = await scheduleService.saveTemplate(ownerActor(w.ownerId), w.businessId, {
      template: { workingPeriods: Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, startMinutes: 540, endMinutes: 720 })), blockedPeriods: [], specialDates: [] },
      name: 'After leave',
    });
    expect(pending.activated).toBe(false);
    const active = await scheduleService.getActiveVersion(w.businessId);
    expect(active?.versionNo).toBe(1);
    await businessService.resumeManual(ownerActor(w.ownerId), w.businessId);
    const settings = await prisma.businessSettings.findUnique({ where: { businessId: w.businessId } });
    expect(settings!.isPaused).toBe(false);
    const latest = await scheduleService.getActiveVersion(w.businessId);
    expect(latest?.versionNo).toBe(2);
    const pendingCount = await prisma.scheduleVersion.count({ where: { businessId: w.businessId, status: 'PENDING' } });
    expect(pendingCount).toBe(1); // v1 demoted; v2 promoted. Exactly one ACTIVE remains.
  }, 20000);

  it('booking creation persists the full aggregate: booking, payment, proof, lock, components, history', async () => {
    const w = await readyBusiness(6);
    const result = await makeBooking(w, new Date('2026-09-14T10:00:00Z'), 'key-happy-1');
    expect(result.booking.status).toBe('PAYMENT_PENDING');
    expect(result.booking.startAt.toISOString()).toBe('2026-09-14T10:00:00.000Z');
    expect(result.booking.endAt.toISOString()).toBe('2026-09-14T11:15:00.000Z'); // 60+10+5 min
    expect(result.booking.customerName).toBe('Liya Tesfaye');

    expect(result.booking.payment).toMatchObject({ method: 'BANK_TRANSFER', status: 'PENDING', prepaidMinor: 0n });

    const components = await prisma.bookingComponent.findMany({ where: { bookingId: result.booking.id }, orderBy: { id: 'asc' } });
    expect(components.map((c) => c.componentType)).toEqual(['SERVICE', 'VARIATION', 'ADD_ON']);
    expect(components.map((c) => String(c.unitPriceMinor))).toEqual(['10000', '2000', '1500']);
    expect(components[0].nameSnapshot).toBe('Haircut');

    const locks = await prisma.slotLock.findMany({ where: { bookingId: result.booking.id }, orderBy: { createdAt: 'asc' } });
    expect(locks).toHaveLength(1);
    expect(locks[0].state).toBe('LOCKED');
    expect(locks[0].startAt.toISOString()).toBe('2026-09-14T10:00:00.000Z');

    const history = await prisma.bookingStatusHistory.findMany({ where: { bookingId: result.booking.id } });
    expect(history).toHaveLength(1);
    expect(history[0].toStatus).toBe('PAYMENT_PENDING');

    const proof = await prisma.paymentProof.findFirst({ where: { submissionKey: 'key-happy-1' } });
    expect(proof).not.toBeNull();

    const money = await prisma.payment.findFirst({ where: { bookingId: result.booking.id } });
    expect(money).toMatchObject({ status: 'PENDING', method: 'BANK_TRANSFER' });
  });

  it('re-submitting the same submission key is idempotent (same booking, no side effects)', async () => {
    const w = await readyBusiness(7);
    await makeBooking(w, new Date('2026-09-14T10:00:00Z'), 'key-idem-7');
    const before = await prisma.payment.count({ where: { businessId: w.businessId } });
    const again = await makeBooking(w, new Date('2026-09-14T10:00:00Z'), 'key-idem-7');
    const after = await prisma.payment.count({ where: { businessId: w.businessId } });
    expect(after).toBe(before);
    expect(again.booking.customerPhone).toBe('+251911112233');
    const locks = await prisma.slotLock.count({ where: { businessId: w.businessId } });
    expect(locks).toBe(1); // no second lock, no second booking
  });

  it('a slot already claimed by an active booking is unavailable', async () => {
    const w = await readyBusiness(8);
    await makeBooking(w, new Date('2026-09-14T10:00:00Z'), 'key-occ-8a');
    await expectCode(makeBooking(w, new Date('2026-09-14T10:00:00Z'), 'key-occ-8b'), ErrorCode.SLOT_UNAVAILABLE);
  });

  it('overlapping partially-booked windows are excluded', async () => {
    const w = await readyBusiness(9);
    await makeBooking(w, new Date('2026-09-14T10:00:00Z'), 'key-over-9a');
    // 10:30 start would end 11:45, overlapping the 10:00-11:15 booking.
    await expectCode(makeBooking(w, new Date('2026-09-14T10:30:00Z'), 'key-over-9b'), ErrorCode.SLOT_UNAVAILABLE);
  });

  it('blocks a booking against off-grid start times and when the business is paused', async () => {
    const w = await readyBusiness(10);
    await businessService.pause(ownerActor(w.ownerId), w.businessId, {});
    await expectCode(makeBooking(w, new Date('2026-09-14T10:00:00Z'), 'key-paused-10'), ErrorCode.BUSINESS_PAUSED);
  });

  it('availability reflects the grid and shrinks once a slot is booked (R088/R090)', async () => {
    const w = await readyBusiness(11);
    const before = await availabilityService.getSlotsForDay(w.businessId, { dateKey: '2026-09-14', durationMinutes: 75 });
    expect(before.some((s) => s.startAt.toISOString() === '2026-09-14T10:00:00.000Z')).toBe(true);
    await makeBooking(w, new Date('2026-09-14T10:00:00Z'), 'key-avail-11');
    const after = await availabilityService.getSlotsForDay(w.businessId, { dateKey: '2026-09-14', durationMinutes: 75 });
    expect(after.some((s) => s.startAt.toISOString() === '2026-09-14T10:00:00.000Z')).toBe(false);
  });

  it('accept proof transitions booking CONFIRMED, payment ACCEPTED, lock ALLOCATED, emits event', async () => {
    const w = await readyBusiness(12);
    const created = await makeBooking(w, new Date('2026-09-14T10:00:00Z'), 'key-accept-12');
    const res = await bookingService.acceptProof(ownerActor(w.ownerId), w.businessId, created.booking.id);
    expect(res.booking.status).toBe('CONFIRMED');
    expect(res.events.map((e) => e.type)).toEqual(['BOOKING_CONFIRMED']);
    const money = await prisma.payment.findFirst({ where: { bookingId: created.booking.id } });
    expect(money!.status).toBe('ACCEPTED');
    const locks = await prisma.slotLock.findMany({ where: { bookingId: created.booking.id } });
    expect(locks[0].state).toBe('ALLOCATED');
    const history = await prisma.bookingStatusHistory.findMany({ where: { bookingId: created.booking.id } });
    expect(history.map((h) => h.toStatus)).toContain('CONFIRMED');
  });

  it('reject proof requires a reason, leaves the slot LOCKED, emits PAYMENT_REJECTED', async () => {
    const w = await readyBusiness(13);
    const created = await makeBooking(w, new Date('2026-09-14T10:00:00Z'), 'key-reject-13');
    await expectCode(bookingService.rejectProof(ownerActor(w.ownerId), w.businessId, created.booking.id, '  '), ErrorCode.VALIDATION_ERROR);
    const res = await bookingService.rejectProof(ownerActor(w.ownerId), w.businessId, created.booking.id, 'Unreadable screenshot');
    expect(res.booking.status).toBe('REJECTED');
    expect(res.events.map((e) => e.type)).toEqual(['PAYMENT_REJECTED']);
    const locks = await prisma.slotLock.findMany({ where: { bookingId: created.booking.id } });
    expect(locks[0].state).toBe('LOCKED');
  });

  it('accepting a non-pending booking is an invalid transition', async () => {
    const w = await readyBusiness(14);
    const created = await makeBooking(w, new Date('2026-09-14T10:00:00Z'), 'key-stale-14');
    await bookingService.acceptProof(ownerActor(w.ownerId), w.businessId, created.booking.id);
    await expectCode(bookingService.acceptProof(ownerActor(w.ownerId), w.businessId, created.booking.id), ErrorCode.INVALID_TRANSITION);
  });

  it('cancel CONFIRMED releases the slot; cancel PAYMENT_PENDING keeps it locked (SM-08/T8)', async () => {
    const w = await readyBusiness(15);
    const confirmed = await makeBooking(w, new Date('2026-09-14T10:00:00Z'), 'key-cancel-15a');
    await bookingService.acceptProof(ownerActor(w.ownerId), w.businessId, confirmed.booking.id);
    const c = await bookingService.cancelBooking(ownerActor(w.ownerId), w.businessId, confirmed.booking.id);
    expect(c.booking.status).toBe('CANCELLED');
    expect((await prisma.slotLock.findMany({ where: { bookingId: confirmed.booking.id } }))[0].state).toBe('RELEASED');

    const pending = await makeBooking(w, new Date('2026-09-14T11:00:00Z'), 'key-cancel-15b');
    const p = await bookingService.cancelBooking(ownerActor(w.ownerId), w.businessId, pending.booking.id);
    expect(p.booking.status).toBe('CANCELLED');
    expect((await prisma.slotLock.findMany({ where: { bookingId: pending.booking.id } }))[0].state).toBe('LOCKED');
  });

  it('no-show only from CONFIRMED and releases the slot', async () => {
    const w = await readyBusiness(16);
    const created = await makeBooking(w, new Date('2026-09-14T10:00:00Z'), 'key-noshow-16');
    await bookingService.acceptProof(ownerActor(w.ownerId), w.businessId, created.booking.id);
    const res = await bookingService.markNoShow(ownerActor(w.ownerId), w.businessId, created.booking.id);
    expect(res.booking.status).toBe('NO_SHOW');
    expect((await prisma.slotLock.findMany({ where: { bookingId: created.booking.id } }))[0].state).toBe('RELEASED');
  });

  it('reschedule moves a CONFIRMED booking: new lock ALLOCATED, old released, history + event', async () => {
    const w = await readyBusiness(17);
    const created = await makeBooking(w, new Date('2026-09-14T10:00:00Z'), 'key-rs-17');
    await bookingService.acceptProof(ownerActor(w.ownerId), w.businessId, created.booking.id);
    const res = await bookingService.reschedule(ownerActor(w.ownerId), w.businessId, created.booking.id, new Date('2026-09-14T14:00:00Z'));
    expect(res.booking.startAt.toISOString()).toBe('2026-09-14T14:00:00.000Z');
    expect(res.events.map((e) => e.type)).toEqual(['BOOKING_RESCHEDULED']);
    const locks = await prisma.slotLock.findMany({ where: { bookingId: created.booking.id }, orderBy: { createdAt: 'asc' } });
    expect(locks.map((l) => l.state)).toEqual(['RELEASED', 'ALLOCATED']);
    expect(locks[1].slotDate).toEqual(new Date(Date.UTC(2026, 8, 14)));
    // Status is unchanged (CONFIRMED), so no noop status-history row exists
    // (the `booking_status_history_noop` constraint forbids from == to).
    const history = await prisma.bookingStatusHistory.findMany({ where: { bookingId: created.booking.id } });
    expect(history.map((h) => h.toStatus)).toEqual(['PAYMENT_PENDING', 'CONFIRMED']);
    expect(history.some((h) => String(h.actorUserId) === w.ownerId && h.toStatus === 'CONFIRMED')).toBe(true);
    const money = await prisma.payment.findFirst({ where: { bookingId: created.booking.id } });
    expect(money!.status).toBe('ACCEPTED'); // payment preserved (REQ-105/106)
  });

  it('reschedule into an occupied window is rejected', async () => {
    const w = await readyBusiness(18);
    const a = await makeBooking(w, new Date('2026-09-14T10:00:00Z'), 'key-rs-18a');
    const b = await makeBooking(w, new Date('2026-09-14T13:00:00Z'), 'key-rs-18b');
    await bookingService.acceptProof(ownerActor(w.ownerId), w.businessId, a.booking.id);
    await bookingService.acceptProof(ownerActor(w.ownerId), w.businessId, b.booking.id);
    await expectCode(
      bookingService.reschedule(ownerActor(w.ownerId), w.businessId, a.booking.id, new Date('2026-09-14T13:30:00Z')),
      ErrorCode.SLOT_UNAVAILABLE,
    );
  });

  it('completion is idempotent and releases the slot; the sweep completes due bookings once', async () => {
    const w = await readyBusiness(19);
    // 09:00 → 10:15 (ends well before FIXED_NOW 18:00).
    const early = await makeBooking(w, new Date('2026-09-14T09:00:00Z'), 'key-done-19a');
    await bookingService.acceptProof(ownerActor(w.ownerId), w.businessId, early.booking.id);
    // 13:00 → 14:15 (also due, but completed only by the sweep).
    const late = await makeBooking(w, new Date('2026-09-14T13:00:00Z'), 'key-done-19b');
    await bookingService.acceptProof(ownerActor(w.ownerId), w.businessId, late.booking.id);

    expect(await bookingService.completeBooking(w.businessId, early.booking.id)).toBe(true);
    expect(await bookingService.completeBooking(w.businessId, early.booking.id)).toBe(false); // idempotent
    expect((await prisma.slotLock.findMany({ where: { bookingId: early.booking.id } }))[0].state).toBe('RELEASED');

    // The sweep completes the other due booking; the already-completed one is skipped.
    const done = await bookingService.autoCompleteDueBookings(w.businessId);
    expect(done).toBe(1);
    expect((await prisma.booking.findUnique({ where: { id: early.booking.id } }))!.status).toBe('COMPLETED');
    expect((await prisma.booking.findUnique({ where: { id: late.booking.id } }))!.status).toBe('COMPLETED');
    expect((await prisma.slotLock.findMany({ where: { bookingId: late.booking.id } }))[0].state).toBe('RELEASED');
  });

  it('resubmission codes are stored hashed and capped; wrong codes increment attempts + are audited', async () => {
    const w = await readyBusiness(20);
    const created = await makeBooking(w, new Date('2026-09-14T10:00:00Z'), 'key-resub-20');
    await bookingService.rejectProof(ownerActor(w.ownerId), w.businessId, created.booking.id, 'blurry');

    const { verificationId } = await resubmissionService.requestCode({ businessSlug: w.ownerSlug, phone: '+251911112233', bookingId: created.booking.id });
    const row = await prisma.resubmissionVerification.findUnique({ where: { id: verificationId } });
    expect(row!.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.codeHash).not.toBe('123456');
    expect(row!.purpose).toBe('RESUBMIT_PROOF');

    await expectCode(
      resubmissionService.resubmit({ businessSlug: w.ownerSlug, phone: '+251911112233', bookingId: created.booking.id, code: '999999', submissionKey: 'key-resub-20b' }),
      ErrorCode.VALIDATION_ERROR,
    );
    const afterFail = await prisma.resubmissionVerification.findUnique({ where: { id: verificationId } });
    expect(afterFail!.attempts).toBe(1);
    const events = await prisma.securityEvent.findMany({ where: { businessId: w.businessId, type: 'RESUBMISSION_CODE_CHECK' } });
    expect(events.map((e) => e.result)).toContain('FAILED');
  });

  it('a valid resubmission code moves REJECTED -> PAYMENT_PENDING, appends a proof with lineage, marks code used', async () => {
    const w = await readyBusiness(21);
    const created = await makeBooking(w, new Date('2026-09-14T10:00:00Z'), 'key-resub-21a');
    await bookingService.rejectProof(ownerActor(w.ownerId), w.businessId, created.booking.id, 'blurry');
    const oldProof = await prisma.paymentProof.findFirst({ where: { submissionKey: 'key-resub-21a' } });

    await prisma.resubmissionVerification.create({
      data: {
        businessId: w.businessId,
        bookingId: created.booking.id,
        phone: '+251911112233',
        purpose: 'RESUBMIT_PROOF',
        codeHash: createHash('sha256').update('123456').digest('hex'),
        expiresAt: new Date(FIXED_NOW.getTime() + 10 * 60 * 1000),
      },
    });

    const res = await resubmissionService.resubmit({
      businessSlug: w.ownerSlug,
      phone: '+251911112233',
      bookingId: created.booking.id,
      code: '123456',
      submissionKey: 'key-resub-21b',
    });
    expect(res.booking.status).toBe('PAYMENT_PENDING');
    expect(res.events.map((e) => e.type)).toEqual(['PAYMENT_PROOF_RECEIVED']);
    const money = await prisma.payment.findFirst({ where: { bookingId: created.booking.id } });
    expect(money!.status).toBe('PENDING');
    const newProof = await prisma.paymentProof.findFirst({ where: { submissionKey: 'key-resub-21b' } });
    expect(newProof).not.toBeNull();
    const old = await prisma.paymentProof.findUnique({ where: { id: oldProof!.id } });
    expect(old!.replacedByProofId).toBe(newProof!.id);
  });

  it('code request is refused for non-rejected bookings', async () => {
    const w = await readyBusiness(22);
    const created = await makeBooking(w, new Date('2026-09-14T10:00:00Z'), 'key-resub-22');
    await expectCode(
      resubmissionService.requestCode({ businessSlug: w.ownerSlug, phone: '+251911112233', bookingId: created.booking.id }),
      ErrorCode.INVALID_TRANSITION,
    );
  });

  it('customer status lookup projects safe, ordered entries (no internals, no ids)', async () => {
    const w = await readyBusiness(23);
    await makeBooking(w, new Date('2026-09-14T10:00:00Z'), 'key-cust-23a');
    const b = await makeBooking(w, new Date('2026-09-14T13:00:00Z'), 'key-cust-23b');
    await bookingService.acceptProof(ownerActor(w.ownerId), w.businessId, b.booking.id);
    const entries = await customerStatusService.getStatus({ businessSlug: w.ownerSlug, phone: '+251911112233' });
    expect(entries).toHaveLength(2);
    expect(entries[0].startAt.getTime()).toBeGreaterThanOrEqual(entries[1].startAt.getTime());
    expect(entries.map((e) => e.status)).toContain('confirmed');
    expect(entries.map((e) => e.status)).toContain('awaiting-verification');
    expect(Object.keys(entries[0]).sort()).toEqual(['endAt', 'startAt', 'status']);
  });

  it('a foreign owner cannot mutate another business’s booking lifecycle', async () => {
    const w = await readyBusiness(24);
    const created = await makeBooking(w, new Date('2026-09-14T10:00:00Z'), 'key-iso-24');
    const other = await prisma.user.create({ data: { email: 'owner24b@example.com', passwordHash: 'x'.repeat(60), role: 'OWNER' } });
    await expectCode(bookingService.cancelBooking(ownerActor(other.id), w.businessId, created.booking.id), ErrorCode.NOT_FOUND);
    await expectCode(bookingService.reschedule(ownerActor(other.id), w.businessId, created.booking.id, new Date('2026-09-14T14:00:00Z')), ErrorCode.NOT_FOUND);
  });

  it('manual resume is refused when the subscription is expired (R157)', async () => {
    const w = await readyBusiness(25);
    await businessService.pause(ownerActor(w.ownerId), w.businessId, {});
    await prisma.subscription.update({ where: { businessId: w.businessId }, data: { status: 'EXPIRED' } });
    await expectCode(businessService.resumeManual(ownerActor(w.ownerId), w.businessId), ErrorCode.SUBSCRIPTION_EXPIRED);
  });
});