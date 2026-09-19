import { minutesOf, minutesToTime } from '@/lib/time'
import type {
  CanonicalScheduleState,
  ScheduleVersionHistoryEntry,
  TimeOfDay,
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
    startMinutes: minutesOf(row.start),
    endMinutes: minutesOf(row.end),
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