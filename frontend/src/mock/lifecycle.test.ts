import { beforeEach, describe, expect, it } from 'vitest'
import {
  acceptBooking,
  cancelBooking,
  completeDueBookings,
  createBookingEntry,
  getServices,
  listBookings,
  markNoShowBooking,
  resetStore,
  rescheduleBooking,
  setCustomerTelegramConnected,
} from '@/mock/store'
import { PRIMARY_BUSINESS_SLUG } from '@/mock/data'

type Booking = ReturnType<typeof listBookings>[number]

beforeEach(() => {
  resetStore()
})

/**
 * Byte-for-byte mirror of the passing seam in bookings.test.ts: single-object
 * `CreateBookingInput`, deterministic far-future dates so no wall-clock/seed
 * slot conflicts can flip the outcome (REQ dictates fixed demo data).
 */
const DATE = '2030-04-04'
const TAKEN = '09:00' // occupied by seedConfirmed; fakeBooking's default slot (die VM never reads it otherwise)
const FREE = '11:00'
const SVC_ID = 'haircut-styling'

function fakeBooking(overrides?: { date?: string; time?: string }) {
  const services = getServices(PRIMARY_BUSINESS_SLUG)
  const service = services.find((s) => s.id === SVC_ID) ?? services[0]
  return {
    businessSlug: PRIMARY_BUSINESS_SLUG,
    lineItems: [
      { name: service.name, unitPrice: service.basePrice, durationMinutes: service.baseDurationMinutes },
    ],
    total: service.basePrice,
    totalDurationMinutes: service.baseDurationMinutes,
    deposit: 18000,
    customer: { name: 'Abebe', phone: '+251911111111', note: '' },
    date: overrides?.date ?? DATE,
    time: overrides?.time ?? TAKEN,
    paymentMethod: 'bank-transfer' as const,
    proof: { fileName: 'receipt.png', sizeBytes: 128000, mimeType: 'image/png' },
  }
}

function seedConfirmed(): Booking {
  const created = createBookingEntry(fakeBooking())
  expect(created.ok).toBe(true)
  if (!created.ok) throw new Error('create failed: ' + created.error)
  const accepted = acceptBooking(PRIMARY_BUSINESS_SLUG, created.booking.id)
  expect(accepted.ok).toBe(true)
  if (!accepted.ok) throw new Error('accept failed: ' + accepted.error)
  return accepted.value
}

describe('owner booking lifecycle: No Show / Cancel / Reschedule / Auto-complete (REQ-103..107, 227..229)', () => {
  it('markNoShowBooking: Confirmed → No Show, slot released, customer Telegram notice (N06 = REQ-227)', () => {
    const booking = seedConfirmed()
    // Unconnected customer: no Telegram event is generated (canonical gating).
    expect(booking.telegramNotices.length).toBe(0)

    setCustomerTelegramConnected(
      PRIMARY_BUSINESS_SLUG,
      booking.customer.phone,
      true,
    )
    const result = markNoShowBooking(PRIMARY_BUSINESS_SLUG, booking.id)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.state).toBe('no-show')
      expect(result.value.slotReleased).toBe(true)
      expect(result.value.telegramNotices).toHaveLength(1)
    }
  })

  it('cancelBooking: Confirmed → Cancelled, slot released (REQ-104), customer Telegram notice (N07 = REQ-228)', () => {
    const booking = seedConfirmed()
    setCustomerTelegramConnected(
      PRIMARY_BUSINESS_SLUG,
      booking.customer.phone,
      true,
    )
    const result = cancelBooking(PRIMARY_BUSINESS_SLUG, booking.id)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.state).toBe('cancelled')
      expect(result.value.slotReleased).toBe(true)
      expect(result.value.telegramNotices.at(-1)?.type).toBe('cancelled')
    }
  })

  it('rescheduleBooking: rejects an occupied slot, accepts a free one (REQ-105/106)', () => {
    const booking = seedConfirmed() // takes TAKEN
    const occupantResult = createBookingEntry(fakeBooking({ date: DATE, time: FREE }))
    expect(occupantResult.ok).toBe(true)
    if (!occupantResult.ok) throw new Error('seed failed')
    const occupant = occupantResult.booking

    const blocked = rescheduleBooking(PRIMARY_BUSINESS_SLUG, booking.id, DATE, FREE)
    expect(blocked.ok).toBe(false)
    // The failed reschedule must not have disturbed the occupant's own booking.
    expect(listBookings(PRIMARY_BUSINESS_SLUG).find((b) => b.id === occupant.id)?.state).toBe('payment-pending')

    const free = rescheduleBooking(PRIMARY_BUSINESS_SLUG, booking.id, DATE, '14:00')
    expect(free.ok).toBe(true)
    if (free.ok) {
      expect(free.value.state).toBe('confirmed')
      expect(free.value.time).toBe('14:00')
    }
    expect(listBookings(PRIMARY_BUSINESS_SLUG).find((b) => b.id === booking.id)?.state).toBe('confirmed')
  })

  it('completeDueBookings: auto-completes a Confirmed booking whose slot end has passed (REQ-102), deterministic via `at`', () => {
    const booking = seedConfirmed() // 09:00 + 30min → ends 09:30
    const t0 = listBookings(PRIMARY_BUSINESS_SLUG).length

    const result = completeDueBookings(PRIMARY_BUSINESS_SLUG, new Date('2030-04-04T10:00:00Z').toISOString())
    expect(result.ok).toBe(true)
    if (result.ok) {
      const completed = result.value.find((b) => b.id === booking.id)
      expect(completed).toBeDefined()
      expect(completed?.state).toBe('completed')
    }
    const dueAfter = listBookings(PRIMARY_BUSINESS_SLUG).length
    expect(dueAfter).toBe(t0)
  })
})
