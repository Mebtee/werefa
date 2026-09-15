import { beforeEach, describe, expect, it } from 'vitest'
import {
  acceptBooking,
  cancelBooking,
  createBookingEntry,
  emitMockReminder,
  getBookingsByPhone,
  getServices,
  markNoShowBooking,
  rejectBooking,
  resetStore,
  rescheduleBooking,
  setCustomerTelegramConnected,
} from '@/mock/store'
import { mockApi } from '@/mock/api'
import { PRIMARY_BUSINESS_SLUG } from '@/mock/data'

const SECOND_SLUG = 'marathon-auto-care'
const PHONE = '+251900000001'
const OTHER_PHONE = '+251900000002'

// Deterministic far-future slots shared with lifecycle.test.ts (the addis
// salon is closed Sundays; marathon is open Mon–Sat). No seed collision:
// demo bookings live near "today", never in 2030.
const DATE = '2030-04-04'
const TAKEN = '09:00'
const FREE = '10:00'
const LATER = '11:00'
const SVC_ID = 'haircut-styling'

function fakeBooking(overrides?: {
  businessSlug?: string
  phone?: string
  date?: string
  time?: string
}) {
  const services = getServices(overrides?.businessSlug ?? PRIMARY_BUSINESS_SLUG)
  const service = services.find((s) => s.id === SVC_ID) ?? services[0]
  return {
    businessSlug: overrides?.businessSlug ?? PRIMARY_BUSINESS_SLUG,
    lineItems: [
      {
        name: service.name,
        unitPrice: service.basePrice,
        durationMinutes: service.baseDurationMinutes,
      },
    ],
    total: service.basePrice,
    totalDurationMinutes: service.baseDurationMinutes,
    deposit: 18000,
    customer: { name: 'Abebe', phone: overrides?.phone ?? PHONE, note: '' },
    date: overrides?.date ?? DATE,
    time: overrides?.time ?? TAKEN,
    paymentMethod: 'bank-transfer' as const,
    proof: { fileName: 'receipt.png', sizeBytes: 128000, mimeType: 'image/png' },
  }
}

function createBooking(
  businessSlug = PRIMARY_BUSINESS_SLUG,
  phone = PHONE,
  slot?: { date?: string; time?: string },
) {
  return createBookingWith({ businessSlug, phone, ...slot })
}

function createBookingWith(overrides: {
  businessSlug?: string
  phone?: string
  date?: string
  time?: string
}) {
  const created = createBookingEntry(fakeBooking(overrides))
  expect(created.ok).toBe(true)
  if (!created.ok) throw new Error('create failed: ' + created.error)
  return created.booking
}

function confirmedBooking(
  businessSlug = PRIMARY_BUSINESS_SLUG,
  phone = PHONE,
  slot?: { date?: string; time?: string },
) {
  const booking = createBooking(businessSlug, phone, slot)
  const accepted = acceptBooking(businessSlug, booking.id)
  expect(accepted.ok).toBe(true)
  if (!accepted.ok) throw new Error('accept failed: ' + accepted.error)
  return accepted.value
}

beforeEach(() => {
  resetStore()
})

/**
 * Customer Telegram notification experience (Notification catalog N01–N08,
 * REQ-060..064, REQ-227..229). Every rule below is written against the
 * canonical gating: a customer Telegram event is generated ONLY when the
 * customer's phone is connected to Telegram for that business. Nothing is
 * generated (and no "failed delivery" event is invented) when unconnected.
 */
