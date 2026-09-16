import { describe, expect, it } from 'vitest';
import { IntlGlobalClock } from './global-clock';

describe('IntlGlobalClock (global timezone)', () => {
  const utc = new IntlGlobalClock('UTC');

  it('partitions a known instant in UTC', () => {
    const d = new Date(Date.UTC(2026, 8, 14, 13, 5)); // 2026-09-14 13:05
    expect(utc.partsInTz(d)).toEqual({ year: 2026, month: 9, day: 14, hour: 13, minute: 5 });
    expect(utc.dateKey(d)).toBe('2026-09-14');
    expect(utc.slotDate(d)).toEqual(new Date(Date.UTC(2026, 8, 14)));
    expect(utc.dateKeyAsSlotDate('2026-09-14')).toEqual(new Date(Date.UTC(2026, 8, 14)));
  });

  it('reports ISO weekday 1=Monday … 7=Sunday', () => {
    expect(utc.isoWeekday(new Date(Date.UTC(2026, 8, 14)))).toBe(1); // Monday
    expect(utc.isoWeekday(new Date(Date.UTC(2026, 8, 20)))).toBe(7); // Sunday
    expect(utc.isoWeekday(new Date(Date.UTC(2026, 8, 1)))).toBe(2); // Sep 1 2026 is a Tuesday
  });

  it('atTimeOn returns the real UTC instant for a UTC clock', () => {
    const d = new Date(Date.UTC(2026, 8, 14));
    expect(utc.atTimeOn(d, 9, 30)).toEqual(new Date(Date.UTC(2026, 8, 14, 9, 30)));
    // Midnight keeps the same date key.
    expect(utc.atTimeOn(d, 0, 0)).toEqual(new Date(Date.UTC(2026, 8, 14)));
  });

  it('deterministic now() via injected clock', () => {
    const fixed = new Date(Date.UTC(2026, 8, 14, 8, 0));
    const clock = new IntlGlobalClock('UTC', () => fixed);
    expect(clock.now()).toBe(fixed);
  });

  describe('Africa/Addis_Ababa (design default, non-normative)', () => {
    const eth = new IntlGlobalClock('Africa/Addis_Ababa');
    // Addis is UTC+3, no DST. 2026-09-14T00:30Z == 03:30 local on the same day.

    it('shifts wall-clock parts by +3h', () => {
      const d = new Date(Date.UTC(2026, 8, 14, 0, 30));
      const parts = eth.partsInTz(d);
      expect(parts).toMatchObject({ year: 2026, month: 9, day: 14, hour: 3, minute: 30 });
    });

    it('date key flips across the local midnight', () => {
      // 2026-09-13T22:30Z is already 2026-09-14 01:30 local.
      expect(eth.dateKey(new Date(Date.UTC(2026, 8, 13, 22, 30)))).toBe('2026-09-14');
      // 2026-09-14T20:30Z is 23:30 local same day.
      expect(eth.dateKey(new Date(Date.UTC(2026, 8, 14, 20, 30)))).toBe('2026-09-14');
      // 2026-09-14T21:30Z is 00:30 local on the 15th.
      expect(eth.dateKey(new Date(Date.UTC(2026, 8, 14, 21, 30)))).toBe('2026-09-15');
    });

    it('slotDate groups by local calendar day', () => {
      const localDay = eth.slotDate(new Date(Date.UTC(2026, 8, 14, 22, 0)));
      expect(localDay).toEqual(new Date(Date.UTC(2026, 8, 15)));
    });

    it('atTimeOn resolves the instant for a local wall time across midnight', () => {
      const dayKey = new Date(Date.UTC(2026, 8, 14));
      const start = eth.atTimeOn(dayKey, 0, 30); // 00:30 local == 2026-09-13T21:30Z
      expect(start.toISOString()).toBe('2026-09-13T21:30:00.000Z');
      const noon = eth.atTimeOn(dayKey, 12, 0); // 12:00 local == 09:00Z
      expect(noon.toISOString()).toBe('2026-09-14T09:00:00.000Z');
    });
  });
});