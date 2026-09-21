import { isoWeekdayOf, minutesOf, minutesToTime, nextDateStrings } from '@/lib/time'
import type {
  BlockedPeriod,
  CanonicalScheduleState,
  DateString,
  ScheduleVersionHistoryEntry,
  SpecialDay,
  TimeOfDay,
  WorkingPeriod,
} from '@/types/models'
import type {
  BlockedPeriodView,
  OwnerScheduleConflictView,
  OwnerScheduleView,
  SaveBlockedPeriodInput,
  SaveSchedulePayload,
  SaveSpecialDateInput,
  SaveWorkingPeriodInput,
  SpecialDateView,
  WorkingPeriodView,
} from './types'

/**
 * Maps the real backend schedule projections to the UI form state and back
 * (Prompt 47). The UI edits days as frontend indices (Sunday = 0, matching
 * `WEEKDAY_NAMES`); the backend persists ISO weekdays (Monday = 1 …
 * Sunday = 7). All conversion lives here so the schedule page stays
 * shape-agnostic.
 */

// --- weekday conversion (frontend day index 0=Sunday ↔ ISO 1=Monday) ---------
export function frontendDayToIsoWeekday(dayIndex: number): number {
  return ((dayIndex + 6) % 7) + 1
}

export function isoWeekdayToFrontendDay(iso: number): number {
  return iso % 7
}

// --- editor-only form shapes --------------------------------------------------
export interface PeriodRow {
  start: TimeOfDay
  end: TimeOfDay
}

export interface SpecialDayEntry {
  date: string
  kind: 'closed' | 'custom'
  start: TimeOfDay | null
  end: TimeOfDay | null
}

export interface BlockedPeriodRow {
  key: string
  /** Frontend day index 0–6 (Sunday = 0); null = every day. */
  day: number | null
  start: TimeOfDay
  end: TimeOfDay
}

export interface ScheduleForm {
  hours: PeriodRow[][]
  interval: string
  specialDays: SpecialDayEntry[]
  blockedPeriods: BlockedPeriodRow[]
  reason: string
}

// --- wire → form ---------------------------------------------------------------
function workingPeriodsToHours(views: readonly WorkingPeriodView[]): PeriodRow[][] {
  const hours: PeriodRow[][] = [[], [], [], [], [], [], []]
  for (const view of views) {
    const day = isoWeekdayToFrontendDay(view.weekday)
    hours[day] = [...hours[day], { start: minutesToTime(view.startMinutes), end: minutesToTime(view.endMinutes) }]
  }
  return hours
}

function specialDatesToEntries(views: readonly SpecialDateView[]): SpecialDayEntry[] {
  return views.map((view) => ({
    date: view.date,
    kind: view.kind === 'CLOSED' ? 'closed' : 'custom',
    start: view.startMinutes == null ? null : minutesToTime(view.startMinutes),
    end: view.endMinutes == null ? null : minutesToTime(view.endMinutes),
  }))
}

function blockedPeriodsToRows(views: readonly BlockedPeriodView[]): BlockedPeriodRow[] {
  return views.map((view) => ({
    key: `${view.dayOfWeek ?? 'all'}-${view.startMinutes ?? 0}-${view.endMinutes ?? 1440}`,
    day: view.dayOfWeek == null ? null : isoWeekdayToFrontendDay(view.dayOfWeek),
    start: view.startMinutes == null ? '' : minutesToTime(view.startMinutes),
    end: view.endMinutes == null ? '' : minutesToTime(view.endMinutes),
  }))
}

export function scheduleFormFromApi(view: OwnerScheduleView, intervalMinutes: number): ScheduleForm {
  return {
    hours: workingPeriodsToHours(view.workingPeriods),
    interval: String(intervalMinutes),
    specialDays: specialDatesToEntries(view.specialDates),
    blockedPeriods: blockedPeriodsToRows(view.blockedPeriods),
    reason: '',
  }
}

// --- form → wire ----------------------------------------------------------------
export function toSchedulePayload(form: ScheduleForm): SaveSchedulePayload {
  const workingPeriods: SaveWorkingPeriodInput[] = []
  for (let day = 0; day < form.hours.length; day++) {
    for (const period of form.hours[day]) {
      workingPeriods.push({
        weekday: frontendDayToIsoWeekday(day),
        startMinutes: minutesOf(period.start),
        endMinutes: minutesOf(period.end),
      })
    }
  }

  const blockedPeriods: SaveBlockedPeriodInput[] = form.blockedPeriods.map((row) => ({
    dayOfWeek: row.day == null ? null : frontendDayToIsoWeekday(row.day),
    // An "every day / all day" row (REQ-084) keeps empty times → null minutes.
    startMinutes: row.start ? minutesOf(row.start) : null,
    endMinutes: row.end ? minutesOf(row.end) : null,
  }))

  const specialDates: SaveSpecialDateInput[] = form.specialDays.map((entry) =>
    entry.kind === 'closed'
      ? { date: entry.date, kind: 'CLOSED', startMinutes: null, endMinutes: null }
      : { date: entry.date, kind: 'CUSTOM', startMinutes: minutesOf(entry.start!), endMinutes: minutesOf(entry.end!) },
  )

  const name = form.reason.trim()
  return {
    ...(name ? { name } : {}),
    workingPeriods,
    blockedPeriods,
    specialDates,
  }
}

