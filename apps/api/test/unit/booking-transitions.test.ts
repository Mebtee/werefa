import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '@werefa/shared';
import {
  assertBookingTransition,
  assertPaymentTransition,
  assertSlotLockTransition,
  isTerminalBookingStatus,
  TERMINAL_BOOKING_STATUSES,
} from '../../apps/api/src/booking/booking-transitions';

/**
 * Prompt 11 — Section 26 state machines (architecture doc 09 §2/§3).
 * Pure-logic unit tests pinning the authoritative transition tables that every
 * mutation path shares (T1–T10).
 */

const ALL_BOOKING_STATUSES = [
  'PAYMENT_PENDING',
  'CONFIRMED',
  'REJECTED',
  'COMPLETED',
  'NO_SHOW',
  'CANCELLED',
] as const;

const ALL_SLOT_LOCK_STATUSES = ['LOCKED', 'ALLOCATED', 'RELEASED'] as const;

describe('booking state machine (Section 26.1)', () => {
  it('allows the defined T1–T10 transitions', () => {
    const allowed: Array<[string, string[]]> = [
      ['PAYMENT_PENDING', ['CONFIRMED', 'REJECTED', 'CANCELLED']],
      ['CONFIRMED', ['COMPLETED', 'NO_SHOW', 'CANCELLED', 'CONFIRMED']],
      ['REJECTED', ['CANCELLED', 'PAYMENT_PENDING']],
    ];
    for (const [from, tos] of allowed) {
      for (const to of tos) {
        expect(() => assertBookingTransition(from, to), `${from} → ${to}`).not.toThrow();
      }
    }
  });

  it('rejects every edge not in the transition table', () => {
    for (const from of ALL_BOOKING_STATUSES) {
      for (const to of ALL_BOOKING_STATUSES) {
        if (from === to && from === 'CONFIRMED') continue; // reschedule leg
        const defined =
          {
            PAYMENT_PENDING: ['CONFIRMED', 'REJECTED', 'CANCELLED'],
            CONFIRMED: ['COMPLETED', 'NO_SHOW', 'CANCELLED', 'CONFIRMED'],
            REJECTED: ['CANCELLED', 'PAYMENT_PENDING'],
          }[from as string] ?? [];
        if (defined.includes(to)) continue;
        try {
          assertBookingTransition(from, to);
          throw new Error(`expected ${from} → ${to} to be rejected`);
        } catch (err) {
          const typed = err as { code?: string; httpStatus?: number; detail?: string };
          expect(typed.code, `${from} → ${to}`).toBe(ErrorCodes.INVALID_TRANSITION);
          expect(typed.httpStatus, `${from} → ${to}`).toBe(409);
        }
      }
    }
  });

  it('keeps terminal statuses immutable', () => {
    for (const terminal of ['COMPLETED', 'NO_SHOW', 'CANCELLED'] as const) {
      expect(TERMINAL_BOOKING_STATUSES.has(terminal)).toBe(true);
      expect(isTerminalBookingStatus(terminal)).toBe(true);
      for (const to of ALL_BOOKING_STATUSES) {
        expect(() => assertBookingTransition(terminal, to)).toThrow();
      }
    }
    expect(isTerminalBookingStatus('PAYMENT_PENDING')).toBe(false);
    expect(isTerminalBookingStatus('CONFIRMED')).toBe(false);
    expect(isTerminalBookingStatus('REJECTED')).toBe(false);
  });
});

describe('payment state machine (Section 26.2)', () => {
  it('allows PENDING→ACCEPTED/REJECTED and REJECTED→PENDING only', () => {
    expect(() => assertPaymentTransition('PENDING', 'ACCEPTED')).not.toThrow();
    expect(() => assertPaymentTransition('PENDING', 'REJECTED')).not.toThrow();
    expect(() => assertPaymentTransition('REJECTED', 'PENDING')).not.toThrow();
  });

  it('rejects illegal payment transitions including ACCEPTED becoming anything', () => {
    const illegal: Array<[string, string]> = [
      ['ACCEPTED', 'PENDING'],
      ['ACCEPTED', 'REJECTED'],
      ['PENDING', 'PENDING'],
      ['REJECTED', 'REJECTED'],
      ['REJECTED', 'ACCEPTED'],
    ];
    for (const [from, to] of illegal) {
      try {
        assertPaymentTransition(from, to);
        throw new Error(`expected ${from} → ${to} to be rejected`);
      } catch (err) {
        expect((err as { code?: string }).code).toBe(ErrorCodes.INVALID_TRANSITION);
      }
    }
  });
});

describe('slot lock state machine (Section 26.3)', () => {
  it('allows LOCKED→ALLOCATED/RELEASED and ALLOCATED→RELEASED only', () => {
    expect(() => assertSlotLockTransition('LOCKED', 'ALLOCATED')).not.toThrow();
    expect(() => assertSlotLockTransition('LOCKED', 'RELEASED')).not.toThrow();
    expect(() => assertSlotLockTransition('ALLOCATED', 'RELEASED')).not.toThrow();
  });

  it('rejects illegal slot-lock transitions and keeps RELEASED terminal', () => {
    for (const from of ALL_SLOT_LOCK_STATUSES) {
      for (const to of ALL_SLOT_LOCK_STATUSES) {
        if (
          (from === 'LOCKED' && (to === 'ALLOCATED' || to === 'RELEASED')) ||
          (from === 'ALLOCATED' && to === 'RELEASED')
        ) {
          continue;
        }
        expect(() => assertSlotLockTransition(from, to), `${from} → ${to}`).toThrow();
      }
    }
  });
});
