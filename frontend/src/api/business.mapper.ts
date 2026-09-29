import type {
  BusinessCategory,
  BusinessDetails,
  PauseState,
  PrepaymentConfig,
} from '@/types/models'
import type {
  BusinessCategoryCode,
  BusinessCoordinates,
  OwnerBusinessView,
  PublicBusinessView,
  UpdateBusinessSettingsInput,
} from './types'

/**
 * Maps the real backend business projections into the UI `BusinessDetails`
 * model (Prompt 45).
 *
 * The UI model carries presentational fields the backend projection does not
 * (working hours, accent colour, map provider, display currency, booking-window
 * sizing, Telegram flag) that have no backend counterpart yet. Those come from
 * the constants below as rendering defaults — they are NEVER a source of
 * business data. Every field the backend does project (slug, name, category,
 * description, address, coordinates, phone, pause, branding, interval) is taken
 * from the real view and nothing else is overlaid on top.
 *
 * There is deliberately no mock/demonstration overlay parameter: a real
 * projection is the only input. Subscription state is real (Prompt 52) and never
 * rides on BusinessDetails — it comes from `src/api/subscription.ts`.
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

/**
 * Real per-business prepayment configuration (REQ-110/111) → the UI model.
 *
 * The backend owns the decision: the owner configures a percentage OR a fixed
 * minor-unit amount (or none at all), and the same three columns are what
 * `computePrepaidAmount` uses to derive every disclosed deposit. Nothing is
 * defaulted to a platform percentage here — a value the projection does not
 * carry for the active mode simply has no value.
 */
export function prepaymentFromView(view: {
  prepaymentMode: 'NONE' | 'PERCENTAGE' | 'FIXED'
  prepaymentPercent: number | null
  prepaymentFixedMinor: number | null
}): PrepaymentConfig {
  if (view.prepaymentMode === 'PERCENTAGE' && view.prepaymentPercent !== null) {
    return { mode: 'percentage', value: view.prepaymentPercent }
  }
  if (view.prepaymentMode === 'FIXED' && view.prepaymentFixedMinor !== null) {
    return { mode: 'fixed', value: view.prepaymentFixedMinor }
  }
  return { mode: 'none' }
}

/** The inverse of {@link prepaymentFromView} for `PATCH …/settings`. */
export function prepaymentToSettings(
  config: PrepaymentConfig,
): Pick<
  UpdateBusinessSettingsInput,
  'prepaymentMode' | 'prepaymentPercent' | 'prepaymentFixedMinor'
> {
  if (config.mode === 'percentage' && config.value !== undefined) {
    return {
      prepaymentMode: 'PERCENTAGE',
      prepaymentPercent: config.value,
      prepaymentFixedMinor: null,
    }
  }
  if (config.mode === 'fixed' && config.value !== undefined) {
    return {
      prepaymentMode: 'FIXED',
      prepaymentPercent: null,
      prepaymentFixedMinor: config.value,
    }
  }
  return { prepaymentMode: 'NONE', prepaymentPercent: null, prepaymentFixedMinor: null }
}

/**
 * Rendering defaults for UI fields the backend projection does not carry.
 * These are display constants (theme colour, map provider, display currency,
 * date-strip sizing, empty schedule/collection placeholders) — never business,
 * service, price or schedule data. The specification defines no display
 * currency, so the existing 'ETB' presentation constant is retained unchanged.
 */
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
  mapProvider: 'osm',
  phone: '',
  workingHours: [[], [], [], [], [], [], []] as BusinessDetails['workingHours'],
  bookingIntervalMinutes: 60,
  blockedDays: [],
  blockedPeriods: [],
  specialDays: {},
  pause: null,
  prepayment: { mode: 'none' },
  currency: 'ETB',
  bookingWindowDays: 14,
  logo: null,
  coverPhoto: null,
}

/** Real owner profile fields over the rendering defaults of the UI model. */
export function hybridizeOwnedBusiness(
  view: OwnerBusinessView,
  defaults: BusinessDetails = DEFAULT_PUBLIC_BUSINESS_FIELDS,
): BusinessDetails {
  const { lat, lng } = coordinatesOf(view.coordinates)
  return {
    ...defaults,
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
    // The real deposit configuration, not a rendering default: this is what
    // decides whether the customer booking wizard asks for a payment proof.
    prepayment: prepaymentFromView(view),
  }
}

/**
 * Real public profile fields over the rendering defaults of the UI model.
 *
 * `view` is the only source of business data. The optional second parameter is
 * a caller-supplied set of *rendering defaults* of the same shape as
 * `DEFAULT_PUBLIC_BUSINESS_FIELDS` — it is never a demo business, catalogue or
 * schedule, and a production caller passes nothing.
 *
 * `PublicBusinessView` carries no prepayment field, and none is needed: the
 * customer wizard never guesses a deposit from business metadata. It shows and
 * enforces exactly the amount the backend derives per selection in the
 * availability response (`requiredPrepaidMinor`, computed by the same
 * `computePrepaidAmount` that rejects a proof-less booking), so no additional
 * public field is required or added here.
 */
export function hybridizePublicBusiness(
  view: PublicBusinessView,
  defaults: BusinessDetails = DEFAULT_PUBLIC_BUSINESS_FIELDS,
): BusinessDetails {
  const { lat, lng } = coordinatesOf(view.coordinates)
  return {
    ...defaults,
    slug: view.slug,
    name: view.name,
    category: categoryFromCode(view.category.code),
    description: view.description ?? '',
    address: view.address ?? '',
    lat,
    lng,
    phone: view.phonePublic ?? '',
    pause: pauseFromBusiness(view.isPaused, view.pauseMessage, view.reopenAt),
    logo: view.branding.logoUrl
      ? { dataUrl: view.branding.logoUrl, alt: `${view.name} logo` }
      : (defaults.logo ?? null),
    coverPhoto: view.branding.coverUrl
      ? { dataUrl: view.branding.coverUrl, alt: `${view.name} cover photo` }
      : (defaults.coverPhoto ?? null),
  }
}