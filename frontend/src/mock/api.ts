import type {
  BookingDraft,
  BusinessDetails,
  BusinessPage,
  DateString,
  SubmitResult,
  TimeOfDay,
} from '@/types/models'
import {
  computeAvailableTimes,
  computeBookingDates,
  type BookingDate,
} from '@/mock/availability'
import { mockRaceSlot } from '@/mock/data'
import { getBusinessPage as readBusinessPage } from '@/mock/store'

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
    durationMinutes: number,
  ): Promise<SubmitResult>
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
    return computeBookingDates(business, durationMinutes)
  },

  async getSlotTimes(business, date, durationMinutes) {
    await delay(latency())
    return computeAvailableTimes(business, date, durationMinutes)
  },

  async createBooking(draft, business, durationMinutes) {
    await delay(latency() + 350)

    if (draft.date === null || draft.time === null) {
      return { status: 'unavailable' }
    }

    // Mock-only race simulation: the slot was offered but taken meanwhile.
    const race = mockRaceSlot(business.slug)
    if (race && race.date === draft.date && race.time === draft.time) {
      return { status: 'unavailable' }
    }

    // Re-check against the current schedule (the backend will authoritatively).
    const times = computeAvailableTimes(business, draft.date, durationMinutes)
    if (!times.includes(draft.time)) {
      return { status: 'unavailable' }
    }

    const prepaid = business.prepayment.mode !== 'none'
    return {
      status: 'created',
      disposition: prepaid ? 'payment-pending' : 'pending-confirmation',
    }
  },
}