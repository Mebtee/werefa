import { describe, expect, it } from 'vitest'
import {
  BOOKING_STATE_ORDER,
  DEFAULT_BOOKING_SORT,
  PAYMENT_STATE_ORDER,
  filterBookings,
  sortBookings,
} from '@/features/owner-portal/lib/bookingQuery'
import type { Booking } from '@/types/models'

function makeBooking(overrides: Partial<Booking>): Booking {
  return {
    id: 'bk-a',
    businessSlug: 'addis-beauty-lounge',
    state: 'payment-pending',
    paymentState: 'pending',
    lineItems: [
      { name: 'Haircut & blowout', unitPrice: 10000, durationMinutes: 60 },
    ],
    total: 10000,
    totalDurationMinutes: 60,
    deposit: 18000,
    date: '2030-03-04',
    time: '09:00',
    customer: { name: 'Abebe', phone: '+251900000001', note: '' },
    paymentMethod: 'bank-transfer',
    proof: { fileName: 'receipt.png', sizeBytes: 100, mimeType: 'image/png' },
    rejectionReason: null,
    createdAt: '2030-03-01T09:00',
    updatedAt: '2030-03-01T09:00',
    history: [
      { state: 'payment-pending', previous: null, actor: 'Customer', at: '2030-03-01T09:00' },
    ],
    telegramNotices: [],
    slotReleased: false,
    scheduleException: null,
    ...overrides,
  }
}

describe('ReQ-190 sort tie-breaking', () => {
  it('date-time sort falls back to createdAt (booking id proxy), then actor', () => {
    const a = makeBooking({
      id: 'bk-1',
      date: '2030-03-04',
      time: '09:00',
      createdAt: '2030-03-01T09:00',
      history: [
        { state: 'payment-pending', previous: null, actor: 'Customer', at: '2030-03-01T09:00' },
      ],
    })
    const b = makeBooking({
      id: 'bk-2',
      date: '2030-03-04',
      time: '09:00',
      createdAt: '2030-03-02T09:00',
      history: [
        { state: 'payment-pending', previous: null, actor: 'Customer', at: '2030-03-02T09:00' },
      ],
    })
    const asc = sortBookings([a, b], { field: 'date-time', direction: 'asc' })
    expect(asc.map((x) => x.id)).toEqual(['bk-1', 'bk-2'])
    // REQ-190: the primary column flips with direction, but tie-breakers always
    // run ascending so equal-date/time results stay reproducible.
    const desc = sortBookings([a, b], { field: 'date-time', direction: 'desc' })
    expect(desc.map((x) => x.id)).toEqual(['bk-1', 'bk-2'])
  })

  it('identical createdAt falls back to actor ascending in both directions', () => {
    const a = makeBooking({
      id: 'bk-a',
      date: '2030-03-04',
      time: '09:00',
      createdAt: '2030-03-01T09:00',
      history: [
        { state: 'payment-pending', previous: null, actor: 'Zelalem', at: '2030-03-01T09:00' },
      ],
    })
    const b = makeBooking({
      id: 'bk-b',
      date: '2030-03-04',
      time: '09:00',
      createdAt: '2030-03-01T09:00',
      history: [
        { state: 'payment-pending', previous: null, actor: 'Amanuel', at: '2030-03-01T09:00' },
      ],
    })
    const asc = sortBookings([a, b], { field: 'date-time', direction: 'asc' })
    expect(asc.map((x) => x.id)).toEqual(['bk-b', 'bk-a'])
    const desc = sortBookings([a, b], { field: 'date-time', direction: 'desc' })
    expect(desc.map((x) => x.id)).toEqual(['bk-b', 'bk-a'])
  })

  it('customer sort uses booking id then date/time for equal names', () => {
    const a = makeBooking({
      id: 'bk-1',
      date: '2030-03-04',
      time: '09:00',
      createdAt: '2030-03-02T09:00',
      customer: { name: 'Abebe', phone: '+251900000001', note: '' },
    })
    const b = makeBooking({
      id: 'bk-2',
      date: '2030-03-05',
      time: '09:00',
      createdAt: '2030-03-01T09:00',
      customer: { name: 'Abebe', phone: '+251900000002', note: '' },
    })
    const asc = sortBookings([b, a], { field: 'customer', direction: 'asc' })
    expect(asc.map((x) => x.id)).toEqual(['bk-2', 'bk-1'])
  })

  it('is fully deterministic across repeated calls', () => {
    const bookings = [
      makeBooking({ id: 'bk-1', date: '2030-03-04', time: '09:00' }),
      makeBooking({ id: 'bk-2', date: '2030-03-04', time: '09:00' }),
      makeBooking({ id: 'bk-3', date: '2030-03-04', time: '10:00' }),
    ]
    const first = sortBookings(bookings, { field: 'status', direction: 'asc' })
    for (let i = 0; i < 5; i += 1) {
      expect(sortBookings(bookings, { field: 'status', direction: 'asc' })).toEqual(first)
    }
  })

  it('sorts by canonical state order and by payment status order', () => {
    const bookings = [
      makeBooking({ id: 'bk-rejected', state: 'rejected', paymentState: 'rejected' }),
      makeBooking({ id: 'bk-pending', state: 'payment-pending', paymentState: 'pending' }),
      makeBooking({ id: 'bk-confirmed', state: 'confirmed', paymentState: 'accepted' }),
    ]
    const byStatus = sortBookings(bookings, { field: 'status', direction: 'asc' })
    expect(byStatus.map((x) => x.state)).toEqual([
      'payment-pending',
      'confirmed',
      'rejected',
    ])
    const byPayment = sortBookings(bookings, { field: 'payment-status', direction: 'asc' })
    expect(byPayment.map((x) => x.paymentState)).toEqual(['pending', 'accepted', 'rejected'])
  })
})

