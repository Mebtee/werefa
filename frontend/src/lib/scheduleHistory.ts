import type { ScheduleSnapshot } from '@/types/models'

function sortKeys<T>(record: Readonly<Record<string, T>>): string[] {
  return Object.keys(record).sort((a, b) => (a < b ? -1 : 1))
}

function sameWeeklyHours(a: readonly (readonly { start: string; end: string }[])[], b: readonly (readonly { start: string; end: string }[])[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function sameDates(
  a: readonly string[],
  b: readonly string[],
): boolean {
  const key = (dates: readonly string[]) => [...dates].sort().join(',')
  return key(a) === key(b)
}

function sameBlockedPeriods(
  a: readonly { date: string; start: string; end: string }[],
  b: readonly { date: string; start: string; end: string }[],
): boolean {
  const key = (blocks: readonly { date: string; start: string; end: string }[]) =>
    [...blocks]
      .map((block) => `${block.date}|${block.start}|${block.end}`)
      .sort()
      .join(',')
  return key(a) === key(b)
}

function sameSpecialDays(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): boolean {
  const ka = sortKeys(a)
  const kb = sortKeys(b)
  if (ka.length !== kb.length) return false
  return ka.every(
    (key, index) => key === kb[index] && JSON.stringify(a[key]) === JSON.stringify(b[key]),
  )
}

/**
 * Human-readable "what changed" summary between two retained schedule states
 * (REQ-163: each history entry contains changed content).
 */
export function describeScheduleChange(
  previous: ScheduleSnapshot | null,
  next: ScheduleSnapshot,
): string {
  if (!previous) return 'Initial schedule.'
  const changed: string[] = []
  if (!sameWeeklyHours(previous.workingHours, next.workingHours)) changed.push('Weekly hours')
  if (previous.bookingIntervalMinutes !== next.bookingIntervalMinutes) changed.push('Booking interval')
  if (!sameDates(previous.blockedDays, next.blockedDays)) changed.push('Blocked days')
  if (!sameBlockedPeriods(previous.blockedPeriods, next.blockedPeriods)) changed.push('Blocked periods')
  if (!sameSpecialDays(previous.specialDays, next.specialDays)) changed.push('Special dates')
  return changed.length > 0
    ? `${changed.join('; ')} changed.`
    : 'Schedule details updated.'
}