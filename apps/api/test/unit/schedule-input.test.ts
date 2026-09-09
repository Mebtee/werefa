import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '@werefa/shared';
import {
  parseScheduleInput,
  parseKeepInput,
  parseCalendarDate,
} from '../../apps/api/src/schedule/schedule-input';

/**
 * Prompt 12 — schedule input validation (doc 10 §3). Structural floors
 * (SCHEDULE_INVALID), week/week overlaps (SCHEDULE_OVERLAP), duplicate special
 * dates (SCHEDULE_DUPLICATE) vs. field-level 422 (VALIDATION_ERROR) stays
 * 422 where the shape itself is broken.
 */

const WEEK = [{ dayOfWeek: 1, startMinutes: 540, endMinutes: 1080 }];

function codeOf(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    return String((err as { code: string }).code);
  }
  return 'UNKNOWN';
}

describe('parseScheduleInput — happy path', () => {
  it('parses a minimal Monday-only schedule with a default interval', () => {
    const input = parseScheduleInput({ workingPeriods: WEEK });
    expect(input.bookingIntervalMinutes).toBe(30);
    expect(input.workingPeriods).toEqual(WEEK);
    expect(input.specialDates).toEqual([]);
    expect(input.blockedPeriods).toEqual([]);
    expect(input.reason).toBeNull();
  });

  it('accepts special dates, blocked periods and a reason', () => {
    const input = parseScheduleInput({
      bookingIntervalMinutes: 60,
      reason: '  Summer hours  ',
      workingPeriods: WEEK,
      specialDates: [{ date: '2026-09-20', isClosed: true }],
      blockedPeriods: [{ startAt: '2026-09-15T06:00:00.000Z', endAt: '2026-09-15T08:00:00.000Z' }],
    });
    expect(input.bookingIntervalMinutes).toBe(60);
    expect(input.reason).toBe('Summer hours');
    expect(input.specialDates[0]).toMatchObject({ isClosed: true });
    expect(input.specialDates[0]?.date.toISOString()).toBe('2026-09-20T00:00:00.000Z');
    expect(input.blockedPeriods[0]?.startAt.toISOString()).toBe('2026-09-15T06:00:00.000Z');
  });

  it('parses multi-window weekly periods across days', () => {
    const input = parseScheduleInput({
      workingPeriods: [
        { dayOfWeek: 1, startMinutes: 540, endMinutes: 720 },
        { dayOfWeek: 1, startMinutes: 780, endMinutes: 1080 },
        { dayOfWeek: 2, startMinutes: 540, endMinutes: 1080 },
      ],
    });
    expect(input.workingPeriods).toHaveLength(3);
  });
});

describe('parseScheduleInput — structural floors (SCHEDULE_INVALID)', () => {
  it('rejects intervals outside 5–240 minutes', () => {
    expect(
      codeOf(safe(() => parseScheduleInput({ bookingIntervalMinutes: 4, workingPeriods: WEEK }))),
    ).toBe(ErrorCodes.SCHEDULE_INVALID);
    expect(
      codeOf(safe(() => parseScheduleInput({ bookingIntervalMinutes: 241, workingPeriods: WEEK }))),
    ).toBe(ErrorCodes.SCHEDULE_INVALID);
  });

  it('rejects a window with start >= end or out of range', () => {
    const inverted = safe(() =>
      parseScheduleInput({
        workingPeriods: [{ dayOfWeek: 1, startMinutes: 720, endMinutes: 540 }],
      }),
    );
    expect(codeOf(inverted)).toBe(ErrorCodes.SCHEDULE_INVALID);
    const tooLate = safe(() =>
      parseScheduleInput({ workingPeriods: [{ dayOfWeek: 1, startMinutes: 0, endMinutes: 1441 }] }),
    );
    expect(codeOf(tooLate)).toBe(ErrorCodes.SCHEDULE_INVALID);
  });

  it('rejects a closed special date that carries open periods', () => {
    const err = safe(() =>
      parseScheduleInput({
        workingPeriods: WEEK,
        specialDates: [
          { date: '2026-09-20', isClosed: true, periods: [{ startMinutes: 540, endMinutes: 600 }] },
        ],
      }),
    );
    expect(codeOf(err)).toBe(ErrorCodes.SCHEDULE_INVALID);
  });
});

