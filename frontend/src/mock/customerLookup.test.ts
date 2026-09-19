import { beforeEach, describe, expect, it } from 'vitest'
import {
  resetStore,
  getBookingsByPhone,
  listBookings,
  createBookingEntry,
  acceptBooking,
  getServices,
} from '@/mock/store'
import { PRIMARY_BUSINESS_SLUG } from '@/mock/data'
import { normalizePhoneForMatch } from '@/lib/validation'

beforeEach(() => {
  resetStore()
})

function fakeBooking(overrides?: {
  phone?: string
  name?: string
  date?: string
  time?: string
  businessSlug?: string
}) {
  const businessSlug = overrides?.businessSlug ?? PRIMARY_BUSINESS_SLUG
  const services = getServices(businessSlug)
  const service = services.find((s) => s.id === 'haircut-styling') ?? services[0]
  return {
    businessSlug,
    lineItems: [{ name: service.name, unitPrice: service.basePriceMinor, durationMinutes: service.baseDurationMinutes }],
    total: service.basePriceMinor,
    totalDurationMinutes: service.baseDurationMinutes,
    deposit: 18000,
    customer: { name: overrides?.name ?? 'Abebe', phone: overrides?.phone ?? '+251911111111', note: '' },
    date: overrides?.date ?? '2030-03-04',
    time: overrides?.time ?? '09:00',
    paymentMethod: 'bank-transfer' as const,
    proof: { fileName: 'receipt.png', sizeBytes: 100, mimeType: 'image/png' },
  }
}

describe('getBookingsByPhone', () => {
  it('returns the seeded pending booking for its phone number', () => {
    const results = getBookingsByPhone(PRIMARY_BUSINESS_SLUG, '+251911223344')
    expect(results.some((b) => b.customer.name === 'Martha Bekele')).toBe(true)
  })

  it('is scoped to the business slug', () => {
    const results = getBookingsByPhone('marathon-auto-care', '+251911223344')
    expect(results).toHaveLength(0)
  })

  it('matches phone numbers despite formatting differences', () => {
    createBookingEntry(fakeBooking({ phone: '+251911111111', date: '2030-03-04', time: '09:00' }))
    const formatted = getBookingsByPhone(PRIMARY_BUSINESS_SLUG, '(+251) 911-111-111')
    const compact = getBookingsByPhone(PRIMARY_BUSINESS_SLUG, '251911111111')
    expect(formatted.some((b) => b.customer.name === 'Abebe')).toBe(true)
    expect(compact.some((b) => b.customer.name === 'Abebe')).toBe(true)
  })

  it('returns all matching bookings for one phone, newest first', () => {
    createBookingEntry(fakeBooking({ phone: '+251911111111', name: 'Aster', date: '2030-03-04', time: '09:00' }))
    createBookingEntry(fakeBooking({ phone: '+251911111111', name: 'Bontu', date: '2030-03-05', time: '10:00' }))
    const results = getBookingsByPhone(PRIMARY_BUSINESS_SLUG, '+251911111111')
    expect(results.map((b) => b.customer.name)).toEqual(['Bontu', 'Aster'])
  })

  it('returns an empty list for a phone with no booking', () => {
    expect(getBookingsByPhone(PRIMARY_BUSINESS_SLUG, '+251888888888')).toHaveLength(0)
  })

  it('does not cross business boundaries when the same phone books elsewhere', () => {
    createBookingEntry(fakeBooking({ phone: '+251911111111', businessSlug: 'marathon-auto-care' }))
    const addis = getBookingsByPhone(PRIMARY_BUSINESS_SLUG, '+251911111111')
    const marathon = getBookingsByPhone('marathon-auto-care', '+251911111111')
    expect(addis).toHaveLength(0)
    expect(marathon.length).toBeGreaterThanOrEqual(1)
  })

  it('reflects the latest state from the shared store after owner transitions', () => {
    const { booking } = createBookingEntry(fakeBooking({ phone: '+251911111111' })) as {
      ok: true
      booking: ReturnType<typeof listBookings>[number]
    }
    expect(getBookingsByPhone(PRIMARY_BUSINESS_SLUG, '+251911111111')[0].state).toBe('payment-pending')
    const accepted = acceptBooking(PRIMARY_BUSINESS_SLUG, booking.id)
    expect(accepted.ok).toBe(true)
    expect(getBookingsByPhone(PRIMARY_BUSINESS_SLUG, '+251911111111')[0].state).toBe('confirmed')
  })
})

describe('normalizePhoneForMatch', () => {
  it('strips non-digits from any formatting', () => {
    expect(normalizePhoneForMatch('+251 911 22 33 44')).toBe('251911223344')
    expect(normalizePhoneForMatch('(+251)911-22-33-44')).toBe('251911223344')
    expect(normalizePhoneForMatch('0911223344')).toBe('0911223344')
  })
})