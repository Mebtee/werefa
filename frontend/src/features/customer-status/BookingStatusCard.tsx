import { useId } from 'react'
import type { CustomerBookingStatusEntry } from '@/types/models'
import {
  BOOKING_STATE_CHIP,
  BOOKING_STATE_EXPLANATION,
  BOOKING_STATE_LABEL,
} from '@/features/customer-status/lib/labels'
import { Button } from '@/components/ui/Button'
import { formatDateTime } from '@/lib/time'

interface BookingStatusCardProps {
  booking: CustomerBookingStatusEntry
  /** Offered only for rejected bookings (REQ-230). */
  onResubmit?: () => void
}

/**
 * Honest, customer-safe status card (Prompt 49): appointment date/time + status
 * only. The real `GET /customer/status` endpoint never projects customer name,
 * line items, payment internals or Telegram state, and this card mirrors that.
 */
export function BookingStatusCard({ booking, onResubmit }: BookingStatusCardProps) {
  const id = useId()
  return (
    <article className="card card--padded status-card" aria-labelledby={id}>
      <div className="status-card__header">
        <h2 className="status-card__title" id={id}>
          Booking on {formatDateTime(booking.startAt)}
        </h2>
        <span
          className={`booking-chip ${BOOKING_STATE_CHIP[booking.bookingState]}`}
        >
          {BOOKING_STATE_LABEL[booking.bookingState]}
        </span>
      </div>

      <p className="status-card__explanation">
        {BOOKING_STATE_EXPLANATION[booking.bookingState]}
      </p>

      {booking.bookingState === 'rejected' && onResubmit && (
        <div className="status-card__actions">
          <Button variant="outline" onClick={onResubmit}>
            Resubmit payment proof
          </Button>
        </div>
      )}
    </article>
  )
}