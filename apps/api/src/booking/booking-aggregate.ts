import type { Prisma } from '@prisma/client';
import type { TenantTransaction } from '../database/tenant-executor';
import type { BookingAggregate } from './booking.serializer';

/**
 * Standard include used by every booking read path (owner, public, worker).
 * Status/payment histories are ordered newest-first so the serializers can
 * surface the latest transition without extra queries.
 */
export const BOOKING_AGGREGATE_INCLUDE = {
  serviceItems: { orderBy: { createdAt: 'asc' } },
  payment: {
    include: {
      proofs: { orderBy: { submittedAt: 'desc' } },
      rejectionEvents: { orderBy: { createdAt: 'desc' } },
      statusHistory: { orderBy: { occurredAt: 'desc' } },
    },
  },
  statusHistory: { orderBy: { occurredAt: 'desc' } },
  slotLocks: { orderBy: { createdAt: 'asc' } },
  scheduleExceptions: true,
} satisfies Prisma.BookingInclude;

/**
 * Load a booking with its full aggregate, asserting it belongs to `businessId`.
 * Returns null when the booking does not exist in this business scope (the
 * caller maps that to 404), keeping each mutation path single-lookup.
 */
export async function loadBookingAggregate(
  tx: TenantTransaction,
  businessId: string,
  bookingId: string,
): Promise<BookingAggregate | null> {
  const row = await tx.booking.findUnique({
    where: { id: bookingId },
    include: BOOKING_AGGREGATE_INCLUDE,
  });
  if (!row || row.businessId !== businessId) return null;
  return {
    booking: row,
    payment: row.payment,
    statusHistory: row.statusHistory,
    paymentStatusHistory: row.payment?.statusHistory ?? [],
    slotLock: row.slotLocks.find((lock) => lock.status !== 'RELEASED') ?? row.slotLocks[0] ?? null,
    scheduleExceptions: row.scheduleExceptions,
  };
}
