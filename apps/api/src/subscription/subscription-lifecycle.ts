import {
  SUBSCRIPTION_PAID_DAYS,
  SUBSCRIPTION_PAID_GRACE_DAYS,
  SUBSCRIPTION_REMINDER_LEAD_DAYS,
  SUBSCRIPTION_TRIAL_DAYS,
  SUBSCRIPTION_TRIAL_GRACE_DAYS,
} from '@werefa/shared';
import type { SubscriptionStatus } from '@prisma/client';

/**
 * Subscription & billing domain rules (Prompt 14, REQ-125..141, doc 15).
 *
 * This module is PURE and unit-tested: it holds the entire state/date model so
 * the DB layer, controllers and job executor all agree on boundaries. All
 * instants are minute-precision (REQ-226); day offsets are exact multiples of
 * 86400000 ms (wall-clock "30 days / 3 days / 5 days", NOT calendar months —
 * doc 15 §1).
 *
 * Status derivation (doc 15 §1) is authoritative-at-query-time: the current
 * band is derived from the stored boundary dates, never from a persisted
 * `status` value. The persisted status column is refreshed by the lifecycle job
 * for reporting/history only. Booking eligibility (REQ-131/132/133/135):
 * bookings stay open during TRIAL, TRIAL_GRACE, ACTIVE and PAID_GRACE; they are
 * blocked only in EXPIRED.
 */

export const MS_PER_DAY = 86_400_000;

export const TRIAL_DAYS = SUBSCRIPTION_TRIAL_DAYS;
export const TRIAL_GRACE_DAYS = SUBSCRIPTION_TRIAL_GRACE_DAYS;
export const PAID_DAYS = SUBSCRIPTION_PAID_DAYS;
export const PAID_GRACE_DAYS = SUBSCRIPTION_PAID_GRACE_DAYS;
export const REMINDER_LEAD_DAYS = SUBSCRIPTION_REMINDER_LEAD_DAYS;

/** Authoritative subscription period boundaries (the state machine's input). */
export interface SubscriptionDates {
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  paidPeriodStartAt: Date | null;
  paidEndsAt: Date | null;
  paidGraceEndsAt: Date | null;
}

/** The subscription row as persisted (superset of the derivation input). */
export interface SubscriptionRow extends SubscriptionDates {
  id: string;
  businessId: string;
  status: SubscriptionStatus;
}

/** Truncate to the minute so boundaries are whole minutes (REQ-226). */
export function minuteTrunc(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 60_000) * 60_000);
}

export function addDays(d: Date, days: number): Date {
  return new Date(minuteTrunc(d).getTime() + days * MS_PER_DAY);
}

export function trialGraceEndsAtOf(trialEndsAt: Date): Date {
  return addDays(trialEndsAt, TRIAL_GRACE_DAYS);
}

export function paidGraceEndsAtOf(paidEndsAt: Date): Date {
  return addDays(paidEndsAt, PAID_GRACE_DAYS);
}

/** Derived current status from the authoritative dates (doc 15 §1). */
export function derivedStatus(dates: SubscriptionDates, now = new Date()): SubscriptionStatus {
  const t = now.getTime();

  // Paid track governs once a payment has ever been approved (paidEndsAt set).
  // An approval always sets paidEndsAt >= trialEndsAt (see extendPaidPeriod),
  // so checking the paid track first is always correct.
  if (dates.paidEndsAt !== null) {
    if (t < dates.paidEndsAt.getTime()) return 'ACTIVE';
    const graceEnd = dates.paidGraceEndsAt ?? paidGraceEndsAtOf(dates.paidEndsAt);
    if (t <= graceEnd.getTime()) return 'PAID_GRACE';
    return 'EXPIRED';
  }

  // Trial track (no approved payment yet).
  if (dates.trialEndsAt !== null) {
    if (t < dates.trialEndsAt.getTime()) return 'TRIAL';
    const graceEnd = trialGraceEndsAtOf(dates.trialEndsAt);
    if (t <= graceEnd.getTime()) return 'TRIAL_GRACE';
    return 'EXPIRED';
  }

  return 'NONE';
}

/** REQ-131/132/133/135: new bookings are blocked ONLY in EXPIRED. */
export function bookingEligible(status: SubscriptionStatus): boolean {
  return status !== 'EXPIRED';
}

/**
 * Extension rule on payment approval (doc 15 §2, REQ-130/137): an approved
 * payment extends the ACTIVE period by 30 days. An ACTIVE subscription extends
 * contiguously from its CURRENT end; any earlier band (trial / grace /
 * expired / never-paid) starts a fresh 30-day period from now.
 */
export function extendPaidPeriod(
  dates: SubscriptionDates,
  now = new Date(),
): { paidPeriodStartAt: Date; paidEndsAt: Date } {
  const anchor =
    dates.paidEndsAt !== null && dates.paidEndsAt.getTime() > now.getTime()
      ? dates.paidEndsAt
      : minuteTrunc(now);
  return {
    paidPeriodStartAt: anchor,
    paidEndsAt: addDays(anchor, PAID_DAYS),
  };
}

export type ReminderKind = 'PAID_END' | 'TRIAL_END' | 'PAID_GRACE' | 'TRIAL_GRACE';

export interface ReminderDecision {
  kind: ReminderKind;
  /** The band whose lapse the reminder warns about (paidEndsAt or trialEndsAt). */
  boundaryAt: Date;
}

/**
 * Renewal-reminder decision (doc 15 §4, REQ-139/140): reminds the owner inside
 * the lead window before the current paid/trial band lapses, plus one reminder
 * as soon as a grace band begins. Null when no reminder applies at `now`.
 * Deduplication (a reminder must be queued at most once) is handled by the job
 * via the notification outbox, not here.
 */
export function reminderDecision(
  dates: SubscriptionDates,
  now = new Date(),
): ReminderDecision | null {
  const status = derivedStatus(dates, now);
  const lead = REMINDER_LEAD_DAYS * MS_PER_DAY;

  if (dates.paidEndsAt !== null) {
    if (status === 'ACTIVE' && now.getTime() >= dates.paidEndsAt.getTime() - lead) {
      return { kind: 'PAID_END', boundaryAt: dates.paidEndsAt };
    }
    if (status === 'PAID_GRACE') {
      return { kind: 'PAID_GRACE', boundaryAt: dates.paidEndsAt };
    }
    return null;
  }

  if (dates.trialEndsAt !== null) {
    if (status === 'TRIAL' && now.getTime() >= dates.trialEndsAt.getTime() - lead) {
      return { kind: 'TRIAL_END', boundaryAt: dates.trialEndsAt };
    }
    if (status === 'TRIAL_GRACE') {
      return { kind: 'TRIAL_GRACE', boundaryAt: dates.trialEndsAt };
    }
    return null;
  }

  return null;
}