describe('actor, booking-id and direction coverage (REQ-188/190)', () => {
  it('sorts by the last audit actor A–Z ascending and Z–A descending', () => {
    const ownerActed = makeBooking({
      id: 'bk-owner',
      state: 'confirmed',
      history: [
        { state: 'payment-pending', previous: null, actor: 'Customer', at: '2030-03-01T09:00' },
        { state: 'confirmed', previous: 'payment-pending', actor: 'Demo Owner', at: '2030-03-02T09:00' },
      ],
    })
    const customerActed = makeBooking({
      id: 'bk-customer',
      state: 'payment-pending',
      history: [
        { state: 'payment-pending', previous: null, actor: 'Customer', at: '2030-03-01T09:00' },
      ],
    })
    const asc = sortBookings([ownerActed, customerActed], { field: 'actor', direction: 'asc' })
    expect(asc.map((x) => x.id)).toEqual(['bk-customer', 'bk-owner'])
    const desc = sortBookings([ownerActed, customerActed], { field: 'actor', direction: 'desc' })
    expect(desc.map((x) => x.id)).toEqual(['bk-owner', 'bk-customer'])
  })

  it('equal actors fall back to createdAt ascending in both directions', () => {
    const older = makeBooking({
      id: 'bk-old',
      createdAt: '2030-02-01T09:00',
      history: [
        { state: 'payment-pending', previous: null, actor: 'Customer', at: '2030-02-01T09:00' },
      ],
    })
    const newer = makeBooking({
      id: 'bk-new',
      createdAt: '2030-03-01T09:00',
      history: [
        { state: 'payment-pending', previous: null, actor: 'Customer', at: '2030-03-01T09:00' },
      ],
    })
    for (const direction of ['asc', 'desc'] as const) {
      expect(
        sortBookings([newer, older], { field: 'actor', direction }).map((x) => x.id),
      ).toEqual(['bk-old', 'bk-new'])
    }
  })

  it('booking-id sort is chronological and reverses with direction', () => {
    const older = makeBooking({ id: 'bk-old', createdAt: '2030-02-01T09:00' })
    const newer = makeBooking({ id: 'bk-new', createdAt: '2030-03-01T09:00' })
    const asc = sortBookings([newer, older], { field: 'booking-id', direction: 'asc' })
    expect(asc.map((x) => x.id)).toEqual(['bk-old', 'bk-new'])
    const desc = sortBookings([newer, older], { field: 'booking-id', direction: 'desc' })
    expect(desc.map((x) => x.id)).toEqual(['bk-new', 'bk-old'])
  })

  it('status and payment-status reverse the canonical order when descending', () => {
    const bookings = [
      makeBooking({ id: 'bk-rejected', state: 'rejected', paymentState: 'rejected' }),
      makeBooking({ id: 'bk-pending', state: 'payment-pending', paymentState: 'pending' }),
      makeBooking({ id: 'bk-confirmed', state: 'confirmed', paymentState: 'accepted' }),
    ]
    const statusDesc = sortBookings(bookings, { field: 'status', direction: 'desc' })
    expect(statusDesc.map((x) => x.state)).toEqual([
      'rejected',
      'confirmed',
      'payment-pending',
    ])
    const paymentDesc = sortBookings(bookings, { field: 'payment-status', direction: 'desc' })
    expect(paymentDesc.map((x) => x.paymentState)).toEqual(['rejected', 'accepted', 'pending'])
  })

  it('customer-name sorting is case-insensitive', () => {
    // A pure case-only pair: 'alemu' vs 'ALEMU' compare equal after lowercasing,
    // so REQ-190 tie-breaking (tie-breakers always ascend) plus the stable sort
    // preserves insertion order in BOTH directions. A case-sensitive comparison
    // would have forced the UPPERCASE name first regardless of input order
    // (ASCII uppercase < lowercase), which the canonical rule deliberately
    // removes.
    const lower = makeBooking({ id: 'bk-1', customer: { name: 'alemu', phone: '+251900000001', note: '' } })
    const upper = makeBooking({ id: 'bk-2', customer: { name: 'ALEMU', phone: '+251900000002', note: '' } })
    const asc = sortBookings([lower, upper], { field: 'customer', direction: 'asc' })
    expect(asc.map((x) => x.id)).toEqual(['bk-1', 'bk-2'])
    const desc = sortBookings([lower, upper], { field: 'customer', direction: 'desc' })
    expect(desc.map((x) => x.id)).toEqual(['bk-1', 'bk-2'])
  })
})

