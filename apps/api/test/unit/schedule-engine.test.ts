import { describe, expect, it } from 'vitest';
import {
  SCHEDULE_TZ_OFFSET_MS,
  MINUTES_PER_DAY,
  shifted,
  localDateOf,
  localWeekdayOf,
  localMinutesOf,
  instantOfLocalDay,
  resolveDayWindows,
  evaluateFit,
  candidateStarts,
  VIOLATION_LABELS,
  type ScheduleSnapshot,
} from '../../apps/api/src/schedule/schedule-availability';

/**
 * Prompt 12 — pure scheduling availability engine (docs 10 §2–§3). All day and
 * weekday math runs in the global Africa/Addis_Ababa wall clock (UTC+3, no
 * DST); these tests pin that model exactly.
 */

// 2026-09-07 is a Monday. T(h, m) is a UTC instant on that day.
const T = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 7, h, m, 0, 0));
// UTC-midnight of 2026-09-07.
const D = (y = 2026, mo = 8, d = 7) => new Date(Date.UTC(y, mo, d));

function snap(overrides: Partial<ScheduleSnapshot> = {}): ScheduleSnapshot {
  return {
    versionId: 'v1',
    businessId: 'b1',
    status: 'ACTIVE',
    bookingIntervalMinutes: 30,
    workingPeriods: [{ dayOfWeek: 1, startMinutes: 540, endMinutes: 1080 }], // Mon 09:00–18:00
    specialDates: [],
    blockedPeriods: [],
    ...overrides,
  };
}

describe('local time model (REQ-222/223, UTC+3 no DST)', () => {
  it('shifted() maps UTC instants to the Addis wall clock', () => {
    expect(shifted(T(6)).toISOString()).toBe('2026-09-07T09:00:00.000Z');
  });

  it('a late UTC instant rolls to the NEXT Addis calendar day at UTC midnight', () => {
    // Fri 2026-09-04 21:30 UTC = Sat 2026-09-05 00:30 Addis.
    const late = new Date(Date.UTC(2026, 8, 4, 21, 30, 0, 0));
    expect(localDateOf(late).toISOString()).toBe('2026-09-05T00:00:00.000Z');
    // Sun 2026-09-06 22:00 UTC = Mon 2026-09-07 01:00 Addis.
    expect(localDateOf(new Date(Date.UTC(2026, 8, 6, 22, 0, 0))).toISOString()).toBe(
      '2026-09-07T00:00:00.000Z',
    );
    // Mon 2026-09-07 02:00 UTC = Mon 2026-09-07 05:00 Addis (same local day).
    expect(localDateOf(T(2)).toISOString()).toBe('2026-09-07T00:00:00.000Z');
  });

  it('weekday is 0-indexed from Sunday and minutes are since local midnight', () => {
    expect(SCHEDULE_TZ_OFFSET_MS).toBe(3 * 60 * 60 * 1000);
    expect(MINUTES_PER_DAY).toBe(1440);
    // 2026-09-07 is Monday (1); 09:00 Addis = 540 minutes.
    expect(localWeekdayOf(T(6))).toBe(1);
    expect(localMinutesOf(T(6))).toBe(540);
    // 2026-09-06 is Sunday (0).
    expect(localWeekdayOf(new Date(Date.UTC(2026, 8, 6, 12)))).toBe(0);
  });

  it('instantOfLocalDay builds the absolute instant for local minutes', () => {
    expect(instantOfLocalDay(D(), 540).toISOString()).toBe('2026-09-07T06:00:00.000Z');
    expect(instantOfLocalDay(D(), 0).toISOString()).toBe('2026-09-06T21:00:00.000Z');
  });
});

describe('resolveDayWindows', () => {
  it('maps weekly hours to absolute instants for the matching weekday', () => {
    const windows = resolveDayWindows(snap(), D());
    expect(windows).toEqual([{ startAt: T(6), endAt: T(15) }]);
  });

  it('subtracts blocked periods that overlap the day', () => {
    const blocked = [
      // 10:00–11:00 local
      { startAt: T(7), endAt: T(8) },
      // 16:00–18:00 local (touches the day end exactly)
      { startAt: T(13), endAt: T(15) },
    ];
    const windows = resolveDayWindows(snap({ blockedPeriods: blocked }), D());
    expect(windows).toEqual([
      { startAt: T(6), endAt: T(7) },
      { startAt: T(8), endAt: T(13) },
    ]);
  });

  it('clips a block that crosses midnight to the day portion only', () => {
    // Weekly window 21:00–23:30 local; block 22:00 Mon local → 00:30 Tue local.
    // On Monday's day the block is clipped to 22:00–24:00, leaving 21:00–22:00.
    const windows = resolveDayWindows(
      snap({
        workingPeriods: [{ dayOfWeek: 1, startMinutes: 1260, endMinutes: 1410 }],
        blockedPeriods: [{ startAt: T(19), endAt: T(21, 30) }],
      }),
      D(),
    );
    expect(windows).toEqual([{ startAt: T(18), endAt: T(19) }]);
  });

  it('returns empty windows for a closed special date', () => {
    const specialDates = [{ calendarDate: D(), isClosed: true, periods: [] }];
    expect(resolveDayWindows(snap({ specialDates }), D())).toEqual([]);
  });

  it('special-date periods replace weekly hours entirely', () => {
    const specialDates = [
      { calendarDate: D(), isClosed: false, periods: [{ startMinutes: 600, endMinutes: 660 }] },
    ];
    const windows = resolveDayWindows(snap({ specialDates }), D());
    expect(windows).toEqual([{ startAt: T(7), endAt: T(8) }]);
  });
});

