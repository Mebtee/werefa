import {
  acceptBooking,
  cancelBooking,
  cancelPaymentPendingBooking,
  changeBusinessSlug,
  countBookingsOn,
  createService,
  getBooking as readBooking,
  getBusiness,
  getOccupiedBlocks,
  getOpenConflicts,
  getOpenConflictsForBooking,
  getServices,
  isCustomerTelegramConnected,
  keepBooking,
  listBookings,
  listScheduleHistory,
  markNoShowBooking,
  rejectBooking,
  releaseRejectedBooking,
  rescheduleBooking,
  resubmitRejectedProof,
  saveBookingInterval,
  saveSpecialDays,
  saveSchedule,
  saveWorkingHours,
  setPause,
  setServiceActive,
  updateBusiness,
  updateService,
  type SaveScheduleOptions,
  type StoreResult,
} from '@/mock/store'
import { computeAvailableTimes } from '@/mock/availability'
import {
  getMockOwnedBusinessSlug,
  setMockOwnedBusinessSlug,
} from '@/mock/ownedBusinessFixture'
import { toDateString } from '@/lib/time'
import type {
  Booking,
  BusinessCategory,
  BusinessDetails,
  DateString,
  ImageAsset,
  MapProvider,
  PauseState,
  ProofFile,
  ScheduleConflict,
  ScheduleSnapshot,
  ScheduleVersion,
  Service,
  ServiceAddOn,
  ServiceVariation,
  SpecialDay,
  TimeOfDay,
  WeeklyWorkingHours,
} from '@/types/models'

/**
 * Owner portal data seam.
 *
 * Every owner action goes through this interface so the in-memory mock can be
 * replaced by the real API client later without touching UI code. All calls
 * operate on the business owned by the current mock session, and all writes
 * land in the same store the public booking page reads.
 */

export type OwnerResult<T = undefined> = StoreResult<T>

export interface BusinessProfilePatch {
  name?: string
  tagline?: string
  category?: BusinessCategory
  description?: string
  accentColor?: string
  address?: string
  lat?: number
  lng?: number
  mapProvider?: MapProvider
  phone?: string
  bookingWindowDays?: number
}

export interface BrandingPatch {
  logo?: ImageAsset | null
  coverPhoto?: ImageAsset | null
}

export interface ServiceDraft {
  id?: string
  name: string
  description?: string
  basePrice: number
  baseDurationMinutes: number
  variations?: readonly ServiceVariation[]
  addOns?: readonly ServiceAddOn[]
}

export type ServicePatch = Partial<ServiceDraft>

export type SlugChangeResult =
  | { ok: true; slug: string }
  | { ok: false; error: string }