describe('customer Telegram notifications (mock events)', () => {
  it('1.Disconnected default: no Telegram event is generated for any lifecycle action', () => {
    const booking = createBooking()
    expect(getBookingsByPhone(PRIMARY_BUSINESS_SLUG, PHONE)[0].telegramNotices)
      .toHaveLength(0)

    acceptBooking(PRIMARY_BUSINESS_SLUG, booking.id)
    markNoShowBooking(PRIMARY_BUSINESS_SLUG, booking.id)
    expect(getBookingsByPhone(PRIMARY_BUSINESS_SLUG, PHONE)[0].telegramNotices)
      .toHaveLength(0)
  })

  it('1b.Business provision alone never gates customer events (addis is provisioned; customer not connected → no events)', () => {
    // addis-beauty-lounge has owner-side telegramConnected: true in data, but
    // the customer phone was never connected, so no customer event may exist.
    const booking = createBooking()
    expect(booking.telegramNotices).toHaveLength(0)
    const accepted = acceptBooking(PRIMARY_BUSINESS_SLUG, booking.id)
    expect(accepted.ok).toBe(true)
    expect(getBookingsByPhone(PRIMARY_BUSINESS_SLUG, PHONE)[0].telegramNotices)
      .toHaveLength(0)
  })

  it('2.N01 Proof received: Payment Pending booking records one payment-proof-received event with full event fields', () => {
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, PHONE, true)
    const booking = createBookingWith({ date: DATE, time: TAKEN })

    expect(booking.telegramNotices).toHaveLength(1)
    const notice = booking.telegramNotices[0]
    expect(notice).toMatchObject({
      id: 'ntf-1',
      bookingId: booking.id,
      businessSlug: PRIMARY_BUSINESS_SLUG,
      customerPhone: booking.customer.phone,
      type: 'payment-proof-received',
      channel: 'telegram',
      deliveryState: 'generated',
      message: 'Your payment proof has been received and is awaiting review.',
    })
    expect(notice.date).toBe(booking.date)
    expect(notice.time).toBe(booking.time)
    expect(notice.createdAt).toBe(booking.createdAt)
    expect(notice.rejectionReason).toBeNull()
  })

  it('3.N02 Booking confirmed: confirmation event recorded after accept, in time order', () => {
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, PHONE, true)
    const booking = confirmedBooking()

    expect(booking.telegramNotices.map((n) => n.type)).toEqual([
      'payment-proof-received',
      'booking-confirmed',
    ])
    expect(booking.telegramNotices[1].id).toBe('ntf-2')
    expect(
      booking.telegramNotices[1].createdAt >= booking.telegramNotices[0].createdAt,
    ).toBe(true)
  })

  it('4.N03 Payment rejected: rejection event carries the owner reason; no extra fields added', () => {
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, PHONE, true)
    const booking = createBooking()
    const rejected = rejectBooking(
      PRIMARY_BUSINESS_SLUG,
      booking.id,
      'The deposit receipt does not match the amount.',
    )
    expect(rejected.ok).toBe(true)

    const notice = booking.telegramNotices.at(-1)
    expect(notice?.type).toBe('payment-rejected')
    expect(notice?.message).toBe('Your payment proof was rejected.')
    expect(notice?.rejectionReason).toBe(
      'The deposit receipt does not match the amount.',
    )
    expect(booking.rejectionReason).toBe(
      'The deposit receipt does not match the amount.',
    )
  })

  it('5.N06 No Show: Confirmed → No Show records a no-show event for the connected customer', () => {
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, PHONE, true)
    const booking = confirmedBooking()
    const result = markNoShowBooking(PRIMARY_BUSINESS_SLUG, booking.id)
    expect(result.ok).toBe(true)

    expect(booking.telegramNotices.map((n) => n.type)).toEqual([
      'payment-proof-received',
      'booking-confirmed',
      'no-show',
    ])
  })

  it('6.N07 Cancelled: Confirmed → Cancelled records a cancelled event for the connected customer', () => {
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, PHONE, true)
    const booking = confirmedBooking()
    const result = cancelBooking(PRIMARY_BUSINESS_SLUG, booking.id)
    expect(result.ok).toBe(true)

    expect(booking.telegramNotices.map((n) => n.type)).toEqual([
      'payment-proof-received',
      'booking-confirmed',
      'cancelled',
    ])
  })

  it('7.N08 Rescheduled: records a reschedule event with the NEW date/time; booking stays Confirmed and payment stays attached', () => {
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, PHONE, true)
    const booking = confirmedBooking() // DATE @ TAKEN

    const before = booking.telegramNotices.length
    const result = rescheduleBooking(PRIMARY_BUSINESS_SLUG, booking.id, DATE, FREE)
    expect(result.ok).toBe(true)

    expect(booking.state).toBe('confirmed')
    expect(booking.paymentState).toBe('accepted')
    expect(booking.date).toBe(DATE)
    expect(booking.time).toBe(FREE)

    const notices = booking.telegramNotices.slice(before)
    expect(notices).toHaveLength(1)
    expect(notices[0].type).toBe('reschedule')
    expect(notices[0].message).toBe('Your booking has been rescheduled.')
    expect(notices[0].date).toBe(DATE)
    expect(notices[0].time).toBe(FREE)
  })

  it('7b.Rescheduling to the same slot records no event (no change = no notification)', () => {
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, PHONE, true)
    const booking = confirmedBooking()
    const before = booking.telegramNotices.length

    rescheduleBooking(PRIMARY_BUSINESS_SLUG, booking.id, DATE, TAKEN)
    expect(booking.telegramNotices.length).toBe(before)
    expect(booking.state).toBe('confirmed')
  })

  it('8.Deterministic event ids and per-booking chronological ordering', () => {
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, PHONE, true)
    const aValues = { date: DATE, time: TAKEN }
    const bValues = { date: DATE, time: FREE }
    const a = createBookingWith(aValues)
    const b = createBookingWith(bValues)
    acceptBooking(PRIMARY_BUSINESS_SLUG, a.id)
    markNoShowBooking(PRIMARY_BUSINESS_SLUG, a.id)

    // Global, deterministic sequence across all bookings: ntf-1 … ntf-4.
    const ids = [a.telegramNotices, b.telegramNotices]
      .flat()
      .map((n) => n.id)
      .sort((x, y) => Number(x.slice(4)) - Number(y.slice(4)))
    expect(ids).toEqual(['ntf-1', 'ntf-2', 'ntf-3', 'ntf-4'])

    // Within a booking, createdAt is non-decreasing (append order).
    const ats = a.telegramNotices.map((n) => n.createdAt)
    expect(ats).toEqual([...ats].sort())
  })

  it('9.Telegram is per business AND per phone: same phone may be connected for one business only', () => {
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, PHONE, true)
    // Same phone on another business stays unconnected → no events there.
    const other = createBooking(SECOND_SLUG, PHONE)
    expect(other.telegramNotices).toHaveLength(0)
    acceptBooking(SECOND_SLUG, other.id)
    expect(other.telegramNotices).toHaveLength(0)

    // A different phone on the connected business is also unconnected.
    const otherPhone = createBookingWith({
      businessSlug: PRIMARY_BUSINESS_SLUG,
      phone: OTHER_PHONE,
      date: DATE,
      time: FREE,
    })
    expect(otherPhone.telegramNotices).toHaveLength(0)

    // The same phone => connected => events.
    const connected = createBookingWith({
      businessSlug: PRIMARY_BUSINESS_SLUG,
      phone: PHONE,
      date: DATE,
      time: LATER,
    })
    expect(connected.telegramNotices).toHaveLength(1)
  })

  it('9b.Connecting a phone for one business does not affect another business anywhere', () => {
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, PHONE, true)

    // Same phone, connected only for addis → no events on marathon.
    const marathon = createBooking(SECOND_SLUG, PHONE)
    expect(marathon.telegramNotices).toHaveLength(0)

    // Events exist only on the business where the phone is connected.
    const addis = createBooking(PRIMARY_BUSINESS_SLUG, PHONE)
    expect(addis.telegramNotices).toHaveLength(1)
  })

  it('11.N04/N05 Reminder trigger: mock-only deterministic emitter, confirmed-only, connected-only', () => {
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, PHONE, true)
    const booking = confirmedBooking()

    const dayBefore = emitMockReminder(PRIMARY_BUSINESS_SLUG, booking.id, 'reminder-24h')
    expect(dayBefore.ok).toBe(true)
    expect(booking.telegramNotices.at(-1)?.type).toBe('reminder-24h')
    expect(booking.telegramNotices.at(-1)?.message).toBe(
      'Reminder: your appointment is tomorrow.',
    )

    const hourBefore = emitMockReminder(PRIMARY_BUSINESS_SLUG, booking.id, 'reminder-1h')
    expect(hourBefore.ok).toBe(true)
    expect(booking.telegramNotices.at(-1)?.type).toBe('reminder-1h')
    expect(booking.telegramNotices.at(-1)?.message).toBe(
      'Reminder: your appointment is in 1 hour.',
    )

    // Each reminder is a distinct once-per-booking event (2 reminders recorded).
    expect(
      booking.telegramNotices.filter((n) => n.type.startsWith('reminder-')),
    ).toHaveLength(2)
  })

  it('11b.Reminder emitter: rejects non-Confirmed bookings and emits nothing for unconnected customers', () => {
    const pending = createBooking() // addis, PHONE, TAKEN
    const result = emitMockReminder(PRIMARY_BUSINESS_SLUG, pending.id, 'reminder-24h')
    expect(result.ok).toBe(false) // only a Confirmed booking can be reminded

    const booking = confirmedBooking(PRIMARY_BUSINESS_SLUG, PHONE, {
      date: DATE,
      time: FREE,
    })
    const before = booking.telegramNotices.length
    const unconnected = emitMockReminder(
      PRIMARY_BUSINESS_SLUG,
      booking.id,
      'reminder-1h',
    )
    expect(unconnected.ok).toBe(true)
    expect(booking.telegramNotices.length).toBe(before) // no event for unconnected
  })

  it('10.API projection: telegramConnected + customer-safe notification view, no internal ids', async () => {
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, PHONE, true)
    const booking = createBookingWith({ date: DATE, time: TAKEN })
    // A rejected booking carries the proof + rejection events; confirmation is
    // only reachable from accept, and rejection only from Payment Pending, so
    // both event types can never coexist on one booking.
    rejectBooking(
      PRIMARY_BUSINESS_SLUG,
      booking.id,
      'Reason visible to customer.',
    )

    const results = await mockApi.lookupBookingsByPhone(
      PRIMARY_BUSINESS_SLUG,
      PHONE,
    )
    expect(results).toHaveLength(1)
    const status = results[0]
    expect(status.telegramConnected).toBe(true)

    // Full safety check on every projected notice.
    expect(status.telegramNotifications.map((n) => n.type)).toEqual([
      'payment-proof-received',
      'payment-rejected',
    ])
    for (const notice of status.telegramNotifications) {
      expect(notice).not.toHaveProperty('bookingId')
      expect(notice).not.toHaveProperty('businessSlug')
      expect(notice).not.toHaveProperty('customerPhone')
      expect(notice).not.toHaveProperty('id')
      expect(notice).not.toHaveProperty('deliveryState')
      expect(notice).not.toHaveProperty('channel')
    }
  })

  it('10b.Unconnected phone is projected as telegramConnected=false with empty notifications', async () => {
    createBooking()
    const lookup = await mockApi.lookupBookingsByPhone(
      PRIMARY_BUSINESS_SLUG,
      PHONE,
    )
    expect(lookup[0].telegramConnected).toBe(false)
    expect(lookup[0].telegramNotifications).toEqual([])
  })
})