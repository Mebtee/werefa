import type { DateString, TimeOfDay } from '@/types/models'

/**
 * Date/time helpers.
 *
 * Dates travel as "YYYY-MM-DD" and times as "HH:MM" (REQ-224 / REQ-225).
 * Parsing uses local noon so weekday/arithmetic never drifts across a
 * midnight boundary. The authoritative timezone is a backend concern
 * (single fixed global timezone TBD — see specification open issues).
 */

export function parseDate(date: DateString): Date {
  const [y, m, d] = date.split('-').map((part) => Number(part))
  return new Date(y, m - 1, d, 12, 0, 0, 0)
}

export function toDateString(date: Date): DateString {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Weekday index (Sunday = 0) for the given date string. */
export function weekdayOf(date: DateString): number {
  return parseDate(date).getDay()
}

export function isToday(date: DateString): boolean {
  return date === toDateString(new Date())
}

export function addDays(date: DateString, days: number): DateString {
  const d = parseDate(date)
  d.setDate(d.getDate() + days)
  return toDateString(d)
}

/** The next N date strings starting today (inclusive). */
export function nextDateStrings(count: number): DateString[] {
  const today = toDateString(new Date())
  return Array.from({ length: Math.max(0, count) }, (_, i) => addDays(today, i))
}

/** Short weekday label for the date strip. */
export function weekdayLabel(date: DateString): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(
    parseDate(date),
  )
}

export function isPastSlot(date: DateString, time: TimeOfDay): boolean {
  if (!isToday(date)) return false
  const now = new Date()
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m <= currentMinutes
}

export function minutesOf(time: TimeOfDay): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export function periodLengthInMinutes(period: {
  start: TimeOfDay
  end: TimeOfDay
}): number {
  return minutesOf(period.end) - minutesOf(period.start)
}