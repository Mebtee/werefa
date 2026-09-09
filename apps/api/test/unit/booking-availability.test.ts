import { describe, expect, it, vi } from 'vitest';
import { ErrorCodes, type ErrorCode } from '@werefa/shared';
import { BookingAvailabilityService } from '../../apps/api/src/booking/booking-availability';
import type { TenantTransaction } from '../../apps/api/src/database/tenant-executor';

/**
 * Prompt 11 — slot overlap semantics (architecture doc 08 §2). Availability is
 * ALWAYS re-checked inside the per-business advisory-lock transaction; these
 * unit tests pin the overlap predicate against the count queries.
 */

function makeTx() {
  const bookingCount = vi.fn(async () => 0);
  const slotLockCount = vi.fn(async () => 0);
  const tx = {
    booking: { count: bookingCount },
    slotLock: { count: slotLockCount },
  } as unknown as TenantTransaction;
  return { tx, bookingCount, slotLockCount };
}

const T = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 7, h, m, 0, 0));

function whereArgs(fn: ReturnType<typeof vi.fn>) {
  const calls = fn.mock.calls as unknown as Array<[{ where: Record<string, unknown> }]>;
  return calls.at(0)?.[0]?.where;
}

describe('BookingAvailabilityService.isSlotAvailable', () => {
  it('is available when nothing overlaps', async () => {
    const { tx, bookingCount, slotLockCount } = makeTx();
    const free = await new BookingAvailabilityService().isSlotAvailable(tx, {
      businessId: 'b1',
      startAt: T(7),
      endAt: T(8),
    });
    expect(free).toBe(true);
    expect(bookingCount).toHaveBeenCalledTimes(1);
    expect(slotLockCount).toHaveBeenCalledTimes(1);
  });

  it('is taken when an active booking overlaps (half-open [start, end))', async () => {
    const { tx, bookingCount } = makeTx();
    bookingCount.mockResolvedValue(1);
    const free = await new BookingAvailabilityService().isSlotAvailable(tx, {
      businessId: 'b1',
      startAt: T(7),
      endAt: T(8),
    });
    expect(free).toBe(false);
  });

  it('is taken when an active slot lock overlaps', async () => {
    const { tx, slotLockCount } = makeTx();
    slotLockCount.mockResolvedValue(1);
    const free = await new BookingAvailabilityService().isSlotAvailable(tx, {
      businessId: 'b1',
      startAt: T(7),
      endAt: T(8),
    });
    expect(free).toBe(false);
  });

  it('treats touching windows as non-overlapping (end boundary exclusive)', async () => {
    const { tx } = makeTx();
    // booking query is built with startAt < endAt AND endAt > startAt — a
    // directly adjacent booking (same endAt as the new startAt) must not
    // conflict, which is why the predicate uses strict inequalities.
    const free = await new BookingAvailabilityService().isSlotAvailable(tx, {
      businessId: 'b1',
      startAt: T(8),
      endAt: T(9),
    });
    expect(free).toBe(true);
  });

  it('scopes the overlap query to active statuses and the business', async () => {
    const { tx, bookingCount } = makeTx();
    await new BookingAvailabilityService().isSlotAvailable(tx, {
      businessId: 'b1',
      startAt: T(7),
      endAt: T(8),
    });
    const where = whereArgs(bookingCount);
    expect(where).toMatchObject({
      businessId: 'b1',
      status: { in: ['PAYMENT_PENDING', 'CONFIRMED'] },
    });
  });

  it('excludes the subject booking and its own slot lock when rescheduling', async () => {
    const { tx, bookingCount, slotLockCount } = makeTx();
    bookingCount.mockResolvedValue(0);
    slotLockCount.mockResolvedValue(0);
    const free = await new BookingAvailabilityService().isSlotAvailable(tx, {
      businessId: 'b1',
      startAt: T(7),
      endAt: T(8),
      excludeBookingId: 'booking-9',
    });
    expect(free).toBe(true);
    expect(whereArgs(bookingCount)).toMatchObject({
      businessId: 'b1',
      id: { not: 'booking-9' },
    });
    expect(whereArgs(slotLockCount)).toMatchObject({
      businessId: 'b1',
      OR: [{ bookingId: null }, { bookingId: { not: 'booking-9' } }],
    });
  });

  it('requireSlotAvailable throws SLOT_UNAVAILABLE (REQ-053) when taken', async () => {
    const { tx, bookingCount } = makeTx();
    bookingCount.mockResolvedValue(1);
    const err = await new BookingAvailabilityService()
      .requireSlotAvailable(tx, { businessId: 'b1', startAt: T(7), endAt: T(8) })
      .then(
        () => null,
        (e: unknown) => e,
      );
    const typed = err as { code?: ErrorCode; httpStatus?: number };
    expect(typed.code).toBe(ErrorCodes.SLOT_UNAVAILABLE);
    expect(typed.httpStatus).toBe(409);
  });
});

describe('BookingAvailabilityService.slotDateOf (REQ-222/223, UTC+3 no DST)', () => {
  it('maps the start time to the Addis-Ababa calendar date at UTC midnight', () => {
    // Fri 2026-09-04 21:30 UTC = Sat 2026-09-05 00:30 Addis (next calendar day).
    const lateUtc = new Date(Date.UTC(2026, 8, 4, 21, 30, 0, 0));
    expect(BookingAvailabilityService.slotDateOf(lateUtc).toISOString()).toBe(
      '2026-09-05T00:00:00.000Z',
    );
    // Wed 2026-09-02 22:00 UTC = Thu 2026-09-03 01:00 Addis.
    expect(
      BookingAvailabilityService.slotDateOf(new Date(Date.UTC(2026, 8, 2, 22))).toISOString(),
    ).toBe('2026-09-03T00:00:00.000Z');
    // Same day: Tue 2026-09-01 08:00 UTC = 11:00 Addis.
    expect(
      BookingAvailabilityService.slotDateOf(new Date(Date.UTC(2026, 8, 1, 8))).toISOString(),
    ).toBe('2026-09-01T00:00:00.000Z');
  });
});
