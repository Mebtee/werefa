import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Booking, BookingState } from '@/types/models'
import { listOwnerBookings } from '@/api/ownerBookings'
import { ownerBookingsFromWire } from '@/features/owner-portal/lib/ownerBooking'
import { useOwnedBusiness } from '@/features/owner-portal/state/useOwnedBusiness'
import { LoadState } from '@/features/owner-portal/components/LoadState'
import {
  BOOKING_STATE_CHIP,
  BOOKING_STATE_LABEL,
  PAYMENT_STATE_CHIP,
  PAYMENT_STATE_LABEL,
} from '@/features/owner-portal/lib/labels'
import { formatDateLong } from '@/lib/time'
import { formatMoney } from '@/lib/format'
import {
  BOOKING_STATE_ORDER,
  DEFAULT_BOOKING_SORT,
  filterBookings,
  sortBookings,
  type BookingSortField,
  type BookingSort,
} from '@/features/owner-portal/lib/bookingQuery'

const SORT_FIELD_LABEL: Record<BookingSortField, string> = {
  'date-time': 'Date & time',
  'booking-id': 'Booking ID',
  customer: 'Customer name',
  status: 'Booking status',
  actor: 'Actor',
  'payment-status': 'Payment status',
}

/** Human-readable label for the active ordering (never color-coded alone). */
function directionLabel(sort: BookingSort): string {
  if (sort.field === 'date-time') {
    return sort.direction === 'desc' ? 'Newest first' : 'Oldest first'
  }
  return sort.direction === 'asc' ? 'A–Z' : 'Z–A'
}

