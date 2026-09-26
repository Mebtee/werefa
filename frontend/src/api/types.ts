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

/**
 * `POST /api/v1/auth/register` body (Prompt 54; REQ-005/009/032). Owner
 * self-service signup; the backend creates an unverified account
 * (`isEmailVerified=false`, REQ-026 deferred) and auto-logs the caller in, so
 * `register` resolves with the same login projection and the new session is
 * immediately active. Ownership of any business is never part of this input —
 * it is created afterwards through the owner onboarding slice.
 */
export interface RegisterRequest {
  email: string
  password: string
}

/**
 * `POST /auth/register` body (Prompt 54; REQ-005/009/032). Owner
 * self-service registration; the backend signs the new owner straight in
 * (auto-login) with an account created `isEmailVerified=false` — verification
 * is deferred (REQ-026–031) and never gates operation.
 */
export interface RegisterRequest {
  email: string
  password: string
}

/**
 * `POST /api/v1/owner/businesses` body (Prompt 54; REQ-065/068/069/086/087).
 * The category allowlist is enforced backend-side; SALON_AND_BARBER|OTHER are
 * the only choices for this slice (REQ-061/063/223/224/236). Slug/name are
 * required; every other field is optional and maps to the canonical business
 * projection. Phone is mapped to `phonePublic` (REQ-213; no separate private
 * field exists until contacts land).
 */
