/**
 * Prompt 23 — unit tests for the owner Telegram verification primitives
 * (REQ-065/066/067/068/120): action-token parsing, the mandatory rejection
 * reason rule shared with the dashboard, payment-method rendering, and the
 * owner notification content. Pure logic only — DB/authorization behaviour is
 * covered by the HTTP integration suite.
 */
import { describe, expect, it } from 'vitest';
import {
  parseOwnerCallback,
  parseOwnerRejectReason,
} from '../../src/notifications/owner-telegram.service';
import { createConnectToken } from '../../src/notifications/telegram-connection.service';
import {
  paymentMethodLabel,
  renderOwnerTelegramProof,
} from '../../src/notifications/notification-templates';

const PROOF = {
  bookingId: '00000000-0000-0000-0000-000000000001',
  businessName: 'Test Salon',
  customerName: 'Selam',
  customerPhone: '+251911000000',
  startAt: '2026-10-05T08:30:00.000Z',
  services: [{ name: 'Haircut', durationMinutes: 30 }],
  paymentMethod: 'BANK_TRANSFER',
  totalPriceMinor: 120000,
  prepaidMinor: 30000,
  submittedAt: '2026-10-05T08:31:00.000Z',
};

describe('parseOwnerCallback (REQ-067/068 action token)', () => {
  it('round-trips a real single-use token for both action kinds', () => {
    const token = createConnectToken();
    expect(token).toHaveLength(43);
    expect(parseOwnerCallback(`pv:accept:${token}`)).toEqual({ kind: 'ACCEPT', token });
    expect(parseOwnerCallback(`pv:reject:${token}`)).toEqual({ kind: 'REJECT', token });
  });

  it('rejects anything that is not an opaque action token', () => {
    // Never trust a booking/proof/business id (or any other public value).
    expect(parseOwnerCallback('pv:accept:00000000-0000-0000-0000-000000000001')).toBeNull();
    expect(parseOwnerCallback('pv:ACCEPT:abc')).toBeNull();
    expect(parseOwnerCallback('pv:accept')).toBeNull();
    expect(parseOwnerCallback('pv:accept:')).toBeNull();
    expect(parseOwnerCallback('accept:token')).toBeNull();
    expect(parseOwnerCallback('pv:approve:token')).toBeNull();
    expect(parseOwnerCallback('')).toBeNull();
  });

  it('rejects tokens of the wrong length or alphabet', () => {
    const good = createConnectToken();
    expect(parseOwnerCallback(`pv:accept:${good.slice(0, 42)}`)).toBeNull();
    expect(parseOwnerCallback(`pv:accept:${good.slice(0, 42)}!`)).toBeNull();
  });
});

describe('parseOwnerRejectReason (REQ-068 mandatory reason)', () => {
  it('requires a non-empty, trimmed reason', () => {
    expect(parseOwnerRejectReason(undefined)).toBeNull();
    expect(parseOwnerRejectReason('')).toBeNull();
    expect(parseOwnerRejectReason('    ')).toBeNull();
    expect(parseOwnerRejectReason('\n\t')).toBeNull();
  });

  it('accepts a reason and trims surrounding whitespace', () => {
    expect(parseOwnerRejectReason('  payment not received  ')).toBe('payment not received');
  });

  it('enforces the same 500-character ceiling as the dashboard API', () => {
    expect(parseOwnerRejectReason('x'.repeat(500))).toHaveLength(500);
    expect(parseOwnerRejectReason('x'.repeat(501))).toBeNull();
    // Whitespace must not let a 501-character body slip through.
    expect(parseOwnerRejectReason(` ${'x'.repeat(501)} `)).toBeNull();
  });
});

describe('paymentMethodLabel (REQ-066 message content)', () => {
  it('renders the stored enum values as human labels', () => {
    expect(paymentMethodLabel('BANK_TRANSFER')).toBe('Bank transfer');
    expect(paymentMethodLabel('TELEBIRR')).toBe('Telebirr');
    expect(paymentMethodLabel('TELEBIRR_MOBILE_MONEY')).toBe('Telebirr / mobile money');
  });

  it('falls back to a readable form instead of leaking raw enum casing', () => {
    expect(paymentMethodLabel('SOME_NEW_METHOD')).toBe('Some new method');
    expect(paymentMethodLabel(null)).toBe('—');
    expect(paymentMethodLabel(undefined)).toBe('—');
  });
});

describe('renderOwnerTelegramProof (REQ-066 content)', () => {
  it('carries every fact the owner needs to identify the payment', () => {
    const { text } = renderOwnerTelegramProof(PROOF);
    expect(text).toContain('Test Salon');
    expect(text).toContain('Selam');
    expect(text).toContain('+251911000000');
    expect(text).toContain('Haircut');
    expect(text).toContain('ETB 1200.00');
    expect(text).toContain('Bank transfer');
    expect(text).toContain('Prepaid required: ETB 300.00');
    expect(text).toContain('accept or reject');
  });

  it('omits the prepaid line when no deposit applies', () => {
    expect(renderOwnerTelegramProof({ ...PROOF, prepaidMinor: 0 }).text).not.toContain(
      'Prepaid required',
    );
  });

  it('never leaks action tokens, storage handles or seconds-precision timestamps', () => {
    const { text } = renderOwnerTelegramProof(PROOF);
    expect(text).not.toContain('pv:');
    expect(text).not.toContain('memory://');
    expect(text).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});
