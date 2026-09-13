import { describe, expect, it } from 'vitest';
import {
  createConnectToken,
  hashToken,
  parseStartCommand,
  parseTelegramUpdate,
} from '../../src/notifications/telegram-connection.service';
import { parseOwnerCallback } from '../../src/notifications/owner-telegram.service';
import { backoffDelay } from '../../src/notifications/notification-dispatcher';
import {
  OWNER_TELEGRAM_TYPES,
  DELIVERY_EXCLUDED_TYPES,
  deliveryIdempotencyKey,
  isReminderType,
  parseScheduleAffected,
} from '../../src/notifications/notification-catalog';
import { BOOKING_NOTIFICATION_TYPE } from '../../src/booking/booking-notifications';

describe('telegram connect token', () => {
  it('creates a distinct, non-guessable token and a stable sha256 hash', () => {
    const a = createConnectToken();
    const b = createConnectToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(hashToken(b));
    // The raw token is not recoverable from the hash.
    expect(hashToken(a)).not.toContain(a);
  });
});

describe('parseStartCommand', () => {
  it('extracts the token from /start <token>', () => {
    expect(parseStartCommand('/start abc123')).toBe('abc123');
  });
  it('is case-insensitive on the command', () => {
    expect(parseStartCommand('/Start ABC')).toBe('ABC');
  });
  it('returns null for non-command messages', () => {
    expect(parseStartCommand('hello')).toBeNull();
    expect(parseStartCommand(undefined)).toBeNull();
  });
});

describe('parseTelegramUpdate', () => {
  it('parses a valid message update', () => {
    const u = parseTelegramUpdate({
      update_id: 123,
      message: { chat: { id: 456 }, text: '/start TOKEN' },
    });
    expect(u).toEqual({ updateId: 123n, chatId: 456n, text: '/start TOKEN' });
  });
  it('rejects malformed payloads', () => {
    expect(parseTelegramUpdate(null)).toBeNull();
    expect(parseTelegramUpdate({ update_id: 1 })).toBeNull();
    expect(parseTelegramUpdate({ update_id: 1, message: {} })).toBeNull();
  });
  it('parses an inline-button callback query', () => {
    const u = parseTelegramUpdate({
      update_id: 999,
      callback_query: {
        id: '1234567890:abcdef',
        data: 'pv:accept:token',
        message: { chat: { id: 777 } },
      },
    });
    expect(u).toEqual({
      updateId: 999n,
      chatId: 777n,
      callbackQueryId: '1234567890:abcdef',
      callbackData: 'pv:accept:token',
    });
  });
  it('does not treat an ordinary message as a callback', () => {
    const u = parseTelegramUpdate({
      update_id: 1,
      message: { chat: { id: 5 }, text: 'just some text' },
    });
    expect(u?.callbackData).toBeUndefined();
  });
});

describe('parseOwnerCallback', () => {
  it('parses a valid accept/reject action token', () => {
    const token = createConnectToken();
    expect(parseOwnerCallback(`pv:accept:${token}`)).toEqual({ kind: 'ACCEPT', token });
    expect(parseOwnerCallback(`pv:reject:${token}`)).toEqual({ kind: 'REJECT', token });
  });
  it('rejects non-action callbacks and malformed payloads', () => {
    expect(parseOwnerCallback('menu:open')).toBeNull();
    expect(parseOwnerCallback('pv:accept:')).toBeNull();
    expect(parseOwnerCallback('pv:accept:SHORT')).toBeNull();
    expect(parseOwnerCallback('')).toBeNull();
  });
});

describe('Prompt 23 catalog wiring', () => {
  it('fans the new-proof notification out to owners via Telegram', () => {
    expect(OWNER_TELEGRAM_TYPES.has(BOOKING_NOTIFICATION_TYPE.newProofOwner)).toBe(true);
  });
  it('no longer excludes the owner-proof notification from delivery', () => {
    expect(DELIVERY_EXCLUDED_TYPES.has(BOOKING_NOTIFICATION_TYPE.newProofOwner)).toBe(false);
  });
});

describe('backoffDelay', () => {
  it('returns base for the first failure and caps at max', () => {
    expect(backoffDelay(1, 1000, 10_000)).toBe(1000);
    expect(backoffDelay(2, 1000, 10_000)).toBe(2000);
    expect(backoffDelay(10, 1000, 10_000)).toBe(10_000);
  });
});

describe('notification-catalog helpers', () => {
  it('builds a unique idempotency key per channel/recipient', () => {
    const k = deliveryIdempotencyKey('n1', 'TELEGRAM', '123');
    expect(k).toBe('n1:TELEGRAM:123');
    expect(deliveryIdempotencyKey('n1', 'EMAIL', 'a@b.c')).not.toBe(k);
  });
  it('classifies reminder types', () => {
    expect(isReminderType(BOOKING_NOTIFICATION_TYPE.reminder24h)).toBe(true);
    expect(isReminderType(BOOKING_NOTIFICATION_TYPE.reminder1h)).toBe(true);
    expect(isReminderType(BOOKING_NOTIFICATION_TYPE.confirmed)).toBe(false);
  });
  it('parses schedule-affected payload defensively', () => {
    expect(parseScheduleAffected({ grouped: true, entries: [{ customerName: 'x' }] }).grouped).toBe(
      true,
    );
    expect(parseScheduleAffected(null).entries).toBeUndefined();
  });
});
