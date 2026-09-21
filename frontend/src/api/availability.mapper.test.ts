import { describe, expect, it } from 'vitest'
import { bookingDatesFromViews, slotTimesFromView } from './availability.mapper'
import type { PublicAvailabilityView } from './types'

/**
 * Mapper tests for the Prompt 48 availability projection: ISO slot instants →
 * the UI's local "HH:MM" times (REQ-224/225), hasTimes expiry for the date
 * strip, and the front-end presentation rule that today's already-past slots
 * are not offered (the still-mock booking submission re-checks the chosen
 * time with the same rule).
 */

function view(slots: { startAt: string; endAt: string }[]): PublicAvailabilityView {
  return {
    date: '2026-11-20',
    slots,
    computedDurationMinutes: 60,
    computedTotalPriceMinor: 30000,
  }
}

/** The mapper output is the local representation of the slot instant. */
function localOf(iso: string): string {
  const date = new Date(iso)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function todayKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`
}

describe('slotTimesFromView', () => {
  it('converts ISO slot instants to ordered local HH:MM times', () => {
    const isos = [
      '2026-11-20T09:00:00.000Z',
      '2026-11-20T09:30:00.000Z',
      '2026-11-20T14:30:00.000Z',
    ]
    const times = slotTimesFromView(
      view([
        { startAt: isos[0], endAt: isos[2] },
        { startAt: isos[1], endAt: isos[2] },
        { startAt: isos[2], endAt: '2026-11-20T15:30:00.000Z' },
      ]),
    )
    expect(times).toEqual([localOf(isos[0]), localOf(isos[1]), localOf(isos[2])])
  })

  it('keeps every slot when the date is not today', () => {
    const iso = '2026-12-01T08:00:00.000Z'
    const times = slotTimesFromView(
      view([{ startAt: iso, endAt: '2026-12-01T09:00:00.000Z' }]),
    )
    expect(times).toEqual([localOf(iso)])
  })

  it('drops only today slots that have already started', () => {
    const now = new Date()
    const earlier = new Date(now.getTime() - 60 * 60_000).toISOString()
    const later = new Date(now.getTime() + 60 * 60_000).toISOString()
    const evenLater = new Date(now.getTime() + 120 * 60_000).toISOString()
    const times = slotTimesFromView(
      {
        ...view([
          { startAt: earlier, endAt: later },
          { startAt: later, endAt: evenLater },
        ]),
        date: todayKey(),
      },
    )
    expect(times).toContain(localOf(later))
    expect(times).not.toContain(localOf(earlier))
  })
})

describe('bookingDatesFromViews', () => {
  it('marks hasTimes false for a view whose only times are today-past', () => {
    const now = new Date()
    const earlier = new Date(now.getTime() - 60 * 60_000).toISOString()
    const later = new Date(now.getTime() + 60 * 60_000).toISOString()
    const evenLater = new Date(now.getTime() + 120 * 60_000).toISOString()
    const dates = bookingDatesFromViews([
      view([]),
      {
        ...view([{ startAt: earlier, endAt: later }]),
        date: todayKey(),
      },
      {
        ...view([
          { startAt: earlier, endAt: later },
          { startAt: later, endAt: evenLater },
        ]),
        date: todayKey(),
      },
    ])
    expect(dates).toEqual([
      { date: '2026-11-20', hasTimes: false },
      { date: todayKey(), hasTimes: false },
      { date: todayKey(), hasTimes: true },
    ])
  })

  it('keeps the slot order of a fully open day', () => {
    const dates = bookingDatesFromViews([
      view([
        { startAt: '2026-11-20T10:00:00.000Z', endAt: '2026-11-20T11:00:00.000Z' },
        { startAt: '2026-11-20T11:00:00.000Z', endAt: '2026-11-20T12:00:00.000Z' },
      ]),
      view([]),
    ])
    expect(dates).toEqual([
      { date: '2026-11-20', hasTimes: true },
      { date: '2026-11-20', hasTimes: false },
    ])
  })
})