describe('filterBookings', () => {
  it('ORs statuses within the category but ANDs across categories', () => {
    const a = makeBooking({ id: 'bk-pending', state: 'payment-pending', date: '2030-03-04' })
    const b = makeBooking({ id: 'bk-confirmed', state: 'confirmed', date: '2030-03-05' })
    const c = makeBooking({ id: 'bk-rejected', state: 'rejected', date: '2030-03-06' })
    const byStatus = filterBookings([a, b, c], {
      statuses: new Set(['payment-pending', 'rejected']),
      dateFrom: '',
      dateTo: '',
      query: '',
    })
    expect(byStatus.map((x) => x.id)).toEqual(['bk-pending', 'bk-rejected'])

    const combined = filterBookings([a, b, c], {
      statuses: new Set(['payment-pending', 'rejected']),
      dateFrom: '2030-03-05',
      dateTo: '',
      query: '',
    })
    expect(combined.map((x) => x.id)).toEqual(['bk-rejected'])
  })

  it('applies the date range inclusively', () => {
    const a = makeBooking({ id: 'bk-1', date: '2030-03-04' })
    const b = makeBooking({ id: 'bk-2', date: '2030-03-05' })
    const c = makeBooking({ id: 'bk-3', date: '2030-03-06' })
    const result = filterBookings([a, b, c], {
      statuses: new Set(),
      dateFrom: '2030-03-05',
      dateTo: '2030-03-06',
      query: '',
    })
    expect(result.map((x) => x.id)).toEqual(['bk-2', 'bk-3'])
  })

  it('matches name and phone as case-insensitive substrings', () => {
    const a = makeBooking({ id: 'bk-1', customer: { name: 'Abebe', phone: '+251900000001', note: '' } })
    const b = makeBooking({ id: 'bk-2', customer: { name: 'Selam', phone: '+251911111111', note: '' } })
    expect(
      filterBookings([a, b], { statuses: new Set(), dateFrom: '', dateTo: '', query: 'ABE' }).map(
        (x) => x.id,
      ),
    ).toEqual(['bk-1'])
    expect(
      filterBookings([a, b], { statuses: new Set(), dateFrom: '', dateTo: '', query: '+251911' }).map(
        (x) => x.id,
      ),
    ).toEqual(['bk-2'])
  })

  it('returns everything when no filter is set', () => {
    const bookings = [
      makeBooking({ id: 'bk-1' }),
      makeBooking({ id: 'bk-2' }),
    ]
    const result = filterBookings(bookings, {
      statuses: new Set(),
      dateFrom: '',
      dateTo: '',
      query: '',
    })
    expect(result.length).toBe(2)
  })
})

