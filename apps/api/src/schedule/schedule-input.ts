import { ErrorCodes } from '@werefa/shared';
import { AppException, ConflictException, ValidationException } from '../common/http/app-error';
import { bodyObject } from '../iam/validation';
import { localDateOf, MINUTES_PER_DAY } from './schedule-availability';

/**
 * Parsed, validated schedule definition (Prompt 12 / REQ-082..086, doc 10 §3).
 *
 * Domain error codes (added to packages/shared for this prompt):
 *   - SCHEDULE_INVALID   malformed structure / out-of-range minutes
 *   - SCHEDULE_OVERLAP   two windows overlap on the same day
 *   - SCHEDULE_DUPLICATE duplicate special dates in one version
 *
 * Calendar dates are parsed as LOCAL calendar days and stored as their
 * UTC-midnight instant (same convention as `slot_date` / doc 10 §2).
 */
export interface ScheduleInputValue {
  bookingIntervalMinutes: number;
  reason: string | null;
  workingPeriods: { dayOfWeek: number; startMinutes: number; endMinutes: number }[];
  specialDates: {
    date: Date;
    isClosed: boolean;
    periods: { startMinutes: number; endMinutes: number }[];
  }[];
  blockedPeriods: { startAt: Date; endAt: Date; reason: string | null }[];
}

export interface KeepBookingInputValue {
  reason: string | null;
}

function invalid(field: string, message: string): never {
  throw new AppException(ErrorCodes.SCHEDULE_INVALID, 400, 'Invalid schedule definition', {
    fields: [{ field, message }],
  });
}

function bad(field: string, message: string): never {
  throw new ValidationException([{ field, message }]);
}

function readInt(payload: Record<string, unknown>, field: string): number | undefined {
  const raw = payload[field];
  if (raw === undefined || raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) bad(field, 'Must be a number.');
  return Math.round(value);
}

function readRangePair(
  payload: Record<string, unknown>,
  field: string,
): { startMinutes: number; endMinutes: number } {
  const start = readInt(payload, 'startMinutes');
  const end = readInt(payload, 'endMinutes');
  if (start === undefined || end === undefined) bad(`${field}.startMinutes`, 'Required (minutes).');
  return { startMinutes: start as number, endMinutes: end as number };
}

function assertRange(
  field: string,
  value: { startMinutes: number; endMinutes: number },
  max: number,
): void {
  if (value.startMinutes < 0 || value.endMinutes > max || value.startMinutes >= value.endMinutes) {
    invalid(field, 'startMinutes must be < endMinutes within [0, 1440].');
  }
}

/** Exact local calendar-day representation: 'YYYY-MM-DD' or an ISO instant. */
export function parseCalendarDate(raw: string, field: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (match) {
    const [, y, m, d] = match;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  }
  const value = new Date(raw.trim());
  if (Number.isNaN(value.getTime())) bad(field, 'Must be a valid date.');
  return localDateOf(value);
}

