import type { BookingState, PaymentState } from '@/types/models'

export const BOOKING_STATE_LABEL: Record<BookingState, string> = {
  'payment-pending': 'Payment Pending',
  confirmed: 'Confirmed',
  completed: 'Completed',
  'no-show': 'No Show',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
}

export const PAYMENT_STATE_LABEL: Record<PaymentState, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  rejected: 'Rejected',
}

export const BOOKING_STATE_CHIP: Record<BookingState, string> = {
  'payment-pending': 'booking-chip--active',
  confirmed: 'booking-chip--confirmed',
  completed: 'booking-chip--completed',
  'no-show': 'booking-chip--rejected',
  cancelled: 'booking-chip--rejected',
  rejected: 'booking-chip--rejected',
}

export const PAYMENT_STATE_CHIP: Record<PaymentState, string> = {
  pending: 'booking-chip--active',
  accepted: 'booking-chip--confirmed',
  rejected: 'booking-chip--rejected',
}

export const BOOKING_STATE_EXPLANATION: Record<BookingState, string> = {
  'payment-pending':
    'Your booking request was received and is awaiting the business to review your payment proof.',
  confirmed:
    'Your appointment is confirmed.',
  rejected:
    'Your booking was not accepted.',
  completed:
    'This appointment is completed.',
  'no-show':
    'This booking was marked as No Show.',
  cancelled:
    'This booking was cancelled.',
}
