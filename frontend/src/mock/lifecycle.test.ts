import { beforeEach, describe, expect, it } from 'vitest'
import {
  acceptBooking,
  cancelBooking,
  cancelPaymentPendingBooking,
  completeDueBookings,
  createBookingEntry,
  getOccupiedBlocks,
  getServices,
  keepBooking,
  listBookings,
  markNoShowBooking,
  rejectBooking,
  releaseRejectedBooking,
  rescheduleBooking,
  resetStore,
  resubmitRejectedProof,
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
const SECONDARY_SLUG = 'marathon-auto-care'

function fakeBooking(overrides?: { date?: string; time?: string }) {
  const services = getServices(PRIMARY_BUSINESS_SLUG)
  const service = services.find((s) => s.id === SVC_ID) ?? services[0]
  return {
    businessSlug: PRIMARY_BUSINESS_SLUG,
    lineItems: [
      { name: service.name, unitPrice: service.basePriceMinor, durationMinutes: service.baseDurationMinutes },
    ],
    total: service.basePriceMinor,
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

describe('terminal-state guards and idempotency (REQ-102/103/104/123, T9/T10)', () => {
  it('refuses every lifecycle action on a No Show booking', () => {
    const booking = seedConfirmed()
    markNoShowBooking(PRIMARY_BUSINESS_SLUG, booking.id)

    expect(cancelBooking(PRIMARY_BUSINESS_SLUG, booking.id).ok).toBe(false)
    expect(markNoShowBooking(PRIMARY_BUSINESS_SLUG, booking.id).ok).toBe(false)
    expect(rescheduleBooking(PRIMARY_BUSINESS_SLUG, booking.id, DATE, '14:00').ok).toBe(false)
    expect(releaseRejectedBooking(PRIMARY_BUSINESS_SLUG, booking.id).ok).toBe(false)
    expect(
      resubmitRejectedProof(PRIMARY_BUSINESS_SLUG, booking.id, {
        fileName: 'n.png',
        sizeBytes: 1,
        mimeType: 'image/png',
      }).ok,
    ).toBe(false)
  })

  it('refuses to cancel or release an already-completed booking', () => {
    const booking = seedConfirmed()
    completeDueBookings(PRIMARY_BUSINESS_SLUG, '2030-04-04T10:00:00Z')
    expect(cancelBooking(PRIMARY_BUSINESS_SLUG, booking.id).ok).toBe(false)
    expect(releaseRejectedBooking(PRIMARY_BUSINESS_SLUG, booking.id).ok).toBe(false)
  })

  it('cancelPaymentPendingBooking keeps the slot blocked and issues no notice (SM-08)', () => {
    const created = createBookingEntry(fakeBooking())
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('create failed')
    const result = cancelPaymentPendingBooking(PRIMARY_BUSINESS_SLUG, created.booking.id)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.state).toBe('cancelled')
      expect(result.value.slotReleased).toBe(false)
      expect(result.value.telegramNotices).toHaveLength(0)
    }
    expect(
      getOccupiedBlocks(PRIMARY_BUSINESS_SLUG, DATE).some((b) => b.start === TAKEN),
    ).toBe(true)
  })

  it('releaseRejectedBooking: Rejected → Cancelled, payment stays Rejected, slot released (T9)', () => {
    const created = createBookingEntry(fakeBooking())
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('create failed')
    const booking = created.booking
    const rejected = rejectBooking(PRIMARY_BUSINESS_SLUG, booking.id, 'Not clear enough')
    expect(rejected.ok).toBe(true)

    const result = releaseRejectedBooking(PRIMARY_BUSINESS_SLUG, booking.id)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.state).toBe('cancelled')
      expect(result.value.paymentState).toBe('rejected')
      expect(result.value.slotReleased).toBe(true)
      expect(result.value.telegramNotices).toHaveLength(0)
    }
    expect(
      getOccupiedBlocks(PRIMARY_BUSINESS_SLUG, DATE).some((b) => b.start === TAKEN),
    ).toBe(false)
  })

  it('resubmitRejectedProof: Rejected → Payment Pending with the slot still blocked (T10, REQ-230)', () => {
    const created = createBookingEntry(fakeBooking())
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('create failed')
    const booking = created.booking
    const rejected = rejectBooking(PRIMARY_BUSINESS_SLUG, booking.id, 'Wrong amount')
    expect(rejected.ok).toBe(true)

    const result = resubmitRejectedProof(PRIMARY_BUSINESS_SLUG, booking.id, {
      fileName: 'fresh.png',
      sizeBytes: 2048,
      mimeType: 'image/png',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.state).toBe('payment-pending')
      expect(result.value.paymentState).toBe('pending')
      expect(result.value.rejectionReason).toBeNull()
      expect(result.value.proof.fileName).toBe('fresh.png')
      expect(result.value.history.at(-1)).toMatchObject({
        previous: 'rejected',
        state: 'payment-pending',
      })
    }
    // The rejected slot stays blocked for the resubmitted booking (REQ-123).
    expect(
      getOccupiedBlocks(PRIMARY_BUSINESS_SLUG, DATE).some((b) => b.start === TAKEN),
    ).toBe(true)
    // The fresh proof is accepted back to review as a normal pending booking.
    const accepted = acceptBooking(PRIMARY_BUSINESS_SLUG, booking.id)
    expect(accepted.ok).toBe(true)
  })
})

