/**
 * Notification catalog and outbox semantics (Prompt 51; spec §18/§19).
 *
 * Pure, side-effect-free constants + helpers shared by the outbox writer, the
 * delivery worker, the reminder sweep, the webhook callbacks and the customer
 * status projection. Centralizing the mapping guarantees the customer status
 * page and the Telegram channel render the same events.
 */

import { BookingNotificationEventType } from '../events/domain-events';

/**
 * Customer Telegram notifications N01–N08 (REQ-060 … REQ-064, REQ-227 … REQ-229).
 * Every one of these is delivered ONLY when the customer is connected for the
 * business + phone (REQ-056); an unconnected customer receives zero customer
 * Telegram notifications and nothing is withheld (spec §19, N01–N08 rows).
 */
export const CUSTOMER_NOTIFICATION_EVENT_TYPES: readonly BookingNotificationEventType[] = [
  'PAYMENT_PROOF_RECEIVED',
  'BOOKING_CONFIRMED',
  'PAYMENT_REJECTED',
  'REMINDER_24H',
  'REMINDER_1H',
  'NO_SHOW',
  'BOOKING_CANCELLED',
  'BOOKING_RESCHEDULED',
];

/**
 * Owner N09 — "new payment proof" notification (REQ-065/066). Emitted for the
 * same trasition that produces the customer N01 (booking creation T1 and
 * resubmission T10). Delivered to the business owner's Telegram connection.
 */
export const OWNER_NOTIFICATION_EVENT_TYPES: readonly BookingNotificationEventType[] = ['PAYMENT_PROOF_RECEIVED'];

export const CUSTOMER_NOTIFICATION_SET: ReadonlySet<string> = new Set(CUSTOMER_NOTIFICATION_EVENT_TYPES);
export const OWNER_NOTIFICATION_SET: ReadonlySet<string> = new Set(OWNER_NOTIFICATION_EVENT_TYPES);

export type NotificationRecipientType = 'CUSTOMER' | 'OWNER' | 'SYSTEM';

/** Human-safe label used by the customer status projection (N01–N08). */
export function customerNotificationKind(eventType: BookingNotificationEventType): string {
  switch (eventType) {
    case 'PAYMENT_PROOF_RECEIVED':
      return 'payment-proof-received';
    case 'BOOKING_CONFIRMED':
      return 'booking-confirmed';
    case 'PAYMENT_REJECTED':
      return 'payment-rejected';
    case 'REMINDER_24H':
      return 'reminder-24h';
    case 'REMINDER_1H':
      return 'reminder-1h';
    case 'NO_SHOW':
      return 'no-show';
    case 'BOOKING_CANCELLED':
      return 'cancelled';
    case 'BOOKING_RESCHEDULED':
      return 'reschedule';
  }
}

/**
 * Stable outbox idempotency key — unique per (recipient, event type, booking).
 * The `notification_delivery.idempotency_key` unique constraint makes every
 * customer/owner notification exactly-once (spec §32 outbox; REQ "retries
 * bounded"): reminders and repeated transitions can never duplicate.
 */
export function deliveryIdempotencyKey(recipient: NotificationRecipientType, eventType: string, bookingId: number): string {
  return `${recipient.toLowerCase()}:${eventType}:${bookingId}`;
}

export function authDeliveryIdempotencyKey(eventType: string, userId: string): string {
  return `system:${eventType}:${userId}`;
}

/** N17 — one email delivery per Admin account + submitting business (REQ-140). */
export function adminSubscriptionDeliveryIdempotencyKey(eventType: string, businessId: string, adminUserId: string): string {
  return `admin:${eventType}:${businessId}:${adminUserId}`;
}

/** N15 — owner email delivery (reason reachable via the proof row). */
export function ownerSubscriptionDeliveryIdempotencyKey(eventType: string, businessId: string, proofId: string): string {
  return `owner:${eventType}:${businessId}:${proofId}`;
}

/** Compact, bounded payload reference stored on a delivery (varchar(200)). */
export function bookingPayloadRef(bookingId: number, extra?: Record<string, string>): string {
  const base: Record<string, string | number> = { b: bookingId };
  if (extra) Object.assign(base, extra);
  return JSON.stringify(base);
}

/**
 * Subscription payload reference for N15/N17 — `{"s":"<proofId>"}`. Proof ids
 * are uuids, so this stays ≪ 200 chars. The delivery worker resolves the proof
 * row to render the rejection reason (N15).
 */
export function subscriptionPayloadRef(proofId: string): string {
  return JSON.stringify({ s: proofId });
}

export interface ParsedPayloadRef {
  bookingId?: number;
  acceptToken?: string;
  rejectToken?: string;
  /** Subscription proof id (N15/N17, Prompt 52). */
  proofId?: string;
}

/** Reverse of {@link bookingPayloadRef}; never throws on foreign/corrupt data. */
export function parsePayloadRef(raw: string | null | undefined): ParsedPayloadRef {
  const out: ParsedPayloadRef = {};
  if (!raw) return out;
  try {
    const obj: Record<string, unknown> = JSON.parse(raw);
    if (typeof obj['b'] === 'number') out.bookingId = obj['b'];
    if (typeof obj['accept'] === 'string') out.acceptToken = obj['accept'];
    if (typeof obj['reject'] === 'string') out.rejectToken = obj['reject'];
    if (typeof obj['s'] === 'string') out.proofId = obj['s'];
  } catch {
    // foreign/corrupt payload — leave empty
  }
  return out;
}

/** Telegram bot deep link for a connection code. */
export function connectDeepLink(botHandle: string, code: string): string {
  return `https://t.me/${botHandle.replace(/^@/, '').replace(/\s+/g, '')}?start=${encodeURIComponent(code)}`;
}

/** Callback payloads sent with inline buttons; must stay ≤ 64 bytes. */
export function acceptCallbackData(token: string): string {
  return `accept:${token}`;
}

export function rejectCallbackData(token: string): string {
  return `reject:${token}`;
}

export function parseCallbackData(data: string): { action: 'accept' | 'reject'; token: string } | null {
  const match = /^(accept|reject):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(data.trim());
  if (!match) return null;
  const action = match[1].toLowerCase();
  return action === 'accept' || action === 'reject' ? { action, token: match[2] } : null;
}