import type { BookingState, SubmitResult } from '@/types/models'
import type { CustomerBookingView, CustomerStatusView } from './types'

/**
 * Maps the real backend booking projections into the UI models (Prompt 49).
 *
 * The backend is authoritative for prices/durations/status; the UI never
 * recomputes them. Status strings come from the backend's PUBLIC_STATUS map
 * (REQ-063): `awaiting-verification` is the customer-facing label for
 * PAYMENT_PENDING, and every other value equals the UI state name.
 */

/** Public status string → mounting BookingState. */
export function bookingStateFromWire(status: string): BookingState {
  if (status === 'awaiting-verification') return 'payment-pending'
  if (
    status === 'confirmed' ||
    status === 'completed' ||
    status === 'no-show' ||
    status === 'cancelled' ||
    status === 'rejected'
  ) {
    return status
  }
  return 'payment-pending'
}

/** A successful create (201) always awaits verification of the payment proof. */
export function createdResultFromView(view: CustomerBookingView): Extract<SubmitResult, { status: 'created' }> {
  return {
    status: 'created',
    disposition:
      view.status === 'awaiting-verification' ? 'payment-pending' : 'pending-confirmation',
  }
}

/** `GET /customer/status` entries → the card list (newest first, as served). */
export function statusEntriesFromView(
  view: CustomerStatusView,
): readonly { startAt: string; endAt: string; bookingState: BookingState }[] {
  return view.bookings.map((entry) => ({
    startAt: entry.startAt,
    endAt: entry.endAt,
    bookingState: bookingStateFromWire(entry.status),
  }))
}