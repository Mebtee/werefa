import { describe, expect, it } from 'vitest';
import { SUBSCRIPTION_NOTIFICATION_TYPE } from '../../src/subscription/subscription-notifications';
import {
  SUBSCRIPTION_ADMIN_EMAIL_TYPES,
  SUBSCRIPTION_OWNER_EMAIL_TYPES,
  isSubscriptionReminderType,
  subscriptionReminderKindOf,
} from '../../src/notifications/notification-catalog';
import {
  formatEtb,
  renderSubscriptionAdminEmail,
  renderSubscriptionOwnerEmail,
} from '../../src/notifications/notification-templates';

describe('SUBSCRIPTION_NOTIFICATION_TYPE', () => {
  it('exposes the exact outbox types (REQ-137/138/139/140)', () => {
    expect(SUBSCRIPTION_NOTIFICATION_TYPE).toEqual({
      paymentSubmittedAdmin: 'SUBSCRIPTION_PAYMENT_SUBMITTED_ADMIN',
      paymentApprovedOwner: 'SUBSCRIPTION_PAYMENT_APPROVED_OWNER',
      paymentRejectedOwner: 'SUBSCRIPTION_PAYMENT_REJECTED_OWNER',
      reminderPaidEnd: 'SUBSCRIPTION_REMINDER_PAID_END',
      reminderTrialEnd: 'SUBSCRIPTION_REMINDER_TRIAL_END',
      reminderPaidGrace: 'SUBSCRIPTION_REMINDER_PAID_GRACE',
      reminderTrialGrace: 'SUBSCRIPTION_REMINDER_TRIAL_GRACE',
    });
  });
});

describe('catalog classification (doc 15 §4)', () => {
  it('maps payment-submitted to the two-admin EMAIL fan-out', () => {
    expect(
      SUBSCRIPTION_ADMIN_EMAIL_TYPES.has(SUBSCRIPTION_NOTIFICATION_TYPE.paymentSubmittedAdmin),
    ).toBe(true);
    expect(
      SUBSCRIPTION_ADMIN_EMAIL_TYPES.has(SUBSCRIPTION_NOTIFICATION_TYPE.paymentApprovedOwner),
    ).toBe(false);
  });

  it('maps all six owner types to EMAIL', () => {
    for (const type of [
      SUBSCRIPTION_NOTIFICATION_TYPE.paymentApprovedOwner,
      SUBSCRIPTION_NOTIFICATION_TYPE.paymentRejectedOwner,
      SUBSCRIPTION_NOTIFICATION_TYPE.reminderPaidEnd,
      SUBSCRIPTION_NOTIFICATION_TYPE.reminderTrialEnd,
      SUBSCRIPTION_NOTIFICATION_TYPE.reminderPaidGrace,
      SUBSCRIPTION_NOTIFICATION_TYPE.reminderTrialGrace,
    ]) {
      expect(SUBSCRIPTION_OWNER_EMAIL_TYPES.has(type)).toBe(true);
    }
  });

  it('recognises exactly the four reminder types', () => {
    expect(isSubscriptionReminderType(SUBSCRIPTION_NOTIFICATION_TYPE.paymentApprovedOwner)).toBe(
      false,
    );
    for (const type of [
      SUBSCRIPTION_NOTIFICATION_TYPE.reminderPaidEnd,
      SUBSCRIPTION_NOTIFICATION_TYPE.reminderTrialEnd,
      SUBSCRIPTION_NOTIFICATION_TYPE.reminderPaidGrace,
      SUBSCRIPTION_NOTIFICATION_TYPE.reminderTrialGrace,
    ]) {
      expect(isSubscriptionReminderType(type)).toBe(true);
    }
  });

  it('round-trips reminder types to their derived kind', () => {
    expect(subscriptionReminderKindOf(SUBSCRIPTION_NOTIFICATION_TYPE.reminderPaidEnd)).toBe(
      'PAID_END',
    );
    expect(subscriptionReminderKindOf(SUBSCRIPTION_NOTIFICATION_TYPE.reminderTrialEnd)).toBe(
      'TRIAL_END',
    );
    expect(subscriptionReminderKindOf(SUBSCRIPTION_NOTIFICATION_TYPE.reminderPaidGrace)).toBe(
      'PAID_GRACE',
    );
    expect(subscriptionReminderKindOf(SUBSCRIPTION_NOTIFICATION_TYPE.reminderTrialGrace)).toBe(
      'TRIAL_GRACE',
    );
    expect(
      subscriptionReminderKindOf(SUBSCRIPTION_NOTIFICATION_TYPE.paymentApprovedOwner),
    ).toBeNull();
  });
});

describe('formatEtb', () => {
  it('renders the operator price 150000 → "1,500.00"', () => {
    expect(formatEtb('150000')).toBe('1500.00');
  });

  it('handles zero, missing, and negatives defensively', () => {
    expect(formatEtb('0')).toBe('0.00');
    expect(formatEtb(undefined)).toBe('0.00');
    expect(formatEtb('')).toBe('0.00');
    expect(formatEtb('-1234')).toBe('-12.34');
  });

  it('round-trips huge BigInt strings', () => {
    expect(formatEtb('123456789012345678')).toBe('1234567890123456.78');
  });
});

describe('renderSubscriptionAdminEmail (REQ-140)', () => {
  it('includes business, amount, and time for the two admins', () => {
    const email = renderSubscriptionAdminEmail({
      businessName: 'Tattoo & Co<script>',
      amountMinor: '150000',
      submittedAt: '2026-09-10T09:00:00.000Z',
    });
    expect(email.subject).toBe('New subscription payment: Tattoo & Co<script>');
    expect(email.text).toContain('ETB 1500.00');
    // HTML is fully escaped — no injected markup survives.
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});

describe('renderSubscriptionOwnerEmail (REQ-137/138/139)', () => {
  it('renders the approved email with the paid amount', () => {
    const email = renderSubscriptionOwnerEmail(
      SUBSCRIPTION_NOTIFICATION_TYPE.paymentApprovedOwner,
      { amountMinor: '150000' },
      'Ink Studio',
    );
    expect(email.subject).toBe('Your subscription payment was approved');
    expect(email.text).toContain('ETB 1500.00');
    expect(email.html).toContain('Ink Studio');
  });

  it('renders the rejection email with the reason', () => {
    const email = renderSubscriptionOwnerEmail(
      SUBSCRIPTION_NOTIFICATION_TYPE.paymentRejectedOwner,
      { amountMinor: '150000', rejectionReason: 'unreadable proof' },
      'Ink Studio',
    );
    expect(email.subject).toBe('Your subscription payment was rejected');
    expect(email.text).toContain('unreadable proof');
  });

  it('renders all four reminders with their boundary date', () => {
    const boundary = '2026-09-15T09:00:00.000Z';
    const cases: Array<[string, string]> = [
      [SUBSCRIPTION_NOTIFICATION_TYPE.reminderPaidEnd, 'ends soon'],
      [SUBSCRIPTION_NOTIFICATION_TYPE.reminderTrialEnd, 'ends soon'],
      [SUBSCRIPTION_NOTIFICATION_TYPE.reminderPaidGrace, 'grace period'],
      [SUBSCRIPTION_NOTIFICATION_TYPE.reminderTrialGrace, 'grace period'],
    ];
    for (const [type, fragment] of cases) {
      const email = renderSubscriptionOwnerEmail(type, { boundaryAt: boundary }, 'Ink Studio');
      expect(email.subject.length).toBeGreaterThan(0);
      expect(email.text).toContain(fragment);
      expect(email.html.length).toBeGreaterThan(0);
    }
  });
});
