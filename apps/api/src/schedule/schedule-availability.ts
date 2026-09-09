/**
 * Pure scheduling availability engine (Prompt 12 / docs 10 §2–§3).
 *
 * Time model: the whole platform runs in the single global timezone
 * Africa/Addis_Ababa (UTC+3, no DST, REQ-222/223). A local calendar day is
 * represented as its UTC-midnight instant; local instants are produced by
 * shifting a fixed +3h offset (no per-business timezone — nothing else can be
 * inferred, doc 10 §2). All arithmetic is millisecond-exact and the outputs are
 * whole minutes (REQ-226).
 *
 * Window resolution precedence (Prompt 12 §7, doc 10 §3):
 *   1. any blocked period overlapping the slot wins (BLOCKED_PERIOD);
 *   2. special-date override for the slot's local day (closed ⇒ no windows,
 *      otherwise the date's periods replace the weekly hours);
 *   3. weekly working periods.
 * An ACTIVE booking that does not fit a resolved window is considered AFFECTED.
 *
 * A business with NO active schedule version has no schedule constraint — the
 * legacy all-day availability (doc 10 §2/§8). The engine returns `ok` for any
 * window when the snapshot is null.
 */

export const SCHEDULE_TZ_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Minutes in a day — the whole-minutes domain of working/period rows. */
export const MINUTES_PER_DAY = 24 * 60;

export type ScheduleViolation =
  'WEEKLY_HOURS' | 'SPECIAL_DATE_CLOSED' | 'SPECIAL_DATE_HOURS' | 'BLOCKED_PERIOD';

export interface WorkingPeriodRow {
  dayOfWeek: number; // 0 = Sunday (JS convention)
  startMinutes: number;
  endMinutes: number;
}

export interface SpecialDateRow {
  calendarDate: Date; // UTC-midnight instant of a local calendar day
  isClosed: boolean;
  periods: WorkingPeriodRow[];
}

export interface BlockedPeriodRow {
  startAt: Date;
  endAt: Date;
}

export interface ScheduleSnapshot {
  versionId: string;
  businessId: string;
  status: string;
  bookingIntervalMinutes: number;
  workingPeriods: WorkingPeriodRow[];
  specialDates: SpecialDateRow[];
  blockedPeriods: BlockedPeriodRow[];
}

export interface TimeWindow {
  startAt: Date;
  endAt: Date;
}

export interface FitResult {
  ok: boolean;
  reason?: ScheduleViolation;
}

/** Shift an absolute instant into the global UTC+3 wall clock. */
export function shifted(instant: Date): Date {
  return new Date(instant.getTime() + SCHEDULE_TZ_OFFSET_MS);
}

/** The local calendar day (as UTC-midnight) that contains `instant`. */
export function localDateOf(instant: Date): Date {
  const s = shifted(instant);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
}

/** Day index (0 = Sunday) of the local day containing `instant`. */
export function localWeekdayOf(instant: Date): number {
  return shifted(instant).getUTCDay();
}

/** Minutes since local midnight of `instant` (0..1439). */
export function localMinutesOf(instant: Date): number {
  const s = shifted(instant);
  return s.getUTCHours() * 60 + s.getUTCMinutes();
}

/** Build the absolute instant at local `minutes` past midnight of `day`. */
export function instantOfLocalDay(day: Date, minutes: number): Date {
  return new Date(day.getTime() - SCHEDULE_TZ_OFFSET_MS + minutes * 60_000);
}

/**
 * Resolve the open windows for one local calendar day, after subtracting any
 * blocked periods that overlapped it (doc 10 §3). Returns [] for a closed
 * special date or a day with no windows.
 */
