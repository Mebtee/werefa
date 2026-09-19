/**
 * Wire types shared by the frontend API client (Prompt 44). These mirror the
 * Prompt 43 backend contract; the backend remains authoritative.
 */

/** Internal platform roles that can authenticate. Customers have no account (REQ-040). */
export type AuthRole = 'OWNER' | 'ADMIN' | 'SUPER_ADMIN'

/** Safe server-side user projection returned by `GET /auth/session`. */
export interface AuthPrincipal {
  id: string
  role: AuthRole
  email: string
}

/** `POST /auth/login` response body. Only the safe projection is returned. */
export interface LoginResponse {
  expiresAt: string
  user: {
    id: string
    role: AuthRole
  }
}

/** `GET /auth/session` response body. `user` is null when no session is active. */
export interface SessionResponse {
  user: AuthPrincipal | null
}

export interface LoginRequest {
  email: string
  password: string
}

export interface ChangePasswordRequest {
  currentPassword: string
  newPassword: string
}

// ---------------------------------------------------------------------------
// BUSINESS wire types (Prompt 45). Mirror the Prompt 42/43 backend projections;
// the backend remains authoritative.
// ---------------------------------------------------------------------------

export type BusinessCategoryCode = 'SALON_AND_BARBER' | 'OTHER'

export interface PublicCategoryView {
  code: BusinessCategoryCode
  label: string
}

export interface BusinessCoordinates {
  latitude: number | null
  longitude: number | null
}

/** `GET/PATCH /api/v1/owner/businesses/:id` and list response item. */
export interface OwnerBusinessView {
  id: string
  slug: string
  name: string
  category: PublicCategoryView
  description: string | null
  address: string | null
  phonePublic: string | null
  coordinates: BusinessCoordinates
  isDeactivated: boolean
  isPaused: boolean
  pauseMessage: string | null
  reopenAt: string | null
  bookingIntervalMinutes: number
  prepaymentMode: 'NONE' | 'PERCENTAGE' | 'FIXED'
  prepaymentPercent: number | null
  prepaymentFixedMinor: number | null
  createdAt: string
}

/** `GET /api/v1/public/businesses/:slug` response body (no owner identity). */
export interface PublicBusinessView {
  slug: string
  name: string
  description: string | null
  address: string | null
  phonePublic: string | null
  category: PublicCategoryView
  coordinates: BusinessCoordinates
  isDeactivated: boolean
  isPaused: boolean
  pauseMessage: string | null
  reopenAt: string | null
  bookingIntervalMinutes: number
  branding: { logoUrl: null; coverUrl: null }
}

/** `PATCH /api/v1/owner/businesses/:id` body (REQ-211 AC1). */
export interface UpdateBusinessProfileInput {
  name?: string
  description?: string
  address?: string
  phonePublic?: string
  categoryCode?: BusinessCategoryCode
  latitude?: number
  longitude?: number
}

/** `PATCH /api/v1/owner/businesses/:id/slug` body (REQ-047). */
export interface ChangePublicSlugInput {
  publicSlug: string
}

/** `POST /api/v1/owner/businesses/:id/pause` body (REQ-148/149). */
export interface PauseBusinessInput {
  pauseMessage?: string
  reopenAt?: string
}

// ---------------------------------------------------------------------------
// SERVICE CATALOG wire types (Prompt 46). Mirror the Prompt 42/43 backend
// projections; the backend remains authoritative. Money is integer minor
// units; add-ons are deltas relative to the base (REQ-073).
// ---------------------------------------------------------------------------

export interface ServiceVariantView {
  id: string
  name: string
  priceDeltaMinor: number
  durationDeltaMinutes: number
}

/** `GET/POST /api/v1/owner/businesses/:id/services` and per-service responses. */
export interface OwnerServiceView {
  id: string
  name: string
  basePriceMinor: number
  baseDurationMinutes: number
  isActive: boolean
  variations: ServiceVariantView[]
  addOns: ServiceVariantView[]
}

/** `GET /api/v1/public/businesses/:slug/services` — active services only. */
export interface PublicServiceView {
  id: string
  name: string
  basePriceMinor: number
  baseDurationMinutes: number
  variations: ServiceVariantView[]
  addOns: ServiceVariantView[]
}

/** `POST /api/v1/owner/businesses/:id/services` body. */
export interface CreateServiceInput {
  name: string
  basePriceMinor: number
  baseDurationMinutes: number
}

