import type { WorkingPeriod } from '@/types/models'
import { minutesOf } from '@/lib/time'

/**
 * Whether two working periods overlap on the timeline (REQ-083: multiple
 * periods per day are allowed, but overlapping ones are rejected).
 */
export function periodsOverlap(a: WorkingPeriod, b: WorkingPeriod): boolean {
  const as = minutesOf(a.start)
  const ae = minutesOf(a.end)
  const bs = minutesOf(b.start)
  const be = minutesOf(b.end)
  return as < be && bs < ae
}

/**
 * Returns the first overlapping pair within a day's periods, or null when all
 * periods are disjoint. Used to validate weekly and special-date hours so a
 * blurred window (e.g. 09:00–12:00 and 11:00–14:00) can never be saved.
 */
export function firstOverlap(
  periods: readonly WorkingPeriod[],
): { a: WorkingPeriod; b: WorkingPeriod } | null {
  for (let i = 0; i < periods.length; i++) {
    for (let j = i + 1; j < periods.length; j++) {
      if (periodsOverlap(periods[i], periods[j])) {
        return { a: periods[i], b: periods[j] }
      }
    }
  }
  return null
}