export function resolveDayWindows(snapshot: ScheduleSnapshot, day: Date): TimeWindow[] {
  const dayUtc = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const special = snapshot.specialDates.find((s) => s.calendarDate.getTime() === dayUtc.getTime());

  const base: { start: number; end: number }[] = [];
  if (special) {
    if (special.isClosed) return [];
    base.push(...special.periods.map((p) => ({ start: p.startMinutes, end: p.endMinutes })));
  } else {
    const weekday = dayUtc.getUTCDay();
    base.push(
      ...snapshot.workingPeriods
        .filter((p) => p.dayOfWeek === weekday)
        .map((p) => ({ start: p.startMinutes, end: p.endMinutes })),
    );
  }

  const dayStartInst = dayUtc.getTime() - SCHEDULE_TZ_OFFSET_MS;
  const dayEndInst = dayStartInst + MINUTES_PER_DAY * 60_000;
  let windows: TimeWindow[] = base.map((p) => ({
    startAt: new Date(dayStartInst + p.start * 60_000),
    endAt: new Date(dayStartInst + p.end * 60_000),
  }));

  for (const block of snapshot.blockedPeriods) {
    const bStart = block.startAt.getTime();
    const bEnd = block.endAt.getTime();
    if (bEnd <= dayStartInst || bStart >= dayEndInst) continue;
    const clipStart = Math.max(bStart, dayStartInst);
    const clipEnd = Math.min(bEnd, dayEndInst);
    const next: TimeWindow[] = [];
    for (const w of windows) {
      const wStart = w.startAt.getTime();
      const wEnd = w.endAt.getTime();
      if (clipEnd <= wStart || clipStart >= wEnd) {
        next.push(w);
        continue;
      }
      if (clipStart > wStart) next.push({ startAt: w.startAt, endAt: new Date(clipStart) });
      if (clipEnd < wEnd) next.push({ startAt: new Date(clipEnd), endAt: w.endAt });
    }
    windows = next;
  }
  return windows;
}

/**
 * Does the slot `[startAt, endAt)` fully sit inside a resolved window of the
 * active schedule? A slot that crosses a window boundary (incl. past midnight)
 * or that lands on a closed/blocked moment does NOT fit (REQ-089).
 */
export function evaluateFit(
  snapshot: ScheduleSnapshot | null,
  startAt: Date,
  endAt: Date,
): FitResult {
  if (!snapshot) return { ok: true };
  if (endAt.getTime() <= startAt.getTime()) return { ok: false, reason: 'WEEKLY_HOURS' };

  const overlapsBlock = snapshot.blockedPeriods.some(
    (b) => b.startAt.getTime() < endAt.getTime() && b.endAt.getTime() > startAt.getTime(),
  );
  if (overlapsBlock) return { ok: false, reason: 'BLOCKED_PERIOD' };

  const day = localDateOf(startAt);
  const special = snapshot.specialDates.find((s) => s.calendarDate.getTime() === day.getTime());
  if (special?.isClosed) return { ok: false, reason: 'SPECIAL_DATE_CLOSED' };

  const windows = resolveDayWindows(snapshot, day);
  const fits = windows.some(
    (w) => w.startAt.getTime() <= startAt.getTime() && w.endAt.getTime() >= endAt.getTime(),
  );
  if (fits) return { ok: true };
  return { ok: false, reason: special ? 'SPECIAL_DATE_HOURS' : 'WEEKLY_HOURS' };
}

/**
 * Basis-of-time candidate start instants inside `[from, to)` that fully fit a
 * resolved window with room for `durationMinutes` (doc 10 §2 basis of time).
 * Starts are anchored at each window's start and stepped by the version's
 * booking interval; a candidate that would cross the window end is dropped
 * (REQ-089). Returns an empty list when no schedule constrains the business.
 */
export function candidateStarts(
  snapshot: ScheduleSnapshot | null,
  from: Date,
  to: Date,
  durationMinutes: number,
): Date[] {
  if (!snapshot) return [];
  if (to.getTime() <= from.getTime() || durationMinutes <= 0) return [];
  const intervalMs = snapshot.bookingIntervalMinutes * 60_000;
  const out: Date[] = [];
  const firstDay = localDateOf(from);
  const lastDay = localDateOf(new Date(to.getTime() - 1));
  const dayStep = 24 * 60 * 60 * 1000;
  for (let dayTs = firstDay.getTime(); dayTs <= lastDay.getTime(); dayTs += dayStep) {
    const day = new Date(dayTs);
    for (const w of resolveDayWindows(snapshot, day)) {
      const wStart = w.startAt.getTime();
      const wEnd = w.endAt.getTime();
      for (let ts = wStart; ts + durationMinutes * 60_000 <= wEnd; ts += intervalMs) {
        if (ts < from.getTime()) continue;
        if (ts + durationMinutes * 60_000 > to.getTime()) break;
        out.push(new Date(ts));
      }
    }
  }
  return out;
}

/** Canonical per-violation reason labels surfaced to owner UIs and email. */
export const VIOLATION_LABELS: Record<ScheduleViolation, string> = {
  WEEKLY_HOURS: 'Outside weekly working hours',
  SPECIAL_DATE_CLOSED: 'Special date is closed',
  SPECIAL_DATE_HOURS: 'Outside special-date hours',
  BLOCKED_PERIOD: 'Inside a blocked period',
};
