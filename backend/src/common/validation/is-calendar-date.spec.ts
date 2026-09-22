import { describe, expect, it } from 'vitest';
import { isCalendarDateKey } from './is-calendar-date';

describe('isCalendarDateKey', () => {
  it('accepts real calendar days', () => {
    expect(isCalendarDateKey('2026-09-20')).toBe(true);
    expect(isCalendarDateKey('2028-02-29')).toBe(true);
    expect(isCalendarDateKey('2000-02-29')).toBe(true);
    expect(isCalendarDateKey('2026-12-31')).toBe(true);
  });

  it('rejects impossible calendar days that still match YYYY-MM-DD', () => {
    expect(isCalendarDateKey('2026-02-30')).toBe(false);
    expect(isCalendarDateKey('2027-02-29')).toBe(false);
    expect(isCalendarDateKey('2026-13-01')).toBe(false);
    expect(isCalendarDateKey('2026-00-10')).toBe(false);
    expect(isCalendarDateKey('2026-04-31')).toBe(false);
  });

  it('rejects non-date input', () => {
    expect(isCalendarDateKey('2026-09-20T00:00:00.000Z')).toBe(false);
    expect(isCalendarDateKey('20-09-2026')).toBe(false);
    expect(isCalendarDateKey('20260920')).toBe(false);
    expect(isCalendarDateKey(20260920)).toBe(false);
    expect(isCalendarDateKey(null)).toBe(false);
    expect(isCalendarDateKey(undefined)).toBe(false);
  });
});