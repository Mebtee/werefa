/**
 * Pure availability computation (architecture doc 10; REQ-051/074/082–090,
 * REQ-093/094/224–226).
 *
 * This module is framework-free so it can be exercised directly in unit tests
 * without any Nest/Prisma infrastructure.  The application-level service
 * (availability.service.ts) resolves the data and gates before calling
 * `computeAvailableSlotStarts`.
 *
 * ## Semantics
 *
 * - A slot start must lie on a **grid aligned to the configured booking interval
 *   (R088)** (grid: `dayStart + k × interval`; `dayStart` is midnight of the
 *   business's calendar day in the global timezone).  The grid is absolute to the
 *   calendar day, not relative to each working window.
 *
 * - The booking of `durationMinutes` must be **entirely contained** in a single
 *   working window (R089).  Slots that cross a window boundary are excluded.
 *
 * - Special dates **replace** the working windows for that calendar day (R086);
 *   blocked periods **subtract** from whatever the active window is (R084/085).
 *
 * - Overlap filtering: any slot that overlaps an occupied span (an active booking
 *   or an active LOCKED/ALLOCATED slot lock — statuses PAYMENT_PENDING or
 *   CONFIRMED for bookings, LOCKED or ALLOCATED for locks) is excluded (R090,
 *   R121).
 *
 * - Seconds are always forced to :00 (R226).
 */

/** Calendar-day working window (only for the weekday / custom-date expansion). */
export interface WorkingWindow {
  startMinutes: number; // inclusive, >= 0
  endMinutes: number; // exclusive, <= 1440
}

/** A blocked period that applies to a specific day-of-week or the whole day. */
export interface BlockedPeriodInput {
  /** null = applies every day / full day. */
  dayOfWeek?: number | null;
  /** null = full day. */
  startMinutes?: number | null;
  endMinutes?: number | null;
}

/** Special-date override for one calendar day. */
export interface SpecialDateInput {
  /** 'YYYY-MM-DD' (UTC-normalised key of the global-tz calendar day). */
  dateKey: string;
  kind: 'CLOSED' | 'CUSTOM';
  startMinutes?: number | null;
  endMinutes?: number | null;
}

/** An already-booked / locked time span used for overlap filtering. */
export interface OccupiedSpan {
  startAt: Date;
  endAt: Date;
}

export interface ComputeArgs {
  /** Booking-interval grid step in whole minutes (R088). */
  intervalMinutes: number;
  /** Total duration of the service combination in whole minutes (R074). */
  durationMinutes: number;
  /** ISO weekday of the target calendar day (1 = Monday … 7 = Sunday). */
  isoWeekday: number;
  /** 'YYYY-MM-DD' calendar day key (global tz). */
  dateKey: string;
  /** Working periods defined for this weekday. */
  workingPeriods: { weekday: number; startMinutes: number; endMinutes: number }[];
  /** Blocked periods that may apply to this weekday / day. */
  blockedPeriods: BlockedPeriodInput[];
  /** Special-date entries that apply to this calendar day (usually 0 or 1). */
  specialDates: SpecialDateInput[];
  /** Booked / locked spans that overlap this calendar day. */
  occupiedSpans: OccupiedSpan[];
  /** Optional lower bound (inclusive) on the start minute within the day. */
  fromMinutes?: number;
  /** Optional upper bound on the start minute (< upper bound is applied). */
  untilMinutes?: number;
}

export interface SlotStart {
  /** Date-time of the slot start (global tz instant). */
  startAt: Date;
  /** Date-time of the slot end (startAt + duration). */
  endAt: Date;
  /** Start of day in the global tz (used for ordering / day grouping). */
  dayStart: Date;
  /** Start minutes from midnight. */
  startMinutes: number;
  /** End minutes from midnight. */
  endMinutes: number;
}

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function buildWorkingWindows(args: ComputeArgs): WorkingWindow[] {
  // Special date takes priority (R086).
  const closed = args.specialDates.some((s) => s.kind === 'CLOSED');
  if (closed) return [];

  const custom = args.specialDates.find((s) => s.kind === 'CUSTOM');
  if (custom) {
    if (custom.startMinutes == null || custom.endMinutes == null) return [];
    if (custom.startMinutes >= custom.endMinutes) return [];
    return [{ startMinutes: custom.startMinutes, endMinutes: custom.endMinutes }];
  }

  // Weekly (R082).
  const periodForDay = args.workingPeriods
    .filter((w) => w.weekday === args.isoWeekday)
    .map<WorkingWindow>((w) => ({ startMinutes: w.startMinutes, endMinutes: w.endMinutes }))
    .filter((w) => w.startMinutes < w.endMinutes)
    .sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);

  return periodForDay;
}

