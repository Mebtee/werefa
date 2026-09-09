import type { BookingStatus, PaymentStatus, SlotLockStatus } from '@prisma/client';
import { ErrorCodes, type ErrorCode } from '@werefa/shared';
import { AppException } from '../common/http/app-error';

/**
 * Pure state machines for the booking domain (master spec Section 26,
 * architecture doc 09 §2/§3). No I/O here — these tables answer "is this a
 * valid transition" so every mutation path (owner, public, worker) shares one
 * authoritative rule set.
 */

export const TERMINAL_BOOKING_STATUSES: ReadonlySet<BookingStatus> = new Set<BookingStatus>([
  'COMPLETED',
  'NO_SHOW',
  'CANCELLED',
]);

/**
 * Allowed booking transitions (Section 26.1, T1–T10). "CONFIRMED → CONFIRMED"
 * is the reschedule transition (T7): same status, new date/time.
 */
const BOOKING_TRANSITIONS: ReadonlyMap<BookingStatus, ReadonlySet<BookingStatus>> = new Map<
  BookingStatus,
  ReadonlySet<BookingStatus>
>([
  ['PAYMENT_PENDING', new Set(['CONFIRMED', 'REJECTED', 'CANCELLED'])],
  ['CONFIRMED', new Set(['COMPLETED', 'NO_SHOW', 'CANCELLED', 'CONFIRMED'])],
  ['REJECTED', new Set(['CANCELLED', 'PAYMENT_PENDING'])],
  ['COMPLETED', new Set()],
  ['NO_SHOW', new Set()],
  ['CANCELLED', new Set()],
]);

/**
 * Allowed payment transitions (Section 26.2 / REQ-100, SM-12). Only
 * PENDING/ACCEPTED/REJECTED exist; a rejected proof returns to PENDING on a
 * valid resubmission (T10). Accepted never changes (REQ-107 stays attached;
 * refund is manual — REQ-122 — and never a status).
 */
const PAYMENT_TRANSITIONS: ReadonlyMap<PaymentStatus, ReadonlySet<PaymentStatus>> = new Map<
  PaymentStatus,
  ReadonlySet<PaymentStatus>
>([
  ['PENDING', new Set(['ACCEPTED', 'REJECTED'])],
  ['REJECTED', new Set(['PENDING'])],
  ['ACCEPTED', new Set()],
]);

/**
 * Slot lock lifecycle (Section 26.3 / doc 08): created LOCKED by a successful
 * proof submission; LOCKED → ALLOCATED on owner acceptance; RELEASED at
 * lifecycle end or explicit owner release. No automatic expiry (OQ-SLOT-001).
 */
const SLOT_LOCK_TRANSITIONS: ReadonlyMap<SlotLockStatus, ReadonlySet<SlotLockStatus>> = new Map<
  SlotLockStatus,
  ReadonlySet<SlotLockStatus>
>([
  ['LOCKED', new Set(['ALLOCATED', 'RELEASED'])],
  ['ALLOCATED', new Set(['RELEASED'])],
  ['RELEASED', new Set()],
]);

function invalidTransitionError(from: string, to: string, code: ErrorCode): AppException {
  return new AppException(code, 409, 'Invalid state transition', {
    detail: `Transition ${from} → ${to} is not permitted in the current state.`,
  });
}

export function assertBookingTransition(from: BookingStatus, to: BookingStatus): void {
  if (!(BOOKING_TRANSITIONS.get(from)?.has(to) ?? false)) {
    throw invalidTransitionError(from, to, ErrorCodes.INVALID_TRANSITION);
  }
}

export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!(PAYMENT_TRANSITIONS.get(from)?.has(to) ?? false)) {
    throw invalidTransitionError(from, to, ErrorCodes.INVALID_TRANSITION);
  }
}

export function assertSlotLockTransition(from: SlotLockStatus, to: SlotLockStatus): void {
  if (!(SLOT_LOCK_TRANSITIONS.get(from)?.has(to) ?? false)) {
    throw invalidTransitionError(from, to, ErrorCodes.INVALID_TRANSITION);
  }
}

export function isTerminalBookingStatus(status: BookingStatus): boolean {
  return TERMINAL_BOOKING_STATUSES.has(status);
}
