import type {
  BlockedPeriod,
  BusinessDetails,
  DateString,
  SpecialDay,
  TimeOfDay,
  WeeklyWorkingHours,
  WorkingPeriod,
} from '@/types/models'
import { isPastSlot, minutesOf, nextDateStrings } from '@/lib/time'
import { mockTakenBlocks } from '@/mock/data'

export interface BookingDate {
  date: DateString
  hasTimes: boolean
}

/**
 * The minimum shape any schedule source provides so period projection works
 * for both a full business and a saved schedule snapshot (REQ-162).
 */
export interface SchedulePeriodSource {
  blockedDays: readonly DateString[]
  blockedPeriods: readonly BlockedPeriod[]
  specialDays: Readonly<Record<DateString, SpecialDay>>
  workingHours: WeeklyWorkingHours
}

/** The working periods that apply for a schedule on a given date. */
export function periodsForSchedule(
  schedule: SchedulePeriodSource,
  date: DateString,
): readonly WorkingPeriod[] {
  if (schedule.blockedDays.includes(date)) return []

  const special = schedule.specialDays[date]
  if (special) {
    if (special.kind === 'closed') return []
    return special.periods
  }

  const weekday = new Date(`${date}T12:00:00`).getDay()
  return schedule.workingHours[weekday]
}

/** The working periods that apply for a business on a given date. */
export function periodsForDate(
  business: BusinessDetails,
  date: DateString,
): readonly WorkingPeriod[] {
  return periodsForSchedule(business, date)
}

/**
 * Computes the selectable start times for a booking of the given duration.
 *
 * This mirrors the front-end *prevalidation* rule: a slot is offered only if
 * the whole booking fits and nothing is already booked or blocked. It is NOT
 * authoritative — the backend always re-checks before accepting a booking.
 *
 * `extraBlocks` lets callers add the live store's locked-booking blocks (slots
 * claimed by earlier proof submissions). Blocks carry their date; callers pass
 * only the dates they care about. It defaults to empty so the pure schedule
 * projection stays free of store state for callers that want it.
 */
export function computeAvailableTimes(
  business: BusinessDetails,
  date: DateString,
  durationMinutes: number,
  extraBlocks: readonly { date: DateString; start: TimeOfDay; end: TimeOfDay }[] = [],
): readonly TimeOfDay[] {
  const result: TimeOfDay[] = []
  const interval = Math.max(1, business.bookingIntervalMinutes)
  const taken = [
    ...business.blockedPeriods.filter((b) => b.date === date),
    ...mockTakenBlocks(business.slug, date),
    ...extraBlocks.filter((b) => b.date === date),
  ]

  for (const period of periodsForDate(business, date)) {
    const start = minutesOf(period.start)
    const end = minutesOf(period.end)
    for (let t = start; t + durationMinutes <= end; t += interval) {
      const candidate = minutesToTime(t)
      if (isPastSlot(date, candidate)) continue
      if (overlapsTaken(candidate, durationMinutes, taken)) continue
      result.push(candidate)
    }
  }

  return result
}

export function computeBookingDates(
  business: BusinessDetails,
  durationMinutes: number,
  extraBlocksForDate: (
    date: DateString,
  ) => readonly BlockedPeriod[] = () => [],
): readonly BookingDate[] {
  return nextDateStrings(business.bookingWindowDays).map((date) => ({
    date,
    hasTimes:
      computeAvailableTimes(business, date, durationMinutes, extraBlocksForDate(date))
        .length > 0,
  }))
}

function overlapsTaken(
  candidateStart: TimeOfDay,
  durationMinutes: number,
  taken: readonly { start: TimeOfDay; end: TimeOfDay }[],
): boolean {
  const s = minutesOf(candidateStart)
  const e = s + durationMinutes
  return taken.some((block) => {
    const bs = minutesOf(block.start)
    const be = minutesOf(block.end)
    return s < be && bs < e
  })
}

function minutesToTime(totalMinutes: number): TimeOfDay {
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}