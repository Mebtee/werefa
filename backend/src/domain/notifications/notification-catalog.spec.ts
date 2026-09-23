import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_NOTIFICATION_EVENT_TYPES,
  OWNER_NOTIFICATION_EVENT_TYPES,
  acceptCallbackData,
  authDeliveryIdempotencyKey,
  bookingPayloadRef,
  connectDeepLink,
  customerNotificationKind,
  deliveryIdempotencyKey,
  parseCallbackData,
  parsePayloadRef,
  rejectCallbackData,
} from './notification-catalog';

describe('notification catalog (pure)', () => {
  it('customer notifications N01-N08 cover the canonical event set', () => {
    expect(CUSTOMER_NOTIFICATION_EVENT_TYPES).toEqual([
      'PAYMENT_PROOF_RECEIVED',
      'BOOKING_CONFIRMED',
      'PAYMENT_REJECTED',
      'REMINDER_24H',
      'REMINDER_1H',
      'NO_SHOW',
      'BOOKING_CANCELLED',
      'BOOKING_RESCHEDULED',
    ]);
  });

  it('owner notification N09 is delivered only for new payment proofs', () => {
    expect(OWNER_NOTIFICATION_EVENT_TYPES).toEqual(['PAYMENT_PROOF_RECEIVED']);
  });

  it('customerNotificationKind maps every event to a stable status label', () => {
    const expected: Record<string, string> = {
      PAYMENT_PROOF_RECEIVED: 'payment-proof-received',
      BOOKING_CONFIRMED: 'booking-confirmed',
      PAYMENT_REJECTED: 'payment-rejected',
      REMINDER_24H: 'reminder-24h',
      REMINDER_1H: 'reminder-1h',
      NO_SHOW: 'no-show',
      BOOKING_CANCELLED: 'cancelled',
      BOOKING_RESCHEDULED: 'reschedule',
    };
    for (const type of CUSTOMER_NOTIFICATION_EVENT_TYPES) {
      expect(customerNotificationKind(type)).toBe(expected[type]);
    }
  });

  it('idempotency keys are stable and scoped per (recipient, event, booking)', () => {
    expect(deliveryIdempotencyKey('CUSTOMER', 'BOOKING_CONFIRMED', 42)).toBe('customer:BOOKING_CONFIRMED:42');
    expect(deliveryIdempotencyKey('OWNER', 'PAYMENT_PROOF_RECEIVED', 42)).toBe('owner:PAYMENT_PROOF_RECEIVED:42');
    expect(deliveryIdempotencyKey('CUSTOMER', 'BOOKING_CONFIRMED', 42)).not.toBe(
      deliveryIdempotencyKey('CUSTOMER', 'BOOKING_CONFIRMED', 43),
    );
    expect(authDeliveryIdempotencyKey('LOGIN', 'u1')).toBe('system:LOGIN:u1');
  });

  it('payload refs round-trip and tolerate corrupt/foreign data', () => {
    const ref = bookingPayloadRef(7, { accept: 'acc-token', reject: 'rej-token' });
    expect(parsePayloadRef(ref)).toEqual({ bookingId: 7, acceptToken: 'acc-token', rejectToken: 'rej-token' });
    expect(parsePayloadRef(bookingPayloadRef(3))).toEqual({ bookingId: 3 });

    expect(parsePayloadRef(null)).toEqual({});
    expect(parsePayloadRef(undefined)).toEqual({});
    expect(parsePayloadRef('not-json')).toEqual({});
    expect(parsePayloadRef('{"b":"not-a-number"}')).toEqual({});
    expect(parsePayloadRef('{"secret":true}')).toEqual({});
  });

  it('deep link strips sigils/whitespace from the bot handle and encodes the code', () => {
    expect(connectDeepLink('@WerefaBot', 'a b')).toBe('https://t.me/WerefaBot?start=a%20b');
    expect(connectDeepLink('werefa_bot', 'x') === connectDeepLink('werefa_bot ', 'x')).toBe(true);
    expect(connectDeepLink('t', '')).toBe('https://t.me/t?start=');
  });

  it('callback data stays within the 64-byte Telegram limit', () => {
    const acc = acceptCallbackData('12345678-1234-1234-1234-123456789012');
    const rej = rejectCallbackData('12345678-1234-1234-1234-123456789012');
    expect(Buffer.byteLength(acc)).toBeLessThanOrEqual(64);
    expect(Buffer.byteLength(rej)).toBeLessThanOrEqual(64);
  });

  it('parseCallbackData accepts well-formed payloads and rejects malformed ones', () => {
    const token = '12345678-1234-1234-1234-123456789012';
    expect(parseCallbackData(`accept:${token}`)).toEqual({ action: 'accept', token });
    expect(parseCallbackData(`reject:${token}`)).toEqual({ action: 'reject', token });
    expect(parseCallbackData(`  accept:${token}  `)).toEqual({ action: 'accept', token });

    expect(parseCallbackData('accept:')).toBeNull();
    expect(parseCallbackData('delete:' + token)).toBeNull();
    expect(parseCallbackData('accept:not-a-uuid')).toBeNull();
    expect(parseCallbackData('')).toBeNull();
    expect(parseCallbackData(token)).toBeNull();
  });
});