function subtractBlocked(windows: WorkingWindow[], blocked: BlockedPeriodInput[], isoWeekday: number): WorkingWindow[] {
  // Expand each blocked period to concrete (start, end) within [0, 1440].
  const blocks: Array<{ start: number; end: number }> = [];
  for (const b of blocked) {
    // A blocked period only applies on its own day-of-week (R085) or every
    // day when dayOfWeek is null.
    if (b.dayOfWeek != null && b.dayOfWeek !== isoWeekday) continue;
    const bStart = b.startMinutes ?? 0;
    const bEnd = b.endMinutes ?? 1440;
    if (bStart >= bEnd || bStart >= 1440 || bEnd <= 0) continue;
    blocks.push({ start: Math.max(0, bStart), end: Math.min(1440, bEnd) });
  }

  let result = [...windows];
  for (const block of blocks) {
    const next: WorkingWindow[] = [];
    for (const w of result) {
      if (!overlap(w.startMinutes, w.endMinutes, block.start, block.end)) {
        next.push(w);
        continue;
      }
      // Left remnant.
      if (block.start > w.startMinutes) {
        next.push({ startMinutes: w.startMinutes, endMinutes: block.start });
      }
      // Right remnant.
      if (block.end < w.endMinutes) {
        next.push({ startMinutes: block.end, endMinutes: w.endMinutes });
      }
    }
    result = next;
  }
  return result.filter((w) => w.startMinutes < w.endMinutes);
}

/**
 * Compute the available slot starts for a single calendar day.
 *
 * This is a pure function — all data must be pre-resolved by the caller.  This
 * makes unit testing trivial: different combinations of working periods,
 * blocked periods, special dates, bookings and locks can be constructed in
 * plain objects without any database or timezone infrastructure (the caller
 * supplies the dateKey, isoWeekday and occupied spans in minute-of-day form).
 *
 * **Calendar day minute-of-day convention:** the caller must convert each
 * OccupiedSpan's Date-typed startAt/endAt into "minute of day" in the target
 * calendar day.  Spans whose startAt or endAt falls outside the target calendar
 * day are truncated to [0, 1440] (handled by the service layer before calling
 * this function).  For simplicity this function works entirely in minute-of-day
 * coordinates.
 */
export function computeAvailableSlotStarts(
  args: ComputeArgs,
  occupiedMinuteSpans: Array<{ startMinute: number; endMinute: number }>,
): Array<{ startMinute: number; endMinute: number }> {
  if (args.durationMinutes <= 0 || args.intervalMinutes <= 0) return [];

  const windows = subtractBlocked(buildWorkingWindows(args), args.blockedPeriods, args.isoWeekday);

  const candidates: Array<{ start: number; end: number }> = [];
  for (const w of windows) {
    // Grid aligned to absolute midnight (not relative to window start).
    const gridStart = Math.ceil(w.startMinutes / args.intervalMinutes) * args.intervalMinutes;
    for (let start = gridStart; start + args.durationMinutes <= w.endMinutes; start += args.intervalMinutes) {
      const end = start + args.durationMinutes;
      if (start >= (args.fromMinutes ?? 0) && start < (args.untilMinutes ?? 1440)) {
        candidates.push({ start, end });
      }
    }
  }

  return candidates
    .filter(({ start, end }) => {
      for (const span of occupiedMinuteSpans) {
        if (span.startMinute < end && span.endMinute > start) return false;
      }
      return true;
    })
    .map(({ start, end }) => ({ startMinute: start, endMinute: end }));
}

// ---------------------------------------------------------------------------
// Service-layer helper: convert OccupiedSpan[] to minute-of-day spans for a
// single calendar day.  (Used by availability.service.ts; not exported from
// the pure module to keep the pure function fully timezone-free.)
// ---------------------------------------------------------------------------

export interface DaySpan {
  startMinute: number;
  endMinute: number;
}

export function toDayMinuteSpans(
  spans: OccupiedSpan[],
  dayStart: Date,
  nextDayStart: Date,
): DaySpan[] {
  const dayMs = dayStart.getTime();
  const nextMs = nextDayStart.getTime();
  const result: DaySpan[] = [];
  for (const s of spans) {
    // Clip to [dayStart, nextDayStart).
    const clipStart = Math.max(s.startAt.getTime(), dayMs);
    const clipEnd = Math.min(s.endAt.getTime(), nextMs);
    if (clipEnd <= clipStart) continue;
    result.push({
      startMinute: Math.floor((clipStart - dayMs) / 60_000),
      endMinute: Math.ceil((clipEnd - dayMs) / 60_000),
    });
  }
  return result;
}