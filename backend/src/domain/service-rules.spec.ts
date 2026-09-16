import { describe, expect, it } from 'vitest';
import { validateSlug } from './services/business.service';
import { validateTemplate } from './services/schedule.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';

function expectCode(fn: () => unknown, code: ErrorCode): void {
  try {
    fn();
    throw new Error(`expected AppError with ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
  }
}

describe('validateSlug (public business slugs)', () => {
  it('normalises case and strips surrounding whitespace', () => {
    expect(validateSlug('  My-Salon  ')).toBe('my-salon');
  });

  it('accepts lowercase letters, digits and hyphens', () => {
    expect(validateSlug('salon-2-b')).toBe('salon-2-b');
  });

  it('rejects reserved slugs, too-short/too-long and bad characters', () => {
    expectCode(() => validateSlug('admin'), ErrorCode.VALIDATION_ERROR);
    expectCode(() => validateSlug('b'), ErrorCode.VALIDATION_ERROR);
    expectCode(() => validateSlug('x'.repeat(65)), ErrorCode.VALIDATION_ERROR);
    expectCode(() => validateSlug('my_salon'), ErrorCode.VALIDATION_ERROR);
    expectCode(() => validateSlug('-hyphen'), ErrorCode.VALIDATION_ERROR);
    expectCode(() => validateSlug('hyphen-'), ErrorCode.VALIDATION_ERROR);
  });
});

describe('validateTemplate (versioned schedule template)', () => {
  const ok = {
    workingPeriods: [{ weekday: 1, startMinutes: 540, endMinutes: 720 }],
    blockedPeriods: [] as Array<{ dayOfWeek: number | null; startMinutes: number | null; endMinutes: number | null }>,
    specialDates: [] as Array<{ date: Date; kind: 'CLOSED' | 'CUSTOM'; startMinutes: number | null; endMinutes: number | null }>,
  };

  it('accepts a minimal valid template', () => {
    expect(() => validateTemplate(ok)).not.toThrow();
  });

  it('rejects a template with no working periods and no special dates', () => {
    expectCode(() => validateTemplate({ ...ok, workingPeriods: [], specialDates: [] }), ErrorCode.VALIDATION_ERROR);
  });

  it('rejects invalid weekday ranges and inverted windows', () => {
    expectCode(
      () => validateTemplate({ ...ok, workingPeriods: [{ weekday: 8, startMinutes: 540, endMinutes: 720 }] }),
      ErrorCode.VALIDATION_ERROR,
    );
    expectCode(
      () => validateTemplate({ ...ok, workingPeriods: [{ weekday: 1, startMinutes: 720, endMinutes: 540 }] }),
      ErrorCode.VALIDATION_ERROR,
    );
    expectCode(
      () => validateTemplate({ ...ok, workingPeriods: [{ weekday: 1, startMinutes: -1, endMinutes: 720 }] }),
      ErrorCode.VALIDATION_ERROR,
    );
  });

  it('rejects CUSTOM special dates without a window', () => {
    expectCode(
      () =>
        validateTemplate({
          ...ok,
          workingPeriods: [],
          specialDates: [{ date: new Date(Date.UTC(2026, 8, 14)), kind: 'CUSTOM', startMinutes: null, endMinutes: null }],
        }),
      ErrorCode.VALIDATION_ERROR,
    );
  });
});