export function BookingsPage() {
  const { business, businessId, loading, error, reload } = useOwnedBusiness()
  const [bookings, setBookings] = useState<readonly Booking[] | null>(null)
  const [failed, setFailed] = useState(false)

  // Filter state (REQ-184). Status is multi-select with OR semantics; the
  // other categories combine with AND (REQ-185).
  const [statuses, setStatuses] = useState<ReadonlySet<BookingState>>(new Set())
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<BookingSort>(DEFAULT_BOOKING_SORT)

  const load = useCallback(async () => {
    if (!businessId) return
    setFailed(false)
    setBookings(null)
    try {
      setBookings(ownerBookingsFromWire(await listOwnerBookings(businessId)))
    } catch {
      setFailed(true)
    }
  }, [businessId])

  useEffect(() => {
    void load()
  }, [load])

  const toggleStatus = (value: BookingState) => {
    setStatuses((current) => {
      const next = new Set(current)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  const resetFilters = () => {
    setStatuses(new Set())
    setDateFrom('')
    setDateTo('')
    setQuery('')
    setSort(DEFAULT_BOOKING_SORT)
  }

  const visible = useMemo(
    () =>
      bookings
        ? sortBookings(
            filterBookings(bookings, { statuses, dateFrom, dateTo, query }),
            sort,
          )
        : [],
    [bookings, statuses, dateFrom, dateTo, query, sort],
  )

  const total = bookings?.length ?? 0
  const filtersActive =
    statuses.size > 0 || dateFrom !== '' || dateTo !== '' || query.trim() !== ''

  const countFor = (value: BookingState) =>
    bookings?.filter((b) => b.state === value).length ?? 0

  return (
    <LoadState
      loading={(loading && business === null) || (bookings === null && !failed)}
      error={(error && business === null) || failed}
      onRetry={reload}
    >
      {business && bookings && (
        <>
          <h1 className="page-title">Bookings</h1>
          <p className="page-subtitle">
            Requests are created when the customer pays and attaches proof.
            Review the proof here, then confirm or reject.
          </p>

          <form
            className="booking-workspace"
            aria-label="Filter and sort bookings"
            onSubmit={(event) => event.preventDefault()}
          >
            <div
              className="booking-filters"
              role="group"
              aria-label="Filter by status"
            >
              <button
                type="button"
                className="booking-pill"
                aria-pressed={statuses.size === 0}
                onClick={() => setStatuses(new Set())}
              >
                All
                <span className="booking-pill__count">{total}</span>
              </button>
              {BOOKING_STATE_ORDER.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="booking-pill"
                  aria-pressed={statuses.has(value)}
                  onClick={() => toggleStatus(value)}
                >
                  {BOOKING_STATE_LABEL[value]}
                  <span className="booking-pill__count">{countFor(value)}</span>
                </button>
              ))}
            </div>

            <div className="booking-toolbar">
              <label className="booking-field">
                <span className="booking-field__label">From date</span>
                <input
                  type="date"
                  className="input booking-date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                />
              </label>
              <label className="booking-field">
                <span className="booking-field__label">To date</span>
                <input
                  type="date"
                  className="input booking-date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                />
              </label>
              <label className="booking-search">
                <span className="booking-field__label">Customer search</span>
                <input
                  type="search"
                  className="input"
                  placeholder="Name or phone"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <label className="booking-field">
                <span className="booking-field__label">Sort by</span>
                <select
                  className="input booking-sort__select"
                  value={sort.field}
                  onChange={(event) => {
                    const field = event.target.value as BookingSortField
                    setSort({
                      field,
                      direction:
                        field === 'date-time' ? 'desc' : 'asc',
                    })
                  }}
                >
                  {(Object.keys(SORT_FIELD_LABEL) as BookingSortField[]).map(
                    (field) => (
                      <option key={field} value={field}>
                        {SORT_FIELD_LABEL[field]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <button
                type="button"
                className="btn btn--outline booking-sort__direction"
                aria-label={`Sort direction: ${directionLabel(sort)}`}
                onClick={() =>
                  setSort((current) => ({
                    ...current,
                    direction: current.direction === 'asc' ? 'desc' : 'asc',
                  }))
                }
              >
                {directionLabel(sort)}
              </button>
              <button
                type="button"
                className="btn btn--outline"
                onClick={resetFilters}
              >
                Reset filters
              </button>
            </div>

            <p className="booking-results" role="status" aria-live="polite">
              Showing {visible.length} of {total} bookings ·{' '}
              {directionLabel(sort)}
            </p>
          </form>

          {visible.length === 0 ? (
            <div className="card card--padded booking-empty">
              <p className="subsection__empty booking-empty__text">
                {total === 0
                  ? 'No bookings yet. They appear here once a customer pays and attaches proof.'
                  : 'No bookings match the current filters.'}
              </p>
              {filtersActive && (
                <p className="booking-empty__action">
                  <button
                    type="button"
                    className="btn btn--outline"
                    onClick={resetFilters}
                  >
                    Reset filters
                  </button>
                </p>
              )}
            </div>
          ) : (
            <ul className="booking-list">
              {visible.map((booking) => (
                <li key={booking.id}>
                  <Link
                    className="card card--padded booking-card"
                    to={`/owner/bookings/${booking.id}`}
                  >
                    <span className="booking-card__main">
                      <strong className="booking-card__name">
                        {booking.customer.name}
                      </strong>
                      <span className="booking-card__meta">
                        {booking.customer.phone}
                      </span>
                    </span>
                    <span className="booking-card__time">
                      <strong>
                        {formatDateLong(booking.date)} · {booking.time}
                      </strong>
                      <span className="booking-card__meta">
                        {booking.lineItems.length}{' '}
                        {booking.lineItems.length === 1 ? 'service' : 'services'} ·{' '}
                        {formatMoney(booking.total, business.currency)}
                      </span>
                    </span>
                    <span className="booking-card__status">
                      <span className={`booking-chip ${BOOKING_STATE_CHIP[booking.state]}`}>
                        {BOOKING_STATE_LABEL[booking.state]}
                      </span>
                      <span
                        className={`booking-chip ${PAYMENT_STATE_CHIP[booking.paymentState]}`}
                      >
                        Payment {PAYMENT_STATE_LABEL[booking.paymentState]}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </LoadState>
  )
}