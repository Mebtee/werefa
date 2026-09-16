import type { Booking, BookingState, PaymentState } from '@/types/models'

/**
 * Owner Bookings workspace query helpers (REQ-175, REQ-184 … REQ-190).
 *
 * Filtering follows REQ-185: OR within a category, AND across categories.
 * Sorting is deterministic and implements REQ-189/190 tie-breaking.
 * Pure functions — the page renders their output, the store stays the
 * single source of truth for the tenant-scoped booking list.
 */

export type BookingSortField =
  | 'date-time'
  | 'booking-id'
  | 'customer'
  | 'status'
  | 'actor'
  | 'payment-status'

export type SortDirection = 'asc' | 'desc'

export interface BookingFilters {
  /** Multi-select status filter (REQ-184); empty = no status constraint (OR). */
  statuses: ReadonlySet<BookingState>
  /** Inclusive from date (YYYY-MM-DD), '' = unset. */
  dateFrom: string
  /** Inclusive to date (YYYY-MM-DD), '' = unset. */
  dateTo: string
  /** Substring match on customer name or phone, '' = unset. */
  query: string
}

/** Canonical booking state order (REQ-101) used for status sorting. */
export const BOOKING_STATE_ORDER: readonly BookingState[] = [
  'payment-pending',
  'confirmed',
  'completed',
  'no-show',
  'cancelled',
  'rejected',
]

/** Canonical payment status order (REQ-100). */
export const PAYMENT_STATE_ORDER: readonly PaymentState[] = [
  'pending',
  'accepted',
  'rejected',
]

export type BookingSort = {
  field: BookingSortField
  direction: SortDirection
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function compareDateTime(a: Booking, b: Booking): number {
  return compareText(a.date, b.date) || compareText(a.time, b.time)
}

/**
 * Booking ID ordering is numeric/chronological (REQ-190 AC1). The mock IDs are
 * random strings, so creation time stands in for the issuance sequence.
 */
function compareBookingId(a: Booking, b: Booking): number {
  return compareText(a.createdAt, b.createdAt)
}

function compareCustomer(a: Booking, b: Booking): number {
  return compareText(
    a.customer.name.toLocaleLowerCase(),
    b.customer.name.toLocaleLowerCase(),
  )
}

function compareStatus(a: Booking, b: Booking): number {
  return (
    BOOKING_STATE_ORDER.indexOf(a.state) - BOOKING_STATE_ORDER.indexOf(b.state)
  )
}

function compareActor(a: Booking, b: Booking): number {
  const actorA = a.history[a.history.length - 1]?.actor.toLocaleLowerCase() ?? ''
  const actorB = b.history[b.history.length - 1]?.actor.toLocaleLowerCase() ?? ''
  return compareText(actorA, actorB)
}

function comparePaymentStatus(a: Booking, b: Booking): number {
  return (
    PAYMENT_STATE_ORDER.indexOf(a.paymentState) -
    PAYMENT_STATE_ORDER.indexOf(b.paymentState)
  )
}

function comparePrimary(field: BookingSortField, a: Booking, b: Booking): number {
  switch (field) {
    case 'date-time':
      return compareDateTime(a, b)
    case 'booking-id':
      return compareBookingId(a, b)
    case 'customer':
      return compareCustomer(a, b)
    case 'status':
      return compareStatus(a, b)
    case 'actor':
      return compareActor(a, b)
    case 'payment-status':
      return comparePaymentStatus(a, b)
  }
}

/**
 * REQ-190 tie-breaking. Booking ID order uses date/time then actor as
 * secondaries (AC2/AC3); date/time order uses Booking ID then actor; the other
 * column sorts use Booking ID then date/time (AC4).
 */
function compareTiebreak(field: BookingSortField, a: Booking, b: Booking): number {
  if (field === 'booking-id') {
    return compareDateTime(a, b) || compareActor(a, b)
  }
  if (field === 'date-time') {
    return compareBookingId(a, b) || compareActor(a, b)
  }
  return compareBookingId(a, b) || compareDateTime(a, b)
}

export function filterBookings(
  bookings: readonly Booking[],
  filters: BookingFilters,
): Booking[] {
  const query = filters.query.trim().toLocaleLowerCase()
  return bookings.filter((booking) => {
    if (filters.statuses.size > 0 && !filters.statuses.has(booking.state)) {
      return false
    }
    if (filters.dateFrom && booking.date < filters.dateFrom) return false
    if (filters.dateTo && booking.date > filters.dateTo) return false
    if (query) {
      const name = booking.customer.name.toLocaleLowerCase()
      const phone = booking.customer.phone.toLocaleLowerCase()
      if (!name.includes(query) && !phone.includes(query)) return false
    }
    return true
  })
}

/**
 * Deterministic sort. The primary column follows the chosen direction; the
 * REQ-190 tie-breakers always run ascending so results stay reproducible.
 */
export function sortBookings(
  bookings: readonly Booking[],
  sort: BookingSort,
): Booking[] {
  const sign = sort.direction === 'asc' ? 1 : -1
  return [...bookings].sort((a, b) => {
    const primary = comparePrimary(sort.field, a, b)
    return primary !== 0 ? primary * sign : compareTiebreak(sort.field, a, b)
  })
}

/** Default: newest first, by exact appointment date/time (REQ-187/189). */
export const DEFAULT_BOOKING_SORT: BookingSort = {
  field: 'date-time',
  direction: 'desc',
}