describe('evaluateFit (precedence + REQ-089 full-window fit)', () => {
  it('returns ok with no active schedule (legacy all-day)', () => {
    expect(evaluateFit(null, T(1), T(2)).ok).toBe(true);
  });

  it('accepts a slot fully inside a window', () => {
    expect(evaluateFit(snap(), T(6), T(7)).ok).toBe(true);
  });

  it('rejects a slot that crosses a window boundary (REQ-089)', () => {
    const r = evaluateFit(snap(), T(14, 30), T(16));
    expect(r).toEqual({ ok: false, reason: 'WEEKLY_HOURS' });
  });

  it('gives BLOCKED_PERIOD precedence over weekly hours', () => {
    const blocked = [{ startAt: T(6, 30), endAt: T(7, 30) }];
    const r = evaluateFit(snap({ blockedPeriods: blocked }), T(6, 30), T(7));
    expect(r).toEqual({ ok: false, reason: 'BLOCKED_PERIOD' });
  });

  it('gives BLOCKED_PERIOD precedence over a special date', () => {
    const specialDates = [
      {
        calendarDate: D(),
        isClosed: true,
        periods: [] as { startMinutes: number; endMinutes: number }[],
      },
    ];
    const blocked = [{ startAt: T(12), endAt: T(13) }];
    const r = evaluateFit(snap({ specialDates, blockedPeriods: blocked }), T(12), T(12, 30));
    expect(r).toEqual({ ok: false, reason: 'BLOCKED_PERIOD' });
  });

  it('flags a slot on a closed special day', () => {
    const specialDates = [{ calendarDate: D(), isClosed: true, periods: [] }];
    const r = evaluateFit(snap({ specialDates }), T(6), T(7));
    expect(r).toEqual({ ok: false, reason: 'SPECIAL_DATE_CLOSED' });
  });

  it('flags the special-hours reason when on a special day but outside its periods', () => {
    const specialDates = [
      { calendarDate: D(), isClosed: false, periods: [{ startMinutes: 600, endMinutes: 660 }] },
    ];
    const r = evaluateFit(snap({ specialDates }), T(6), T(6, 30));
    expect(r).toEqual({ ok: false, reason: 'SPECIAL_DATE_HOURS' });
  });

  it('returns ok inside an open special-date window', () => {
    const specialDates = [
      { calendarDate: D(), isClosed: false, periods: [{ startMinutes: 600, endMinutes: 660 }] },
    ];
    expect(evaluateFit(snap({ specialDates }), T(7), T(7, 30)).ok).toBe(true);
  });

  it('rejects an inverted slot defensively', () => {
    const r = evaluateFit(snap(), T(8), T(7));
    expect(r).toEqual({ ok: false, reason: 'WEEKLY_HOURS' });
  });
});

describe('candidateStarts (basis-of-time, doc 10 §2)', () => {
  it('anchors candidates at window start and steps by the interval', () => {
    const out = candidateStarts(snap(), T(5), T(16), 30);
    expect(out.map((d) => d.toISOString())).toEqual([
      '2026-09-07T06:00:00.000Z',
      '2026-09-07T06:30:00.000Z',
      '2026-09-07T07:00:00.000Z',
      '2026-09-07T07:30:00.000Z',
      '2026-09-07T08:00:00.000Z',
      '2026-09-07T08:30:00.000Z',
      '2026-09-07T09:00:00.000Z',
      '2026-09-07T09:30:00.000Z',
      '2026-09-07T10:00:00.000Z',
      '2026-09-07T10:30:00.000Z',
      '2026-09-07T11:00:00.000Z',
      '2026-09-07T11:30:00.000Z',
      '2026-09-07T12:00:00.000Z',
      '2026-09-07T12:30:00.000Z',
      '2026-09-07T13:00:00.000Z',
      '2026-09-07T13:30:00.000Z',
      '2026-09-07T14:00:00.000Z',
      '2026-09-07T14:30:00.000Z',
    ]);
  });

  it('drops candidates that would cross the window end (REQ-089)', () => {
    // 2h booking interval → candidates step by 2h from 09:00 local.
    const out = candidateStarts(snap({ bookingIntervalMinutes: 120 }), T(5), T(16), 120);
    // 14:00 local + 120 min equals the 18:00 local close; anything later is cut.
    expect(out.map((d) => d.toISOString())).toEqual([
      '2026-09-07T06:00:00.000Z',
      '2026-09-07T08:00:00.000Z',
      '2026-09-07T10:00:00.000Z',
      '2026-09-07T12:00:00.000Z',
    ]);
  });

  it('respects the `to` bound', () => {
    const out = candidateStarts(snap(), T(6), T(7, 45), 30);
    const last = out.at(-1);
    expect(last?.toISOString()).toBe('2026-09-07T07:00:00.000Z');
  });

  it('returns [] when no schedule constrains the business (all-day)', () => {
    expect(candidateStarts(null, T(6), T(7), 30)).toEqual([]);
  });

  it('returns [] for an interval longer than the window', () => {
    expect(candidateStarts(snap(), T(6), T(15), 600)).toEqual([]);
  });
});

describe('VIOLATION_LABELS', () => {
  it('labels every violation', () => {
    expect(Object.keys(VIOLATION_LABELS).sort()).toEqual([
      'BLOCKED_PERIOD',
      'SPECIAL_DATE_CLOSED',
      'SPECIAL_DATE_HOURS',
      'WEEKLY_HOURS',
    ]);
    expect(VIOLATION_LABELS.WEEKLY_HOURS).toMatch(/working/);
  });
});
