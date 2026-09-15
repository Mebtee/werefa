import { useId } from 'react'
import type { CustomerBookingStatus } from '@/types/models'
import {
  BOOKING_STATE_CHIP,
  BOOKING_STATE_EXPLANATION,
  BOOKING_STATE_LABEL,
  PAYMENT_STATE_CHIP,
  PAYMENT_STATE_LABEL,
} from '@/features/customer-status/lib/labels'
import { formatDateLong } from '@/lib/time'
import { formatTime } from '@/lib/format'

interface BookingStatusCardProps {
  booking: CustomerBookingStatus
}

export function BookingStatusCard({ booking }: BookingStatusCardProps) {
  const id = useId()
  return (
    <article className="card card--padded status-card" aria-labelledby={id}>
      <div className="status-card__header">
        <h2 className="status-card__title" id={id}>
          Booking for {booking.customerName}
        </h2>
        <div className="status-card__chips">
          <span
            className={`booking-chip ${BOOKING_STATE_CHIP[booking.bookingState]}`}
          >
            {BOOKING_STATE_LABEL[booking.bookingState]}
          </span>
          <span className={`booking-chip ${PAYMENT_STATE_CHIP[booking.paymentState]}`}>
            Payment {PAYMENT_STATE_LABEL[booking.paymentState]}
          </span>
        </div>
      </div>

      <p className="status-card__explanation">
        {BOOKING_STATE_EXPLANATION[booking.bookingState]}
        {booking.bookingState === 'rejected' && booking.rejectionReason && (
          <>
            {' '}Reason: {booking.rejectionReason}
          </>
        )}
      </p>

      <div className="status-card__details">
        <dl>
          <div className="status-card__detail">
            <dt>When</dt>
            <dd>
              {formatDateLong(booking.date)} at {formatTime(booking.time)}
            </dd>
          </div>
          <div className="status-card__detail">
            <dt>Services</dt>
            <dd>
              <ul className="status-card__services">
                {booking.lineItems.map((item) => (
                  <li key={item.name}>
                    {item.name} <span>({item.durationMinutes} min)</span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>
      </div>
    </article>
  )
}