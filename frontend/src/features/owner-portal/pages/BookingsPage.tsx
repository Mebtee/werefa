import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Booking, BookingState } from '@/types/models'
import { mockOwnerApi } from '@/mock/ownerApi'
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

const FILTER_ORDER: readonly (BookingState | 'all')[] = [
  'all',
  'payment-pending',
  'confirmed',
  'completed',
  'no-show',
  'cancelled',
  'rejected',
]

export function BookingsPage() {
  const { business, loading, error, reload } = useOwnedBusiness()
  const [bookings, setBookings] = useState<readonly Booking[] | null>(null)
  const [filter, setFilter] = useState<BookingState | 'all'>('all')
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    setBookings(null)
    try {
      setBookings(await mockOwnerApi.listBookings())
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered =
    bookings?.filter((b) => filter === 'all' || b.state === filter) ?? []

  const countFor = (value: BookingState | 'all') =>
    value === 'all'
      ? bookings?.length ?? 0
      : bookings?.filter((b) => b.state === value).length ?? 0

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

          <div
            className="booking-filters"
            role="group"
            aria-label="Filter bookings by status"
          >
            {FILTER_ORDER.map((value) => (
              <button
                key={value}
                type="button"
                className="booking-pill"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {value === 'all' ? 'All' : BOOKING_STATE_LABEL[value]}
                <span className="booking-pill__count">{countFor(value)}</span>
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="card card--padded">
              <p className="subsection__empty">
                {filter === 'all'
                  ? 'No bookings yet. They appear here once a customer pays and attaches proof.'
                  : `No ${BOOKING_STATE_LABEL[filter as BookingState].toLowerCase()} bookings yet.`}
              </p>
            </div>
          ) : (
            <ul className="booking-list">
              {filtered.map((booking) => (
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
                        {booking.scheduleException && (
                          <>
                            {' '}·
                            <span className="booking-card__exception">
                              Schedule Exception
                            </span>
                          </>
                        )}
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