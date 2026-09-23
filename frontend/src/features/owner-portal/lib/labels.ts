import type {
  BookingState,
  BusinessCategory,
  CustomerNotificationType,
  PaymentState,
} from '@/types/models'
import type { SubscriptionStatusCode } from '@/api/types'

export const CATEGORY_LABEL: Record<BusinessCategory, string> = {
  'salon-barber': 'Salon & Barber',
  other: 'Other',
}

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

/** User-facing labels for the booking state machine (REQ-101). */
export const BOOKING_STATE_LABEL: Record<BookingState, string> = {
  'payment-pending': 'Payment Pending',
  confirmed: 'Confirmed',
  completed: 'Completed',
  'no-show': 'No Show',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
}

/** Payment status labels — exactly Pending, Accepted, Rejected (REQ-100). */
export const PAYMENT_STATE_LABEL: Record<PaymentState, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  rejected: 'Rejected',
}

/** Chip tone per booking state, so a confirming review reads at a glance. */
export const BOOKING_STATE_CHIP: Record<BookingState, string> = {
  'payment-pending': 'booking-chip--active',
  confirmed: 'booking-chip--confirmed',
  completed: 'booking-chip--completed',
  'no-show': 'booking-chip--rejected',
  cancelled: 'booking-chip--rejected',
  rejected: 'booking-chip--rejected',
}

/** Chip tone per payment status (REQ-100). */
export const PAYMENT_STATE_CHIP: Record<PaymentState, string> = {
  pending: 'booking-chip--active',
  accepted: 'booking-chip--confirmed',
  rejected: 'booking-chip--rejected',
}

/** User-facing labels for the customer Telegram notification catalog (N01–N08). */
export const TELEGRAM_NOTICE_LABEL: Record<CustomerNotificationType, string> = {
  'payment-proof-received': 'Payment proof received',
  'booking-confirmed': 'Booking confirmed',
  'payment-rejected': 'Payment rejected',
  'reminder-24h': '24-hour reminder',
  'reminder-1h': '1-hour reminder',
  'no-show': 'No Show',
  cancelled: 'Cancelled',
  reschedule: 'Reschedule',
}
/** User-facing subscription status labels (Prompt 52; REQ-128…131). */
export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatusCode, string> = {
  TRIAL: 'Free trial',
  TRIAL_GRACE: 'Trial grace',
  ACTIVE: 'Active',
  PAID_GRACE: 'Paid grace',
  EXPIRED: 'Expired',
  NONE: 'None',
}

/** Chip tone per subscription status. */
export const SUBSCRIPTION_STATUS_CHIP: Record<SubscriptionStatusCode, string> = {
  TRIAL: 'booking-chip--active',
  TRIAL_GRACE: 'booking-chip--active',
  ACTIVE: 'booking-chip--confirmed',
  PAID_GRACE: 'booking-chip--active',
  EXPIRED: 'booking-chip--rejected',
  NONE: 'booking-chip--rejected',
}
