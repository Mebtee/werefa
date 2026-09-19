import type {
  BookingDraft,
  BusinessDetails,
  BusinessPage,
  CustomerBookingStatus,
  DateString,
  Service,
  SubmitResult,
  TimeOfDay,
} from '@/types/models'
import {
  computeAvailableTimes,
  computeBookingDates,
  type BookingDate,
} from '@/mock/availability'
import { mockRaceSlot } from '@/mock/data'
import {
  createBookingEntry,
  getBookingsByPhone,
  getBusinessPage as readBusinessPage,
  getOccupiedBlocks,
  isCustomerTelegramConnected,
  setCustomerTelegramConnected,
} from '@/mock/store'
import {
  buildLineItems,
  prepaymentAmount,
  totalDurationMinutes,
  totalPrice,
} from '@/lib/format'

/**
 * The frontend's data-access seam.
 *
 * Everything a page/feature reads or writes goes through this interface so
 * the in-memory mock below can later be swapped for the real API client
 * (see architecture: 18-api-architecture, 26-validation) without touching UI
 * code. Customers are anonymous; the phone number in the draft is their only
 * identifier.
 */
export interface BookingApi {
  getBusinessPage(slug: string): Promise<BusinessPage | null>
  getBookingDates(
    business: BusinessDetails,
    durationMinutes: number,
  ): Promise<readonly BookingDate[]>
  getSlotTimes(
    business: BusinessDetails,
    date: DateString,
    durationMinutes: number,
  ): Promise<readonly TimeOfDay[]>
  createBooking(
    draft: BookingDraft,
    business: BusinessDetails,
    services: readonly Service[],
    durationMinutes: number,
  ): Promise<SubmitResult>
  /**
   * Customer booking status lookup (REQ-109). Scoped to the business and
   * keyed by a normalized phone number; returns customer-safe projections
   * that never include the internal Booking ID or status history.
   */
  lookupBookingsByPhone(
    businessSlug: string,
    phone: string,
  ): Promise<readonly CustomerBookingStatus[]>
  /**
   * Demo-only connect/disconnect of the customer Telegram side-channel for a
   * business + phone (canonical §18). Mock behavior — no real Telegram
   * authorization occurs. See store.isCustomerTelegramConnected.
   */
  setCustomerTelegramConnected(
    businessSlug: string,
    phone: string,
    connected: boolean,
  ): Promise<boolean>
}

function latency(): number {
  return import.meta.env.MODE === 'test' ? 0 : 280
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export const mockApi: BookingApi = {
  async getBusinessPage(slug) {
    await delay(latency())
    const page = readBusinessPage(slug)
    if (!page) return null
    // The public page only publishes active services (REQ-079). Deactivated
    // ones remain in the shared store so the owner portal can reactivate them.
    return {
      business: page.business,
      services: page.services.filter((service) => service.isActive),
    }
  },

  async getBookingDates(business, durationMinutes) {
    await delay(latency())
    return computeBookingDates(
      business,
      durationMinutes,
      (date) => getOccupiedBlocks(business.slug, date),
    )
  },

  async getSlotTimes(business, date, durationMinutes) {
    await delay(latency())
    return computeAvailableTimes(
      business,
      date,
      durationMinutes,
      getOccupiedBlocks(business.slug, date),
    )
  },

  async createBooking(draft, business, services, durationMinutes) {
    await delay(latency() + 350)

    if (draft.date === null || draft.time === null) {
      return { status: 'unavailable' }
    }

    // Mock-only race simulation: the slot was offered but taken meanwhile.
    const race = mockRaceSlot(business.slug)
    if (race && race.date === draft.date && race.time === draft.time) {
      return { status: 'unavailable' }
    }

    // Re-check against the current schedule and live bookings (T1 claim).
    const times = computeAvailableTimes(
      business,
      draft.date,
      durationMinutes,
      getOccupiedBlocks(business.slug, draft.date),
    )
    if (!times.includes(draft.time)) {
      return { status: 'unavailable' }
    }

    if (business.prepayment.mode === 'none') {
      // No prepayment: no payment proof exists to review, so no stored
      // Payment Pending booking is created in this slice (the business
      // confirms directly; dashboard booking management covers prepayment).
      return {
        status: 'created',
        disposition: 'pending-confirmation',
      }
    }

    if (draft.paymentMethod === null || draft.proof === null) {
      return { status: 'unavailable' }
    }

    // Line items are built from the real catalog services passed in (Prompt
    // 46) — the mock never resolves services from the store anymore.
    const lineItems = buildLineItems(services, draft.selections)
    const total = totalPrice(lineItems)
    const deposit = prepaymentAmount(business.prepayment, total) ?? 0

    const created = createBookingEntry({
      businessSlug: business.slug,
      lineItems: lineItems.map((item) => ({
        name: item.name,
        unitPrice: item.unitPrice,
        durationMinutes: item.durationMinutes,
      })),
      total,
      totalDurationMinutes: totalDurationMinutes(lineItems),
      deposit,
      customer: draft.customer,
      date: draft.date,
      time: draft.time,
      paymentMethod: draft.paymentMethod,
      proof: draft.proof,
    })

    if (!created.ok) {
      return { status: 'unavailable' }
    }

    return {
      status: 'created',
      disposition: 'payment-pending',
    }
  },

  async lookupBookingsByPhone(businessSlug, phone) {
    await delay(latency())
    const page = readBusinessPage(businessSlug)
    if (!page) return []
    const telegramConnected = isCustomerTelegramConnected(businessSlug, phone)
    return getBookingsByPhone(businessSlug, phone).map((booking) => ({
      business: { slug: page.business.slug, name: page.business.name },
      customerName: booking.customer.name,
      lineItems: booking.lineItems,
      date: booking.date,
      time: booking.time,
      bookingState: booking.state,
      paymentState: booking.paymentState,
      rejectionReason: booking.rejectionReason,
      createdAt: booking.createdAt,
      telegramConnected,
      telegramNotifications: booking.telegramNotices.map((notice) => ({
        type: notice.type,
        message: notice.message,
        date: notice.date,
        time: notice.time,
        rejectionReason: notice.rejectionReason,
        at: notice.createdAt,
      })),
    }))
  },

  async setCustomerTelegramConnected(businessSlug, phone, connected) {
    await delay(latency())
    const result = setCustomerTelegramConnected(businessSlug, phone, connected)
    return result.ok ? result.value : false
  },
}