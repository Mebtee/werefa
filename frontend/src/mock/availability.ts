import type {
  BusinessDetails,
  DateString,
  TimeOfDay,
  WorkingPeriod,
} from '@/types/models'
import { isPastSlot, minutesOf, nextDateStrings } from '@/lib/time'
import { mockTakenBlocks } from '@/mock/data'

export interface BookingDate {
  date: DateString
  hasTimes: boolean
}

/** The working periods that apply for a business on a given date. */
export function periodsForDate(
  business: BusinessDetails,
  date: DateString,
): readonly WorkingPeriod[] {
  if (business.blockedDays.includes(date)) return []

  const special = business.specialDays[date]
  if (special) {
    if (special.kind === 'closed') return []
    return special.periods
  }

  const weekday = new Date(`${date}T12:00:00`).getDay()
  return business.workingHours[weekday]
}

/**
 * Computes the selectable start times for a booking of the given duration.
 *
 * This mirrors the front-end *prevalidation* rule: a slot is offered only if
 * the whole booking fits and nothing is already booked or blocked. It is NOT
 * authoritative — the backend always re-checks before accepting a booking.
 */
export function computeAvailableTimes(
  business: BusinessDetails,
  date: DateString,
  durationMinutes: number,
): readonly TimeOfDay[] {
  const result: TimeOfDay[] = []
  const interval = Math.max(1, business.bookingIntervalMinutes)
  const taken = [
    ...business.blockedPeriods.filter((b) => b.date === date),
    ...mockTakenBlocks(business.slug, date),
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
): readonly BookingDate[] {
  return nextDateStrings(business.bookingWindowDays).map((date) => ({
    date,
    hasTimes: computeAvailableTimes(business, date, durationMinutes).length > 0,
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