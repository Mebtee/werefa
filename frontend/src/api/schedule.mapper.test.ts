import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  availabilityScheduleFromView,
  canonicalState,
  frontendDayToIsoWeekday,
  isoWeekdayToFrontendDay,
  scheduleFormFromApi,
  toSchedulePayload,
  versionHistoryEntry,
} from './schedule.mapper'
import type { OwnerScheduleView } from './types'

/**
 * Unit tests for the Prompt 47 schedule mapper: the wire→form and form→wire
 * conversions stay consistent, the empty-rows band ("null" minute views for
 * blocked periods) survive a save round-trip, and the canonical view expands
 * deterministically to the mock availability fixture the public page reads.
 */

afterEach(() => {
  vi.useRealTimers()
})

describe('weekday conversion', () => {
  it('maps frontend day index (Sunday = 0) to ISO weekday (Monday = 1)', () => {
    expect(frontendDayToIsoWeekday(0)).toBe(7) // Sunday
    expect(frontendDayToIsoWeekday(1)).toBe(1) // Monday
    expect(frontendDayToIsoWeekday(6)).toBe(6) // Saturday
    expect(isoWeekdayToFrontendDay(7)).toBe(0)
    expect(isoWeekdayToFrontendDay(1)).toBe(1)
    expect(isoWeekdayToFrontendDay(6)).toBe(6)
  })
})

describe('form round-trip', () => {
  const view: OwnerScheduleView = {
    versionId: 'sch-v-1',
    versionNo: 1,
    status: 'ACTIVE',
    name: null,
    appliedAt: '2026-09-18T09:00:00.000Z',
    appliedBy: 'owner@example.com',
    reason: null,
    createdAt: '2026-09-18T09:00:00.000Z',
    workingPeriods: [
      { weekday: 1, startMinutes: 540, endMinutes: 780 },
      { weekday: 1, startMinutes: 840, endMinutes: 1080 },
      { weekday: 5, startMinutes: 480, endMinutes: 600 },
    ],
    // "Every day, all day" blocks are encoded as null minutes (REQ-084 empty row).
    blockedPeriods: [
      { dayOfWeek: 1, startMinutes: 570, endMinutes: 630 },
      { dayOfWeek: null, startMinutes: null, endMinutes: null },
    ],
    specialDates: [
      { date: '2026-12-25', kind: 'CLOSED', startMinutes: null, endMinutes: null },
      { date: '2026-12-31', kind: 'CUSTOM', startMinutes: 600, endMinutes: 900 },
    ],
  }

  it('decodes a view into the editor form (frontend weekday slots)', () => {
    const form = scheduleFormFromApi(view, 30)

    expect(form.interval).toBe('30')
    expect(form.hours[1]).toEqual([
      { start: '09:00', end: '13:00' },
      { start: '14:00', end: '18:00' },
    ])
    expect(form.hours[5]).toEqual([{ start: '08:00', end: '10:00' }])
    expect(form.specialDays).toEqual([
      { date: '2026-12-25', kind: 'closed', start: null, end: null },
      { date: '2026-12-31', kind: 'custom', start: '10:00', end: '15:00' },
    ])
    expect(form.blockedPeriods[0]).toMatchObject({
      day: 1,
      start: '09:30',
      end: '10:30',
    })
    // The all-day row keeps its null day and a stable key; empty time rows.
    expect(form.blockedPeriods[1]).toMatchObject({
      day: null,
      start: '',
      end: '',
      key: 'all-0-1440',
    })
  })

  it('re-encodes the form into the same wire shape', () => {
    const form = scheduleFormFromApi(view, 30)
    const payload = toSchedulePayload(form)

    expect(payload).toEqual({
      workingPeriods: [
        { weekday: 1, startMinutes: 540, endMinutes: 780 },
        { weekday: 1, startMinutes: 840, endMinutes: 1080 },
        { weekday: 5, startMinutes: 480, endMinutes: 600 },
      ],
      blockedPeriods: [
        { dayOfWeek: 1, startMinutes: 570, endMinutes: 630 },
        { dayOfWeek: null, startMinutes: null, endMinutes: null },
      ],
      specialDates: [
        { date: '2026-12-25', kind: 'CLOSED', startMinutes: null, endMinutes: null },
        { date: '2026-12-31', kind: 'CUSTOM', startMinutes: 600, endMinutes: 900 },
      ],
    })
  })

  it('includes the trimmed owner reason as the version name (REQ-164)', () => {
    const form = scheduleFormFromApi(view, 30)
    form.reason = '  Q3 opening hours  '
    expect(toSchedulePayload(form).name).toBe('Q3 opening hours')
  })
})

