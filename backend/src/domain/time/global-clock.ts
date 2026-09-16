/**
 * Global timezone abstraction (Prompt 41 §21; REQ-222/223, REQ-225/226).
 *
 * One global timezone is applied to all availability/date math. The timezone
 * value itself is config (`productParameters.appTimezone`, architecture default
 * Africa/Addis_Ababa); the product-level decision remains §46 item 2 (REQ-222)
 * and this module deliberately only CONSUMES the configured value — it never
 * selects one. "Calendar day" and "weekday" are computed in the global
 * timezone, never in UTC or the server's local timezone.
 *
 * Date-only values (slot_date, special_date) use the UTC-midnight encoding of
 * the global-tz calendar date (matches the repository's `dateOnly` convention).
 */
export const GLOBAL_CLOCK = Symbol('GLOBAL_CLOCK');

export interface ClockParts {
  year: number;
  /** 1..12 */
  month: number;
  /** 1..31 */
  day: number;
  hour: number;
  minute: number;
}

export interface GlobalClock {
  readonly timezone: string;
  now(): Date;
  partsInTz(date: Date): ClockParts;
  /** ISO weekday: 1=Monday … 7=Sunday in the global timezone. */
  isoWeekday(date: Date): number;
  /** Date at UTC midnight of the global-tz calendar day (date-only key). */
  slotDate(date: Date): Date;
  isSameSlotDay(a: Date, b: Date): boolean;
  /** 'YYYY-MM-DD' of the global-tz calendar day. */
  dateKey(date: Date): string;
  /** Parses 'YYYY-MM-DD' into the UTC-midnight date-only key. */
  dateKeyAsSlotDate(key: string): Date;
  /** Real instant whose global-tz wall clock is (date, hour, minute). */
  atTimeOn(date: Date, hour: number, minute: number): Date;
}

function two(n: number): string {
  return String(n).padStart(2, '0');
}

export class IntlGlobalClock implements GlobalClock {
  readonly timezone: string;
  private readonly fmt: Intl.DateTimeFormat;

  constructor(timezone: string, private readonly nowFns: () => Date = () => new Date()) {
    this.timezone = timezone;
    this.fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }

  now(): Date {
    return this.nowFns();
  }

  partsInTz(date: Date): ClockParts {
    const parts = this.fmt.formatToParts(date);
    const get = (t: string): number => {
      const p = parts.find((x) => x.type === t);
      return p ? Number(p.value) : 0;
    };
    let hour = get('hour');
    // HT: en-CA with hour12:false can emit '24' for midnight.
    if (hour === 24) hour = 0;
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour,
      minute: get('minute'),
    };
  }

  isoWeekday(date: Date): number {
    const p = this.partsInTz(date);
    const utcDay = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
    // JS: 0=Sun..6=Sat -> ISO 1=Mon..7=Sun
    return ((utcDay + 6) % 7) + 1;
  }

  slotDate(date: Date): Date {
    const p = this.partsInTz(date);
    return new Date(Date.UTC(p.year, p.month - 1, p.day));
  }

  isSameSlotDay(a: Date, b: Date): boolean {
    return this.dateKey(a) === this.dateKey(b);
  }

  dateKey(date: Date): string {
    const p = this.partsInTz(date);
    return `${p.year}-${two(p.month)}-${two(p.day)}`;
  }

  dateKeyAsSlotDate(key: string): Date {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  atTimeOn(date: Date, hour: number, minute: number): Date {
    const p = this.partsInTz(date);
    // Converge on the instant whose global-tz wall clock equals the target.
    const target = Date.UTC(p.year, p.month - 1, p.day, hour, minute, 0, 0);
    let guess = target;
    for (let i = 0; i < 3; i++) {
      const wall = this.partsInTz(new Date(guess));
      const wallUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
      guess += target - wallUtc;
    }
    return new Date(guess);
  }
}