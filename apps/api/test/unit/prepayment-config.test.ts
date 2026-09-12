import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '@werefa/shared';
import {
  derivePrepaidMinor,
  toPrepaymentConfig,
  type PrepaymentSettingsRow,
} from '../../apps/api/src/business/prepayment-config.service';
import { parsePrepaymentConfigInput } from '../../apps/api/src/business/prepayment-input';

/**
 * Prompt 21 — REQ-110/111 prepayment derivation and owner-provided config
 * validation. The pure math (percentage floor, fixed passthrough, disabled
 * zero) is pinned without a DB; input parsing rejects the mixed form and
 * out-of-range values that REQ-111 AC1 requires.
 */

function row(over: Partial<PrepaymentSettingsRow> = {}): PrepaymentSettingsRow {
  return {
    prepaymentEnabled: false,
    prepaymentType: null,
    prepaymentPercentage: null,
    prepaymentFixedMinor: null,
    ...over,
  };
}

function validationCode(run: () => void): void {
  let caught: { code?: string } | undefined;
  try {
    run();
  } catch (err) {
    caught = err as { code?: string };
  }
  expect(caught?.code).toBe(ErrorCodes.VALIDATION_ERROR);
}

describe('derivePrepaidMinor', () => {
  it('returns 0 when prepayment is disabled', () => {
    expect(derivePrepaidMinor(row(), 25_000n)).toBe(0n);
  });

  it('computes a percentage as floor(total * pct / 100)', () => {
    const r = row({
      prepaymentEnabled: true,
      prepaymentType: 'PERCENTAGE',
      prepaymentPercentage: 20,
    });
    expect(derivePrepaidMinor(r, 25_000n)).toBe(5_000n); // 20% of 250 ETB
    expect(derivePrepaidMinor(r, 1n)).toBe(0n); // floor(0.2) = 0
    expect(derivePrepaidMinor(r, 7_500n)).toBe(1_500n); // 75 ETB → 15 ETB
  });

  it('passes through the fixed minor amount regardless of the total', () => {
    const r = row({
      prepaymentEnabled: true,
      prepaymentType: 'FIXED',
      prepaymentFixedMinor: 10_000n,
    });
    expect(derivePrepaidMinor(r, 25_000n)).toBe(10_000n);
    expect(derivePrepaidMinor(r, 5_000n)).toBe(10_000n);
  });

  it('returns 0 for a malformed row (defensive default)', () => {
    expect(
      derivePrepaidMinor(row({ prepaymentEnabled: true, prepaymentType: 'PERCENTAGE' }), 10_000n),
    ).toBe(0n);
    expect(
      derivePrepaidMinor(row({ prepaymentEnabled: true, prepaymentType: null }), 10_000n),
    ).toBe(0n);
  });
});

describe('toPrepaymentConfig', () => {
  it('normalizes disabled rows to a null mode', () => {
    expect(toPrepaymentConfig(row({ prepaymentType: 'FIXED', prepaymentFixedMinor: 1n }))).toEqual({
      enabled: false,
      type: null,
      percentage: null,
      fixedMinor: null,
    });
  });

  it('maps PERCENTAGE rows', () => {
    expect(
      toPrepaymentConfig(
        row({ prepaymentEnabled: true, prepaymentType: 'PERCENTAGE', prepaymentPercentage: 15 }),
      ),
    ).toEqual({ enabled: true, type: 'PERCENTAGE', percentage: 15, fixedMinor: null });
  });

  it('maps FIXED rows', () => {
    expect(
      toPrepaymentConfig(
        row({ prepaymentEnabled: true, prepaymentType: 'FIXED', prepaymentFixedMinor: 8_500n }),
      ),
    ).toEqual({ enabled: true, type: 'FIXED', percentage: null, fixedMinor: 8_500 });
  });
});

describe('parsePrepaymentConfigInput', () => {
  it('accepts disabling', () => {
    expect(parsePrepaymentConfigInput({ enabled: false })).toEqual({ enabled: false });
    expect(parsePrepaymentConfigInput({ enabled: false, type: 'FIXED' })).toEqual({
      enabled: false,
    });
  });

  it('requires the enabled flag', () => {
    validationCode(() => parsePrepaymentConfigInput({}));
    validationCode(() => parsePrepaymentConfigInput({ enabled: 'yes' }));
  });

  it('accepts a percentage in range', () => {
    expect(
      parsePrepaymentConfigInput({ enabled: true, type: 'PERCENTAGE', percentage: 20 }),
    ).toEqual({ enabled: true, type: 'PERCENTAGE', percentage: 20 });
    expect(
      parsePrepaymentConfigInput({ enabled: true, type: 'PERCENTAGE', percentage: 1 }),
    ).toEqual({ enabled: true, type: 'PERCENTAGE', percentage: 1 });
    expect(
      parsePrepaymentConfigInput({ enabled: true, type: 'PERCENTAGE', percentage: 100 }),
    ).toEqual({ enabled: true, type: 'PERCENTAGE', percentage: 100 });
  });

  it('rejects percentage out of range', () => {
    validationCode(() =>
      parsePrepaymentConfigInput({ enabled: true, type: 'PERCENTAGE', percentage: 0 }),
    );
    validationCode(() =>
      parsePrepaymentConfigInput({ enabled: true, type: 'PERCENTAGE', percentage: 101 }),
    );
    validationCode(() =>
      parsePrepaymentConfigInput({ enabled: true, type: 'PERCENTAGE', percentage: '20' }),
    );
  });

  it('accepts a fixed minor amount (number, string or bigint)', () => {
    expect(parsePrepaymentConfigInput({ enabled: true, type: 'FIXED', fixedMinor: 5_000 })).toEqual(
      { enabled: true, type: 'FIXED', fixedMinor: 5_000n },
    );
    expect(
      parsePrepaymentConfigInput({ enabled: true, type: 'FIXED', fixedMinor: '5000' }),
    ).toEqual({ enabled: true, type: 'FIXED', fixedMinor: 5_000n });
    expect(
      parsePrepaymentConfigInput({ enabled: true, type: 'FIXED', fixedMinor: 5_000n }),
    ).toEqual({ enabled: true, type: 'FIXED', fixedMinor: 5_000n });
  });

  it('rejects non-positive fixed amounts', () => {
    validationCode(() =>
      parsePrepaymentConfigInput({ enabled: true, type: 'FIXED', fixedMinor: 0 }),
    );
    validationCode(() =>
      parsePrepaymentConfigInput({ enabled: true, type: 'FIXED', fixedMinor: -1 }),
    );
    validationCode(() =>
      parsePrepaymentConfigInput({ enabled: true, type: 'FIXED', fixedMinor: 1.5 }),
    );
  });

  it('rejects mixing percentage and fixed (REQ-111 AC1)', () => {
    validationCode(() =>
      parsePrepaymentConfigInput({
        enabled: true,
        type: 'PERCENTAGE',
        percentage: 20,
        fixedMinor: 5_000,
      }),
    );
    validationCode(() =>
      parsePrepaymentConfigInput({
        enabled: true,
        type: 'FIXED',
        fixedMinor: 5_000,
        percentage: 20,
      }),
    );
  });

  it('rejects an unknown type', () => {
    validationCode(() =>
      parsePrepaymentConfigInput({ enabled: true, type: 'OTHER', percentage: 20 }),
    );
  });
});
