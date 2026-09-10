import { describe, expect, it } from 'vitest';
import {
  MS_PER_DAY,
  PAID_GRACE_DAYS,
  REMINDER_LEAD_DAYS,
  TRIAL_DAYS,
  TRIAL_GRACE_DAYS,
  addDays,
  bookingEligible,
  derivedStatus,
  extendPaidPeriod,
  minuteTrunc,
  paidGraceEndsAtOf,
  reminderDecision,
  trialGraceEndsAtOf,
  type SubscriptionDates,
} from '../../src/subscription/subscription-lifecycle';

const NO_PAYMENTS: SubscriptionDates = {
  trialStartedAt: new Date('2026-01-01T00:00:00.000Z'),
  trialEndsAt: new Date('2026-01-31T00:00:00.000Z'),
  paidPeriodStartAt: null,
  paidEndsAt: null,
  paidGraceEndsAt: null,
};

function withPaid(overrides: Partial<SubscriptionDates> = {}): SubscriptionDates {
  const paidEndsAt = overrides.paidEndsAt ?? new Date('2026-01-30T00:00:00.000Z');
  return {
    trialStartedAt: new Date('2025-12-01T00:00:00.000Z'),
    trialEndsAt: new Date('2025-12-31T00:00:00.000Z'),
    paidPeriodStartAt: overrides.paidPeriodStartAt ?? new Date('2025-12-31T00:00:00.000Z'),
    paidEndsAt,
    paidGraceEndsAt: overrides.paidGraceEndsAt ?? paidGraceEndsAtOf(paidEndsAt),
  };
}

function at(iso: string): Date {
  return new Date(iso);
}

describe('minuteTrunc', () => {
  it('truncates sub-minute precision', () => {
    const d = at('2026-09-10T12:34:56.789Z');
    expect(minuteTrunc(d).toISOString()).toBe('2026-09-10T12:34:00.000Z');
  });
});

describe('addDays', () => {
  it('adds whole-day multiples (REQ-226)', () => {
    const base = new Date('2026-01-01T10:00:00.000Z');
    expect(addDays(base, 30).toISOString()).toBe('2026-01-31T10:00:00.000Z');
    expect(addDays(base, -2).toISOString()).toBe('2025-12-30T10:00:00.000Z');
  });
});

describe('derivedStatus (doc 15 §1)', () => {
  it('is TRIAL before the trial end and open for booking', () => {
    const dates = { ...NO_PAYMENTS, trialEndsAt: at('2026-01-31T00:00:00.000Z') };
    expect(derivedStatus(dates, at('2026-01-15T00:00:00.000Z'))).toBe('TRIAL');
    expect(bookingEligible('TRIAL')).toBe(true);
  });

  it('is TRIAL_GRACE during the 3-day trial grace (closed only after)', () => {
    const dates = { ...NO_PAYMENTS, trialEndsAt: at('2026-01-31T00:00:00.000Z') };
    const gracePeriod_1D = at('2026-02-01T10:00:00.000Z');
    expect(derivedStatus(dates, gracePeriod_1D)).toBe('TRIAL_GRACE');
    expect(bookingEligible('TRIAL_GRACE')).toBe(true);
    const afterGrace = at('2026-02-03T01:00:00.000Z');
    expect(derivedStatus(dates, afterGrace)).toBe('EXPIRED');
    expect(bookingEligible('EXPIRED')).toBe(false);
  });

  it('is ACTIVE under a valid paid period', () => {
    const dates = withPaid({ paidEndsAt: at('2026-01-30T00:00:00.000Z') });
    expect(derivedStatus(dates, at('2026-01-15T12:00:00.000Z'))).toBe('ACTIVE');
  });

  it('is PAID_GRACE after paidEndsAt within the 5-day grace, EXPIRED after', () => {
    const dates = withPaid({ paidEndsAt: at('2026-01-30T00:00:00.000Z') });
    expect(derivedStatus(dates, at('2026-02-01T00:00:00.000Z'))).toBe('PAID_GRACE');
    expect(derivedStatus(dates, at('2026-02-04T00:00:00.000Z'))).toBe('PAID_GRACE');
    expect(derivedStatus(dates, at('2026-02-04T00:00:01.000Z'))).toBe('EXPIRED');
  });

  it('prefers the paid track whenever paidEndsAt exists', () => {
    const dates = withPaid();
    // trial would be long over — paid track governs.
    expect(derivedStatus(dates, at('2026-01-20T00:00:00.000Z'))).toBe('ACTIVE');
  });

  it('is NONE without any boundaries', () => {
    expect(
      derivedStatus(
        {
          trialStartedAt: null,
          trialEndsAt: null,
          paidPeriodStartAt: null,
          paidEndsAt: null,
          paidGraceEndsAt: null,
        },
        at('2026-01-01T00:00:00.000Z'),
      ),
    ).toBe('NONE');
  });

  it('is inclusive at the grace boundary (t <= graceEnd)', () => {
    const dates = { ...NO_PAYMENTS, trialEndsAt: at('2026-01-31T00:00:00.000Z') };
    const graceLastInstant = trialGraceEndsAtOf(at('2026-01-31T00:00:00.000Z'));
    expect(derivedStatus(dates, graceLastInstant)).toBe('TRIAL_GRACE');
  });
});