describe('parseScheduleInput — overlap & duplicates', () => {
  it('flags overlapping weekly windows on the same day as SCHEDULE_OVERLAP', () => {
    const err = safe(() =>
      parseScheduleInput({
        workingPeriods: [
          { dayOfWeek: 1, startMinutes: 540, endMinutes: 780 },
          { dayOfWeek: 1, startMinutes: 760, endMinutes: 1080 },
        ],
      }),
    );
    expect(codeOf(err)).toBe(ErrorCodes.SCHEDULE_OVERLAP);
  });

  it('allows touching weekly windows on the same day', () => {
    const input = parseScheduleInput({
      workingPeriods: [
        { dayOfWeek: 1, startMinutes: 540, endMinutes: 780 },
        { dayOfWeek: 1, startMinutes: 780, endMinutes: 1080 },
      ],
    });
    expect(input.workingPeriods).toHaveLength(2);
  });

  it('flags two special dates on the same local day as SCHEDULE_DUPLICATE', () => {
    const err = safe(() =>
      parseScheduleInput({
        workingPeriods: WEEK,
        specialDates: [{ date: '2026-09-20' }, { date: '2026-09-20', isClosed: true }],
      }),
    );
    expect(codeOf(err)).toBe(ErrorCodes.SCHEDULE_DUPLICATE);
  });

  it('accepts consecutive local days (their Addis spans only touch at midnight)', () => {
    // Local days 2026-09-20 and 2026-09-21 run 09-19T21Z→09-20T21Z and
    // 09-20T21Z→09-21T21Z; they share only the instantaneous boundary.
    const input = parseScheduleInput({
      workingPeriods: WEEK,
      specialDates: [{ date: '2026-09-20' }, { date: '2026-09-21' }],
    });
    expect(input.specialDates).toHaveLength(2);
  });
});

describe('parseScheduleInput — field shape (VALIDATION_ERROR 422)', () => {
  it('rejects non-array periods and bad types', () => {
    expect(codeOf(safe(() => parseScheduleInput({ workingPeriods: 'x' })))).toBe(
      ErrorCodes.VALIDATION_ERROR,
    );
    expect(
      codeOf(
        safe(() => parseScheduleInput({ bookingIntervalMinutes: 'many', workingPeriods: WEEK })),
      ),
    ).toBe(ErrorCodes.VALIDATION_ERROR);
    // An out-of-range *integer* day is a structural floor, not a shape error.
    expect(
      codeOf(
        safe(() =>
          parseScheduleInput({
            workingPeriods: [{ dayOfWeek: 8, startMinutes: 0, endMinutes: 60 }],
          }),
        ),
      ),
    ).toBe(ErrorCodes.SCHEDULE_INVALID);
  });

  it('rejects blocked periods without whole-minute precision (REQ-226)', () => {
    const err = safe(() =>
      parseScheduleInput({
        workingPeriods: WEEK,
        blockedPeriods: [
          { startAt: '2026-09-15T06:00:30.000Z', endAt: '2026-09-15T08:00:00.000Z' },
        ],
      }),
    );
    expect(codeOf(err)).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('rejects blocked periods that end before they start', () => {
    const err = safe(() =>
      parseScheduleInput({
        workingPeriods: WEEK,
        blockedPeriods: [
          { startAt: '2026-09-15T08:00:00.000Z', endAt: '2026-09-15T06:00:00.000Z' },
        ],
      }),
    );
    expect(codeOf(err)).toBe(ErrorCodes.SCHEDULE_INVALID);
  });
});

describe('parseKeepInput', () => {
  it('returns null reason when omitted or blank', () => {
    expect(parseKeepInput({})).toEqual({ reason: null });
    expect(parseKeepInput({ reason: '   ' })).toEqual({ reason: null });
  });

  it('trims a provided reason', () => {
    expect(parseKeepInput({ reason: '  owner agreed at counter  ' })).toEqual({
      reason: 'owner agreed at counter',
    });
  });
});

describe('parseCalendarDate', () => {
  it('accepts a YYYY-MM-DD local calendar day at UTC midnight', () => {
    expect(parseCalendarDate('2026-09-20', 'date').toISOString()).toBe('2026-09-20T00:00:00.000Z');
  });

  it('normalizes an ISO instant to its Addis local day', () => {
    // 2026-09-20T21:30Z = 2026-09-21T00:30 Addis.
    const day = parseCalendarDate('2026-09-20T21:30:00.000Z', 'date');
    expect(day.toISOString()).toBe('2026-09-21T00:00:00.000Z');
  });

  it('rejects garbage dates as VALIDATION_ERROR (field 422, duck-typed)', () => {
    let caught: unknown = null;
    try {
      parseCalendarDate('not-a-date', 'date');
    } catch (err) {
      caught = err;
    }
    expect(codeOf(caught)).toBe(ErrorCodes.VALIDATION_ERROR);
  });
});

function safe(fn: () => unknown): unknown {
  try {
    fn();
    return null;
  } catch (err) {
    return err;
  }
}
