import { isPastSlot } from '@/lib/time'
import type { DateString, TimeOfDay } from '@/types/models'
import type { PublicAvailabilityView } from './types'

/**
 * Maps the real backend availability projection into the UI's date/time
 * selectors (Prompt 48).
 *
 * The backend emits slot starts as ISO instants in the global timezone; the UI
 * renders 24-hour local times (REQ-225) and "HH:MM" date keys (REQ-224), so
 * this mapper converts ISO → local wall clock. It also applies the front-end
 * *presentation* rule that already-today slots in the past are not offered —
 * the backend has no past-time rule yet (spec §46 item 2), and the still-mock
 * booking submission re-checks the chosen time with the same `isPastSlot`
 * rule, so offering them would make the submit fail.
 */

export interface BookingDate {
  date: DateString
  hasTimes: boolean
}

/** ISO slot instants → ordered local "HH:MM" times (past today's slots dropped). */
export function slotTimesFromView(view: PublicAvailabilityView): readonly TimeOfDay[] {
  const times: TimeOfDay[] = []
  for (const slot of view.slots) {
    const time = localTimeOf(slot.startAt)
    if (isPastSlot(view.date, time)) continue
    times.push(time)
  }
  return times
}

/** One availability view per window date → the date strip (hasTimes = any offered slot). */
export function bookingDatesFromViews(
  views: readonly PublicAvailabilityView[],
): readonly BookingDate[] {
  return views.map((view) => ({
    date: view.date,
    hasTimes: slotTimesFromView(view).length > 0,
  }))
}

function localTimeOf(iso: string): TimeOfDay {
  const date = new Date(iso)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}