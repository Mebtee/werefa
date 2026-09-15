import type { CustomerNotificationType } from '@/types/models'

/**
 * Human-readable purpose labels for customer Telegram notification events
 * (Notification catalog N01–N08). Used in the notification history list.
 */
export const NOTIFICATION_TYPE_LABEL: Record<CustomerNotificationType, string> = {
  'payment-proof-received': 'Payment proof received',
  'booking-confirmed': 'Booking confirmed',
  'payment-rejected': 'Payment rejected',
  'reminder-24h': 'Reminder — 24 hours',
  'reminder-1h': 'Reminder — 1 hour',
  'no-show': 'No Show',
  cancelled: 'Cancelled',
  reschedule: 'Rescheduled',
}