export interface OwnerApi {
  getOwnedBusiness(): Promise<BusinessDetails>
  getServices(): Promise<readonly Service[]>
  getTodayPreview(): Promise<{ bookingsToday: number }>
  saveProfile(patch: BusinessProfilePatch): Promise<OwnerResult<BusinessDetails>>
  saveBranding(patch: BrandingPatch): Promise<OwnerResult<BusinessDetails>>
  changePublicSlug(next: string): Promise<SlugChangeResult>
  createService(input: ServiceDraft): Promise<OwnerResult<Service>>
  updateService(id: string, patch: ServicePatch): Promise<OwnerResult<Service>>
  setServiceActive(id: string, active: boolean): Promise<OwnerResult<Service>>
  saveWorkingHours(
    workingHours: WeeklyWorkingHours,
  ): Promise<OwnerResult<BusinessDetails>>
  saveBookingInterval(
    bookingIntervalMinutes: number,
  ): Promise<OwnerResult<BusinessDetails>>
  saveSpecialDays(
    specialDays: Readonly<Record<DateString, SpecialDay>>,
  ): Promise<OwnerResult<BusinessDetails>>
  setPause(pause: PauseState): Promise<OwnerResult<BusinessDetails>>
  /**
   * Saves the whole schedule in one step: records a retained version
   * (REQ-162/163), applies it to the public page, and returns any affected
   * bookings as open conflicts (REQ-092/099). While paused the save is stored
   * as a pending version and activates on resume (REQ-150/151).
   */
  saveSchedule(
    snapshot: ScheduleSnapshot,
    opts?: SaveScheduleOptions,
  ): Promise<OwnerResult<{ business: BusinessDetails; version: ScheduleVersion; conflicts: readonly ScheduleConflict[] }>>
  /** Retained schedule versions for the business, newest first (REQ-166). */
  listScheduleHistory(): Promise<readonly ScheduleVersion[]>
  /** Open affected-booking conflicts still waiting for a decision (REQ-092). */
  getOpenConflicts(): Promise<readonly ScheduleConflict[]>
  /** Keep Booking — records a booking-specific schedule exception (REQ-159/160). */
  keepBooking(id: string, reason: string): Promise<OwnerResult<Booking>>
  /** Bookings of the current session's business, newest first. */
  listBookings(): Promise<readonly Booking[]>
  getBooking(id: string): Promise<Booking>
  acceptBooking(id: string): Promise<OwnerResult<Booking>>
  rejectBooking(id: string, reason: string): Promise<OwnerResult<Booking>>
  /** Confirmed → No Show (REQ-103). Slot is released; Telegram notifies if connected. */
  markNoShowBooking(id: string): Promise<OwnerResult<Booking>>
  /** Confirmed → Cancelled (REQ-104). Slot released; Telegram notifies if connected. */
  cancelBooking(id: string): Promise<OwnerResult<Booking>>
  /** Payment Pending → Cancelled (REQ-104, SM-08). Slot stays blocked; no customer notice. */
  cancelPaymentPendingBooking(id: string): Promise<OwnerResult<Booking>>
  /** Rejected → Cancelled (T9, REQ-123/230). Slot released; no customer notice. */
  releaseRejectedBooking(id: string): Promise<OwnerResult<Booking>>
  /** Confirmed → Rescheduled to a still-free slot (REQ-105..107; REQ-106 hard gate). */
  rescheduleBooking(
    id: string,
    date: DateString,
    time: TimeOfDay,
  ): Promise<OwnerResult<Booking>>
  /**
   * Availability read for the reschedule picker (REQ-106 — only free+fitting
   * slots are offered). Extra conflict blocks are rejected, never warned.
   */
  listAvailableTimesFor(
    date: DateString,
    durationMinutes: number,
  ): Promise<OwnerResult<readonly TimeOfDay[]>>
  /** Open conflicts for one booking (REQ-093) — detail-page warning state. */
  getOpenConflictsForBooking(id: string): Promise<readonly ScheduleConflict[]>
  /** Customer Telegram connection state for this business + phone (canonical §18). */
  isCustomerTelegramConnected(phone: string): Promise<boolean>
  /**
   * Minimal T10 seam for rejected-recovery completeness (REQ-230): returns the
   * booking to Payment Pending with a fresh proof, slot stays blocked. Not wired
   * to any customer UI in this slice — owner workspace tests exercise it.
   */
  resubmitRejectedProof(
    id: string,
    proof: ProofFile,
  ): Promise<OwnerResult<Booking>>
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function latency(): number {
  return import.meta.env.MODE === 'test' ? 0 : 280
}

function ownedSlug(): string {
  return getMockOwnedBusinessSlug()
}

export const mockOwnerApi: OwnerApi = {
  async getOwnedBusiness() {
    await delay(latency())
    const result = getBusiness(ownedSlug())
    if (!result) throw new Error('Owned business not found.')
    return result
  },

  async getServices() {
    await delay(latency())
    return getServices(ownedSlug())
  },

  async getTodayPreview() {
    await delay(latency())
    const today = toDateString(new Date())
    return { bookingsToday: countBookingsOn(ownedSlug(), today) }
  },

  async saveProfile(patch) {
    await delay(latency())
    return updateBusiness(ownedSlug(), patch)
  },

  async saveBranding(patch) {
    await delay(latency())
    return updateBusiness(ownedSlug(), patch)
  },

  async changePublicSlug(next) {
    await delay(latency())
    const result = changeBusinessSlug(ownedSlug(), next)
    if (result.ok) setMockOwnedBusinessSlug(result.value)
    return result.ok
      ? { ok: true, slug: result.value }
      : { ok: false, error: result.error }
  },

  async createService(input) {
    await delay(latency())
    return createService(ownedSlug(), input)
  },

  async updateService(id, patch) {
    await delay(latency())
    return updateService(ownedSlug(), id, patch)
  },

  async setServiceActive(id, active) {
    await delay(latency())
    return setServiceActive(ownedSlug(), id, active)
  },

  async saveWorkingHours(workingHours) {
    await delay(latency())
    return saveWorkingHours(ownedSlug(), workingHours)
  },

  async saveBookingInterval(bookingIntervalMinutes) {
    await delay(latency())
    return saveBookingInterval(ownedSlug(), bookingIntervalMinutes)
  },

  async saveSpecialDays(specialDays) {
    await delay(latency())
    return saveSpecialDays(ownedSlug(), specialDays)
  },

  async setPause(pause) {
    await delay(latency())
    return setPause(ownedSlug(), pause)
  },

  async saveSchedule(snapshot, opts) {
    await delay(latency())
    return saveSchedule(ownedSlug(), snapshot, opts)
  },

  async listScheduleHistory() {
    await delay(latency())
    return listScheduleHistory(ownedSlug())
  },

  async getOpenConflicts() {
    await delay(latency())
    return getOpenConflicts(ownedSlug())
  },

  async keepBooking(id, reason) {
    await delay(latency())
    return keepBooking(ownedSlug(), id, reason)
  },

  async listBookings() {
    await delay(latency())
    return listBookings(ownedSlug())
  },

  async getBooking(id) {
    await delay(latency())
    const booking = readBooking(ownedSlug(), id)
    if (!booking) throw new Error('Booking not found.')
    return booking
  },

  async acceptBooking(id) {
    await delay(latency())
    return acceptBooking(ownedSlug(), id)
  },

  async rejectBooking(id, reason) {
    await delay(latency())
    return rejectBooking(ownedSlug(), id, reason)
  },

  async markNoShowBooking(id) {
    await delay(latency())
    return markNoShowBooking(ownedSlug(), id)
  },

  async cancelBooking(id) {
    await delay(latency())
    return cancelBooking(ownedSlug(), id)
  },

  async cancelPaymentPendingBooking(id) {
    await delay(latency())
    return cancelPaymentPendingBooking(ownedSlug(), id)
  },

  async releaseRejectedBooking(id) {
    await delay(latency())
    return releaseRejectedBooking(ownedSlug(), id)
  },

  async rescheduleBooking(id, date, time) {
    await delay(latency())
    return rescheduleBooking(ownedSlug(), id, date, time)
  },

  async listAvailableTimesFor(date, durationMinutes) {
    await delay(latency())
    const business = getBusiness(ownedSlug())
    if (!business) return { ok: false, error: 'Business not found.' }
    const occupied = getOccupiedBlocks(ownedSlug(), date)
    return { ok: true, value: computeAvailableTimes(business, date, durationMinutes, occupied) }
  },

  async getOpenConflictsForBooking(id) {
    await delay(latency())
    return getOpenConflictsForBooking(ownedSlug(), id)
  },

  async isCustomerTelegramConnected(phone) {
    await delay(latency())
    return isCustomerTelegramConnected(ownedSlug(), phone)
  },

  async resubmitRejectedProof(id, proof) {
    await delay(latency())
    return resubmitRejectedProof(ownedSlug(), id, proof)
  },
}
