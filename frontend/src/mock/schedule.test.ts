import { beforeEach, describe, expect, it } from 'vitest'
import type {
  Booking,
  DateString,
  ScheduleSnapshot,
  TimeOfDay,
} from '@/types/models'
import {
  resetStore,
  getBusiness,
  scheduleSnapshotOf,
  saveSchedule,
  listScheduleHistory,
  setPause,
  addBlockedDay,
  removeBlockedDay,
  addBlockedPeriod,
  removeBlockedPeriod,
  createBookingEntry,
  acceptBooking,
  cancelBooking,
  rescheduleBooking,
  keepBooking,
  getOpenConflicts,
  getScheduleConflicts,
  completeDueBookings,
} from '@/mock/store'
import {
  computeAvailableTimes,
  periodsForDate,
  periodsForSchedule,
} from '@/mock/availability'
import { PRIMARY_BUSINESS_SLUG } from '@/mock/data'
import { describeScheduleChange } from '@/lib/scheduleHistory'

const SLUG = PRIMARY_BUSINESS_SLUG

// Deterministic future dates: Monday and Tuesday of the availability fixture.
const MONDAY: DateString = '2030-03-04'
const TUESDAY: DateString = '2030-03-05'

function snapshotOf(patch: Partial<ScheduleSnapshot> = {}): ScheduleSnapshot {
  const business = getBusiness(SLUG)!
  return { ...scheduleSnapshotOf(business), ...patch }
}

function bookOn(
  date: DateString,
  time: TimeOfDay,
  durationMinutes = 60,
): Booking {
  const created = createBookingEntry({
    businessSlug: SLUG,
    lineItems: [{ name: 'Test Service', unitPrice: 10000, durationMinutes }],
    total: 10000,
    totalDurationMinutes: durationMinutes,
    deposit: 0,
    customer: { name: 'Test Customer', phone: '+251900000001', note: '' },
    date,
    time,
    paymentMethod: 'bank-transfer',
    proof: { fileName: 'proof.png', sizeBytes: 100, mimeType: 'image/png' },
  })
  if (!created.ok) throw new Error('fixture booking failed')
  return created.booking
}

function acceptedOn(date: DateString, time: TimeOfDay, durationMinutes = 60): Booking {
  const booking = bookOn(date, time, durationMinutes)
  const accepted = acceptBooking(SLUG, booking.id)
  if (!accepted.ok) throw new Error('fixture accept failed')
  return accepted.value
}

function closeMonday(): ScheduleSnapshot {
  const base = snapshotOf()
  const hours = base.workingHours.map((day) => day.map((p) => ({ ...p })))
  hours[1] = []
  return { ...base, workingHours: hours }
}

function closeTuesday(): ScheduleSnapshot {
  const base = snapshotOf()
  const hours = base.workingHours.map((day) => day.map((p) => ({ ...p })))
  hours[2] = []
  return { ...base, workingHours: hours }
}

beforeEach(() => {
  resetStore()
})

