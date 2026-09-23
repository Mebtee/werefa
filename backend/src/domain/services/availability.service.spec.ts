import { describe, expect, it } from 'vitest';
import { IntlGlobalClock } from '../time/global-clock';
import { AvailabilityService } from './availability.service';

/**
 * Gate + occupancy coverage for AvailabilityService (Prompt 48). The pure
 * window math already lives in availability.spec.ts; this spec mocks the
 * data-access seam (fakely resolves gates + occupied spans) with a real
 * IntlGlobalClock so the service is exercised on its own.
 *
 * Target date: 2026-09-14 is a Monday in UTC.
 */

const clock = new IntlGlobalClock('UTC');

interface Version {
  workingPeriods: { weekday: number; startMinutes: number; endMinutes: number }[];
  blockedPeriods: { dayOfWeek?: number | null; startMinutes?: number | null; endMinutes?: number | null }[];
  specialDates: { date: Date; kind: 'CLOSED' | 'CUSTOM'; startMinutes?: number | null; endMinutes?: number | null }[];
}

interface Overrides {
  business?: { deactivatedAt: Date | null } | null;
  settings?: { isPaused: boolean; bookingIntervalMins: number } | null;
  subscription?: {
    status: string;
    trialStartedAt: Date | null;
    trialEndsAt: Date | null;
    trialGraceEndsAt: Date | null;
    periodEndsAt: Date | null;
    paidGraceEndsAt: Date | null;
  } | null;
  version?: Version | null;
  bookings?: { startAt: Date; endAt: Date }[];
  locks?: { startAt: Date; endAt: Date }[];
}

const OPEN_WEEK = { workingPeriods: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startMinutes: 540, endMinutes: 1020 })), blockedPeriods: [], specialDates: [] } as Version;

/** Far-future TRIAL so the time-derived gate (Prompt 52) stays open. */
const TRIAL_SUBSCRIPTION = {
  status: 'TRIAL',
  trialStartedAt: new Date('2026-01-01T00:00:00Z'),
  trialEndsAt: new Date('2099-01-01T00:00:00Z'),
  trialGraceEndsAt: new Date('2099-04-01T00:00:00Z'),
  periodEndsAt: null,
  paidGraceEndsAt: null,
};

function makeService(overrides: Overrides = {}) {
  const prisma = {
    business: {
      findUnique: async () => (overrides.business === undefined ? { deactivatedAt: null } : overrides.business),
    },
    businessSettings: {
      findUnique: async () => (overrides.settings === undefined ? { isPaused: false, bookingIntervalMins: 30 } : overrides.settings),
    },
    subscription: {
      findUnique: async () => (overrides.subscription === undefined ? TRIAL_SUBSCRIPTION : overrides.subscription),
    },
    booking: {
      findMany: async () => overrides.bookings ?? [],
    },
    slotLock: {
      findMany: async () => overrides.locks ?? [],
    },
  };
  const scheduleRepo = { getActiveVersion: async () => (overrides.version === undefined ? OPEN_WEEK : overrides.version) };
  return new AvailabilityService(prisma as never, scheduleRepo as never, clock);
}

describe('AvailabilityService gates', () => {
  it('a ready business yields slots on the Monday grid (09:00–17:00, 60m @ 30m)', async () => {
    const slots = await makeService().getSlotsForDay('b1', { dateKey: '2026-09-14', durationMinutes: 60 });
    expect(slots.map((s) => s.startMinutes)).toEqual([540, 570, 600, 630, 660, 690, 720, 750, 780, 810, 840, 870, 900, 930, 960]);
    expect(slots[0].startAt.toISOString()).toBe('2026-09-14T09:00:00.000Z');
    expect(slots[0].endAt.toISOString()).toBe('2026-09-14T10:00:00.000Z');
  });

  it('returns nothing when the business is deactivated', async () => {
    const service = makeService({ business: { deactivatedAt: new Date('2026-09-01T00:00:00Z') } });
    expect(await service.getSlotsForDay('b1', { dateKey: '2026-09-14', durationMinutes: 60 })).toEqual([]);
  });

  it('returns nothing when the business is missing', async () => {
    const service = makeService({ business: null });
    expect(await service.getSlotsForDay('b1', { dateKey: '2026-09-14', durationMinutes: 60 })).toEqual([]);
  });

  it('returns nothing when settings are paused', async () => {
    const service = makeService({ settings: { isPaused: true, bookingIntervalMins: 30 } });
    expect(await service.getSlotsForDay('b1', { dateKey: '2026-09-14', durationMinutes: 60 })).toEqual([]);
  });

  it('returns nothing when settings are missing', async () => {
    const service = makeService({ settings: null });
    expect(await service.getSlotsForDay('b1', { dateKey: '2026-09-14', durationMinutes: 60 })).toEqual([]);
  });

  it('returns nothing when the subscription is missing', async () => {
    const service = makeService({ subscription: null });
    expect(await service.getSlotsForDay('b1', { dateKey: '2026-09-14', durationMinutes: 60 })).toEqual([]);
  });

  it('returns nothing when the subscription is EXPIRED (R133)', async () => {
    const service = makeService({
      subscription: {
        status: 'EXPIRED',
        trialStartedAt: null,
        trialEndsAt: null,
        trialGraceEndsAt: null,
        periodEndsAt: null,
        paidGraceEndsAt: null,
      },
    });
    expect(await service.getSlotsForDay('b1', { dateKey: '2026-09-14', durationMinutes: 60 })).toEqual([]);
  });

  it('returns nothing when there is no active schedule version', async () => {
    const service = makeService({ version: null });
    expect(await service.getSlotsForDay('b1', { dateKey: '2026-09-14', durationMinutes: 60 })).toEqual([]);
  });
});

describe('AvailabilityService occupancy', () => {
  it('an active booking removes overlapping starts but keeps touching starts (R090)', async () => {
    const service = makeService({
      bookings: [{ startAt: new Date('2026-09-14T10:00:00Z'), endAt: new Date('2026-09-14T11:00:00Z') }],
    });
    const slots = await service.getSlotsForDay('b1', { dateKey: '2026-09-14', durationMinutes: 60 });
    // 09:00 [540,600) only touches the occupied start -> kept; 09:30..11:00 excluded;
    // 11:00 [660,720) only touches the occupied end -> kept again.
    expect(slots.map((s) => s.startMinutes)).toEqual([
      540, 660, 690, 720, 750, 780, 810, 840, 870, 900, 930, 960,
    ]);
  });

  it('a LOCKED/ALLOCATED slot lock removes the same starts as an occupancy', async () => {
    const service = makeService({
      locks: [{ startAt: new Date('2026-09-14T12:00:00Z'), endAt: new Date('2026-09-14T13:00:00Z') }],
    });
    const slots = await service.getSlotsForDay('b1', { dateKey: '2026-09-14', durationMinutes: 60 });
    // [12:00,13:00) excludes starts overlapping it; touching starts (11:00, 13:00) are kept.
    expect(slots.map((s) => s.startMinutes)).toEqual([
      540, 570, 600, 630, 660, 780, 810, 840, 870, 900, 930, 960,
    ]);
  });
});