import { isoWeekdayOf, minutesToTime, nextDateStrings } from '@/lib/time'
import type {
  DateString,
  SpecialDay,
  TimeOfDay,
  WorkingPeriod,
} from '@/types/models'
import { updateBusiness } from './store'

/**
 * Mirrors a successfully-saved canonical schedule into the mock business store
 * (Prompt 47 seam). The bookings/availability vertical is not migrated, so the
 * still-mock public availability reads the mock business's `workingHours`,
 * `specialDays`, `blockedDays` and `blockedPeriods`. After every real schedule
 * save we rewrite that mock state so the two never drift.
 *
 * The mock store can express everything the canonical model can:
 * - working periods  → `workingHours` (sorted per day)
 * - CLOSED special   → `specialDays[date] = { kind: 'closed' }` AND `blockedDays`
 * - CUSTOM special   → `specialDays[date] = { kind: 'hours', periods: [window] }`
 * - weekly blocks    → expanded across the booking window for matching weekdays
 *                      (null dayOfWeek → every date in the window)
 */

export interface MirrorScheduleInput {
  workingPeriods: readonly { weekday: number; startMinutes: number; endMinutes: number }[]
  blockedPeriods: readonly {
    dayOfWeek?: number | null
    startMinutes?: number | null
    endMinutes?: number | null
  }[]
  specialDates: readonly {
    date: string
    kind: 'CLOSED' | 'CUSTOM'
    startMinutes?: number | null
    endMinutes?: number | null
  }[]
}

export interface MirrorScheduleOptions {
  intervalMinutes: number
  bookingWindowDays: number
}

function sortedHours(
  slots: readonly { start: TimeOfDay; end: TimeOfDay }[],
): readonly { start: TimeOfDay; end: TimeOfDay }[] {
  return [...slots].sort((a, b) => (a.start < b.start ? -1 : 1))
}

export function mirrorScheduleIntoBusiness(
  slug: string,
  input: MirrorScheduleInput,
  options: MirrorScheduleOptions,
): void {
  const workingHours: WorkingPeriod[][] = [[], [], [], [], [], [], []]
  for (const period of input.workingPeriods) {
    const day = period.weekday % 7
    workingHours[day] = [...workingHours[day], {
      start: minutesToTime(period.startMinutes),
      end: minutesToTime(period.endMinutes),
    }]
  }
  const normalizedHours = workingHours.map((slots) => sortedHours(slots))

  const specialDays: Record<DateString, SpecialDay> = {}
  const blockedDays: string[] = []
  for (const special of input.specialDates) {
    if (special.kind === 'CLOSED') {
      specialDays[special.date] = { kind: 'closed' }
      blockedDays.push(special.date)
    } else if (special.startMinutes != null && special.endMinutes != null) {
      specialDays[special.date] = {
        kind: 'hours',
        periods: [
          {
            start: minutesToTime(special.startMinutes),
            end: minutesToTime(special.endMinutes),
          },
        ],
      }
    }
  }

  const blockedPeriods: { date: DateString; start: TimeOfDay; end: TimeOfDay }[] = []
  for (const block of input.blockedPeriods) {
    const start = block.startMinutes == null ? '00:00' : minutesToTime(block.startMinutes)
    const end = block.endMinutes == null ? '23:59' : minutesToTime(block.endMinutes)
    for (const date of nextDateStrings(options.bookingWindowDays)) {
      if (block.dayOfWeek == null || isoWeekdayOf(date) === block.dayOfWeek) {
        blockedPeriods.push({ date, start, end })
      }
    }
  }

  updateBusiness(slug, {
    workingHours: normalizedHours,
    specialDays,
    blockedDays,
    blockedPeriods,
    bookingIntervalMinutes: options.intervalMinutes,
  })
}