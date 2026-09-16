import { describe, expect, it } from 'vitest';
import { computeAvailableSlotStarts, toDayMinuteSpans } from './availability';

const base = {
  intervalMinutes: 30,
  durationMinutes: 60,
  isoWeekday: 1,
  dateKey: '2026-09-14',
  workingPeriods: [],
  blockedPeriods: [],
  specialDates: [],
  occupiedSpans: [],
};

describe('computeAvailableSlotStarts (pure availability)', () => {
  it('contains a single booking entirely within one worked shift (09:00–12:00, 60m @ 30m interval)', () => {
    const slots = computeAvailableSlotStarts(
      { ...base, workingPeriods: [{ weekday: 1, startMinutes: 540, endMinutes: 720 }] },
      [],
    );
    // 11:00 start ends exactly at 12:00 (720), still interior to [540,720].
    expect(slots.map((s) => s.startMinute)).toEqual([540, 570, 600, 630, 660]);
    for (const s of slots) expect(s.endMinute).toBe(s.startMinute + 60);
  });

  it('excludes slots that cross a window boundary (R089)', () => {
    const slots = computeAvailableSlotStarts(
      { ...base, workingPeriods: [{ weekday: 1, startMinutes: 570, endMinutes: 720 }] },
      [],
    );
    // 11:00 (660) ends at 12:00 (720) -> interior. 11:30 (690) would end at 750 > 720 -> excluded.
    expect(slots.map((s) => s.startMinute)).toEqual([570, 600, 630, 660]);
  });

  it('grid is aligned to midnight, not to the window start (R088)', () => {
    const slots = computeAvailableSlotStarts(
      { ...base, workingPeriods: [{ weekday: 1, startMinutes: 605, endMinutes: 755 }] },
      [],
    );
    // Grid starts at 630 (ceil(605/30)*30). 630+60=690<=755 included; 660+60=720<=755 included; 690+60=750<=755 included.
    expect(slots.map((s) => s.startMinute)).toEqual([630, 660, 690]);
  });

  it('a CLOSED special date returns no slots and overrides weekly periods (R086)', () => {
    const slots = computeAvailableSlotStarts(
      {
        ...base,
        workingPeriods: [{ weekday: 1, startMinutes: 540, endMinutes: 720 }],
        specialDates: [{ dateKey: '2026-09-14', kind: 'CLOSED' }],
      },
      [],
    );
    expect(slots).toEqual([]);
  });

  it('a CUSTOM special date replaces the weekly window (R086)', () => {
    const slots = computeAvailableSlotStarts(
      {
        ...base,
        workingPeriods: [{ weekday: 1, startMinutes: 540, endMinutes: 720 }],
        specialDates: [{ dateKey: '2026-09-14', kind: 'CUSTOM', startMinutes: 600, endMinutes: 690 }],
      },
      [],
    );
    expect(slots.map((s) => s.startMinute)).toEqual([600, 630]);
  });

  it('a blocked period is subtracted from the acting window (R084/085)', () => {
    const slots = computeAvailableSlotStarts(
      {
        ...base,
        workingPeriods: [{ weekday: 1, startMinutes: 540, endMinutes: 840 }],
        blockedPeriods: [{ dayOfWeek: 1, startMinutes: 600, endMinutes: 720 }],
      },
      [],
    );
    expect(slots.map((s) => s.startMinute)).toEqual([540, 720, 750, 780]);
  });

  it('full-day blocked periods leave nothing', () => {
    const slots = computeAvailableSlotStarts(
      {
        ...base,
        workingPeriods: [{ weekday: 1, startMinutes: 540, endMinutes: 840 }],
        blockedPeriods: [{ dayOfWeek: 1, startMinutes: 0, endMinutes: 1440 }],
      },
      [],
    );
    expect(slots).toEqual([]);
  });

  it('blocked periods only apply on their day-of-week', () => {
    const slots = computeAvailableSlotStarts(
      {
        ...base,
        isoWeekday: 2, // Tuesday
        workingPeriods: [{ weekday: 2, startMinutes: 540, endMinutes: 840 }],
        blockedPeriods: [{ dayOfWeek: 1, startMinutes: 0, endMinutes: 1440 }],
      },
      [],
    );
    expect(slots.map((s) => s.startMinute)).toEqual([540, 570, 600, 630, 660, 690, 720, 750, 780]);
  });

  it('occupied spans block overlapping slots (R090/R121)', () => {
    const slots = computeAvailableSlotStarts(
      { ...base, workingPeriods: [{ weekday: 1, startMinutes: 540, endMinutes: 840 }] },
      [{ startMinute: 600, endMinute: 700 }],
    );
    // 09:00 slot [540,600) touches the occupied start only -> not overlapping, kept.
    expect(slots.map((s) => s.startMinute)).toEqual([540, 720, 750, 780]);
  });

  it('from/until bounds constrain the start minute', () => {
    const all = computeAvailableSlotStarts(
      { ...base, workingPeriods: [{ weekday: 1, startMinutes: 540, endMinutes: 840 }] },
      [],
    );
    const bounded = computeAvailableSlotStarts(
      {
        ...base,
        workingPeriods: [{ weekday: 1, startMinutes: 540, endMinutes: 840 }],
        fromMinutes: 660,
        untilMinutes: 720,
      },
      [],
    );
    expect(bounded.map((s) => s.startMinute)).toEqual(all.filter((s) => s.startMinute >= 660 && s.startMinute < 720).map((s) => s.startMinute));
  });

  it('invalid durations/intervals yield no slots', () => {
    expect(computeAvailableSlotStarts({ ...base, durationMinutes: 0 }, [])).toEqual([]);
    expect(computeAvailableSlotStarts({ ...base, intervalMinutes: 0 }, [])).toEqual([]);
  });

  it('toDayMinuteSpans clips cross-day spans and skips out-of-day spans', () => {
    const day = new Date(Date.UTC(2026, 8, 14)); // 2026-09-14
    const next = new Date(Date.UTC(2026, 8, 15));
    const spans = toDayMinuteSpans(
      [
        { startAt: new Date(Date.UTC(2026, 8, 14, 9, 30)), endAt: new Date(Date.UTC(2026, 8, 14, 11, 0)) }, // inside
        { startAt: new Date(Date.UTC(2026, 8, 13, 23, 0)), endAt: new Date(Date.UTC(2026, 8, 14, 1, 0)) }, // clips start -> [0,60]
        { startAt: new Date(Date.UTC(2026, 8, 15, 0, 0)), endAt: new Date(Date.UTC(2026, 8, 15, 1, 0)) }, // outside -> skipped
      ],
      day,
      next,
    );
    expect(spans).toEqual([
      { startMinute: 570, endMinute: 660 },
      { startMinute: 0, endMinute: 60 },
    ]);
  });
});