describe('trialGraceEndsAtOf / paidGraceEndsAtOf', () => {
  it('adds 3 / 5 days', () => {
    expect(trialGraceEndsAtOf(at('2026-01-31T00:00:00.000Z')).toISOString()).toBe(
      '2026-02-03T00:00:00.000Z',
    );
    expect(paidGraceEndsAtOf(at('2026-01-30T00:00:00.000Z')).toISOString()).toBe(
      '2026-02-04T00:00:00.000Z',
    );
  });
});

describe('extendPaidPeriod (doc 15 §2)', () => {
  it('extends an ACTIVE subscription contiguously from its current end', () => {
    const dates = withPaid({ paidEndsAt: at('2026-02-10T00:00:00.000Z') });
    const ext = extendPaidPeriod(dates, at('2026-01-15T00:00:00.000Z'));
    expect(ext.paidPeriodStartAt.toISOString()).toBe('2026-02-10T00:00:00.000Z');
    expect(ext.paidEndsAt.toISOString()).toBe('2026-03-12T00:00:00.000Z');
  });

  it('starts a fresh 30 days from now for an expired/never-paid band', () => {
    const dates = withPaid({ paidEndsAt: at('2025-12-01T00:00:00.000Z') });
    const ext = extendPaidPeriod(dates, at('2026-01-15T12:34:56.000Z'));
    expect(ext.paidPeriodStartAt.toISOString()).toBe('2026-01-15T12:34:00.000Z');
    expect(ext.paidEndsAt.toISOString()).toBe('2026-02-14T12:34:00.000Z');
  });
});

describe('reminderDecision (doc 15 §4)', () => {
  it('nudges inside the 3-day lead before paidEndsAt (PAID_END)', () => {
    const paidEndsAt = at('2026-02-01T00:00:00.000Z');
    const dates = withPaid({ paidEndsAt });
    const decision = reminderDecision(dates, at('2026-01-30T00:00:00.000Z'));
    expect(decision).toEqual({ kind: 'PAID_END', boundaryAt: paidEndsAt });
  });

  it('reminds once when the paid grace starts (PAID_GRACE)', () => {
    const paidEndsAt = at('2026-01-30T00:00:00.000Z');
    const dates = withPaid({ paidEndsAt });
    const decision = reminderDecision(dates, at('2026-02-01T00:00:00.000Z'));
    expect(decision).toEqual({ kind: 'PAID_GRACE', boundaryAt: paidEndsAt });
  });

  it('nudges inside the last 3 lead days of the trial (TRIAL_END)', () => {
    const trialEndsAt = at('2026-01-31T00:00:00.000Z');
    const dates = { ...NO_PAYMENTS, trialEndsAt };
    expect(reminderDecision(dates, at('2026-01-29T00:00:00.000Z'))).toEqual({
      kind: 'TRIAL_END',
      boundaryAt: trialEndsAt,
    });
  });

  it('reminds once when the trial grace starts (TRIAL_GRACE)', () => {
    const trialEndsAt = at('2026-01-31T00:00:00.000Z');
    const dates = { ...NO_PAYMENTS, trialEndsAt };
    expect(reminderDecision(dates, at('2026-02-01T00:00:00.000Z'))).toEqual({
      kind: 'TRIAL_GRACE',
      boundaryAt: trialEndsAt,
    });
  });

  it('is null for an ACTIVE subscription well before the lead window', () => {
    const dates = withPaid({ paidEndsAt: at('2026-04-01T00:00:00.000Z') });
    expect(reminderDecision(dates, at('2026-01-15T00:00:00.000Z'))).toBeNull();
  });

  it('is null with no boundaries', () => {
    const empty: SubscriptionDates = {
      trialStartedAt: null,
      trialEndsAt: null,
      paidPeriodStartAt: null,
      paidEndsAt: null,
      paidGraceEndsAt: null,
    };
    expect(reminderDecision(empty, at('2026-01-15T00:00:00.000Z'))).toBeNull();
  });
});

describe('published constants', () => {
  it('exposes the platform policy values', () => {
    expect(TRIAL_DAYS).toBe(30);
    expect(TRIAL_GRACE_DAYS).toBe(3);
    expect(PAID_GRACE_DAYS).toBe(5);
    expect(REMINDER_LEAD_DAYS).toBe(3);
    void MS_PER_DAY;
  });
});
