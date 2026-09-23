import { Subscription, SubscriptionStatus } from '@prisma/client';

/**
 * Canonical subscription lifecycle derivation (Prompt 52; spec §17, REQ-125 …
 * REQ-141).
 *
 * Time-based status is DERIVED from the persisted band timestamps, never from
 * a stored counter: 30-day trial (REQ-128) → 3-day trial grace (REQ-129) →
 * 30-day paid period per approval (REQ-130) → 5-day paid grace (REQ-131) →
 * expired. Bookings continue during any grace (REQ-132); after grace new
 * bookings close (REQ-133); the public page stays visible (REQ-134).
 *
 * An approval stops the trial band: activating a paid period (REQ-130) makes
 * `periodEndsAt` authoritative, so during an approved period the subscription
 * reads ACTIVE regardless of the remaining trial window (the owner who pays
 * early starts their paid month immediately).
 */

export const ELIGIBLE_FOR_BOOKINGS: ReadonlySet<SubscriptionStatus> = new Set([
  'TRIAL',
  'TRIAL_GRACE',
  'ACTIVE',
  'PAID_GRACE',
]);

/** Whether a persisted status accepts new bookings (status-set check only). */
export function isEligible(status: SubscriptionStatus): boolean {
  return ELIGIBLE_FOR_BOOKINGS.has(status);
}

/**
 * The canonical status implied by the band timestamps at `now`.
 *
 * Resolution order: the paid band (whenever `periodEndsAt` is set) supersedes
 * the trial band. Expiry is the fall-through. A row with no trial at all
 * (`NONE`) is never eligible.
 */
export function deriveCanonicalStatus(
  sub: Pick<Subscription, 'trialEndsAt' | 'trialGraceEndsAt' | 'periodEndsAt' | 'paidGraceEndsAt'>,
  now: Date | number,
): SubscriptionStatus {
  const at = typeof now === 'number' ? new Date(now) : now;
  if (sub.periodEndsAt && at.getTime() < sub.periodEndsAt.getTime()) return 'ACTIVE';
  if (sub.paidGraceEndsAt && at.getTime() < sub.paidGraceEndsAt.getTime()) return 'PAID_GRACE';
  if (sub.trialEndsAt && at.getTime() < sub.trialEndsAt.getTime()) return 'TRIAL';
  if (sub.trialGraceEndsAt && at.getTime() < sub.trialGraceEndsAt.getTime()) return 'TRIAL_GRACE';
  return 'EXPIRED';
}

/** A subscription accepts booking requests right now (timestamp-aware). */
export function isEligibleAt(
  sub: Pick<Subscription, 'status' | 'trialEndsAt' | 'trialGraceEndsAt' | 'periodEndsAt' | 'paidGraceEndsAt'>,
  now: Date | number,
): boolean {
  return isEligible(deriveCanonicalStatus(sub, now));
}

export const TRIAL_DAYS = 30;
export const TRIAL_GRACE_DAYS = 3;
export const PAID_PERIOD_DAYS = 30;
export const PAID_GRACE_DAYS = 5;

/** Start of the next paid period (REQ-130): max(now, current coverage) + 30d. */
export function nextPeriodEndsAt(current: Pick<Subscription, 'periodEndsAt' | 'paidGraceEndsAt'>, now: Date): Date {
  const coverage = [current.periodEndsAt, current.paidGraceEndsAt]
    .filter((d): d is Date => d !== null && d.getTime() > now.getTime())
    .reduce<Date | null>((latest, d) => (latest === null || d.getTime() > latest.getTime() ? d : latest), null);
  const base = coverage ?? now;
  return new Date(base.getTime() + PAID_PERIOD_DAYS * 24 * 60 * 60 * 1000);
}

export function paidGraceEndsAfter(periodEndsAt: Date): Date {
  return new Date(periodEndsAt.getTime() + PAID_GRACE_DAYS * 24 * 60 * 60 * 1000);
}