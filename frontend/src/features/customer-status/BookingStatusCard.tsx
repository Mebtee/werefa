import { useId } from 'react'
import type { ComponentType, SVGProps } from 'react'
import type { BookingState, CustomerBookingStatusEntry } from '@/types/models'
import {
  BOOKING_STATE_CHIP,
  BOOKING_STATE_EXPLANATION,
  BOOKING_STATE_LABEL,
} from '@/features/customer-status/lib/labels'
import { Button } from '@/components/ui/Button'
import { formatDateTime } from '@/lib/time'
import {
  CheckCircleIcon,
  InfoIcon,
  ReceiptIcon,
  UploadIcon,
} from '@/components/ui/icons'

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>

/**
 * A shape as well as a colour for every state, so a status is never carried by
 * hue alone (WCAG 1.4.1).
 */
const STATE_ICON: Record<BookingState, IconComponent> = {
  'payment-pending': ReceiptIcon,
  confirmed: CheckCircleIcon,
  completed: CheckCircleIcon,
  'no-show': InfoIcon,
  cancelled: InfoIcon,
  rejected: InfoIcon,
}

interface BookingStatusCardProps {
  booking: CustomerBookingStatusEntry
  /** Offered only for rejected bookings (REQ-230). */
  onResubmit?: () => void
}

/**
 * Honest, customer-safe status card (Prompt 49): appointment date/time + status
 * only. The real `GET /customer/status` endpoint never projects customer name,
 * line items, payment internals or Telegram state, and this card mirrors that —
 * it shows the appointment it can see and an explanation of what the business
 * still has to do.
 */
export function BookingStatusCard({ booking, onResubmit }: BookingStatusCardProps) {
  const id = useId()
  const StateIcon = STATE_ICON[booking.bookingState]
  return (
    <article className="card card--padded status-card" aria-labelledby={id}>
      <div className="status-card__header">
        <h2 className="status-card__title" id={id}>
          Booking on {formatDateTime(booking.startAt)}
        </h2>
        <span className={`booking-chip ${BOOKING_STATE_CHIP[booking.bookingState]}`}>
          <StateIcon size={15} />
          {BOOKING_STATE_LABEL[booking.bookingState]}
        </span>
      </div>

      <p className="status-card__explanation">
        {BOOKING_STATE_EXPLANATION[booking.bookingState]}
      </p>

      {booking.bookingState === 'rejected' && onResubmit && (
        <div className="status-card__actions">
          <Button variant="outline" onClick={onResubmit}>
            <UploadIcon size={17} />
            Resubmit payment proof
          </Button>
        </div>
      )}
    </article>
  )
}