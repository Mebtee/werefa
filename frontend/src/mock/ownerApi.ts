import {
  changeBusinessSlug,
  createService,
  getBusiness,
  getServices,
  saveBookingInterval,
  saveSpecialDays,
  saveWorkingHours,
  setPause,
  setServiceActive,
  updateBusiness,
  updateService,
  type StoreResult,
} from '@/mock/store'
import { ownerSession } from '@/mock/ownerSession'
import { mockTakenBlocks } from '@/mock/data'
import { toDateString } from '@/lib/time'
import type {
  BusinessCategory,
  BusinessDetails,
  DateString,
  MapProvider,
  PauseState,
  Service,
  ServiceAddOn,
  ServiceVariation,
  SpecialDay,
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
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function latency(): number {
  return import.meta.env.MODE === 'test' ? 0 : 280
}

function ownedSlug(): string {
  return ownerSession.businessSlug
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
    return { bookingsToday: mockTakenBlocks(ownedSlug(), today).length }
  },

  async saveProfile(patch) {
    await delay(latency())
    return updateBusiness(ownedSlug(), patch)
  },

  async changePublicSlug(next) {
    await delay(latency())
    const result = changeBusinessSlug(ownedSlug(), next)
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
}

export { ownerSession }