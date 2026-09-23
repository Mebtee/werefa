import { describe, expect, it } from 'vitest';
import {
  deriveCanonicalStatus,
  isEligibleAt,
  nextPeriodEndsAt,
  paidGraceEndsAfter,
  TRIAL_DAYS,
  TRIAL_GRACE_DAYS,
  PAID_PERIOD_DAYS,
  PAID_GRACE_DAYS,
} from '../lib/subscription-lifecycle';

/**
 * Pure time-derived subscription status (Prompt 52; spec §17 timeframe):
 * 30d trial → 3d trial grace → 30d per approved proof → 5d paid grace.
 * Paid band supersedes the trial band; runtime cost is zero (pure derivation,
 * no persistence in this spec).
 */

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-09-23T12:00:00.000Z');
const trial = {
  trialStartedAt: now,
  trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY),
  trialGraceEndsAt: new Date(now.getTime() + (TRIAL_DAYS + TRIAL_GRACE_DAYS) * DAY),
  periodEndsAt: null,
  paidGraceEndsAt: null,
};

describe('deriveCanonicalStatus timeline', () => {
  it('fresh trial reads TRIAL and is eligible', () => {
    expect(deriveCanonicalStatus(trial, now)).toBe('TRIAL');
    expect(isEligibleAt({ status: 'TRIAL', ...trial }, now)).toBe(true);
  });

  it('after the trial, TRIAL_GRACE for exactly 3 days, then EXPIRED', () => {
    const afterTrial = new Date(now.getTime() + TRIAL_DAYS * DAY + DAY);
    expect(deriveCanonicalStatus(trial, afterTrial)).toBe('TRIAL_GRACE');
    expect(isEligibleAt({ status: 'TRIAL_GRACE', ...trial }, afterTrial)).toBe(true);

    const afterGrace = new Date(now.getTime() + (TRIAL_DAYS + TRIAL_GRACE_DAYS) * DAY + DAY);
    expect(deriveCanonicalStatus(trial, afterGrace)).toBe('EXPIRED');
    expect(isEligibleAt({ status: 'EXPIRED', ...trial }, afterGrace)).toBe(false);
  });

  it('an approval stops the trial band: paid period reads ACTIVE immediately (REQ-130)', () => {
    const paid = {
      ...trial,
      periodEndsAt: new Date(now.getTime() + PAID_PERIOD_DAYS * DAY),
      paidGraceEndsAt: paidGraceEndsAfter(new Date(now.getTime() + PAID_PERIOD_DAYS * DAY)),
    };
    // The trial would still be open, but the paid band supersedes it.
    expect(deriveCanonicalStatus(paid, now)).toBe('ACTIVE');
    expect(isEligibleAt({ status: 'ACTIVE', ...paid }, now)).toBe(true);
  });

  it('a lapsed paid period enters PAID_GRACE for 5 days then EXPIRED (REQ-131/133)', () => {
    const ended = new Date(now.getTime() - DAY);
    // Trial band long lapsed (the paid band supersedes it while active).
    const paid = {
      trialStartedAt: new Date(now.getTime() - 90 * DAY),
      trialEndsAt: new Date(now.getTime() - 60 * DAY),
      trialGraceEndsAt: new Date(now.getTime() - 57 * DAY),
      periodEndsAt: ended,
      paidGraceEndsAt: paidGraceEndsAfter(ended),
    };
    expect(deriveCanonicalStatus(paid, now)).toBe('PAID_GRACE');
    expect(isEligibleAt({ status: 'PAID_GRACE', ...paid }, now)).toBe(true);

    const expired = { ...paid, paidGraceEndsAt: new Date(now.getTime() - DAY) };
    expect(deriveCanonicalStatus(expired, now)).toBe('EXPIRED');
    expect(isEligibleAt({ status: 'EXPIRED', ...expired }, now)).toBe(false);
  });

  it('a row with no trial at all reads NONE-ish EXPIRED and never books (REQ-134 keeps page)', () => {
    expect(deriveCanonicalStatus({ trialEndsAt: null, trialGraceEndsAt: null, periodEndsAt: null, paidGraceEndsAt: null }, now)).toBe('EXPIRED');
    expect(isEligibleAt({ status: 'NONE', trialEndsAt: null, trialGraceEndsAt: null, periodEndsAt: null, paidGraceEndsAt: null }, now)).toBe(false);
  });
});

describe('nextPeriodEndsAt (REQ-130) + grace', () => {
  it('starts exactly 30 days from now when nothing is covered', () => {
    const periodEnd = nextPeriodEndsAt({ periodEndsAt: null, paidGraceEndsAt: null }, now);
    expect(periodEnd.getTime()).toBe(now.getTime() + PAID_PERIOD_DAYS * DAY);
    expect(paidGraceEndsAfter(periodEnd).getTime()).toBe(periodEnd.getTime() + PAID_GRACE_DAYS * DAY);
  });

  it('extends from max(periodEndsAt, paidGraceEndsAt) when still covered (never double-counts)', () => {
    const periodEndsAt = new Date(now.getTime() + 10 * DAY);
    const paidGraceEndsAt = paidGraceEndsAfter(periodEndsAt);
    const next = nextPeriodEndsAt({ periodEndsAt, paidGraceEndsAt }, now);
    expect(next.getTime()).toBe(paidGraceEndsAt.getTime() + PAID_PERIOD_DAYS * DAY);
  });

  it('ignores already-expired coverage and measures from now', () => {
    const past = new Date(now.getTime() - 5 * DAY);
    const next = nextPeriodEndsAt({ periodEndsAt: past, paidGraceEndsAt: past }, now);
    expect(next.getTime()).toBe(now.getTime() + PAID_PERIOD_DAYS * DAY);
  });
});