describe('idempotent double actions and tenant mutation guard rails (Prompt 38)', () => {
  it('accepting twice records exactly one confirmation transition and one Telegram notice', () => {
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, '+251911111111', true)
    const booking = seedConfirmed()
    const historyAfter = booking.history.length
    const noticesAfter = booking.telegramNotices.length
    const second = acceptBooking(PRIMARY_BUSINESS_SLUG, booking.id)
    expect(second.ok).toBe(false)
    expect(booking.state).toBe('confirmed')
    expect(booking.history).toHaveLength(historyAfter)
    expect(booking.telegramNotices).toHaveLength(noticesAfter)
    expect(
      booking.telegramNotices.filter((n) => n.type === 'booking-confirmed'),
    ).toHaveLength(1)
  })

  it('cancelling twice records only one cancellation transition and notice', () => {
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, '+251911111111', true)
    const booking = seedConfirmed()
    const first = cancelBooking(PRIMARY_BUSINESS_SLUG, booking.id)
    expect(first.ok).toBe(true)
    const len = booking.history.length
    const notices = booking.telegramNotices.length
    const second = cancelBooking(PRIMARY_BUSINESS_SLUG, booking.id)
    expect(second.ok).toBe(false)
    expect(booking.history).toHaveLength(len)
    expect(booking.telegramNotices).toHaveLength(notices)
    expect(
      booking.telegramNotices.filter((n) => n.type === 'cancelled'),
    ).toHaveLength(1)
  })

  it('marking No Show twice records only one transition and notice', () => {
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, '+251911111111', true)
    const booking = seedConfirmed()
    const first = markNoShowBooking(PRIMARY_BUSINESS_SLUG, booking.id)
    expect(first.ok).toBe(true)
    const len = booking.history.length
    const notices = booking.telegramNotices.length
    const second = markNoShowBooking(PRIMARY_BUSINESS_SLUG, booking.id)
    expect(second.ok).toBe(false)
    expect(booking.history).toHaveLength(len)
    expect(booking.telegramNotices).toHaveLength(notices)
    expect(
      booking.telegramNotices.filter((n) => n.type === 'no-show'),
    ).toHaveLength(1)
  })

  it('double-rescheduling to the same target slot is rejected; no duplicate notice', () => {
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, '+251911111111', true)
    const booking = seedConfirmed() // at TAKEN
    const moved = rescheduleBooking(PRIMARY_BUSINESS_SLUG, booking.id, DATE, '14:00')
    expect(moved.ok).toBe(true)
    const historyLen = booking.history.length
    const noticesLen = booking.telegramNotices.length
    const again = rescheduleBooking(PRIMARY_BUSINESS_SLUG, booking.id, DATE, '14:00')
    expect(again.ok).toBe(false)
    expect(booking.history).toHaveLength(historyLen)
    expect(booking.telegramNotices).toHaveLength(noticesLen)
    expect(
      booking.telegramNotices.filter((n) => n.type === 'reschedule'),
    ).toHaveLength(1)
  })

  it('rejecting twice records one rejected transition/notice and keeps the reason', () => {
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, '+251911111111', true)
    const created = createBookingEntry(fakeBooking())
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const first = rejectBooking(PRIMARY_BUSINESS_SLUG, created.booking.id, 'Blurry photo')
    expect(first.ok).toBe(true)
    const len = created.booking.history.length
    const notices = created.booking.telegramNotices.length
    const again = rejectBooking(PRIMARY_BUSINESS_SLUG, created.booking.id, 'Blurry photo')
    expect(again.ok).toBe(false)
    expect(created.booking.rejectionReason).toBe('Blurry photo')
    expect(created.booking.history).toHaveLength(len)
    expect(created.booking.telegramNotices).toHaveLength(notices)
    expect(
      created.booking.telegramNotices.filter((n) => n.type === 'payment-rejected'),
    ).toHaveLength(1)
  })

  it('releasing a rejected booking twice records one transition and releases the slot once', () => {
    const created = createBookingEntry(fakeBooking())
    expect(created.ok).toBe(true)
    if (!created.ok) return
    rejectBooking(PRIMARY_BUSINESS_SLUG, created.booking.id, 'Wrong amount')
    const first = releaseRejectedBooking(PRIMARY_BUSINESS_SLUG, created.booking.id)
    expect(first.ok).toBe(true)
    const len = created.booking.history.length
    const again = releaseRejectedBooking(PRIMARY_BUSINESS_SLUG, created.booking.id)
    expect(again.ok).toBe(false)
    expect(created.booking.state).toBe('cancelled')
    expect(created.booking.slotReleased).toBe(true)
    expect(created.booking.history).toHaveLength(len)
  })

  it('cancelling a Payment Pending booking twice is rejected with the slot still blocked', () => {
    const created = createBookingEntry(fakeBooking())
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const first = cancelPaymentPendingBooking(PRIMARY_BUSINESS_SLUG, created.booking.id)
    expect(first.ok).toBe(true)
    const len = created.booking.history.length
    const again = cancelPaymentPendingBooking(PRIMARY_BUSINESS_SLUG, created.booking.id)
    expect(again.ok).toBe(false)
    expect(created.booking.history).toHaveLength(len)
    expect(created.booking.slotReleased).toBe(false)
    expect(created.booking.telegramNotices).toHaveLength(0)
  })

  it('resubmitting proof twice is rejected; only the first proof is kept', () => {
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, '+251911111111', true)
    const created = createBookingEntry(fakeBooking())
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(rejectBooking(PRIMARY_BUSINESS_SLUG, created.booking.id, 'Rejected').ok).toBe(true)
    const first = resubmitRejectedProof(PRIMARY_BUSINESS_SLUG, created.booking.id, {
      fileName: 'a.png',
      sizeBytes: 10,
      mimeType: 'image/png',
    })
    expect(first.ok).toBe(true)
    const len = created.booking.history.length
    const notices = created.booking.telegramNotices.length
    const again = resubmitRejectedProof(PRIMARY_BUSINESS_SLUG, created.booking.id, {
      fileName: 'b.png',
      sizeBytes: 20,
      mimeType: 'image/png',
    })
    expect(again.ok).toBe(false)
    expect(created.booking.state).toBe('payment-pending')
    expect(created.booking.proof.fileName).toBe('a.png')
    expect(created.booking.history).toHaveLength(len)
    expect(created.booking.telegramNotices).toHaveLength(notices)
    // Two proof-received events are legitimate: creation and the first resubmit.
    expect(
      created.booking.telegramNotices.filter((n) => n.type === 'payment-proof-received'),
    ).toHaveLength(2)
  })

  it('another businesss booking cannot be mutated by this owner session', () => {
    const services = getServices(SECONDARY_SLUG)
    const service = services[0]
    const created = createBookingEntry({
      businessSlug: SECONDARY_SLUG,
      lineItems: [
        { name: service.name, unitPrice: service.basePriceMinor, durationMinutes: service.baseDurationMinutes },
      ],
      total: service.basePriceMinor,
      totalDurationMinutes: service.baseDurationMinutes,
      deposit: 0,
      customer: { name: 'Other Biz Customer', phone: '+251988776655', note: '' },
      date: DATE,
      time: TAKEN,
      paymentMethod: 'bank-transfer' as const,
      proof: { fileName: 'receipt.png', sizeBytes: 100, mimeType: 'image/png' },
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const id = created.booking.id
    const acceptResult = acceptBooking(PRIMARY_BUSINESS_SLUG, id)
    expect(acceptResult.ok).toBe(false)
    if (!acceptResult.ok) expect(acceptResult.error).toBe('Booking not found.')
    const rejectResult = rejectBooking(PRIMARY_BUSINESS_SLUG, id, 'nope')
    expect(rejectResult.ok).toBe(false)
    if (!rejectResult.ok) expect(rejectResult.error).toBe('Booking not found.')
    const cancelResult = cancelBooking(PRIMARY_BUSINESS_SLUG, id)
    expect(cancelResult.ok).toBe(false)
    const noShowResult = markNoShowBooking(PRIMARY_BUSINESS_SLUG, id)
    expect(noShowResult.ok).toBe(false)
    expect(created.booking.state).toBe('payment-pending')
    expect(created.booking.paymentState).toBe('pending')
    expect(listBookings(SECONDARY_SLUG).find((b) => b.id === id)!.state).toBe('payment-pending')
  })

  it('every other mutation is tenant-isolated with a generic error and no side effects', () => {
    setCustomerTelegramConnected(SECONDARY_SLUG, '+251988776655', true)
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, '+251911111111', true)
    // A Confirmed booking in the secondary business, connected to Telegram.
    const services = getServices(SECONDARY_SLUG)
    const service = services[0]
    const created = createBookingEntry({
      businessSlug: SECONDARY_SLUG,
      lineItems: [
        { name: service.name, unitPrice: service.basePriceMinor, durationMinutes: service.baseDurationMinutes },
      ],
      total: service.basePriceMinor,
      totalDurationMinutes: service.baseDurationMinutes,
      deposit: 0,
      customer: { name: 'Other Biz Customer', phone: '+251988776655', note: '' },
      date: DATE,
      time: FREE,
      paymentMethod: 'bank-transfer' as const,
      proof: { fileName: 'receipt.png', sizeBytes: 100, mimeType: 'image/png' },
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const secondary = created.booking
    expect(acceptBooking(SECONDARY_SLUG, secondary.id).ok).toBe(true)

    const rescheduleResult = rescheduleBooking(PRIMARY_BUSINESS_SLUG, secondary.id, DATE, '14:00')
    expect(rescheduleResult.ok).toBe(false)
    if (!rescheduleResult.ok) expect(rescheduleResult.error).toBe('Booking not found.')
    expect(cancelPaymentPendingBooking(PRIMARY_BUSINESS_SLUG, secondary.id).ok).toBe(false)
    expect(releaseRejectedBooking(PRIMARY_BUSINESS_SLUG, secondary.id).ok).toBe(false)
    const resubmitResult = resubmitRejectedProof(PRIMARY_BUSINESS_SLUG, secondary.id, {
      fileName: 'x.png',
      sizeBytes: 1,
      mimeType: 'image/png',
    })
    expect(resubmitResult.ok).toBe(false)
    expect(keepBooking(PRIMARY_BUSINESS_SLUG, secondary.id, 'keep').ok).toBe(false)
    // Auto-complete is scoped: a due-time secondary booking is not completed by
    // a primary-session completion sweep, and vice versa.
    expect(secondary.state).toBe('confirmed')
    const completed = completeDueBookings(PRIMARY_BUSINESS_SLUG, new Date('2030-04-04T10:00:00Z').toISOString())
    expect(completed.ok).toBe(true)
    expect(listBookings(SECONDARY_SLUG).find((b) => b.id === secondary.id)?.state).toBe('confirmed')
    // No cross-tenant Telegram notification was generated on the secondary booking.
    // It carries only its own proof-received (create) and confirmation notices.
    expect(secondary.telegramNotices).toHaveLength(2)
    expect(secondary.telegramNotices.filter((n) => n.type === 'booking-confirmed')).toHaveLength(1)
    expect(secondary.telegramNotices.filter((n) => n.type === 'payment-proof-received')).toHaveLength(1)
    expect(
      secondary.telegramNotices.some(
        (n) =>
          n.type === 'reschedule' ||
          n.type === 'cancelled' ||
          n.type === 'no-show' ||
          n.type === 'payment-rejected',
      ),
    ).toBe(false)
  })
})