export interface CreateOwnedBusinessInput {
  slug: string
  name: string
  categoryCode: BusinessCategoryCode
  description?: string
  address?: string
  phonePublic?: string
  bookingIntervalMinutes?: number
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
  branding: { logoUrl: string | null; coverUrl: string | null }
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

// ---------------------------------------------------------------------------
// PUBLIC AVAILABILITY wire types (Prompt 48). Mirror the Prompt 43 backend
// contract; the backend remains authoritative. `POST …/availability` computes
// duration/price for a whole multi-service appointment (REQ-070/074); the
// client never sends its own duration.
// ---------------------------------------------------------------------------

/** One service within an availability request (REQ-070). */
export interface AvailabilitySelectionInput {
  serviceId: string
  variationId?: string
  addOnIds?: string[]
}

/** `POST /api/v1/public/businesses/:slug/availability` body. */
export interface AvailabilityQueryPayload {
  date: string
  selections: AvailabilitySelectionInput[]
}

/** One start/end pair in a business's local timeline, as ISO instants. */
export interface PublicAvailabilitySlot {
  startAt: string
  endAt: string
}

/** `GET|POST …/availability` response projection (no internal ids). */
export interface PublicAvailabilityView {
  date: string
  slots: PublicAvailabilitySlot[]
  computedDurationMinutes: number
  computedTotalPriceMinor: number
  /**
   * Deposit due for this selection per the business prepayment settings
   * (REQ-110/111). 0 when no prepayment is required. The booking wizard shows
   * its payment-proof step exactly when this is greater than 0.
   */
  requiredPrepaidMinor: number
}

// ---------------------------------------------------------------------------
// CUSTOMER BOOKING wire types (Prompt 49). Mirror the Prompt 43 backend
// contract; the backend remains authoritative. The client sends `selections`
// only — never prices/durations — and the backend snapshots each component
// itself (REQ-074/076). `submissionKey` makes the POST idempotent (REQ-121).
// ---------------------------------------------------------------------------

/** One service within a booking request (REQ-070) — mirrors `AvailabilitySelectionInput`. */
export interface CreateCustomerBookingSelectionInput {
  serviceId: string
  variationId?: string
  addOnIds?: string[]
}

/** `POST /api/v1/customer/bookings` body. */
export interface CreateCustomerBookingInput {
  businessSlug: string
  selections: CreateCustomerBookingSelectionInput[]
  customerName: string
  customerPhone: string
  note?: string
  /** Preferred appointment start as an ISO instant. */
  startAt: string
  submissionKey: string
  paymentMethod?: 'BANK_TRANSFER' | 'TELEBIRR_MOBILE_MONEY'
}

/** `POST /api/v1/customer/bookings` response — customer-safe projection. */
export interface CustomerBookingView {
  status: string
  startAt: string
  endAt: string
  serviceNames: string[]
  businessSlug: string
  totalPriceMinor: number
  prepaidMinor: number
  paymentMethod: string
  note: string | null
}

/** One entry in `GET /api/v1/customer/status` (newest first). */
export interface CustomerStatusEntryView {
  startAt: string
  endAt: string
  status: string
}

/** `GET /api/v1/customer/status?slug=…&phone=…` response (no internal ids). */
export interface CustomerStatusView {
  bookings: CustomerStatusEntryView[]
  /**
   * Whether this phone is live-connected to Telegram for the business
   * (per business + phone, REQ-056). Projected with the status lookup so the
   * customer status page can reflect it without a separate request.
   */
  telegramConnected: boolean
}

// ---------------------------------------------------------------------------
// TELEGRAM wire types (Prompt 51). Mirror the backend `TelegramConnectionView`
// / `OwnerTelegramStatusView` projections (§23.3, REQ-056/065/066). The
// deep link is the ONLY way a code is conveyed — the plain 10-minute code is
// never exposed to the client. `status: 'ready'` means a link was issued;
// `status: 'connected'` means this phone/owner is already linked.
// ---------------------------------------------------------------------------

/** `POST /api/v1/public/businesses/:slug/telegram/connect` body. */
export interface TelegramCustomerConnectInput {
  phone: string
}

/**
 * `POST …/telegram/connect` response (customer and owner). `deepLink` /
 * `expiresInMs` are non-null exactly when `status === 'ready'`.
 */
export interface TelegramConnectionView {
  status: 'ready' | 'connected'
  deepLink: string | null
  expiresInMs: number | null
}

/** `GET /api/v1/owner/businesses/:id/telegram/status` response. */
export interface OwnerTelegramStatusView {
  connected: boolean
}

// ---------------------------------------------------------------------------
// REJECTED-BOOKING RESUBMISSION wire types (Prompt 50). Mirror the backend
// contract; the backend remains authoritative. Codes are one-time, expiring and
// phone-scoped (REQ-230); the backend delivers the code to the customer's
// connected Telegram chat (Section 23.3), so the frontend never returns or
// displays the code itself — it only offers a code-input step.
// ---------------------------------------------------------------------------

/** `POST /api/v1/customer/resubmission/request-code` body (JSON). */
export interface ResubmissionRequestInput {
  businessSlug: string
  phone: string
}

/** `POST /api/v1/customer/resubmission/verify` body (multipart `payload` field). */
export interface ResubmissionVerifyInput extends ResubmissionRequestInput {
  /** The one-time 6-digit code (delivered out-of-band). */
  code: string
  /** Idempotency key (REQ-121), stable across retries of one attempt. */
  submissionKey: string
}

/**
 * `POST …/resubmission/request-code` response. The code itself is never
 * returned; only its expiry is disclosed (the backend delivers it to the
 * customer's connected Telegram chat; the frontend never sees the code).
 */
export interface ResubmissionRequestCodeView {
  expiresAt: string
}

/** `POST /api/v1/customer/resubmission/verify` response. */
export interface CustomerResubmissionResultView {
  booking: CustomerBookingView
  outcome: string
}

// ---------------------------------------------------------------------------
// OWNER PAYMENT-PROOF REVIEW wire types (Prompt 51). Mirror the backend owner
// projections (`OwnerBookingView` / `OwnerBookingDetailView` /
// `OwnerBookingProofView`). The backend remains authoritative for statuses,
// prices and proof metadata; the UI never recomputes them. Booking status and
// payment status are distinct backend values and are carried separately.
// ---------------------------------------------------------------------------

/** `OwnerPaymentView` on `GET /api/v1/owner/businesses/:id/bookings/:bookingId`. */
export interface OwnerPaymentView {
  /** Backend payment-status code: `PENDING` | `ACCEPTED` | `REJECTED`. */
  status: string
  /** Backend payment-method code, e.g. `BANK_TRANSFER` | `TELEBIRR_MOBILE_MONEY`. */
  method: string
  prepaidMinor: number
}

/** One resolved component line on the owner booking projection. */
export interface OwnerBookingComponentView {
  componentType: string
  name: string
  unitPriceMinor: number
  durationMinutes: number
}

/** `OwnerBookingView` — the owner booking list item and detail base. */
export interface OwnerBookingView {
  bookingId: number
  /** Backend booking-state code, e.g. `PAYMENT_PENDING` | `CONFIRMED`. */
  status: string
  customerName: string
  customerPhone: string
  note: string | null
  startAt: string
  endAt: string
  createdAt: string
  updatedAt: string
  payment: OwnerPaymentView | null
  components: OwnerBookingComponentView[]
  totalPriceMinor: number
  /** Last status-transition actor (`OWNER` | `CUSTOMER` | `SYSTEM` …) — list sort (REQ-188/190). */
  actorType: string
}

/** One booking-history entry on `OwnerBookingDetailView`. */
export interface OwnerBookingHistoryView {
  occurredAt: string
  fromStatus: string | null
  toStatus: string
  actorType: string
  actorUserId: string | null
  reason: string | null
}

/** One proof in the owner proof timeline (metadata only, newest last). */
export interface OwnerBookingProofView {
  proofId: string
  submittedAt: string
  fileName: string
  mimeType: string
  sizeBytes: number
  /** True when a later resubmitted proof replaced this one. */
  replaced: boolean
}

/** `GET /api/v1/owner/businesses/:id/bookings/:bookingId` response. */
export interface OwnerBookingDetailView extends OwnerBookingView {
  history: OwnerBookingHistoryView[]
  proofs: OwnerBookingProofView[]
}

/** `POST …/bookings/:bookingId/reject` body (REQ-118 rejection reason). */
export interface OwnerBookingRejectInput {
  reason: string
}

/** `GET …/bookings` query parameters (all optional — the owner re-filters client-side). */
export interface OwnerBookingListQuery {
  status?: string
  from?: string
  to?: string
  search?: string
  limit?: number
}

/** `POST …/bookings/:bookingId/reschedule` body — the target as an ISO instant. */
export interface OwnerRescheduleInput {
  startAt: string
}

/** One free + fitting slot of the reschedule picker (REQ-106/089). */
export interface OwnerRescheduleAvailabilitySlotView {
  startAt: string
  endAt: string
}

/** `GET …/bookings/:bookingId/available-times?date=…` response. */
export interface OwnerRescheduleAvailabilityView {
  date: string
  durationMinutes: number
  slots: OwnerRescheduleAvailabilitySlotView[]
}

// ---------------------------------------------------------------------------
// SUBSCRIPTION wire types (Prompt 52; spec §17, §27.2/§27.3, REQ-125…141).
// Mirror the Prompt 43 backend views; the backend remains authoritative.
// ---------------------------------------------------------------------------

/** Canonical subscription status (REQ-128…131; derives from band timestamps). */
export type SubscriptionStatusCode =
  | 'TRIAL'
  | 'TRIAL_GRACE'
  | 'ACTIVE'
  | 'PAID_GRACE'
  | 'EXPIRED'
  | 'NONE'

export type SubscriptionReviewState = 'PENDING' | 'APPROVED' | 'REJECTED'

/** One owner payment-proof submission (upload date + review outcome). */
export interface SubscriptionProofView {
  id: string
  reviewState: SubscriptionReviewState
  requestedAt: string
  reviewedBy: string | null
  rejectionReason: string | null
  approvedUntil: string | null
  createdAt: string
}

/** `GET /api/v1/owner/businesses/:id/subscription` response (no price — §46). */
export interface OwnerSubscriptionView {
  status: SubscriptionStatusCode
  trialStartedAt: string | null
  trialEndsAt: string | null
  trialGraceEndsAt: string | null
  periodEndsAt: string | null
  paidGraceEndsAt: string | null
  bookingsEnabled: boolean
  proofs: SubscriptionProofView[]
}

/** Admin review-queue item (REQ-137): pending proof + owning business owner. */
export interface AdminSubscriptionProofView extends SubscriptionProofView {
  businessId: string
  businessName: string
  ownerEmail: string
}

// ---------------------------------------------------------------------------
// PLATFORM ADMINISTRATION wire types (Prompt 53; spec §20, §27.3,
// REQ-191…206, REQ-217…221). Mirror the Prompt 43 backend views; the backend
// remains authoritative. No password/recovery material is ever returned.
// ---------------------------------------------------------------------------

/** `GET /api/v1/admin/admins` item and `POST /api/v1/admin/admins` result (REQ-217). */
export interface AdminUserView {
  id: string
  email: string
  createdAt: string
  isDeactivated: boolean
  activeSessions: number
}

/** One security-history record (REQ-191/192/201/202/203). */
export interface SecurityEventView {
  id: string
  /** Present only in the Super Admin platform-wide list (REQ-203). */
  userId?: string | null
  type: string
  ip: string | null
  device: string | null
  browser: string | null
  result: string
  createdAt: string
}

/** One canonical booking-history row (REQ-182 fields; no reasons/notes, REQ-183). */
export interface BookingHistoryRowView {
  occurredAt: string
  bookingId: number
  customerName: string
  businessName: string
  fromStatus: string | null
  toStatus: string
  actorType: string
}

/** Super Admin booking status-history report (REQ-177/184…190). */
export interface BookingHistoryReportView {
  rows: BookingHistoryRowView[]
  total: number
  from: string
  to: string
  sortBy: string
  sortDirection: string
}

export interface CreateAdminRequest {
  email: string
  password: string
  recoveryEmail?: string
}

export interface ResetAdminPasswordRequest {
  newPassword: string
}

/** `POST /api/v1/auth/recovery/request` body (REQ-198/199). */
export interface RecoveryRequestInput {
  email: string
}

/** `POST /api/v1/auth/recovery/confirm` body (REQ-200). */
export interface RecoveryConfirmInput {
  email: string
  code: string
  newPassword: string
}
