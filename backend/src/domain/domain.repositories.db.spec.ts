import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaBusinessRepository } from './repositories/prisma-business.repository';
import { PrismaBookingRepository } from './repositories/prisma-booking.repository';
import { PrismaScheduleRepository } from './repositories/prisma-schedule.repository';

const TEST_URL = process.env.TEST_DATABASE_URL;
const RUN = process.env.RUN_DB_TESTS === 'true' && Boolean(TEST_URL);

let prisma: PrismaClient = null as unknown as PrismaClient;

const businessRepo = () => new PrismaBusinessRepository(prisma);
const bookingRepo = () => new PrismaBookingRepository(prisma);
const scheduleRepo = () => new PrismaScheduleRepository(prisma);

// ---------------------------------------------------------------------------
// Seeding / cleanup helpers (test database only — never the dev database)
// ---------------------------------------------------------------------------

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
  await seedCategories();
}

async function seedCategories(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "business_category" ("code", "label") VALUES ('SALON_AND_BARBER', 'Salon & Barber'), ('OTHER', 'Other') ON CONFLICT DO NOTHING`,
  );
}

async function createUser(email: string): Promise<string> {
  const user = await prisma.user.create({
    data: { email, passwordHash: 'x'.repeat(60), role: 'OWNER' },
  });
  return user.id;
}

beforeAll(async () => {
  if (RUN) {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL! } } });
    await resetDatabase();
  }
});

afterAll(async () => {
  if (RUN) {
    await resetDatabase();
    await prisma.$disconnect();
  }
});

describe.skipIf(!RUN)('domain repositories + schema invariants (live PostgreSQL 16)', () => {
  it('base tables and enums exist after the migration', async () => {
    const tables = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM information_schema.tables WHERE table_schema = 'public'
    `;
    expect(Number(tables[0].n)).toBeGreaterThanOrEqual(30);
    const enums = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typtype = 'e'
    `;
    expect(Number(enums[0].n)).toBeGreaterThanOrEqual(15);
  });

  it('defense-in-depth partial indexes are present (doc 07 §3)', async () => {
    const slotLock = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_slot_lock_active'
    `;
    expect(slotLock).toHaveLength(1);
    expect(slotLock[0].indexdef).toContain('LOCKED');
    expect(slotLock[0].indexdef).toContain('ALLOCATED');
    const activeVersion = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_active_schedule_version'
    `;
    expect(activeVersion).toHaveLength(1);
  });

  it('app role can perform DML on the domain tables (grants present)', async () => {
    const ownerId = await createUser('grants.owner@example.com');
    const biz = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'grants-business',
        categoryCode: 'SALON_AND_BARBER',
        name: 'Grants Business',
        ownerId,
        bookingIntervalMinutes: 30,
      }),
    );
    expect(biz.publicSlug).toBe('grants-business');
  });

  it('global unique public slug (REQ-047) is enforced case-insensitively', async () => {
    const ownerId = await createUser('slug.owner@example.com');
    const args = {
      publicSlug: 'slug-acme',
      categoryCode: 'SALON_AND_BARBER',
      name: 'Acme',
      ownerId,
      bookingIntervalMinutes: 30,
    };
    await prisma.$transaction((tx) => businessRepo().createForOwner(tx, args));
    await expect(
      prisma.$transaction((tx) =>
        businessRepo().createForOwner(tx, { ...args, publicSlug: 'SLUG-ACME' }),
      ),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('slug/email uniqueness relies on lowercase storage (CHECK constraint)', async () => {
    await expect(
      prisma.business.create({
        data: {
          publicSlug: 'MixedCaseSlug',
          categoryCode: 'OTHER',
          name: 'Mixed',
          settings: { create: { bookingIntervalMins: 30 } },
        },
      }),
    ).rejects.toThrow(/business_public_slug_lowercase/);
    await expect(
      prisma.user.create({
        data: { email: 'Mixed@Case.com', passwordHash: 'x'.repeat(60) },
      }),
    ).rejects.toThrow(/user_email_lowercase/);
  });

  it('a business is owned by one owner and an owner may manage several businesses (REQ-011/012/013)', async () => {
    const ownerId = await createUser('multi.owner@example.com');
    const first = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'multi-one',
        categoryCode: 'OTHER',
        name: 'One',
        ownerId,
        bookingIntervalMinutes: 30,
      }),
    );
    const second = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'multi-two',
        categoryCode: 'OTHER',
        name: 'Two',
        ownerId,
        bookingIntervalMinutes: 60,
      }),
    );
    expect(second.publicSlug).toBe('multi-two');
    const bySlug = await businessRepo().findBySlug('MULTI-ONE');
    expect(bySlug?.id).toBe(first.id);
    expect(bySlug?.owners.map((o) => o.userId)).toContain(ownerId);
    const owned = await businessRepo().listByOwner(ownerId);
    expect(owned.map((b) => b.publicSlug).sort()).toEqual(['multi-one', 'multi-two']);
  });

  it('booking aggregate persists atomically: components + history + payment + proof + LOCKED slot (REQ-076/100/121/173)', async () => {
    const ownerId = await createUser('booking.owner@example.com');
    const biz = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'booking-agg',
        categoryCode: 'SALON_AND_BARBER',
        name: 'Aggregate',
        ownerId,
        bookingIntervalMinutes: 30,
      }),
    );
    const startAt = new Date('2026-10-01T09:00:00.000Z');
    const endAt = new Date('2026-10-01T09:30:00.000Z');
    const booking = await prisma.$transaction((tx) =>
      bookingRepo().createBooking(tx, {
        businessId: biz.id,
        customerName: 'Ada',
        customerPhone: '+251911000001',
        note: 'first visit',
        startAt,
        endAt,
        paymentMethod: 'BANK_TRANSFER',
        prepaidMinor: 35000n,
        submissionKey: `submission-${biz.id}`,
        components: [
          {
            serviceId: null,
            componentType: 'SERVICE',
            nameSnapshot: 'Haircut',
            unitPriceMinor: 35000n,
            durationMinutes: 30,
          },
        ],
      }),
    );
    expect(booking.status).toBe('PAYMENT_PENDING');

    const full = await bookingRepo().findById(biz.id, booking.id);
    expect(full).not.toBeNull();
    expect(full!.components).toHaveLength(1);
    expect(full!.components[0].nameSnapshot).toBe('Haircut');
    expect(full!.payment?.status).toBe('PENDING');
    expect(full!.payment?.method).toBe('BANK_TRANSFER');
    expect(full!.payment?.prepaidMinor).toBe(35000n);

    const history = await prisma.bookingStatusHistory.findMany({
      where: { bookingId: booking.id },
      orderBy: { id: 'asc' },
    });
    expect(history).toHaveLength(1);
    expect(history[0].fromStatus).toBeNull();
    expect(history[0].toStatus).toBe('PAYMENT_PENDING');

    const lock = await prisma.slotLock.findFirst({ where: { bookingId: booking.id } });
    expect(lock?.state).toBe('LOCKED');
    expect(lock?.releasedAt).toBeNull();
    expect(lock?.startAt.getTime()).toBe(startAt.getTime());

    const proof = await prisma.paymentProof.findFirst({ where: { payment: { bookingId: booking.id } } });
    expect(proof?.submissionKey).toBe(`submission-${biz.id}`);
  });

  it('booking id is an integer primary key (internal Booking ID, REQ-109/190)', async () => {
    const ownerId = await createUser('booking-id.owner@example.com');
    const biz = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'booking-id',
        categoryCode: 'OTHER',
        name: 'Ids',
        ownerId,
        bookingIntervalMinutes: 15,
      }),
    );
    const dates: [Date, Date][] = [
      [new Date('2026-11-02T08:00:00.000Z'), new Date('2026-11-02T08:15:00.000Z')],
      [new Date('2026-11-02T09:00:00.000Z'), new Date('2026-11-02T09:15:00.000Z')],
      [new Date('2026-11-02T10:00:00.000Z'), new Date('2026-11-02T10:15:00.000Z')],
    ];
    const created: number[] = [];
    for (const [s, e] of dates) {
      const b = await prisma.$transaction((tx) =>
        bookingRepo().createBooking(tx, {
          businessId: biz.id,
          customerName: 'C',
          customerPhone: '+251911000002',
          startAt: s,
          endAt: e,
          paymentMethod: 'TELEBIRR_MOBILE_MONEY',
          prepaidMinor: 100n,
          submissionKey: `booking-id-${crypto.randomUUID()}`,
          components: [],
        }),
      );
      created.push(b.id);
    }
    expect(Number.isInteger(created[0])).toBe(true);
    expect(created[1]).toBeGreaterThan(created[0]);
    expect(created[2]).toBeGreaterThan(created[1]);
  });

  it('one payment per booking (unique booking_id)', async () => {
    const ownerId = await createUser('payment.owner@example.com');
    const biz = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'payment-one',
        categoryCode: 'OTHER',
        name: 'Pay',
        ownerId,
        bookingIntervalMinutes: 15,
      }),
    );
    const booking = await prisma.$transaction((tx) =>
      bookingRepo().createBooking(tx, {
        businessId: biz.id,
        customerName: 'C',
        customerPhone: '+251911000003',
        startAt: new Date('2026-11-03T08:00:00.000Z'),
        endAt: new Date('2026-11-03T08:15:00.000Z'),
        paymentMethod: 'BANK_TRANSFER',
        prepaidMinor: 1000n,
        submissionKey: `payment-one-${crypto.randomUUID()}`,
        components: [],
      }),
    );
    await expect(
      prisma.payment.create({
        data: {
          businessId: biz.id,
          bookingId: booking.id,
          status: 'PENDING',
          method: 'BANK_TRANSFER',
          prepaidMinor: 1000n,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('component snapshots are immutable copies — later service edits do not affect bookings (REQ-076/080)', async () => {
    const ownerId = await createUser('snapshot.owner@example.com');
    const biz = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'snapshot',
        categoryCode: 'SALON_AND_BARBER',
        name: 'Snap',
        ownerId,
        bookingIntervalMinutes: 30,
      }),
    );
    const service = await prisma.service.create({
      data: { businessId: biz.id, name: 'Haircut', basePriceMinor: 20000n, baseDurationMinutes: 30 },
    });
    const booking = await prisma.$transaction((tx) =>
      bookingRepo().createBooking(tx, {
        businessId: biz.id,
        customerName: 'C',
        customerPhone: '+251911000004',
        startAt: new Date('2026-11-04T08:00:00.000Z'),
        endAt: new Date('2026-11-04T08:30:00.000Z'),
        paymentMethod: 'BANK_TRANSFER',
        prepaidMinor: 20000n,
        submissionKey: `snapshot-${crypto.randomUUID()}`,
        components: [
          {
            serviceId: service.id,
            componentType: 'SERVICE',
            nameSnapshot: 'Haircut',
            unitPriceMinor: 20000n,
            durationMinutes: 30,
          },
        ],
      }),
    );
    await prisma.service.update({
      where: { id: service.id },
      data: { basePriceMinor: 50000n, baseDurationMinutes: 45 },
    });
    const reloaded = await bookingRepo().findById(biz.id, booking.id);
    expect(reloaded?.components[0].unitPriceMinor).toBe(20000n);
    expect(reloaded?.components[0].durationMinutes).toBe(30);
    expect(reloaded?.payment?.prepaidMinor).toBe(20000n);
  });

  it('status history is append-only and records prior/current state + actor (REQ-173)', async () => {
    const ownerId = await createUser('history.owner@example.com');
    const biz = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'history',
        categoryCode: 'OTHER',
        name: 'Hist',
        ownerId,
        bookingIntervalMinutes: 30,
      }),
    );
    const booking = await prisma.$transaction((tx) =>
      bookingRepo().createBooking(tx, {
        businessId: biz.id,
        customerName: 'C',
        customerPhone: '+251911000005',
        startAt: new Date('2026-11-05T08:00:00.000Z'),
        endAt: new Date('2026-11-05T08:30:00.000Z'),
        paymentMethod: 'BANK_TRANSFER',
        prepaidMinor: 100n,
        submissionKey: `history-${crypto.randomUUID()}`,
        components: [],
      }),
    );
    await prisma.$transaction(async (tx) => {
      await bookingRepo().appendStatusHistory(tx, {
        bookingId: booking.id,
        businessId: biz.id,
        fromStatus: 'PAYMENT_PENDING',
        toStatus: 'CONFIRMED',
        actorType: 'OWNER',
        actorUserId: ownerId,
      });
      await bookingRepo().appendStatusHistory(tx, {
        bookingId: booking.id,
        businessId: biz.id,
        fromStatus: 'CONFIRMED',
        toStatus: 'COMPLETED',
        actorType: 'SYSTEM',
      });
    });
    const history = await prisma.bookingStatusHistory.findMany({
      where: { bookingId: booking.id },
      orderBy: { id: 'asc' },
    });
    expect(history.map((h) => h.toStatus)).toEqual(['PAYMENT_PENDING', 'CONFIRMED', 'COMPLETED']);
    expect(history[1].fromStatus).toBe('PAYMENT_PENDING');
    expect(history[1].actorType).toBe('OWNER');
    expect(history[1].actorUserId).toBe(ownerId);
    expect(history[0].occurredAt).toBeInstanceOf(Date);
  });

  it('booking status and payment status are stored separately (REQ-100)', async () => {
    const ownerId = await createUser('separate.owner@example.com');
    const biz = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'separate',
        categoryCode: 'OTHER',
        name: 'Sep',
        ownerId,
        bookingIntervalMinutes: 15,
      }),
    );
    const booking = await prisma.$transaction((tx) =>
      bookingRepo().createBooking(tx, {
        businessId: biz.id,
        customerName: 'C',
        customerPhone: '+251911000006',
        startAt: new Date('2026-11-06T08:00:00.000Z'),
        endAt: new Date('2026-11-06T08:15:00.000Z'),
        paymentMethod: 'BANK_TRANSFER',
        prepaidMinor: 100n,
        submissionKey: `separate-${crypto.randomUUID()}`,
        components: [],
      }),
    );
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CONFIRMED' } });
    const pay = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    await prisma.payment.update({ where: { id: pay.id }, data: { status: 'ACCEPTED' } });
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    const payAfter = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(after.status).toBe('CONFIRMED');
    expect(payAfter.status).toBe('ACCEPTED');
  });

  it('partial unique index allows only one active slot claim per exact identity and release re-opens it (REQ-121, no auto-TTL)', async () => {
    const ownerId = await createUser('slot.owner@example.com');
    const biz = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'slot-unique',
        categoryCode: 'OTHER',
        name: 'Slot',
        ownerId,
        bookingIntervalMinutes: 15,
      }),
    );
    const slotDate = new Date('2026-11-07T00:00:00.000Z');
    const startAt = new Date('2026-11-07T08:00:00.000Z');
    const endAt = new Date('2026-11-07T08:15:00.000Z');
    await prisma.slotLock.create({
      data: { businessId: biz.id, slotDate, startAt, endAt, state: 'LOCKED' },
    });
    await expect(
      prisma.slotLock.create({
        data: { businessId: biz.id, slotDate, startAt, endAt, state: 'ALLOCATED' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await prisma.slotLock.create({
      data: {
        businessId: biz.id,
        slotDate,
        startAt: new Date('2026-11-07T09:00:00.000Z'),
        endAt: new Date('2026-11-07T09:15:00.000Z'),
        state: 'LOCKED',
      },
    });
    const released = await prisma.slotLock.create({
      data: {
        businessId: biz.id,
        slotDate,
        startAt,
        endAt,
        state: 'RELEASED',
        releasedAt: new Date('2026-11-07T12:00:00.000Z'),
      },
    });
    expect(released.state).toBe('RELEASED');
  });

  it('slot lock release correlation is DB-enforced (RELEASED requires released_at)', async () => {
    const ownerId = await createUser('lock-check.owner@example.com');
    const biz = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'lock-check',
        categoryCode: 'OTHER',
        name: 'Lock',
        ownerId,
        bookingIntervalMinutes: 15,
      }),
    );
    await expect(
      prisma.slotLock.create({
        data: {
          businessId: biz.id,
          slotDate: new Date('2026-11-08T00:00:00.000Z'),
          startAt: new Date('2026-11-08T08:00:00.000Z'),
          endAt: new Date('2026-11-08T08:15:00.000Z'),
          state: 'RELEASED',
        },
      }),
    ).rejects.toThrow(/slot_lock_released_correlation/);
  });

  it('at most one ACTIVE schedule version per business; many PENDING allowed (doc 07 §2)', async () => {
    const ownerId = await createUser('schedule.owner@example.com');
    const biz = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'schedule-version',
        categoryCode: 'OTHER',
        name: 'Sched',
        ownerId,
        bookingIntervalMinutes: 30,
      }),
    );
    const template = {
      workingPeriods: [
        { weekday: 1, startMinutes: 8 * 60, endMinutes: 17 * 60 },
        { weekday: 2, startMinutes: 8 * 60, endMinutes: 17 * 60 },
      ],
      blockedPeriods: [],
      specialDates: [],
    };
    const v1 = await prisma.$transaction((tx) =>
      scheduleRepo().createPendingVersion(tx, {
        businessId: biz.id,
        versionNo: 1,
        name: 'v1',
        template,
      }),
    );
    const v2 = await prisma.$transaction((tx) =>
      scheduleRepo().createPendingVersion(tx, {
        businessId: biz.id,
        versionNo: 2,
        name: 'v2',
        template,
      }),
    );
    expect(v1.status).toBe('PENDING');
    expect(v2.status).toBe('PENDING');
    await prisma.$transaction((tx) =>
      scheduleRepo().applyVersion(tx, {
        versionId: v1.id,
        businessId: biz.id,
        appliedBy: ownerId,
        reason: 'initial',
      }),
    );
    await expect(
      prisma.$transaction((tx) =>
        scheduleRepo().applyVersion(tx, {
          versionId: v2.id,
          businessId: biz.id,
          appliedBy: ownerId,
        }),
      ),
    ).rejects.toMatchObject({ code: 'P2002' });

    const active = await scheduleRepo().getActiveVersion(biz.id);
    expect(active?.id).toBe(v1.id);
    expect(active?.workingPeriods).toHaveLength(2);
  });

  it('schedule template relations are version-scoped and validated (weekday/hours bounds)', async () => {
    const ownerId = await createUser('schedule-valid.owner@example.com');
    const biz = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'schedule-valid',
        categoryCode: 'OTHER',
        name: 'Valid',
        ownerId,
        bookingIntervalMinutes: 30,
      }),
    );
    await expect(
      prisma.$transaction((tx) =>
        scheduleRepo().createPendingVersion(tx, {
          businessId: biz.id,
          versionNo: 1,
          name: 'bad',
          template: {
            workingPeriods: [{ weekday: 9, startMinutes: 0, endMinutes: 60 }],
            blockedPeriods: [],
            specialDates: [],
          },
        }),
      ),
    ).rejects.toThrow(/working_period_weekday_range/);
    await expect(
      prisma.$transaction((tx) =>
        scheduleRepo().createPendingVersion(tx, {
          businessId: biz.id,
          versionNo: 2,
          name: 'bad-hours',
          template: {
            workingPeriods: [{ weekday: 1, startMinutes: 60, endMinutes: 30 }],
            blockedPeriods: [],
            specialDates: [],
          },
        }),
      ),
    ).rejects.toThrow(/working_period_minutes_bounds/);
    await expect(
      prisma.$transaction((tx) =>
        scheduleRepo().createPendingVersion(tx, {
          businessId: biz.id,
          versionNo: 3,
          name: 'bad-special',
          template: {
            workingPeriods: [],
            blockedPeriods: [],
            specialDates: [
              { date: new Date('2026-12-01T00:00:00.000Z'), kind: 'CLOSED', startMinutes: 100, endMinutes: 50 },
            ],
          },
        }),
      ),
    ).rejects.toThrow(/special_date_minutes_bounds/);
  });

  it('special dates are unique per version and date', async () => {
    const ownerId = await createUser('special.owner@example.com');
    const biz = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'special-date',
        categoryCode: 'OTHER',
        name: 'Special',
        ownerId,
        bookingIntervalMinutes: 30,
      }),
    );
    const day = new Date('2026-12-25T00:00:00.000Z');
    await prisma.$transaction((tx) =>
      scheduleRepo().createPendingVersion(tx, {
        businessId: biz.id,
        versionNo: 1,
        name: 'v1',
        template: {
          workingPeriods: [],
          blockedPeriods: [],
          specialDates: [{ date: day, kind: 'CLOSED' }],
        },
      }),
    );
    await expect(
      prisma.$transaction((tx) =>
        scheduleRepo().createPendingVersion(tx, {
          businessId: biz.id,
          versionNo: 2,
          name: 'v2',
          template: {
            workingPeriods: [],
            blockedPeriods: [],
            specialDates: [
              { date: day, kind: 'CLOSED' },
              { date: day, kind: 'CUSTOM', startMinutes: 0, endMinutes: 60 },
            ],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('schedule exception persists booking conflict foundation (REQ-159…161) and requires real booking', async () => {
    const ownerId = await createUser('exception.owner@example.com');
    const biz = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'exception',
        categoryCode: 'OTHER',
        name: 'Exc',
        ownerId,
        bookingIntervalMinutes: 30,
      }),
    );
    const version = await prisma.$transaction((tx) =>
      scheduleRepo().createPendingVersion(tx, {
        businessId: biz.id,
        versionNo: 1,
        name: 'v1',
        template: { workingPeriods: [], blockedPeriods: [], specialDates: [] },
      }),
    );
    const booking = await prisma.$transaction((tx) =>
      bookingRepo().createBooking(tx, {
        businessId: biz.id,
        customerName: 'C',
        customerPhone: '+251911000007',
        startAt: new Date('2026-11-09T08:00:00.000Z'),
        endAt: new Date('2026-11-09T08:30:00.000Z'),
        paymentMethod: 'BANK_TRANSFER',
        prepaidMinor: 100n,
        submissionKey: `exception-${crypto.randomUUID()}`,
        components: [],
      }),
    );
    await prisma.scheduleException.create({
      data: { businessId: biz.id, scheduleVersionId: version.id, bookingId: booking.id },
    });
    const rows = await prisma.scheduleException.findMany({
      where: { bookingId: booking.id },
    });
    expect(rows).toHaveLength(1);
    await expect(
      prisma.scheduleException.create({
        data: { businessId: biz.id, scheduleVersionId: version.id, bookingId: booking.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma.scheduleException.create({
        data: { businessId: biz.id, scheduleVersionId: version.id, bookingId: 2147483647 },
      }),
    ).rejects.toBeTruthy();
  });

  it('booking times enforce minute precision and start < end (REQ-226, doc 07 §3)', async () => {
    const ownerId = await createUser('precision.owner@example.com');
    const biz = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'precision',
        categoryCode: 'OTHER',
        name: 'Prec',
        ownerId,
        bookingIntervalMinutes: 15,
      }),
    );
    await expect(
      prisma.booking.create({
        data: {
          businessId: biz.id,
          customerName: 'C',
          customerPhone: '+251911000008',
          startAt: new Date('2026-11-10T08:00:30.000Z'),
          endAt: new Date('2026-11-10T08:15:00.000Z'),
        },
      }),
    ).rejects.toThrow(/booking_start_minute_precision/);
    await expect(
      prisma.booking.create({
        data: {
          businessId: biz.id,
          customerName: 'C',
          customerPhone: '+251911000009',
          startAt: new Date('2026-11-10T09:00:00.000Z'),
          endAt: new Date('2026-11-10T08:30:00.000Z'),
        },
      }),
    ).rejects.toThrow(/booking_start_before_end/);
  });

  it('invalid booking state value is rejected by the enum type', async () => {
    const ownerId = await createUser('enum.owner@example.com');
    const biz = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'enum-check',
        categoryCode: 'OTHER',
        name: 'Enum',
        ownerId,
        bookingIntervalMinutes: 15,
      }),
    );
    await expect(
      prisma.$executeRaw`
        INSERT INTO "booking" ("business_id", "customer_name", "customer_phone", "start_at", "end_at", "status")
        VALUES (${biz.id}::uuid, 'C', '+251911000010', '2026-11-11T08:00:00Z', '2026-11-11T08:15:00Z', 'INVALID_STATE')
      `,
    ).rejects.toBeTruthy();
  });

  it('money round-trips exactly in integer minor units (doc 07, ADR-002)', async () => {
    const ownerId = await createUser('money.owner@example.com');
    const biz = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'money',
        categoryCode: 'OTHER',
        name: 'Money',
        ownerId,
        bookingIntervalMinutes: 15,
      }),
    );
    const booking = await prisma.$transaction((tx) =>
      bookingRepo().createBooking(tx, {
        businessId: biz.id,
        customerName: 'C',
        customerPhone: '+251911000011',
        startAt: new Date('2026-11-12T08:00:00.000Z'),
        endAt: new Date('2026-11-12T08:15:00.000Z'),
        paymentMethod: 'BANK_TRANSFER',
        prepaidMinor: 123456789n,
        submissionKey: `money-${crypto.randomUUID()}`,
        components: [{ serviceId: null, componentType: 'SERVICE', nameSnapshot: 'X', unitPriceMinor: 987654321n, durationMinutes: 15 }],
      }),
    );
    const reloaded = await bookingRepo().findById(biz.id, booking.id);
    expect(reloaded?.payment?.prepaidMinor).toBe(123456789n);
    expect(reloaded?.components[0].unitPriceMinor).toBe(987654321n);
    await expect(
      prisma.payment.update({ where: { bookingId: booking.id }, data: { prepaidMinor: -5n } }),
    ).rejects.toThrow(/payment_prepaid_nonnegative/);
  });

  it('timestamps are timestamptz and round-trip the exact instant', async () => {
    const ownerId = await createUser('tz.owner@example.com');
    const biz = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'tz-check',
        categoryCode: 'OTHER',
        name: 'Tz',
        ownerId,
        bookingIntervalMinutes: 15,
      }),
    );
    const instant = new Date('2026-11-13T23:59:00.000Z');
    const booking = await prisma.$transaction((tx) =>
      bookingRepo().createBooking(tx, {
        businessId: biz.id,
        customerName: 'C',
        customerPhone: '+251911000012',
        startAt: instant,
        endAt: new Date('2026-11-14T00:14:00.000Z'),
        paymentMethod: 'BANK_TRANSFER',
        prepaidMinor: 100n,
        submissionKey: `tz-${crypto.randomUUID()}`,
        components: [],
      }),
    );
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.startAt.getTime()).toBe(instant.getTime());
  });

  it('business settings prepayment configuration is validated (REQ-111: percentage OR fixed)', async () => {
    const ownerId = await createUser('prepay.owner@example.com');
    const biz = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'prepay-check',
        categoryCode: 'OTHER',
        name: 'Prepay',
        ownerId,
        bookingIntervalMinutes: 15,
      }),
    );
    await expect(
      prisma.businessSettings.update({
        where: { businessId: biz.id },
        data: { prepaymentMode: 'PERCENTAGE', prepaymentPercent: null, prepaymentFixedMinor: 100n },
      }),
    ).rejects.toThrow(/business_settings_prepayment_mode/);
    await expect(
      prisma.businessSettings.update({
        where: { businessId: biz.id },
        data: { prepaymentMode: 'PERCENTAGE', prepaymentPercent: 150 },
      }),
    ).rejects.toThrow(/business_settings_percent_range/);
    await prisma.businessSettings.update({
      where: { businessId: biz.id },
      data: { prepaymentMode: 'FIXED', prepaymentFixedMinor: 25000n },
    });
    const updated = await prisma.businessSettings.findUniqueOrThrow({ where: { businessId: biz.id } });
    expect(updated.prepaymentMode).toBe('FIXED');
    expect(updated.prepaymentFixedMinor).toBe(25000n);
  });

  it('subscription proof rejection requires a reason (REQ-138)', async () => {
    const ownerId = await createUser('subproof.owner@example.com');
    const biz = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'subproof-check',
        categoryCode: 'OTHER',
        name: 'SubProof',
        ownerId,
        bookingIntervalMinutes: 15,
      }),
    );
    const subscription = await prisma.subscription.create({
      data: { businessId: biz.id, status: 'TRIAL', trialStartedAt: new Date(), trialEndsAt: new Date() },
    });
    const proof = await prisma.subscriptionProof.create({
      data: { subscriptionId: subscription.id, businessId: biz.id },
    });
    await expect(
      prisma.subscriptionProof.update({
        where: { id: proof.id },
        data: { reviewState: 'REJECTED', rejectionReason: null },
      }),
    ).rejects.toThrow(/subscription_proof_rejection_reason/);
  });

  it('proof submissions are idempotent by unique submission_key (REQ-121)', async () => {
    const ownerId = await createUser('idem.owner@example.com');
    const biz = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'idem',
        categoryCode: 'OTHER',
        name: 'Idem',
        ownerId,
        bookingIntervalMinutes: 15,
      }),
    );
    const booking = await prisma.$transaction((tx) =>
      bookingRepo().createBooking(tx, {
        businessId: biz.id,
        customerName: 'C',
        customerPhone: '+251911000013',
        startAt: new Date('2026-11-15T08:00:00.000Z'),
        endAt: new Date('2026-11-15T08:15:00.000Z'),
        paymentMethod: 'BANK_TRANSFER',
        prepaidMinor: 100n,
        submissionKey: 'exact-duplicate-key',
        components: [],
      }),
    );
    const pay = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    await expect(
      prisma.paymentProof.create({
        data: { paymentId: pay.id, businessId: biz.id, submissionKey: 'exact-duplicate-key' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('tenant scoping: business B cannot read business A bookings through the repository', async () => {
    const ownerId = await createUser('tenancy.owner@example.com');
    const a = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'tenancy-a',
        categoryCode: 'OTHER',
        name: 'A',
        ownerId,
        bookingIntervalMinutes: 15,
      }),
    );
    const b = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'tenancy-b',
        categoryCode: 'OTHER',
        name: 'B',
        ownerId,
        bookingIntervalMinutes: 15,
      }),
    );
    const booking = await prisma.$transaction((tx) =>
      bookingRepo().createBooking(tx, {
        businessId: a.id,
        customerName: 'C',
        customerPhone: '+251911000014',
        startAt: new Date('2026-11-16T08:00:00.000Z'),
        endAt: new Date('2026-11-16T08:15:00.000Z'),
        paymentMethod: 'BANK_TRANSFER',
        prepaidMinor: 100n,
        submissionKey: `tenancy-${crypto.randomUUID()}`,
        components: [],
      }),
    );
    expect(await bookingRepo().findById(b.id, booking.id)).toBeNull();
    expect((await bookingRepo().listByBusiness(a.id)).map((x) => x.id)).toContain(booking.id);
  });

  it('notification delivery outbox books idempotent rows per business channel', async () => {
    const ownerId = await createUser('outbox.owner@example.com');
    const biz = await prisma.$transaction((tx) =>
      businessRepo().createForOwner(tx, {
        publicSlug: 'outbox-check',
        categoryCode: 'OTHER',
        name: 'Outbox',
        ownerId,
        bookingIntervalMinutes: 15,
      }),
    );
    const notification = await prisma.notification.create({
      data: { businessId: biz.id, type: 'BOOKING_REMINDER_1H' },
    });
    await prisma.notificationDelivery.create({
      data: {
        notificationId: notification.id,
        recipientType: 'CUSTOMER',
        recipientRef: '+251911000015',
        channel: 'TELEGRAM',
        idempotencyKey: `outbox-${biz.id}`,
      },
    });
    await expect(
      prisma.notificationDelivery.create({
        data: {
          notificationId: notification.id,
          recipientType: 'CUSTOMER',
          recipientRef: '+251911000015',
          channel: 'TELEGRAM',
          idempotencyKey: `outbox-${biz.id}`,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});