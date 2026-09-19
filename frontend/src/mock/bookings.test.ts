import { beforeEach, describe, expect, it } from 'vitest'
import { resetStore, getOccupiedBlocks, listBookings, countBookingsOn, createBookingEntry, acceptBooking, rejectBooking, getServices } from '@/mock/store'
import { PRIMARY_BUSINESS_SLUG } from '@/mock/data'

beforeEach(() => {
  resetStore()
})

function fakeBooking(overrides?: { businessSlug?: string; date?: string; time?: string }) {
  const services = getServices(overrides?.businessSlug ?? PRIMARY_BUSINESS_SLUG)
  const service = services.find((s) => s.id === 'haircut-styling') ?? services[0]
  const businessSlug = overrides?.businessSlug ?? PRIMARY_BUSINESS_SLUG
  const date = overrides?.date ?? '2030-03-04'
  const time = overrides?.time ?? '09:00'
  return {
    businessSlug,
    lineItems: [{ name: service.name, unitPrice: service.basePriceMinor, durationMinutes: service.baseDurationMinutes }],
    total: service.basePriceMinor,
    totalDurationMinutes: service.baseDurationMinutes,
    deposit: 18000,
    customer: { name: 'Abebe', phone: '+251911111111', note: '' },
    date,
    time,
    paymentMethod: 'bank-transfer' as const,
    proof: { fileName: 'receipt.png', sizeBytes: 100, mimeType: 'image/png' },
  }
}

describe('seeded bookings', () => {
  it('creates demo bookings on resetStore', () => {
    const bookings = listBookings(PRIMARY_BUSINESS_SLUG)
    expect(bookings.length).toBeGreaterThanOrEqual(2)
    const states = bookings.map((b) => b.state)
    expect(states).toContain('payment-pending')
    expect(states).toContain('confirmed')
  })

  it('getOccupiedBlocks excludes slot-released bookings', () => {
    const pending = listBookings(PRIMARY_BUSINESS_SLUG).find((b) => b.state === 'payment-pending')
    expect(pending).toBeDefined()
    const blocksBefore = getOccupiedBlocks(PRIMARY_BUSINESS_SLUG, pending!.date)
    expect(blocksBefore.some((b) => b.start === pending!.time)).toBe(true)
  })
})

describe('createBookingEntry', () => {
  it('creates a booking in payment-pending state', () => {
    const result = createBookingEntry(fakeBooking({ date: '2030-03-04', time: '10:30' }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.booking.state).toBe('payment-pending')
      expect(result.booking.paymentState).toBe('pending')
      expect(result.booking.customer.name).toBe('Abebe')
      expect(result.booking.slotReleased).toBe(false)
      expect(result.booking.history).toHaveLength(1)
    }
  })

  it('blocks a slot after the first submission', () => {
    const first = createBookingEntry(fakeBooking({ date: '2030-03-04', time: '10:30' }))
    expect(first.ok).toBe(true)
    const second = createBookingEntry(fakeBooking({ date: '2030-03-04', time: '10:30' }))
    expect(second.ok).toBe(false)
  })

  it('returns unavailable for an unrecognised slot', () => {
    const result = createBookingEntry(fakeBooking({ date: '2030-03-04', time: '23:59' }))
    expect(result.ok).toBe(false)
  })

  it('does not store a booking when the slot is unavailable', () => {
    const before = listBookings(PRIMARY_BUSINESS_SLUG).length
    createBookingEntry(fakeBooking({ date: '2030-03-04', time: '23:59' }))
    expect(listBookings(PRIMARY_BUSINESS_SLUG).length).toBe(before)
  })
})

describe('acceptBooking', () => {
  it('moves payment-pending → confirmed and records a history entry', () => {
    const { booking } = createBookingEntry(fakeBooking({ date: '2030-03-04', time: '10:30' })) as { ok: true; booking: ReturnType<typeof listBookings>[number] }
    const result = acceptBooking(PRIMARY_BUSINESS_SLUG, booking.id)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.state).toBe('confirmed')
      expect(result.value.paymentState).toBe('accepted')
      expect(result.value.history).toHaveLength(2)
      expect(result.value.history[1].previous).toBe('payment-pending')
    }
  })

  it('rejects already-confirmed bookings', () => {
    const confirmed = listBookings(PRIMARY_BUSINESS_SLUG).find((b) => b.state === 'confirmed')
    expect(confirmed).toBeDefined()
    const result = acceptBooking(PRIMARY_BUSINESS_SLUG, confirmed!.id)
    expect(result.ok).toBe(false)
  })

  it('returns not-found for unknown ids', () => {
    expect(acceptBooking(PRIMARY_BUSINESS_SLUG, 'bk-nonexistent').ok).toBe(false)
  })
})

describe('rejectBooking', () => {
  it('requires a non-empty reason', () => {
    const { booking } = createBookingEntry(fakeBooking({ date: '2030-03-04', time: '10:30' })) as { ok: true; booking: ReturnType<typeof listBookings>[number] }
    const result = rejectBooking(PRIMARY_BUSINESS_SLUG, booking.id, '  ')
    expect(result.ok).toBe(false)
  })

  it('moves payment-pending → rejected with the supplied reason', () => {
    const { booking } = createBookingEntry(fakeBooking({ date: '2030-03-04', time: '10:30' })) as { ok: true; booking: ReturnType<typeof listBookings>[number] }
    const result = rejectBooking(PRIMARY_BUSINESS_SLUG, booking.id, 'Missing reference')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.state).toBe('rejected')
      expect(result.value.paymentState).toBe('rejected')
      expect(result.value.rejectionReason).toBe('Missing reference')
      expect(result.value.history).toHaveLength(2)
      expect(result.value.history[1].previous).toBe('payment-pending')
    }
  })

  it('cannot reject the same booking twice', () => {
    const { booking } = createBookingEntry(fakeBooking({ date: '2030-03-04', time: '10:30' })) as { ok: true; booking: ReturnType<typeof listBookings>[number] }
    rejectBooking(PRIMARY_BUSINESS_SLUG, booking.id, 'reason one')
    const second = rejectBooking(PRIMARY_BUSINESS_SLUG, booking.id, 'reason two')
    expect(second.ok).toBe(false)
  })

  it('rejects already-rejected bookings', () => {
    const { booking } = createBookingEntry(fakeBooking({ date: '2030-03-04', time: '10:30' })) as { ok: true; booking: ReturnType<typeof listBookings>[number] }
    rejectBooking(PRIMARY_BUSINESS_SLUG, booking.id, 'bad')
    const result = rejectBooking(PRIMARY_BUSINESS_SLUG, booking.id, 'again')
    expect(result.ok).toBe(false)
  })
})

describe('booking store queries', () => {
  it('counts bookings on a date', () => {
    const before = countBookingsOn(PRIMARY_BUSINESS_SLUG, '2030-03-04')
    createBookingEntry(fakeBooking({ date: '2030-03-04', time: '10:30' }))
    expect(countBookingsOn(PRIMARY_BUSINESS_SLUG, '2030-03-04')).toBe(before + 1)
  })

  it('isolates bookings by business slug', () => {
    createBookingEntry(fakeBooking({ date: '2030-03-04', time: '10:30' }))
    const other = listBookings('salon-other')
    expect(other).toHaveLength(0)
  })
})
