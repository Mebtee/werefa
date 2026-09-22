import type { OwnerBookingDetailView, OwnerBookingProofView } from '@/api/types'
import type { BookingState, PaymentState } from '@/types/models'

/**
 * Maps the owner booking detail projection into the payment-proof review view
 * model (Prompt 51).
 *
 * The backend carries the booking status (`PAYMENT_PENDING` | …) and the
 * payment status (`PENDING` | `ACCEPTED` | `REJECTED`) as two separate values
 * (REQ-100 vs REQ-101); this module preserves that separation and never derives
 * one from the other. The rejection reason is read from the booking history —
 * the authoritative place the backend records it (REQ-118) — rather than from a
 * duplicate field.
 */

const BOOKING_STATE_FROM_WIRE: Record<string, BookingState> = {
  PAYMENT_PENDING: 'payment-pending',
  CONFIRMED: 'confirmed',
  COMPLETED: 'completed',
  NO_SHOW: 'no-show',
  CANCELLED: 'cancelled',
  REJECTED: 'rejected',
}

/** Owner booking-state code → the mounting BookingState. */
export function ownerBookingStateFromWire(status: string): BookingState {
  return BOOKING_STATE_FROM_WIRE[status] ?? 'payment-pending'
}

/** Owner payment-status code → the mounting PaymentState (null when absent). */
export function ownerPaymentStateFromWire(status: string | null | undefined): PaymentState | null {
  if (status === 'PENDING') return 'pending'
  if (status === 'ACCEPTED') return 'accepted'
  if (status === 'REJECTED') return 'rejected'
  return null
}

/** One proof as rendered in the owner proof timeline. */
export interface OwnerProofReview {
  proofId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  replaced: boolean
}

/** The payment-proof review surface derived from one owner booking detail. */
export interface OwnerPaymentReview {
  bookingStatus: BookingState
  paymentStatus: PaymentState | null
  rejectionReason: string | null
  proofs: OwnerProofReview[]
}

/** The most recent rejection reason recorded in the booking history, if any. */
export function rejectionReasonFromDetail(detail: OwnerBookingDetailView): string | null {
  for (let i = detail.history.length - 1; i >= 0; i -= 1) {
    const entry = detail.history[i]
    if (entry.toStatus === 'REJECTED' && entry.reason && entry.reason.trim()) {
      return entry.reason.trim()
    }
  }
  return null
}

function proofReviewOf(proof: OwnerBookingProofView): OwnerProofReview {
  return {
    proofId: proof.proofId,
    fileName: proof.fileName,
    mimeType: proof.mimeType,
    sizeBytes: proof.sizeBytes,
    replaced: proof.replaced,
  }
}

/** Projects an owner booking detail into the payment-proof review view model. */
export function paymentReviewFromDetail(detail: OwnerBookingDetailView): OwnerPaymentReview {
  return {
    bookingStatus: ownerBookingStateFromWire(detail.status),
    paymentStatus: ownerPaymentStateFromWire(detail.payment?.status),
    rejectionReason: rejectionReasonFromDetail(detail),
    proofs: [...detail.proofs]
      .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
      .map(proofReviewOf),
  }
}