// --- history ----------------------------------------------------------------
export function canonicalState(view: OwnerScheduleView): CanonicalScheduleState {
  return {
    workingPeriods: view.workingPeriods,
    blockedPeriods: view.blockedPeriods.map((b) => ({
      dayOfWeek: b.dayOfWeek,
      startMinutes: b.startMinutes ?? 0,
      endMinutes: b.endMinutes ?? 1440,
    })),
    specialDates: view.specialDates.map((s) =>
      s.kind === 'CUSTOM' && s.startMinutes != null && s.endMinutes != null
        ? { date: s.date, kind: 'CUSTOM' as const, startMinutes: s.startMinutes, endMinutes: s.endMinutes }
        : { date: s.date, kind: 'CLOSED' as const, startMinutes: null, endMinutes: null },
    ),
  }
}

function localMinuteTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d}T${hh}:${mm}`
}

export function versionHistoryEntry(view: OwnerScheduleView): ScheduleVersionHistoryEntry {
  const automatic = view.appliedBy == null || view.appliedBy === 'system'
  return {
    id: view.versionId,
    versionNo: view.versionNo,
    status: view.status === 'ACTIVE' ? 'active' : view.status === 'PENDING' ? 'pending' : 'superseded',
    name: view.name,
    actor: automatic ? 'System (automatic)' : 'Owner',
    automatic,
    reason: view.reason,
    at: localMinuteTimestamp(view.appliedAt ?? view.createdAt),
    snapshot: canonicalState(view),
  }
}

// --- conflicts --------------------------------------------------------------
export interface ScheduleConflictItem {
  bookingId: string
  customerName: string
  customerPhone: string
  startAt: string
  reason: 'CLOSED' | 'OUTSIDE_HOURS' | 'BLOCKED'
  reasonDetail: string
  services: readonly { name: string; durationMinutes: number; unitPriceMinor: string }[]
}

export function conflictsFromApi(views: readonly OwnerScheduleConflictView[]): ScheduleConflictItem[] {
  return views.map((view) => ({
    bookingId: view.bookingId,
    customerName: view.customerName,
    customerPhone: view.customerPhone,
    startAt: view.startAt,
    reason: view.reason,
    reasonDetail: view.reasonDetail,
    services: view.services,
  }))
}

// --- canonical schedule → mock availability fixture --------------------------------
// The public booking page consumes the real public-schedule projection (Prompt
// 47 §18) but the still-mock availability engine reads the legacy BusinessDetails
// schedule fields. This pure derivation converts the canonical view (weekly
// periods, weekly blocked periods, single-window special dates) into those fields:
// - working periods → `workingHours` (sorted per day)
// - CLOSED special  → `specialDays[date] = { kind: 'closed' }` AND `blockedDays`
// - CUSTOM special  → `specialDays[date] = { kind: 'hours', periods: [window] }`
// - weekly blocks   → expanded across the booking window for matching weekdays
//                     (null dayOfWeek → every date in the window)
export interface AvailabilityScheduleFields {
  workingHours: WorkingPeriod[][]
  specialDays: Record<DateString, SpecialDay>
  blockedDays: readonly string[]
  blockedPeriods: readonly BlockedPeriod[]
}

export function availabilityScheduleFromView(
  view: Pick<OwnerScheduleView, 'workingPeriods' | 'blockedPeriods' | 'specialDates'>,
  options: { intervalMinutes: number; bookingWindowDays: number },
): AvailabilityScheduleFields {
  const workingHours: WorkingPeriod[][] = [[], [], [], [], [], [], []]
  for (const period of view.workingPeriods) {
    const day = isoWeekdayToFrontendDay(period.weekday)
    workingHours[day] = [
      ...workingHours[day],
      { start: minutesToTime(period.startMinutes), end: minutesToTime(period.endMinutes) },
    ]
  }
  const sortedHours = workingHours.map((slots) =>
    [...slots].sort((a, b) => (a.start < b.start ? -1 : 1)),
  )

  const specialDays: Record<DateString, SpecialDay> = {}
  const blockedDays: string[] = []
  for (const special of view.specialDates) {
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

  const blockedPeriods: BlockedPeriod[] = []
  for (const block of view.blockedPeriods) {
    const start = block.startMinutes == null ? '00:00' : minutesToTime(block.startMinutes)
    const end = block.endMinutes == null ? '23:59' : minutesToTime(block.endMinutes)
    for (const date of nextDateStrings(options.bookingWindowDays)) {
      if (block.dayOfWeek == null || isoWeekdayOf(date) === block.dayOfWeek) {
        blockedPeriods.push({ date, start, end })
      }
    }
  }

  return {
    workingHours: sortedHours,
    specialDays,
    blockedDays,
    blockedPeriods,
  }
}