describe('date range safety (Prompt 38)', () => {
  it('a reversed range (from > to) matches nothing — no crash, empty result', () => {
    const a = makeBooking({ id: 'bk-1', date: '2030-03-04' })
    const b = makeBooking({ id: 'bk-2', date: '2030-03-06' })
    const result = filterBookings([a, b], {
      statuses: new Set(),
      dateFrom: '2030-03-06',
      dateTo: '2030-03-04',
      query: '',
    })
    expect(result).toEqual([])
  })

  it('a from-only and a to-only range each filter independently and inclusively', () => {
    const a = makeBooking({ id: 'bk-1', date: '2030-03-04' })
    const b = makeBooking({ id: 'bk-2', date: '2030-03-05' })
    const c = makeBooking({ id: 'bk-3', date: '2030-03-06' })
    const fromOnly = filterBookings([a, b, c], {
      statuses: new Set(),
      dateFrom: '2030-03-05',
      dateTo: '',
      query: '',
    })
    expect(fromOnly.map((x) => x.id)).toEqual(['bk-2', 'bk-3'])
    const toOnly = filterBookings([a, b, c], {
      statuses: new Set(),
      dateFrom: '',
      dateTo: '2030-03-05',
      query: '',
    })
    expect(toOnly.map((x) => x.id)).toEqual(['bk-1', 'bk-2'])
  })
})

describe('sort determinism beyond tie-breakers (Prompt 38, REQ-190)', () => {
  it('is independent of object insertion order for every sort field and direction', () => {
    const set = [
      makeBooking({ id: 'bk-1', date: '2030-03-04', time: '09:00', createdAt: '2030-02-01T09:00' }),
      makeBooking({ id: 'bk-2', date: '2030-03-05', time: '10:00', createdAt: '2030-02-02T09:00' }),
      makeBooking({ id: 'bk-3', date: '2030-03-04', time: '11:00', createdAt: '2030-02-03T09:00' }),
    ]
    const shuffled = [set[2], set[0], set[1]]
    const fields = [
      'date-time',
      'booking-id',
      'customer',
      'status',
      'actor',
      'payment-status',
    ] as const
    for (const field of fields) {
      for (const direction of ['asc', 'desc'] as const) {
        const straight = sortBookings(set, { field, direction })
        const reordered = sortBookings(shuffled, { field, direction })
        expect(reordered.map((x) => x.id)).toEqual(straight.map((x) => x.id))
      }
    }
  })

  it('the chosen primary column controls ordering even when secondary values conflict', () => {
    const latePending = makeBooking({
      id: 'bk-late',
      state: 'payment-pending',
      date: '2030-03-09',
      createdAt: '2030-03-01T09:00',
    })
    const earlyConfirmed = makeBooking({
      id: 'bk-early',
      state: 'confirmed',
      date: '2030-03-04',
      createdAt: '2030-02-01T09:00',
    })
    // status asc must put the earlier-state booking first regardless of date/age.
    const byStatus = sortBookings([latePending, earlyConfirmed], {
      field: 'status',
      direction: 'asc',
    })
    expect(byStatus.map((x) => x.id)).toEqual(['bk-late', 'bk-early'])
    const byDate = sortBookings([latePending, earlyConfirmed], {
      field: 'date-time',
      direction: 'asc',
    })
    expect(byDate.map((x) => x.id)).toEqual(['bk-early', 'bk-late'])
  })

  it('date & time share one direction: equal dates sort by time within the chosen direction', () => {
    const morning = makeBooking({ id: 'bk-am', date: '2030-03-04', time: '09:00' })
    const noon = makeBooking({ id: 'bk-pm', date: '2030-03-04', time: '13:00' })
    const desc = sortBookings([morning, noon], { field: 'date-time', direction: 'desc' })
    expect(desc.map((x) => x.id)).toEqual(['bk-pm', 'bk-am'])
    const asc = sortBookings([noon, morning], { field: 'date-time', direction: 'asc' })
    expect(asc.map((x) => x.id)).toEqual(['bk-am', 'bk-pm'])
  })
})

describe('defaults and orders', () => {
  it('defaults to newest-first by date-time', () => {
    expect(DEFAULT_BOOKING_SORT).toEqual({ field: 'date-time', direction: 'desc' })
  })

  it('BOOKING_STATE_ORDER matches the canonical six states', () => {
    expect(BOOKING_STATE_ORDER).toEqual([
      'payment-pending',
      'confirmed',
      'completed',
      'no-show',
      'cancelled',
      'rejected',
    ])
  })

  it('PAYMENT_STATE_ORDER matches the canonical three payment states', () => {
    expect(PAYMENT_STATE_ORDER).toEqual(['pending', 'accepted', 'rejected'])
  })
})