export function parseScheduleInput(body: unknown): ScheduleInputValue {
  const payload = bodyObject(body);

  const intervalRaw = readInt(payload, 'bookingIntervalMinutes');
  const bookingIntervalMinutes = intervalRaw ?? 30;
  if (bookingIntervalMinutes < 5 || bookingIntervalMinutes > 240) {
    invalid('bookingIntervalMinutes', 'Must be between 5 and 240 minutes.');
  }

  const reasonRaw = payload['reason'];
  let reason: string | null = null;
  if (reasonRaw !== undefined && reasonRaw !== null) {
    if (typeof reasonRaw !== 'string') bad('reason', 'Must be a string.');
    reason = reasonRaw.trim() ? reasonRaw.trim().slice(0, 500) : null;
  }

  const workingPeriods: ScheduleInputValue['workingPeriods'] = [];
  const weeklyRaw = payload['workingPeriods'];
  if (weeklyRaw !== undefined && weeklyRaw !== null) {
    if (!Array.isArray(weeklyRaw)) bad('workingPeriods', 'Must be an array.');
    const byDay = new Map<number, { startMinutes: number; endMinutes: number }[]>();
    weeklyRaw.forEach((entry, index) => {
      const line = bodyObject(entry, `workingPeriods[${index}]`);
      const day = readInt(line, 'dayOfWeek');
      if (day === undefined || day < 0 || day > 6) {
        invalid(`workingPeriods[${index}].dayOfWeek`, 'Must be an integer 0-6 (0 = Sunday).');
      }
      const pair = readRangePair(line, `workingPeriods[${index}]`);
      assertRange(`workingPeriods[${index}]`, pair, MINUTES_PER_DAY);
      const roundedDay = day as number;
      const dayList = byDay.get(roundedDay) ?? [];
      dayList.push(pair);
      byDay.set(roundedDay, dayList);
      workingPeriods.push({ dayOfWeek: roundedDay, ...pair });
    });
    for (const [day, windows] of byDay) {
      const sorted = [...windows].sort((a, b) => a.startMinutes - b.startMinutes);
      for (let i = 1; i < sorted.length; i += 1) {
        const prev = sorted[i - 1];
        const next = sorted[i];
        if (next && prev && next.startMinutes < prev.endMinutes) {
          throw new ConflictException(
            `Weekly windows overlap on ${weekdayName(day)} — merge or split them first.`,
            ErrorCodes.SCHEDULE_OVERLAP,
          );
        }
      }
    }
  }

  const specialDates: ScheduleInputValue['specialDates'] = [];
  const specialRaw = payload['specialDates'];
  if (specialRaw !== undefined && specialRaw !== null) {
    if (!Array.isArray(specialRaw)) bad('specialDates', 'Must be an array.');
    const seen = new Set<number>();
    specialRaw.forEach((entry, index) => {
      const line = bodyObject(entry, `specialDates[${index}]`);
      const dateRaw = line['date'];
      if (typeof dateRaw !== 'string' || !dateRaw.trim())
        bad(`specialDates[${index}].date`, 'Required.');
      const date = parseCalendarDate(dateRaw, `specialDates[${index}].date`);
      const isClosed = Boolean(line['isClosed'] ?? false);
      const periods: { startMinutes: number; endMinutes: number }[] = [];
      const periodsRaw = line['periods'];
      if (Array.isArray(periodsRaw)) {
        periodsRaw.forEach((p, pi) => {
          const pair = readRangePair(
            bodyObject(p, `specialDates[${index}].periods[${pi}]`),
            'periods',
          );
          assertRange(`specialDates[${index}].periods[${pi}]`, pair, MINUTES_PER_DAY);
          periods.push(pair);
        });
      }
      if (!isClosed && periodsRaw !== undefined && !Array.isArray(periodsRaw)) {
        bad(`specialDates[${index}].periods`, 'Must be an array.');
      }
      if (isClosed && periods.length > 0) {
        invalid(`specialDates[${index}]`, 'A closed special date cannot carry open periods.');
      }
      const key = date.getTime();
      if (seen.has(key)) {
        throw new ConflictException(
          'A special date can only be defined once per schedule version.',
          ErrorCodes.SCHEDULE_DUPLICATE,
        );
      }
      seen.add(key);
      specialDates.push({ date, isClosed, periods });
    });
    const sorted = [...specialDates].sort((a, b) => a.date.getTime() - b.date.getTime());
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (!prev || !cur) continue;
      const prevStart = prev.date.getTime() - 3 * 60 * 60 * 1000;
      const prevEnd = prevStart + MINUTES_PER_DAY * 60_000;
      const curStart = cur.date.getTime() - 3 * 60 * 60 * 1000;
      if (curStart < prevEnd) {
        throw new ConflictException(
          'Special dates cannot overlap each other (their local days must not intersect).',
          ErrorCodes.SCHEDULE_OVERLAP,
        );
      }
    }
  }

  const blockedPeriods: ScheduleInputValue['blockedPeriods'] = [];
  const blockedRaw = payload['blockedPeriods'];
  if (blockedRaw !== undefined && blockedRaw !== null) {
    if (!Array.isArray(blockedRaw)) bad('blockedPeriods', 'Must be an array.');
    blockedRaw.forEach((entry, index) => {
      const line = bodyObject(entry, `blockedPeriods[${index}]`);
      const startRaw = line['startAt'];
      const endRaw = line['endAt'];
      if (typeof startRaw !== 'string' || typeof endRaw !== 'string') {
        bad('blockedPeriods[' + index + ']', 'startAt and endAt are required.');
      }
      const startAt = new Date(startRaw.trim());
      const endAt = new Date(endRaw.trim());
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
        bad(`blockedPeriods[${index}]`, 'Must be valid ISO date-times.');
      }
      if (
        startAt.getSeconds() !== 0 ||
        startAt.getMilliseconds() !== 0 ||
        endAt.getSeconds() !== 0 ||
        endAt.getMilliseconds() !== 0
      ) {
        bad(`blockedPeriods[${index}]`, 'Times must be whole minutes (REQ-226).');
      }
      if (endAt.getTime() <= startAt.getTime()) {
        invalid(`blockedPeriods[${index}]`, 'endAt must be after startAt.');
      }
      let reason: string | null = null;
      const reasonRaw = line['reason'];
      if (reasonRaw !== undefined && reasonRaw !== null) {
        if (typeof reasonRaw !== 'string')
          bad(`blockedPeriods[${index}].reason`, 'Must be a string.');
        reason = reasonRaw.trim() ? reasonRaw.trim().slice(0, 200) : null;
      }
      blockedPeriods.push({ startAt, endAt, reason });
    });
  }

  return { bookingIntervalMinutes, reason, workingPeriods, specialDates, blockedPeriods };
}

export function parseKeepInput(body: unknown): KeepBookingInputValue {
  const payload = bodyObject(body);
  const reasonRaw = payload['reason'];
  if (reasonRaw === undefined || reasonRaw === null) return { reason: null };
  if (typeof reasonRaw !== 'string') bad('reason', 'Must be a string.');
  const reason = reasonRaw.trim() ? reasonRaw.trim().slice(0, 500) : null;
  return { reason };
}

function weekdayName(day: number): string {
  return (
    ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day] ??
    String(day)
  );
}
