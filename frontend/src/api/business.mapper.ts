import type { BusinessCategory, BusinessDetails, PauseState } from '@/types/models'
import type {
  BusinessCategoryCode,
  BusinessCoordinates,
  OwnerBusinessView,
  PublicBusinessView,
} from './types'

/**
 * Maps the real backend business projections into the UI `BusinessDetails`
 * model (Prompt 45).
 *
 * The UI model still carries mock-only fields (working hours, accent colour,
 * map provider, currency, prepayment/payment instructions, Telegram and
 * subscription state) that belong to later slices. This mapper overlays the
 * REAL authoritative profile fields on top of those mock-only values, so pages
 * keep working without a second copy of the data.
 */

export function categoryFromCode(code: BusinessCategoryCode): BusinessCategory {
  return code === 'SALON_AND_BARBER' ? 'salon-barber' : 'other'
}

export function categoryToCode(category: BusinessCategory): BusinessCategoryCode {
  return category === 'salon-barber' ? 'SALON_AND_BARBER' : 'OTHER'
}

export function coordinatesOf(coordinates: BusinessCoordinates): { lat: number | null; lng: number | null } {
  return { lat: coordinates.latitude ?? null, lng: coordinates.longitude ?? null }
}

export function pauseFromBusiness(
  isPaused: boolean,
  pauseMessage: string | null,
  reopenAt: string | null,
): PauseState {
  if (!isPaused) return null
  const message = pauseMessage?.trim() ? pauseMessage : undefined
  if (reopenAt) return { kind: 'until', reopenDate: reopenAt.slice(0, 10), message }
  return { kind: 'indefinite', message }
}

/** Mock-only defaults used when a real public business has no mock catalog. */
export const DEFAULT_PUBLIC_BUSINESS_FIELDS: BusinessDetails = {
  slug: '',
  name: '',
  category: 'other',
  tagline: '',
  description: '',
  accentColor: '#b4457f',
  address: '',
  lat: null,
  lng: null,
  mapProvider: 'google',
  phone: '',
  workingHours: [[], [], [], [], [], [], []] as BusinessDetails['workingHours'],
  bookingIntervalMinutes: 60,
  blockedDays: [],
  blockedPeriods: [],
  specialDays: {},
  pause: null,
  subscriptionStatus: 'active',
  prepayment: { mode: 'none' },
  paymentInstructions: { methods: [] },
  currency: 'ETB',
  bookingWindowDays: 14,
  telegramConnected: false,
  logo: null,
  coverPhoto: null,
}

/** Real owner profile fields over the mock-only fields of the UI model. */
export function hybridizeOwnedBusiness(view: OwnerBusinessView, mock: BusinessDetails): BusinessDetails {
  const { lat, lng } = coordinatesOf(view.coordinates)
  return {
    ...mock,
    slug: view.slug,
    name: view.name,
    category: categoryFromCode(view.category.code),
    description: view.description ?? '',
    address: view.address ?? '',
    lat,
    lng,
phone: view.phonePublic ?? '',
    pause: pauseFromBusiness(view.isPaused, view.pauseMessage, view.reopenAt),
    bookingIntervalMinutes: view.bookingIntervalMinutes,
  }
}

/**
 * Real public profile fields over the mock-only public page fields.
 * `mock` is the in-memory mock page for the same slug (services stay mock);
 * it is undefined for a real slug that has no mock catalog, in which case the
 * page renders with empty mock-only defaults.
 */
export function hybridizePublicBusiness(
  view: PublicBusinessView,
  mock: BusinessDetails | undefined,
): BusinessDetails {
  const { lat, lng } = coordinatesOf(view.coordinates)
  return {
    ...DEFAULT_PUBLIC_BUSINESS_FIELDS,
    ...(mock ?? {}),
    slug: view.slug,
    name: view.name,
    category: categoryFromCode(view.category.code),
    description: view.description ?? '',
    address: view.address ?? '',
    lat,
    lng,
    phone: view.phonePublic ?? '',
    pause: pauseFromBusiness(view.isPaused, view.pauseMessage, view.reopenAt),
  }
}