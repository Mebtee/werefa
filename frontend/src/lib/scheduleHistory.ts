import type { CanonicalScheduleState, ScheduleSnapshot } from '@/types/models'

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

function canonicalKeys(schedule: CanonicalScheduleState): {
  working: string
  blocked: string
  special: string
} {
  return {
    working: JSON.stringify(
      [...schedule.workingPeriods].sort((a, b) => a.weekday - b.weekday || a.startMinutes - b.startMinutes),
    ),
    blocked: JSON.stringify(
      [...schedule.blockedPeriods].sort(
        (a, b) => (a.dayOfWeek ?? 7) - (b.dayOfWeek ?? 7) || a.startMinutes - b.startMinutes,
      ),
    ),
    special: JSON.stringify(
      [...schedule.specialDates].sort((a, b) => (a.date < b.date ? -1 : 1)),
    ),
  }
}

/**
 * "What changed" summary between two canonical (wire-mapped) schedule states —
 * the version-history diff for the Prompt 47 schedule API slice. Booking
 * interval is intentionally not part of the diff: the backend persists it on
 * business settings, not the schedule snapshot.
 */
export function describeVersionChange(
  previous: CanonicalScheduleState | null,
  next: CanonicalScheduleState,
): string {
  if (!previous) return 'Initial schedule.'
  const left = canonicalKeys(previous)
  const right = canonicalKeys(next)
  const changed: string[] = []
  if (left.working !== right.working) changed.push('Weekly hours')
  if (left.blocked !== right.blocked) changed.push('Blocked periods')
  if (left.special !== right.special) changed.push('Special dates')
  return changed.length > 0
    ? `${changed.join('; ')} changed.`
    : 'Schedule details updated.'
}