describe('canonicalState + versionHistoryEntry', () => {
  it('derives the canonical schedule state and history entry from a view', () => {
    const view: OwnerScheduleView = {
      versionId: 'sch-v-2',
      versionNo: 2,
      status: 'SUPERSEDED',
      name: 'Evening slots',
      appliedAt: '2026-09-20T18:30:00.000Z',
      appliedBy: 'owner@example.com',
      reason: 'Evening slots',
      createdAt: '2026-09-20T18:30:00.000Z',
      workingPeriods: [{ weekday: 1, startMinutes: 1080, endMinutes: 1140 }],
      blockedPeriods: [{ dayOfWeek: 2, startMinutes: null, endMinutes: null }],
      specialDates: [{ date: '2026-12-25', kind: 'CLOSED', startMinutes: null, endMinutes: null }],
    }
    const canonical = canonicalState(view)
    expect(canonical.workingPeriods).toEqual([{ weekday: 1, startMinutes: 1080, endMinutes: 1140 }])
    expect(canonical.blockedPeriods).toEqual([{ dayOfWeek: 2, startMinutes: 0, endMinutes: 1440 }])
    expect(canonical.specialDates).toEqual([
      { date: '2026-12-25', kind: 'CLOSED', startMinutes: null, endMinutes: null },
    ])

    const entry = versionHistoryEntry(view)
    expect(entry.status).toBe('superseded')
    expect(entry.versionNo).toBe(2)
    expect(entry.actor).toBe('Owner')
    expect(entry.automatic).toBe(false)
  })

  it('marks a system-applied version as automatic (REQ-151)', () => {
    const entry = versionHistoryEntry({
      versionId: 'sch-v-3',
      versionNo: 3,
      status: 'ACTIVE',
      name: null,
      appliedAt: null,
      appliedBy: 'system',
      reason: 'Schedule applied on resume.',
      createdAt: '2026-09-21T08:00:00.000Z',
      workingPeriods: [],
      blockedPeriods: [],
      specialDates: [],
    })
    expect(entry.automatic).toBe(true)
    expect(entry.actor).toBe('System (automatic)')
    expect(entry.status).toBe('active')
  })
})

describe('availabilityScheduleFromView', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-19T12:00:00')) // Saturday
  })

  const view = (patch: Partial<OwnerScheduleView> = {}): OwnerScheduleView => ({
    versionId: 'sch-v-1',
    versionNo: 1,
    status: 'ACTIVE',
    name: null,
    appliedAt: null,
    appliedBy: null,
    reason: null,
    createdAt: '2026-09-19T08:00:00.000Z',
    workingPeriods: [
      { weekday: 1, startMinutes: 540, endMinutes: 780 }, // Monday 09:00–13:00
      { weekday: 1, startMinutes: 1080, endMinutes: 1140 }, // Monday 18:00–19:00 (unsorted on purpose)
    ],
    blockedPeriods: [],
    specialDates: [],
    ...patch,
  })

  it('sorts per-day working periods into frontend week slots', () => {
    const fields = availabilityScheduleFromView(view(), {
      intervalMinutes: 30,
      bookingWindowDays: 7,
    })
    expect(fields.workingHours[1]).toEqual([
      { start: '09:00', end: '13:00' },
      { start: '18:00', end: '19:00' },
    ])
    expect(fields.workingHours).toHaveLength(7)
  })

  it('maps a CLOSED special date to both specialDays and blockedDays', () => {
    const fields = availabilityScheduleFromView(
      view({
        specialDates: [
          { date: '2026-12-25', kind: 'CLOSED', startMinutes: null, endMinutes: null },
        ],
      }),
      { intervalMinutes: 30, bookingWindowDays: 7 },
    )
    expect(fields.specialDays['2026-12-25']).toEqual({ kind: 'closed' })
    expect(fields.blockedDays).toContain('2026-12-25')
  })

  it('maps a CUSTOM special date to a single-window hours day', () => {
    const fields = availabilityScheduleFromView(
      view({
        specialDates: [
          { date: '2026-12-31', kind: 'CUSTOM', startMinutes: 600, endMinutes: 900 },
        ],
      }),
      { intervalMinutes: 30, bookingWindowDays: 7 },
    )
    expect(fields.specialDays['2026-12-31']).toEqual({
      kind: 'hours',
      periods: [{ start: '10:00', end: '15:00' }],
    })
  })

  it('expands a weekly blocked period across the window for matching weekdays only', () => {
    // Window 2026-09-19 (Sat) … 2026-09-25 (Fri). ISO weekday 1 = Monday:
    // 2026-09-21. ISO weekday 7 = Sunday: 2026-09-20.
    const fields = availabilityScheduleFromView(
      view({
        blockedPeriods: [{ dayOfWeek: 1, startMinutes: 570, endMinutes: 630 }],
      }),
      { intervalMinutes: 30, bookingWindowDays: 7 },
    )
    expect(fields.blockedPeriods).toEqual([
      { date: '2026-09-21', start: '09:30', end: '10:30' },
    ])
  })

  it('expands an every-day block (null dayOfWeek) to every date in the window', () => {
    const fields = availabilityScheduleFromView(
      view({
        blockedPeriods: [
          // Null minutes = "all day" → clamped start/end (REQ-084 empty row).
          { dayOfWeek: null, startMinutes: null, endMinutes: null },
        ],
      }),
      { intervalMinutes: 30, bookingWindowDays: 3 },
    )
    expect(fields.blockedPeriods).toEqual([
      { date: '2026-09-19', start: '00:00', end: '23:59' },
      { date: '2026-09-20', start: '00:00', end: '23:59' },
      { date: '2026-09-21', start: '00:00', end: '23:59' },
    ])
  })
})