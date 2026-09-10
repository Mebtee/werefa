import { BOOKING_NOTIFICATION_TYPE } from '../booking/booking-notifications';
import { SUBSCRIPTION_NOTIFICATION_TYPE } from '../subscription/subscription-notifications';
import { SCHEDULE_AFFECTED_TYPE } from '../schedule/schedule.service';

/**
 * Fan-out catalog (doc 13 §3/§4/§8, Prompt 13; subscription part = Prompt 14,
 * doc 15 §4): the only mapping from a durable domain `notification` outbox row
 * to concrete delivery intents (channel × recipient). Pure and unit-testable —
 * no DB access.
 *
 * Decision rules:
 *  - Customer-facing types are delivered over Telegram ONLY (REQ-060/063/064/065
 *    are SMS/Telegram-to-customer; Telegram is the single customer channel this
 *    prompt implements, doc 12). If the booking has no active connection the
 *    intent is SUPPRESSED (delivery rows exist so fan-out stays idempotent).
 *  - `SCHEDULE_AFFECTED_OWNER` and the subscription owner types are EMAIL to
 *    the business contact (REQ-093/094; REQ-137/138/139/140); a business without
 *    a contact email is SUPPRESSED.
 *  - `SUBSCRIPTION_PAYMENT_SUBMITTED_ADMIN` fans out to the (exactly) two Admin
 *    platform accounts over EMAIL (REQ-140 — takes the two earliest admins).
 *  - `BOOKING_NEW_PROOF_OWNER` and owner-Telegram delivery are OUT OF SCOPE
 *    (dashboard-only; REQ-066 deferred) — no delivery intent is created.
 *  - Reminder intents are re-validated at delivery time (stale-safe): booking
 *    reminders require the booking to still be CONFIRMED; subscription
 *    reminders require the derived reminder decision to still hold.
 */

export const NOTIFICATION_CHANNEL = {
  EMAIL: 'EMAIL',
  TELEGRAM: 'TELEGRAM',
} as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNEL)[keyof typeof NOTIFICATION_CHANNEL];

/** Channel used for deliveries that turn out to have no viable recipient. */
export const SUPPRESSED_RECIPIENT = '-';

/** Outbox types whose delivery is deferred/dashboard-only (no delivery rows). */
export const DELIVERY_EXCLUDED_TYPES = new Set<string>([BOOKING_NOTIFICATION_TYPE.newProofOwner]);

/** Outbox types fanned out to TELEGRAM when a chat connection exists (REQ-060+). */
export const CUSTOMER_TELEGRAM_TYPES = new Set<string>([
  BOOKING_NOTIFICATION_TYPE.proofReceived,
  BOOKING_NOTIFICATION_TYPE.confirmed,
  BOOKING_NOTIFICATION_TYPE.rejected,
  BOOKING_NOTIFICATION_TYPE.noShow,
  BOOKING_NOTIFICATION_TYPE.cancelled,
  BOOKING_NOTIFICATION_TYPE.rescheduled,
  BOOKING_NOTIFICATION_TYPE.reminder24h,
  BOOKING_NOTIFICATION_TYPE.reminder1h,
]);

/** Outbox types carried by EMAIL. */
export const OWNER_EMAIL_TYPES = new Set<string>([SCHEDULE_AFFECTED_TYPE]);

/** Payment-submission fan-out to the two Admin platform accounts (REQ-140). */
export const SUBSCRIPTION_ADMIN_EMAIL_TYPES = new Set<string>([
  SUBSCRIPTION_NOTIFICATION_TYPE.paymentSubmittedAdmin,
]);

/** Owner-facing subscription events delivered to the business contact email. */
export const SUBSCRIPTION_OWNER_EMAIL_TYPES = new Set<string>([
  SUBSCRIPTION_NOTIFICATION_TYPE.paymentApprovedOwner,
  SUBSCRIPTION_NOTIFICATION_TYPE.paymentRejectedOwner,
  SUBSCRIPTION_NOTIFICATION_TYPE.reminderPaidEnd,
  SUBSCRIPTION_NOTIFICATION_TYPE.reminderTrialEnd,
  SUBSCRIPTION_NOTIFICATION_TYPE.reminderPaidGrace,
  SUBSCRIPTION_NOTIFICATION_TYPE.reminderTrialGrace,
]);

export function isSubscriptionReminderType(type: string): boolean {
  return (
    type === SUBSCRIPTION_NOTIFICATION_TYPE.reminderPaidEnd ||
    type === SUBSCRIPTION_NOTIFICATION_TYPE.reminderTrialEnd ||
    type === SUBSCRIPTION_NOTIFICATION_TYPE.reminderPaidGrace ||
    type === SUBSCRIPTION_NOTIFICATION_TYPE.reminderTrialGrace
  );
}

/** Map a queued subscription reminder type to its derived-kind identity. */
export function subscriptionReminderKindOf(
  type: string,
): 'PAID_END' | 'TRIAL_END' | 'PAID_GRACE' | 'TRIAL_GRACE' | null {
  switch (type) {
    case SUBSCRIPTION_NOTIFICATION_TYPE.reminderPaidEnd:
      return 'PAID_END';
    case SUBSCRIPTION_NOTIFICATION_TYPE.reminderTrialEnd:
      return 'TRIAL_END';
    case SUBSCRIPTION_NOTIFICATION_TYPE.reminderPaidGrace:
      return 'PAID_GRACE';
    case SUBSCRIPTION_NOTIFICATION_TYPE.reminderTrialGrace:
      return 'TRIAL_GRACE';
    default:
      return null;
  }
}

export function isReminderType(type: string): boolean {
  return (
    type === BOOKING_NOTIFICATION_TYPE.reminder24h || type === BOOKING_NOTIFICATION_TYPE.reminder1h
  );
}

/**
 * Idempotency key for a (notification, channel, recipient) intent: UNIQUE on
 * `notification_delivery.idempotency_key` so repeated fan-out / worker runs are
 * no-ops, even across process restarts.
 */
export function deliveryIdempotencyKey(
  notificationId: string,
  channel: NotificationChannel,
  recipient: string,
): string {
  return `${notificationId}:${channel}:${recipient}`;
}

/** Parse a stored `notification` payload defensively (never throws). */
export function readPayload(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
}

export function readPayloadString(payload: unknown, key: string): string | undefined {
  const value = readPayload(payload)[key];
  return typeof value === 'string' ? value : undefined;
}

export interface ScheduleAffectedPayload {
  versionId?: string;
  grouped?: boolean;
  entries?: {
    bookingId?: string;
    customerName?: string;
    customerPhone?: string;
    startAt?: string;
    endAt?: string;
    durationMinutes?: number;
    services?: { name?: string; durationMinutes?: number }[];
    reason?: string;
    managementUrl?: string;
    occurredAt?: string;
  }[];
}

export function parseScheduleAffected(payload: unknown): ScheduleAffectedPayload {
  const raw = readPayload(payload);
  return {
    versionId: typeof raw.versionId === 'string' ? raw.versionId : undefined,
    grouped: raw.grouped === true,
    entries: Array.isArray(raw.entries)
      ? (raw.entries as ScheduleAffectedPayload['entries'])
      : undefined,
  };
}

/** Booking data the templates/dispatcher read at delivery time (authoritative). */
export interface DeliveryBookingContext {
  bookingId: string;
  businessId: string;
  businessName: string;
  customerName: string;
  customerPhone: string;
  startAt: string;
  endAt: string;
  status: string;
  services: { name: string; durationMinutes: number }[];
}