/** `PATCH /api/v1/owner/businesses/:id/services/:serviceId` body. */
export interface UpdateServiceInput {
  name?: string
  basePriceMinor?: number
  baseDurationMinutes?: number
}

/** `POST /api/v1/owner/businesses/:id/services/:serviceId/variations|addons` body. */
export interface CreateServiceVariantInput {
  name: string
  priceDeltaMinor: number
  durationDeltaMinutes: number
}

/** `PATCH /api/v1/owner/businesses/:id/settings` body (booking interval lives on business settings). */
export interface UpdateBusinessSettingsInput {
  bookingIntervalMinutes?: number
}

// ---------------------------------------------------------------------------
// SCHEDULE wire types (Prompt 47). Mirror the Prompt 41/42/43 backend
// projections; the backend remains authoritative. Weekdays are ISO
// 1 (Monday) … 7 (Sunday) — matching the backend contract.
//
// Staged-slice note (Prompt 47): the bookings vertical is NOT migrated, so the
// conflict/exception views carry the mock booking-seam id (`bookingId` as a
// string). When the bookings integration lands this becomes the backend
// numeric booking id and the UI maps it through unchanged.
// ---------------------------------------------------------------------------

export interface WorkingPeriodView {
  weekday: number
  startMinutes: number
  endMinutes: number
}

export interface BlockedPeriodView {
  dayOfWeek: number | null
  startMinutes: number | null
  endMinutes: number | null
}

export interface SpecialDateView {
  date: string
  kind: 'CLOSED' | 'CUSTOM'
  startMinutes: number | null
  endMinutes: number | null
}

/** `GET /api/v1/owner/businesses/:id/schedule/current` + each history version. */
export interface OwnerScheduleView {
  versionId: string
  versionNo: number
  status: 'ACTIVE' | 'PENDING' | 'SUPERSEDED'
  name: string | null
  appliedAt: string | null
  appliedBy: string | null
  reason: string | null
  createdAt: string
  workingPeriods: WorkingPeriodView[]
  blockedPeriods: BlockedPeriodView[]
  specialDates: SpecialDateView[]
}

/** `GET /api/v1/public/businesses/:slug/schedule` — canonical schedule only. */
export interface PublicScheduleView {
  workingPeriods: WorkingPeriodView[]
  blockedPeriods: BlockedPeriodView[]
  specialDates: SpecialDateView[]
}

/** `PUT /api/v1/owner/businesses/:id/schedule` body. */
export interface SaveWorkingPeriodInput {
  weekday: number
  startMinutes: number
  endMinutes: number
}

export interface SaveBlockedPeriodInput {
  dayOfWeek?: number | null
  startMinutes?: number | null
  endMinutes?: number | null
}

export interface SaveSpecialDateInput {
  date: string
  kind: 'CLOSED' | 'CUSTOM'
  startMinutes?: number | null
  endMinutes?: number | null
}

export interface SaveSchedulePayload {
  /** The owner-facing version name/reason (REQ-164) — stored as the version name. */
  name?: string
  workingPeriods: SaveWorkingPeriodInput[]
  blockedPeriods?: SaveBlockedPeriodInput[]
  specialDates?: SaveSpecialDateInput[]
}

/** `PUT /api/v1/owner/businesses/:id/schedule` response. */
export interface OwnerScheduleSaveResultView {
  versionId: string
  versionNo: number
  activated: boolean
  version: OwnerScheduleView
}

/** `GET /api/v1/owner/businesses/:id/schedule/conflicts` item (REQ-092/093). */
export interface ScheduleConflictBookingComponentView {
  name: string
  durationMinutes: number
  unitPriceMinor: string
}

export interface OwnerScheduleConflictView {
  bookingId: string
  status: string
  startAt: string
  endAt: string
  createdAt: string
  customerName: string
  customerPhone: string
  note: string | null
  reason: 'CLOSED' | 'OUTSIDE_HOURS' | 'BLOCKED'
  reasonDetail: string
  services: ScheduleConflictBookingComponentView[]
}

/** `POST /api/v1/owner/businesses/:id/schedule/exceptions` body (REQ-160/161). */
export interface RecordExceptionPayload {
  bookingId: string
  versionId: string
  reason?: string
}

/** `POST …/schedule/exceptions` response. */
export interface ScheduleExceptionView {
  id: string
  scheduleVersionId: string
  bookingId: string
  reason: string | null
  createdAt: string
}