describe('saveSchedule + versioning (REQ-162/163/164/166)', () => {
  it('records a retained active version and applies it to the business', () => {
    const result = saveSchedule(SLUG, snapshotOf({ bookingIntervalMinutes: 45 }), {})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.version.status).toBe('active')
    expect(result.value.version.automatic).toBe(false)
    expect(result.value.version.actor).toBe('Demo Owner')
    expect(result.value.version.reason).toBeNull()
    expect(getBusiness(SLUG)!.bookingIntervalMinutes).toBe(45)
  })

  it('supersedes the previous active version on a new save', () => {
    saveSchedule(SLUG, snapshotOf({ bookingIntervalMinutes: 45 }))
    saveSchedule(SLUG, snapshotOf({ bookingIntervalMinutes: 60 }))
    const history = listScheduleHistory(SLUG)
    expect(history).toHaveLength(2)
    expect(history[0].status).toBe('active')
    expect(history[0].snapshot.bookingIntervalMinutes).toBe(60)
    expect(history[1].status).toBe('superseded')
    expect(history[1].snapshot.bookingIntervalMinutes).toBe(45)
  })

  it('records an optional owner reason, trimming blanks', () => {
    saveSchedule(SLUG, snapshotOf(), { reason: '  Summer closure  ' })
    expect(listScheduleHistory(SLUG)[0].reason).toBe('Summer closure')
    saveSchedule(SLUG, snapshotOf({ bookingIntervalMinutes: 60 }), { reason: '   ' })
    expect(listScheduleHistory(SLUG)[0].reason).toBeNull()
  })

  it('keeps every retained version unique across several saves', () => {
    for (let i = 0; i < 3; i += 1) {
      saveSchedule(SLUG, snapshotOf({ bookingIntervalMinutes: 15 + i * 15 }))
    }
    const ids = listScheduleHistory(SLUG).map((v) => v.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('reports the whole list newest first even for same-minute saves', () => {
    saveSchedule(SLUG, snapshotOf({ bookingIntervalMinutes: 30 }))
    saveSchedule(SLUG, snapshotOf({ bookingIntervalMinutes: 20 }))
    const history = listScheduleHistory(SLUG)
    expect(history[0].snapshot.bookingIntervalMinutes).toBe(20)
    expect(history[1].snapshot.bookingIntervalMinutes).toBe(30)
  })
})

describe('schedule while paused (REQ-147/150/151/152)', () => {
  it('stores saves as pending versions when paused, still applying to the business', () => {
    setPause(SLUG, { kind: 'indefinite', message: 'Holiday' })
    saveSchedule(SLUG, closeMonday())
    const version = listScheduleHistory(SLUG)[0]
    expect(version.status).toBe('pending')
    expect(getBusiness(SLUG)!.workingHours[1]).toHaveLength(0)
    expect(getOpenConflicts(SLUG)).toEqual([])
  })

  it('resume promotes the latest pending version and records an automatic System version', () => {
    setPause(SLUG, { kind: 'indefinite' })
    saveSchedule(SLUG, snapshotOf({ bookingIntervalMinutes: 20 }))
    saveSchedule(SLUG, closeMonday())
    expect(listScheduleHistory(SLUG).filter((v) => v.status === 'pending')).toHaveLength(2)

    const resume = setPause(SLUG, null)
    expect(resume.ok).toBe(true)
    const history = listScheduleHistory(SLUG)
    expect(history[0].automatic).toBe(true)
    expect(history[0].actor).toBe('System')
    expect(history[0].reason).toBe('Schedule applied on resume.')
    expect(history[0].status).toBe('active')
    expect(history[0].snapshot.workingHours[1]).toHaveLength(0)
    expect(history.slice(1).map((v) => v.status)).toEqual(['superseded', 'superseded'])
  })

  it('resume records conflicts for bookings hit by the promoted schedule', () => {
    const booking = acceptedOn(MONDAY, '10:00')
    setPause(SLUG, { kind: 'indefinite' })
    saveSchedule(SLUG, closeMonday())
    expect(getOpenConflicts(SLUG)).toEqual([])
    setPause(SLUG, null)
    const open = getOpenConflicts(SLUG)
    expect(open).toHaveLength(1)
    expect(open[0].bookingId).toBe(booking.id)
    expect(open[0].reason).toContain('closed on 2030-03-04')
  })
})

describe('blocked days & periods (REQ-084/085)', () => {
  it('adds and removes a blocked day idempotently', () => {
    addBlockedDay(SLUG, MONDAY)
    addBlockedDay(SLUG, MONDAY)
    expect(getBusiness(SLUG)!.blockedDays).toContain(MONDAY)
    expect(periodsForSchedule(getBusiness(SLUG)!, MONDAY)).toEqual([])
    expect(computeAvailableTimes(getBusiness(SLUG)!, MONDAY, 30)).toEqual([])
    removeBlockedDay(SLUG, MONDAY)
    expect(getBusiness(SLUG)!.blockedDays).not.toContain(MONDAY)
    expect(computeAvailableTimes(getBusiness(SLUG)!, MONDAY, 30).length).toBeGreaterThan(0)
  })

  it('adds and removes a blocked period idempotently, closing that window', () => {
    addBlockedPeriod(SLUG, { date: MONDAY, start: '09:30', end: '10:30' })
    addBlockedPeriod(SLUG, { date: MONDAY, start: '09:30', end: '10:30' })
    const times = computeAvailableTimes(getBusiness(SLUG)!, MONDAY, 60)
    expect(times).not.toContain('09:00') // 09:00+60 overlaps 09:30–10:30
    expect(times).not.toContain('09:30')
    expect(times).toContain('10:30')
    removeBlockedPeriod(SLUG, MONDAY, '09:30', '10:30')
    expect(computeAvailableTimes(getBusiness(SLUG)!, MONDAY, 60)).toContain('09:30')
  })
})

describe('conflict detection (REQ-091/092/093)', () => {
  it('flags a confirmed booking when its day is newly closed, leaving the booking untouched', () => {
    const booking = acceptedOn(MONDAY, '10:00')
    const result = saveSchedule(SLUG, closeMonday())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.conflicts).toHaveLength(1)
    const conflict = result.value.conflicts[0]
    expect(conflict.bookingId).toBe(booking.id)
    expect(conflict.status).toBe('open')
    expect(conflict.reason).toContain('closed on 2030-03-04')
    const stored = getBusiness(SLUG) ? getOpenConflicts(SLUG) : []
    expect(stored).toHaveLength(1)
    expect(booking.state).toBe('confirmed')
  })

  it('flags when working hours no longer cover the full appointment, and skips unaffected ones', () => {
    const hit = acceptedOn(MONDAY, '10:00', 60)
    const fine = acceptedOn(TUESDAY, '10:00', 60)
    const base = snapshotOf()
    const hours = base.workingHours.map((day) => day.map((p) => ({ ...p })))
    hours[1] = [{ start: '09:00', end: '10:30' }]
    const result = saveSchedule(SLUG, { ...base, workingHours: hours })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const ids = result.value.conflicts.map((c) => c.bookingId)
    expect(ids).toContain(hit.id)
    expect(ids).not.toContain(fine.id)
    expect(result.value.conflicts[0].reason).toContain('no longer cover the full')
  })

  it('flags a booking whose window now overlaps a blocked period', () => {
    const booking = acceptedOn(MONDAY, '10:00', 60)
    const base = snapshotOf()
    const result = saveSchedule(SLUG, {
      ...base,
      blockedPeriods: [{ date: MONDAY, start: '09:30', end: '10:30' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.conflicts).toHaveLength(1)
    expect(result.value.conflicts[0].bookingId).toBe(booking.id)
    expect(result.value.conflicts[0].reason).toContain('A blocked period overlaps')
  })

  it('ignores released or terminal bookings', () => {
    const booking = acceptedOn(MONDAY, '10:00')
    const cancelled = cancelBooking(SLUG, booking.id)
    expect(cancelled.ok).toBe(true)
    const result = saveSchedule(SLUG, closeMonday())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.conflicts).toEqual([])
    expect(getOpenConflicts(SLUG)).toEqual([])
  })

  it('a kept schedule exception is not re-flagged by later saves (REQ-160)', () => {
    const booking = acceptedOn(MONDAY, '10:00')
    saveSchedule(SLUG, closeMonday())
    keepBooking(SLUG, booking.id, 'Kept.')
    expect(getOpenConflicts(SLUG)).toEqual([])
    // Saving an unchanged closing schedule must not re-warn about the kept
    // booking; the Schedule Exception already records the owner's decision.
    saveSchedule(SLUG, closeMonday())
    expect(getOpenConflicts(SLUG)).toEqual([])
  })

  it('payment-pending bookings also conflict (still live/held)', () => {
    const booking = bookOn(MONDAY, '10:00')
    const result = saveSchedule(SLUG, closeMonday())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.conflicts.map((c) => c.bookingId)).toEqual([booking.id])
  })
})

describe('conflict resolution + Keep Booking (REQ-099/159/160/161)', () => {
  it('cancel resolves the conflict as cancel and releases the slot', () => {
    const booking = acceptedOn(MONDAY, '10:00')
    saveSchedule(SLUG, closeMonday())
    expect(getOpenConflicts(SLUG)).toHaveLength(1)
    cancelBooking(SLUG, booking.id)
    expect(getOpenConflicts(SLUG)).toEqual([])
    expect(getScheduleConflicts(SLUG)[0].action).toBe('cancel')
    expect(getScheduleConflicts(SLUG)[0].status).toBe('resolved')
  })

  it('reschedule resolves the conflict as reschedule and moves the booking', () => {
    const booking = acceptedOn(MONDAY, '10:00')
    saveSchedule(SLUG, closeMonday())
    const moved = rescheduleBooking(SLUG, booking.id, TUESDAY, '14:00')
    expect(moved.ok).toBe(true)
    expect(moved.ok && moved.value.date).toBe(TUESDAY)
    expect(getOpenConflicts(SLUG)).toEqual([])
    expect(getScheduleConflicts(SLUG)[0].action).toBe('reschedule')
  })

  it('keepBooking labels the booking with a Schedule Exception and never notifies', () => {
    const booking = acceptedOn(MONDAY, '10:00')
    saveSchedule(SLUG, closeMonday())
    const kept = keepBooking(SLUG, booking.id, 'Customer confirmed by phone.')
    expect(kept.ok).toBe(true)
    if (!kept.ok) return
    expect(kept.value.scheduleException?.reason).toBe('Customer confirmed by phone.')
    expect(kept.value.scheduleException?.scheduleVersionId).toBe(listScheduleHistory(SLUG)[0].id)
    expect(kept.value.scheduleException?.at).toBeTruthy()
    expect(getOpenConflicts(SLUG)).toEqual([])
    expect(getScheduleConflicts(SLUG)[0].action).toBe('keep')
    // No customer notification is issued for a kept booking (REQ-160 AC6).
    expect(kept.value.telegramNotices).toEqual([])
    // The decision is recorded in the audit history without an IllegalResult...
    expect(kept.value.history.at(-1)?.previous).toBe('confirmed')
  })

  it('a kept exception persists after the appointment completes', () => {
    const booking = acceptedOn(MONDAY, '10:00', 60)
    saveSchedule(SLUG, closeMonday())
    keepBooking(SLUG, booking.id, 'Kept.')
    const done = completeDueBookings(SLUG, `${MONDAY}T11:30`)
    expect(done.ok).toBe(true)
    if (!done.ok) return
    const completed = done.value.find((b) => b.id === booking.id)
    expect(completed?.state).toBe('completed')
    expect(completed?.scheduleException?.reason).toBe('Kept.')
  })

  it('refuses to keep a booking that is not affected by any open conflict (REQ-159)', () => {
    const booking = acceptedOn(MONDAY, '10:00')
    saveSchedule(SLUG, closeTuesday())
    const kept = keepBooking(SLUG, booking.id, 'No conflict here.')
    expect(kept.ok).toBe(false)
    expect(booking.scheduleException).toBeNull()
    expect(booking.history).toHaveLength(2)
    expect(getOpenConflicts(SLUG)).toEqual([])
  })

  it('keeping twice is rejected after the first keep resolves the conflict', () => {
    const booking = acceptedOn(MONDAY, '10:00')
    saveSchedule(SLUG, closeMonday())
    const first = keepBooking(SLUG, booking.id, 'Kept.')
    expect(first.ok).toBe(true)
    const len = booking.history.length
    const again = keepBooking(SLUG, booking.id, 'Kept again.')
    expect(again.ok).toBe(false)
    expect(booking.scheduleException?.reason).toBe('Kept.')
    expect(booking.history).toHaveLength(len)
    expect(getOpenConflicts(SLUG)).toEqual([])
  })
})

describe('periodsForSchedule + special dates (REQ-082/083)', () => {
  it('returns multiple periods for a special hours day', () => {
    const base = snapshotOf()
    const specialDays: Record<string, { kind: 'hours'; periods: { start: TimeOfDay; end: TimeOfDay }[] }> = {
      [MONDAY]: { kind: 'hours', periods: [
        { start: '08:00', end: '10:00' },
        { start: '15:00', end: '16:00' },
      ] },
    }
    const next = { ...base, specialDays }
    saveSchedule(SLUG, next)
    expect(periodsForSchedule(getBusiness(SLUG)!, MONDAY)).toEqual([
      { start: '08:00', end: '10:00' },
      { start: '15:00', end: '16:00' },
    ])
    const times = computeAvailableTimes(getBusiness(SLUG)!, MONDAY, 60)
    expect(times).toContain('08:00')
    expect(times).toContain('15:00')
    expect(times).not.toContain('10:00')
  })

  it('respects saved blocked days and closed special days', () => {
    saveSchedule(SLUG, {
      ...snapshotOf(),
      blockedDays: [MONDAY],
      specialDays: { [TUESDAY]: { kind: 'closed' } },
    })
    expect(periodsForDate(getBusiness(SLUG)!, MONDAY)).toEqual([])
    expect(periodsForDate(getBusiness(SLUG)!, TUESDAY)).toEqual([])
  })
})

describe('describeScheduleChange (REQ-163 history summaries)', () => {
  const base = {
    workingHours: [],
    bookingIntervalMinutes: 30,
    blockedDays: [],
    blockedPeriods: [],
    specialDays: {},
  } as ScheduleSnapshot

  it('summarizes the initial schedule', () => {
    expect(describeScheduleChange(null, base)).toBe('Initial schedule.')
  })

  it('lists changed facets only, in a stable order', () => {
    const next: ScheduleSnapshot = {
      ...base,
      bookingIntervalMinutes: 60,
      blockedDays: ['2030-03-04'],
    }
    expect(describeScheduleChange(base, next)).toBe(
      'Booking interval; Blocked days changed.',
    )
  })

  it('treats reordered blocked days as unchanged', () => {
    const a: ScheduleSnapshot = { ...base, blockedDays: ['2030-03-04', '2030-03-05'] }
    const b: ScheduleSnapshot = { ...base, blockedDays: ['2030-03-05', '2030-03-04'] }
    expect(describeScheduleChange(a, b)).toBe('Schedule details updated.')
  })

  it('detects weekly hours and special dates changes', () => {
    const next: ScheduleSnapshot = {
      ...base,
      workingHours: [[{ start: '09:00', end: '17:00' }]],
      specialDays: { '2030-03-04': { kind: 'closed' } },
    }
    expect(describeScheduleChange(base, next)).toBe(
      'Weekly hours; Special dates changed.',
    )
  })
})