import type {
  BlockedPeriodView,
  OwnerBookingDetailView,
  OwnerBusinessView,
  OwnerScheduleConflictView,
  OwnerScheduleView,
  OwnerServiceView,
  PublicBusinessView,
  PublicScheduleView,
  PublicServiceView,
  SaveSchedulePayload,
  ScheduleExceptionView,
  SpecialDateView,
  WorkingPeriodView,
} from '@/api/types'
import { availabilityScheduleFromView } from '@/api/schedule.mapper'
import {
  acceptBooking,
  createBookingEntry,
  getBooking,
  getBookingsByPhone,
  getBusiness,
  getOccupiedBlocks,
  getOpenConflicts,
  getServices,
  applyScheduleException,
  listScheduleHistory,
  rejectBooking,
  resubmitRejectedProof,
  saveBookingInterval,
  saveSchedule,
  scheduleSnapshotOf,
} from '@/mock/store'
import { computeAvailableTimes } from '@/mock/availability'
import { mockRaceSlot } from '@/mock/data'
import { buildLineItems, prepaymentAmount, totalDurationMinutes, totalPrice } from '@/lib/format'
import type {
  Booking,
  ScheduleConflict,
  ScheduleSnapshot,
  ScheduleVersion,
  Service,
} from '@/types/models'
import { MOCK_BUSINESS_PAGES, PRIMARY_BUSINESS_SLUG } from '@/mock/data'
import { MOCK_OWNER_ACTOR_NAME } from '@/mock/ownedBusinessFixture'
import { isoWeekdayOf, minutesOf, minutesToTime, nowTimestamp } from '@/lib/time'

/**
 * Stateful test double for the real business API endpoints (Prompt 45).
 *
 * Models the implemented backend contract for the endpoints this vertical
 * slice consumes — owner business list/detail/profile/slug/pause and the public
 * business page — so render-based tests exercise the real API client against
 * the true wire shapes. It is deliberately NOT a reimplementation of domain
 * logic: it stores the demo business and applies the same field names the
 * backend accepts/rejects, delegating every other URL to the previously
 * installed `fetch` (so `installFetchStub` routes for auth etc. keep working).
 */

export interface RecordedRequest {
  method: string
  url: string
  body?: unknown
  /** Metadata of the `proof` file field when the request was multipart. */
  proof?: { fileName: string; sizeBytes: number; mimeType: string }
}

export interface BusinessApiStub {
  calls: RecordedRequest[]
  restore(): void
}

/**
 * The one-time resubmission code this double accepts. Real codes are random and
 * delivered out-of-band; tests need a known value, so the double fixes it and
 * exposes it here.
 */
export const RESUBMISSION_TEST_CODE = '123456'

export interface BusinessApiStubOptions {
  /**
   * Consulted by the availability route ON REQUEST so a test can fail a
   * specific date's lookup after the date strip has rendered (datesError /
   * slotsError paths).
   */
  failAvailabilityFor?: (date: string) => boolean
  /**
   * Consulted by the owner booking routes ON REQUEST (Prompt 51). Return a
   * `Response` to force an error for a specific method/path, or null to let the
   * double handle it. Used to exercise 403/404/409/5xx on the review surface.
   */
  failOwnerBookingRequest?: (request: { method: string; path: string }) => Response | null
}

const OWNER_ID = '00000000-0000-4000-8000-0000000000a'

function envelope(status: number, code: string, title: string, detail: string): Response {
  return new Response(
    JSON.stringify({ error: { code, title, detail, fields: null } }),
    { status, headers: { 'content-type': 'application/json' } },
  )
}

function validationEnvelope(
  fields: Record<string, string>,
  detail = 'One or more fields are invalid.',
): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: 'VALIDATION_ERROR',
        title: 'Validation failed',
        detail,
        fields,
      },
    }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  )
}

function json<T>(body: T): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function newOwnerState(): OwnerBusinessView {
  const mock = getBusiness(PRIMARY_BUSINESS_SLUG)!
  return {
    id: OWNER_ID,
    slug: mock.slug,
    name: mock.name,
    category: {
      code: mock.category === 'salon-barber' ? 'SALON_AND_BARBER' : 'OTHER',
      label: mock.category === 'salon-barber' ? 'Salon & Barber' : 'Other',
    },
    description: mock.description,
    address: mock.address,
    phonePublic: mock.phone,
    coordinates: { latitude: mock.lat, longitude: mock.lng },
    isDeactivated: false,
    isPaused: mock.pause !== null,
    pauseMessage: mock.pause?.message ?? null,
    reopenAt:
      mock.pause?.kind === 'until' ? `${mock.pause.reopenDate}T00:00:00.000Z` : null,
    bookingIntervalMinutes: mock.bookingIntervalMinutes,
    prepaymentMode:
      mock.prepayment.mode === 'percentage'
        ? 'PERCENTAGE'
        : mock.prepayment.mode === 'fixed'
          ? 'FIXED'
          : 'NONE',
    prepaymentPercent:
      mock.prepayment.mode === 'percentage' ? mock.prepayment.value ?? null : null,
    prepaymentFixedMinor:
      mock.prepayment.mode === 'fixed' ? mock.prepayment.value ?? null : null,
    createdAt: new Date().toISOString(),
  }
}

function publicViewOf(owner: OwnerBusinessView): PublicBusinessView {
  return {
    slug: owner.slug,
    name: owner.name,
    description: owner.description,
    address: owner.address,
    phonePublic: owner.phonePublic,
    category: owner.category,
    coordinates: owner.coordinates,
    isDeactivated: owner.isDeactivated,
    isPaused: owner.isPaused,
    pauseMessage: owner.pauseMessage,
    reopenAt: owner.reopenAt,
    bookingIntervalMinutes: owner.bookingIntervalMinutes,
    branding: { logoUrl: null, coverUrl: null },
  }
}

/**
 * Other demo businesses are also in the simulated database, so the public API
 * serves their profiles too (same contract as the real backend).
 */
function publicViewFromStore(slug: string): PublicBusinessView | undefined {
  const mock = getBusiness(slug)
  if (!mock) return undefined
  return {
    slug: mock.slug,
    name: mock.name,
    description: mock.description || null,
    address: mock.address || null,
    phonePublic: mock.phone || null,
    category: {
      code: mock.category === 'salon-barber' ? 'SALON_AND_BARBER' : 'OTHER',
      label: mock.category === 'salon-barber' ? 'Salon & Barber' : 'Other',
    },
    coordinates: { latitude: mock.lat ?? null, longitude: mock.lng ?? null },
    isDeactivated: false,
    isPaused: mock.pause !== null,
    pauseMessage: mock.pause?.message ?? null,
    reopenAt:
      mock.pause?.kind === 'until' ? `${mock.pause.reopenDate}T00:00:00.000Z` : null,
    bookingIntervalMinutes: mock.bookingIntervalMinutes,
    branding: { logoUrl: null, coverUrl: null },
  }
}

// --- Schedule (Prompt 47) -----------------------------------------------------
// The test double round-trips the real schedule wire contract through the mock
// store's schedule domain: saves apply the snapshot the store derives from (via
// the same pure availability mapper the public page uses), so assertions on the
// still-mock business (`workingHours`, `specialDays`, availability…) keep
// passing while the production path talks to the API client only.

function workingPeriodViewsOf(snapshot: ScheduleSnapshot): WorkingPeriodView[] {
  const views: WorkingPeriodView[] = []
  for (let day = 0; day < snapshot.workingHours.length; day++) {
    for (const period of snapshot.workingHours[day]) {
      views.push({
        weekday: ((day + 6) % 7) + 1,
        startMinutes: minutesOf(period.start),
        endMinutes: minutesOf(period.end),
      })
    }
  }
  return views
}

function blockedPeriodViewsOf(snapshot: ScheduleSnapshot): BlockedPeriodView[] {
  const seen = new Set<string>()
  const views: BlockedPeriodView[] = []
  for (const block of snapshot.blockedPeriods) {
    const dayOfWeek = isoWeekdayOf(block.date)
    const startMinutes = minutesOf(block.start)
    const endMinutes = minutesOf(block.end)
    const key = `${dayOfWeek}-${startMinutes}-${endMinutes}`
    if (seen.has(key)) continue
    seen.add(key)
    views.push({ dayOfWeek, startMinutes, endMinutes })
  }
  return views
}

function specialDateViewsOf(snapshot: ScheduleSnapshot): SpecialDateView[] {
  return Object.entries(snapshot.specialDays)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, day]) =>
      day.kind === 'closed'
        ? { date, kind: 'CLOSED' as const, startMinutes: null, endMinutes: null }
        : {
            date,
            kind: 'CUSTOM' as const,
            startMinutes: minutesOf(day.periods[0]?.start ?? '00:00'),
            endMinutes: minutesOf(day.periods[0]?.end ?? '00:00'),
          },
    )
}

function scheduleViewFromVersion(version: ScheduleVersion, versionNo: number): OwnerScheduleView {
  return {
    versionId: version.id,
    versionNo,
    status: version.status.toUpperCase() as OwnerScheduleView['status'],
    name: version.reason,
    appliedAt: version.at,
    appliedBy: version.actor,
    reason: version.reason,
    createdAt: version.at,
    workingPeriods: workingPeriodViewsOf(version.snapshot),
    blockedPeriods: blockedPeriodViewsOf(version.snapshot),
    specialDates: specialDateViewsOf(version.snapshot),
  }
}

function scheduleViewsFor(
  history: readonly ScheduleVersion[],
): OwnerScheduleView[] {
  return history.map((version, index) =>
    scheduleViewFromVersion(version, history.length - index),
  )
}

/** The current schedule the backend would return: newest ACTIVE version (or newest pending/none). */
function currentScheduleView(slug: string): OwnerScheduleView {
  const history = listScheduleHistory(slug)
  const views = scheduleViewsFor(history)
  const active = views.find((view) => view.status === 'ACTIVE') ?? views[0]
  if (active) return active
  const business = getBusiness(slug)!
  const version: ScheduleVersion = {
    id: `sch-v-initial-${slug}`,
    businessSlug: slug,
    snapshot: scheduleSnapshotOf(business),
    actor: MOCK_OWNER_ACTOR_NAME,
    reason: null,
    automatic: false,
    at: nowTimestamp(),
    status: 'active',
  }
  return scheduleViewFromVersion(version, 1)
}

function publicScheduleViewFor(slug: string): PublicScheduleView {
  const active =
    listScheduleHistory(slug).find((version) => version.status === 'active')?.snapshot ??
    scheduleSnapshotOf(getBusiness(slug)!)
  return {
    workingPeriods: workingPeriodViewsOf(active),
    blockedPeriods: blockedPeriodViewsOf(active),
    specialDates: specialDateViewsOf(active),
  }
}

function snapshotFromPayload(
  slug: string,
  payload: SaveSchedulePayload,
  intervalMinutes: number,
): ScheduleSnapshot {
  const windowDays = getBusiness(slug)?.bookingWindowDays ?? 14
  const fields = availabilityScheduleFromView(
    {
      workingPeriods: payload.workingPeriods,
      blockedPeriods: (payload.blockedPeriods ?? []).map((b) => ({
        dayOfWeek: b.dayOfWeek ?? null,
        startMinutes: b.startMinutes ?? null,
        endMinutes: b.endMinutes ?? null,
      })),
      specialDates: (payload.specialDates ?? []).map((s) => ({
        date: s.date,
        kind: s.kind,
        startMinutes: s.startMinutes ?? null,
        endMinutes: s.endMinutes ?? null,
      })),
    },
    { intervalMinutes, bookingWindowDays: windowDays },
  )
  return {
    workingHours: fields.workingHours,
    bookingIntervalMinutes: intervalMinutes,
    blockedDays: [...fields.blockedDays],
    blockedPeriods: [...fields.blockedPeriods],
    specialDays: { ...fields.specialDays },
  }
}

function conflictStatusOf(booking: Booking | undefined): string {
  if (!booking) return 'CONFIRMED'
  if (booking.state === 'payment-pending') return 'PAYMENT_PENDING'
  return booking.state.toUpperCase().replace('-', '_')
}

function conflictReasonCode(reason: string): OwnerScheduleConflictView['reason'] {
  if (reason.toLowerCase().includes('closed')) return 'CLOSED'
  if (reason.toLowerCase().includes('blocked')) return 'BLOCKED'
  return 'OUTSIDE_HOURS'
}

function conflictViewOf(conflict: ScheduleConflict): OwnerScheduleConflictView {
  const booking = getBooking(conflict.businessSlug, conflict.bookingId)
  const startAt = booking
    ? `${booking.date}T${booking.time}:00.000Z`
    : conflict.at
  const endAt = booking
    ? `${booking.date}T${minutesToTime(minutesOf(booking.time) + booking.totalDurationMinutes)}:00.000Z`
    : conflict.at
  return {
    bookingId: conflict.bookingId,
    status: conflictStatusOf(booking),
    startAt,
    endAt,
    createdAt: conflict.at,
    customerName: booking?.customer.name ?? 'Unknown customer',
    customerPhone: booking?.customer.phone ?? '',
    note: booking?.customer.note ?? null,
    reason: conflictReasonCode(conflict.reason),
    reasonDetail: conflict.reason,
    services:
      booking?.lineItems.map((item) => ({
        name: item.name,
        durationMinutes: item.durationMinutes,
        unitPriceMinor: String(item.unitPrice),
      })) ?? [],
  }
}

// --- Service catalog (Prompt 46) -------------------------------------------
// The same contract as the real backend: integer-minor money, delta add-ons
// (REQ-073), and the public projection omits `isActive` because the endpoint
// only answers with active services (REQ-079).

function ownerServiceFromStore(s: Service): OwnerServiceView {
  return {
    id: s.id,
    name: s.name,
    basePriceMinor: s.basePriceMinor,
    baseDurationMinutes: s.baseDurationMinutes,
    isActive: s.isActive,
    variations: s.variations.map((v) => ({
      id: v.id,
      name: v.name,
      priceDeltaMinor: v.priceDeltaMinor,
      durationDeltaMinutes: v.durationDeltaMinutes,
    })),
    addOns: s.addOns.map((a) => ({
      id: a.id,
      name: a.name,
      priceDeltaMinor: a.priceDeltaMinor,
      durationDeltaMinutes: a.durationDeltaMinutes,
    })),
  }
}

function publicServiceFromOwner(view: OwnerServiceView): PublicServiceView {
  return {
    id: view.id,
    name: view.name,
    basePriceMinor: view.basePriceMinor,
    baseDurationMinutes: view.baseDurationMinutes,
    variations: view.variations.map((v) => ({ ...v })),
    addOns: view.addOns.map((a) => ({ ...a })),
  }
}

function newServicesState(): OwnerServiceView[] {
  return getServices(PRIMARY_BUSINESS_SLUG).map(ownerServiceFromStore)
}

function validateServiceInput(body: unknown): Record<string, string> | null {
  const input = (body ?? {}) as Record<string, unknown>
  const fields: Record<string, string> = {}
  if (typeof input.name !== 'string' || input.name.trim().length === 0) {
    fields.name = 'Service name is required.'
  } else if (input.name.trim().length > 160) {
    fields.name = 'Service name must be 160 characters or fewer.'
  }
  if (typeof input.basePriceMinor !== 'number' || !Number.isInteger(input.basePriceMinor) || input.basePriceMinor < 0) {
    fields.basePriceMinor = 'Price must be a non-negative integer amount (minor units).'
  }
  if (typeof input.baseDurationMinutes !== 'number' || !Number.isInteger(input.baseDurationMinutes) || input.baseDurationMinutes < 1) {
    fields.baseDurationMinutes = 'Duration must be a whole number of minutes, at least 1.'
  }
  return Object.keys(fields).length > 0 ? fields : null
}

function validateVariantInput(body: unknown): Record<string, string> | null {
  const input = (body ?? {}) as Record<string, unknown>
  const fields: Record<string, string> = {}
  if (typeof input.name !== 'string' || input.name.trim().length === 0) {
    fields.name = 'A name is required.'
  }
  if (typeof input.priceDeltaMinor !== 'number' || !Number.isInteger(input.priceDeltaMinor) || input.priceDeltaMinor < 0) {
    fields.priceDeltaMinor = 'Delta price must be a non-negative integer amount (minor units).'
  }
  if (typeof input.durationDeltaMinutes !== 'number' || !Number.isInteger(input.durationDeltaMinutes) || input.durationDeltaMinutes < 0) {
    fields.durationDeltaMinutes = 'Delta duration must be a non-negative whole number of minutes.'
  }
  return Object.keys(fields).length > 0 ? fields : null
}

// --- Availability (Prompt 48) -------------------------------------------------
// Models the public availability POST route. The backend is authoritative and
// computes the appointment totals itself; this double derives the same totals
// from the catalog (REQ-074) and reuses the mock's pure time projections so
// the still-mock booking submission re-checks the exact same offered slots.

function serviceFromOwnerView(view: OwnerServiceView): Service {
  return {
    id: view.id,
    name: view.name,
    basePriceMinor: view.basePriceMinor,
    baseDurationMinutes: view.baseDurationMinutes,
    isActive: view.isActive,
    variations: view.variations.map((v) => ({ ...v })),
    addOns: view.addOns.map((a) => ({ ...a })),
  }
}

interface AvailabilitySelection {
  serviceId: string
  variationId?: string
  addOnIds?: string[]
}

interface AppointmentTotals {
  ok: boolean
  durationMinutes: number
  totalPriceMinor: number
  fields?: Record<string, string>
}

function computeAppointmentTotals(
  services: readonly Service[],
  selections: AvailabilitySelection[],
): AppointmentTotals {
  if (selections.length === 0) {
    return { ok: false, durationMinutes: 0, totalPriceMinor: 0, fields: { selections: 'Select at least one service.' } }
  }
  let duration = 0
  let totalPrice = 0
  for (const sel of selections) {
    const service = services.find((s) => s.id === sel.serviceId && s.isActive)
    if (!service) {
      return { ok: false, durationMinutes: 0, totalPriceMinor: 0, fields: { serviceId: 'One or more selected services are not active.' } }
    }
    duration += service.baseDurationMinutes
    totalPrice += service.basePriceMinor
    if (sel.variationId) {
      const variation = service.variations.find((v) => v.id === sel.variationId)
      if (!variation) {
        return { ok: false, durationMinutes: 0, totalPriceMinor: 0, fields: { variationId: 'One or more selected variations are not active.' } }
      }
      duration += variation.durationDeltaMinutes
      totalPrice += variation.priceDeltaMinor
    }
    for (const addOnId of sel.addOnIds ?? []) {
      const addOn = service.addOns.find((a) => a.id === addOnId)
      if (!addOn) {
        return { ok: false, durationMinutes: 0, totalPriceMinor: 0, fields: { addOnId: 'One or more selected add-ons are not active.' } }
      }
      duration += addOn.durationDeltaMinutes
      totalPrice += addOn.priceDeltaMinor
    }
  }
  return { ok: true, durationMinutes: duration, totalPriceMinor: totalPrice }
}

function slotInstants(date: string, time: string, durationMinutes: number) {
  const [y, mo, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const startAt = new Date(y, mo - 1, d, hh, mm)
  return {
    startAt: startAt.toISOString(),
    endAt: new Date(startAt.getTime() + durationMinutes * 60_000).toISOString(),
  }
}

/** Customer-safe projection of a store booking (mirrors `CustomerBookingView`). */
function customerBookingViewOf(booking: Booking, slug: string) {
  const [y, mo, d] = booking.date.split('-').map(Number)
  const [hh, mm] = booking.time.split(':').map(Number)
  const start = new Date(y, mo - 1, d, hh, mm)
  return {
    status: booking.state === 'payment-pending' ? 'awaiting-verification' : booking.state,
    startAt: start.toISOString(),
    endAt: new Date(
      start.getTime() + booking.totalDurationMinutes * 60_000,
    ).toISOString(),
    serviceNames: booking.lineItems.map((item) => item.name),
    businessSlug: slug,
    totalPriceMinor: booking.total,
    prepaidMinor: booking.deposit,
    paymentMethod:
      booking.paymentMethod === 'bank-transfer'
        ? 'BANK_TRANSFER'
        : 'TELEBIRR_MOBILE_MONEY',
    note: booking.customer.note || null,
  }
}

/** The most recent rejected booking for a phone (newest first, REQ-230). */
function latestRejectedFor(slug: string, phone: string): Booking | undefined {
  return getBookingsByPhone(slug, phone).find(
    (booking) => booking.state === 'rejected',
  )
}

// ---------------------------------------------------------------------------
// Owner payment-proof review routes (Prompt 51). The double projects a store
// booking into the real owner wire shapes (`OwnerBookingDetailView`) and routes
// accept/reject through the same store functions the mock owner API used, so
// render tests exercise the real client against the authoritative contract.
// ---------------------------------------------------------------------------

const OWNER_BOOKING_STATE_CODE: Record<Booking['state'], string> = {
  'payment-pending': 'PAYMENT_PENDING',
  confirmed: 'CONFIRMED',
  completed: 'COMPLETED',
  'no-show': 'NO_SHOW',
  cancelled: 'CANCELLED',
  rejected: 'REJECTED',
}

/** Stable, addressable id for a store booking's single proof record. */
function ownerProofId(booking: Booking): string {
  return `proof-${booking.id}`
}

function ownerProofViewOf(booking: Booking) {
  return {
    proofId: ownerProofId(booking),
    submittedAt: booking.updatedAt,
    fileName: booking.proof.fileName,
    mimeType: booking.proof.mimeType,
    sizeBytes: booking.proof.sizeBytes,
    replaced: false,
  }
}

/** Projects a store booking into the real `OwnerBookingDetailView` shape. */
function ownerBookingDetailViewOf(booking: Booking): OwnerBookingDetailView {
  const startAt = new Date(`${booking.date}T${booking.time}:00`)
  return {
    bookingId: hashBookingId(booking.id),
    status: OWNER_BOOKING_STATE_CODE[booking.state],
    customerName: booking.customer.name,
    customerPhone: booking.customer.phone,
    note: booking.customer.note || null,
    startAt: startAt.toISOString(),
    endAt: new Date(startAt.getTime() + booking.totalDurationMinutes * 60_000).toISOString(),
    createdAt: startAt.toISOString(),
    updatedAt: startAt.toISOString(),
    payment: {
      status:
        booking.paymentState === 'pending'
          ? 'PENDING'
          : booking.paymentState === 'accepted'
            ? 'ACCEPTED'
            : 'REJECTED',
      method:
        booking.paymentMethod === 'bank-transfer' ? 'BANK_TRANSFER' : 'TELEBIRR_MOBILE_MONEY',
      prepaidMinor: booking.deposit,
    },
    components: booking.lineItems.map((item) => ({
      componentType: 'SERVICE',
      name: item.name,
      unitPriceMinor: item.unitPrice,
      durationMinutes: item.durationMinutes,
    })),
    totalPriceMinor: booking.total,
    history: booking.history.map((entry) => ({
      occurredAt: entry.at,
      fromStatus: entry.previous ? OWNER_BOOKING_STATE_CODE[entry.previous] : null,
      toStatus: OWNER_BOOKING_STATE_CODE[entry.state],
      actorType: 'OWNER',
      actorUserId: null,
      reason: entry.state === 'rejected' ? booking.rejectionReason : null,
    })),
    proofs: [ownerProofViewOf(booking)],
  }
}

/** Deterministic positive surrogate for the numeric backend booking id. */
function hashBookingId(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 1_000_000
  }
  return hash + 1
}

/** A binary proof response, mirroring the streaming download route. */
function ownerProofBinaryResponse(booking: Booking): Response {
  const mimeType = booking.proof.mimeType || 'application/octet-stream'
  return new Response(new Blob([`proof-bytes:${booking.id}`], { type: mimeType }), {
    status: 200,
    headers: {
      'content-type': mimeType,
      'content-disposition': `attachment; filename="${booking.proof.fileName}"`,
      'x-request-id': 'stub-owner-proof',
    },
  })
}

export function installBusinessApiStub(
  delegateTo: typeof fetch = globalThis.fetch,
  options: BusinessApiStubOptions = {},
): BusinessApiStub {
  const calls: RecordedRequest[] = []
  const state = newOwnerState()
  const servicesState = newServicesState()
  let variantSerial = 0
  let exceptionSerial = 0
  const nextVariantId = () => `variant-${++variantSerial}`
  const nextAddOnId = () => `addon-${++variantSerial}`
  // Idempotent submission keys (REQ-121): replay of the same key + same
  // business + same start + same selections replays the original response.
  const idempotentKeys = new Map<
    string,
    { businessSlug: string; startAt: string; signature: string; response: unknown }
  >()
  // One live resubmission code per business+phone (REQ-230). Real codes are
  // random and delivered out-of-band; the double accepts RESUBMISSION_TEST_CODE.
  const resubmissionCodes = new Map<
    string,
    { code: string; used: boolean; expiresAt: number }
  >()
  const takenSlugs = new Set(
    MOCK_BUSINESS_PAGES.map((page) => page.business.slug).filter(
      (slug) => slug !== state.slug,
    ),
  )
  // The owned business's mock-store page is a stale duplicate of the live
  // record (`state`); once its slug changes the old slug must 404, so that page
  // is excluded from the "other demo businesses" public fallback.
  const initialOwnedSlug = state.slug
  // The owned business's schedule lives in the mock store under its ORIGINAL
  // slug (the store is not renamed when the API slug changes); the API-side
  // `state.slug` is the live public slug.
  const storeSlug = initialOwnedSlug
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input.href : String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const rawBody = init?.body
    let body: unknown
    let proofFile: File | null = null
    if (typeof rawBody === 'string') {
      try {
        body = JSON.parse(rawBody)
      } catch {
        body = rawBody
      }
    } else if (typeof FormData !== 'undefined' && rawBody instanceof FormData) {
      // Multipart contract (Prompt 50): the JSON lives in the `payload` text
      // field and the raw bytes in the `proof` file field.
      const payloadText = rawBody.get('payload')
      if (typeof payloadText === 'string') {
        try {
          body = JSON.parse(payloadText)
        } catch {
          body = payloadText
        }
      }
      const file = rawBody.get('proof')
      if (typeof File !== 'undefined' && file instanceof File) proofFile = file
    }
    calls.push({
      method,
      url,
      body,
      proof: proofFile
        ? {
            fileName: proofFile.name,
            sizeBytes: proofFile.size,
            mimeType: proofFile.type,
          }
        : undefined,
    })

    let pathname: string
    try {
      pathname = new URL(url).pathname
    } catch {
      pathname = url
    }
    const segments = pathname.split('/').filter(Boolean)

    if (segments.length >= 3 && segments[0] === 'api' && segments[1] === 'v1') {
      const rest = segments.slice(2)
      if (rest[0] === 'owner' && rest[1] === 'businesses') {
        if (!rest[2]) {
          if (method === 'GET') return json([{ ...state }])
          return envelope(404, 'NOT_FOUND', 'Not found', 'No fetch stub for this owner business route.')
        }
        if (rest[2] !== OWNER_ID) {
          return envelope(404, 'NOT_FOUND', 'Not found', 'Business not found.')
        }
        const action = rest[3]
        if (!action && method === 'GET') return json({ ...state })
        if (action === 'bookings') {
          const forced = options.failOwnerBookingRequest?.({ method, path: pathname })
          if (forced) return forced
          const bookingId = rest[4]
          if (!bookingId) {
            return envelope(404, 'NOT_FOUND', 'Not found', 'No fetch stub for the owner bookings list.')
          }
          const sub = rest[5]
          if (!sub && method === 'GET') {
            const booking = getBooking(storeSlug, bookingId)
            if (!booking) return envelope(404, 'NOT_FOUND', 'Not found', 'Booking not found.')
            return json(ownerBookingDetailViewOf(booking))
          }
          if (sub === 'accept' && method === 'POST') {
            const result = acceptBooking(storeSlug, bookingId)
            if (!result.ok) return envelope(409, 'CONFLICT', 'Conflict', result.error)
            return json(ownerBookingDetailViewOf(result.value))
          }
          if (sub === 'reject' && method === 'POST') {
            const reason =
              typeof (body as { reason?: unknown } | undefined)?.reason === 'string'
                ? (body as { reason: string }).reason
                : ''
            if (!reason.trim()) {
              return validationEnvelope({
                reason: 'Please provide a reason for the rejection.',
              })
            }
            const result = rejectBooking(storeSlug, bookingId, reason)
            if (!result.ok) return envelope(409, 'CONFLICT', 'Conflict', result.error)
            return json(ownerBookingDetailViewOf(result.value))
          }
          if (sub === 'proofs' && method === 'GET') {
            const proofId = rest[6]
            const booking = getBooking(storeSlug, bookingId)
            if (!booking) return envelope(404, 'NOT_FOUND', 'Not found', 'Booking not found.')
            if (proofId !== ownerProofId(booking)) {
              return envelope(404, 'NOT_FOUND', 'Not found', 'Proof not found.')
            }
            return ownerProofBinaryResponse(booking)
          }
          return envelope(404, 'NOT_FOUND', 'Not found', 'No fetch stub for this owner booking route.')
        }
        if (!action && method === 'PATCH') {
          const patch = (body ?? {}) as Record<string, unknown>
          if (typeof patch.name === 'string') state.name = patch.name
          if (typeof patch.description === 'string') state.description = patch.description
          if (typeof patch.address === 'string') state.address = patch.address
          if (typeof patch.phonePublic === 'string') state.phonePublic = patch.phonePublic
          if (patch.categoryCode === 'SALON_AND_BARBER' || patch.categoryCode === 'OTHER') {
            state.category = {
              code: patch.categoryCode,
              label: patch.categoryCode === 'SALON_AND_BARBER' ? 'Salon & Barber' : 'Other',
            }
          }
          if (typeof patch.latitude === 'number') {
            state.coordinates = { ...state.coordinates, latitude: patch.latitude }
          }
          if (typeof patch.longitude === 'number') {
            state.coordinates = { ...state.coordinates, longitude: patch.longitude }
          }
          return json({ ...state })
        }
        if (action === 'slug' && method === 'PATCH') {
          const publicSlug = (body as { publicSlug?: unknown } | undefined)?.publicSlug
          if (typeof publicSlug !== 'string' || takenSlugs.has(publicSlug)) {
            return envelope(409, 'CONFLICT', 'Conflict', 'This public slug is already in use.')
          }
          state.slug = publicSlug
          return json({ ...state })
        }
        if (action === 'pause' && method === 'POST') {
          const pause = (body ?? {}) as { pauseMessage?: unknown; reopenAt?: unknown }
          state.isPaused = true
          state.pauseMessage = typeof pause.pauseMessage === 'string' ? pause.pauseMessage : null
          state.reopenAt = typeof pause.reopenAt === 'string' ? pause.reopenAt : null
          return json({ ...state })
        }
        if (action === 'resume' && method === 'POST') {
          state.isPaused = false
          state.pauseMessage = null
          state.reopenAt = null
          return json({ ...state })
        }
        if (action === 'deactivate' && method === 'POST') {
          state.isDeactivated = true
          return json({ ...state })
        }
        if (action === 'reactivate' && method === 'POST') {
          state.isDeactivated = false
          return json({ ...state })
        }

        if (action === 'services') {
          const serviceId = rest[4]
          if (!serviceId) {
            if (method === 'GET') {
              return json(servicesState.map((s) => ({ ...ownerServiceFromStore(s) })))
            }
            if (method === 'POST') {
              const fields = validateServiceInput(body)
              if (fields) {
                return validationEnvelope(fields)
              }
              const input = body as { name: string; basePriceMinor: number; baseDurationMinutes: number }
              const created: OwnerServiceView = {
                id: `svc-${servicesState.length + 1}`,
                name: input.name.trim(),
                basePriceMinor: input.basePriceMinor,
                baseDurationMinutes: input.baseDurationMinutes,
                isActive: true,
                variations: [],
                addOns: [],
              }
              servicesState.push(created)
              return json(ownerServiceFromStore(created))
            }
            return envelope(404, 'NOT_FOUND', 'Not found', 'No fetch stub for this services route.')
          }
          const svc = servicesState.find((s) => s.id === serviceId)
          if (!svc) {
            return envelope(404, 'NOT_FOUND', 'Not found', 'Service not found.')
          }
          const sub = rest[5]
          if (!sub && method === 'PATCH') {
            const input = (body ?? {}) as Record<string, unknown>
            if (typeof input.name === 'string') svc.name = input.name.trim()
            if (typeof input.basePriceMinor === 'number') svc.basePriceMinor = input.basePriceMinor
            if (typeof input.baseDurationMinutes === 'number') {
              svc.baseDurationMinutes = input.baseDurationMinutes
            }
            return json(ownerServiceFromStore(svc))
          }
          if (sub === 'deactivate' && method === 'POST') {
            svc.isActive = false
            return json(ownerServiceFromStore(svc))
          }
          if (sub === 'reactivate' && method === 'POST') {
            svc.isActive = true
            return json(ownerServiceFromStore(svc))
          }
          if (sub === 'variations' && method === 'POST') {
            const fields = validateVariantInput(body)
            if (fields) return validationEnvelope(fields)
            const input = body as { name: string; priceDeltaMinor: number; durationDeltaMinutes: number }
            svc.variations.push({
              id: nextVariantId(),
              name: input.name.trim(),
              priceDeltaMinor: input.priceDeltaMinor,
              durationDeltaMinutes: input.durationDeltaMinutes,
            })
            return json({ ok: true })
          }
          if (sub === 'addons' && method === 'POST') {
            const fields = validateVariantInput(body)
            if (fields) return validationEnvelope(fields)
            const input = body as { name: string; priceDeltaMinor: number; durationDeltaMinutes: number }
            svc.addOns.push({
              id: nextAddOnId(),
              name: input.name.trim(),
              priceDeltaMinor: input.priceDeltaMinor,
              durationDeltaMinutes: input.durationDeltaMinutes,
            })
            return json({ ok: true })
          }
          return envelope(404, 'NOT_FOUND', 'Not found', 'No fetch stub for this service route.')
        }

        if (action === 'settings' && method === 'PATCH') {
          const input = (body ?? {}) as { bookingIntervalMinutes?: unknown }
          if (typeof input.bookingIntervalMinutes === 'number' && Number.isFinite(input.bookingIntervalMinutes)) {
            state.bookingIntervalMinutes = input.bookingIntervalMinutes
            saveBookingInterval(storeSlug, input.bookingIntervalMinutes)
          }
          return json({ ...state })
        }

        if (action === 'schedule') {
          const sub = rest[4]
          if (sub === 'current' && method === 'GET') {
            return json(currentScheduleView(storeSlug))
          }
          if (sub === 'versions' && method === 'GET') {
            return json(scheduleViewsFor(listScheduleHistory(storeSlug)))
          }
          if (sub === 'conflicts' && method === 'GET') {
            return json(getOpenConflicts(storeSlug).map(conflictViewOf))
          }
          if (sub === 'exceptions' && method === 'POST') {
            const input = (body ?? {}) as { bookingId?: unknown; versionId?: unknown; reason?: unknown }
            if (typeof input.bookingId !== 'string' || typeof input.versionId !== 'string') {
              return envelope(400, 'VALIDATION_ERROR', 'Validation failed', 'bookingId and versionId are required.')
            }
            const result = applyScheduleException(storeSlug, input.bookingId, {
              reason:
                typeof input.reason === 'string' && input.reason.trim()
                  ? input.reason.trim()
                  : null,
              scheduleVersionId: input.versionId,
            })
            if (!result.ok) {
              return envelope(404, 'NOT_FOUND', 'Not found', result.error ?? 'Booking not found.')
            }
            const exception: ScheduleExceptionView = {
              id: `sched-exc-${++exceptionSerial}`,
              scheduleVersionId: input.versionId,
              bookingId: input.bookingId,
              reason: result.value.scheduleException?.reason ?? null,
              createdAt: result.value.scheduleException?.at ?? nowTimestamp(),
            }
            return json(exception)
          }
          if (!sub && method === 'PUT') {
            const payload = body as SaveSchedulePayload
            const intervalMinutes = state.bookingIntervalMinutes
            const snapshot = snapshotFromPayload(storeSlug, payload, intervalMinutes)
            const saved = saveSchedule(storeSlug, snapshot, {
              reason:
                typeof payload.name === 'string' && payload.name.trim()
                  ? payload.name.trim()
                  : undefined,
            })
            const history = listScheduleHistory(storeSlug)
            const versionNo = history.length
            if (!saved.ok) {
              return envelope(
                409,
                'CONFLICT',
                'CONFLICT',
                saved.error ?? 'The schedule could not be saved.',
              )
            }
            return json({
              versionId: saved.value.version.id,
              versionNo,
              activated: saved.value.version.status === 'active',
              version: scheduleViewFromVersion(saved.value.version, versionNo),
            })
          }
          return envelope(404, 'NOT_FOUND', 'Not found', 'No fetch stub for this schedule route.')
        }

        return envelope(404, 'NOT_FOUND', 'Not found', 'No fetch stub for this owner business route.')
      }

      if (rest[0] === 'customer') {
        const action = rest[1]
        if (action === 'bookings' && method === 'POST') {
          const payload = (body ?? {}) as Record<string, unknown>
          const slug = String(payload.businessSlug ?? '')
          const selections = Array.isArray(payload.selections) ? payload.selections : []
          const customerName = String(payload.customerName ?? '')
          const customerPhone = String(payload.customerPhone ?? '')
          const startAtText = String(payload.startAt ?? '')
          const submissionKey = String(payload.submissionKey ?? '')

          const fields: Record<string, string> = {}
          if (!slug.trim() || slug.trim().length < 2) fields.businessSlug = 'Business slug is required.'
          if (selections.length === 0) fields.selections = 'Select at least one service.'
          if (!customerName.trim()) fields.customerName = 'Customer name is required.'
          if (!customerPhone.trim()) fields.customerPhone = 'Customer phone is required.'
          if (!startAtText || Number.isNaN(new Date(startAtText).getTime())) fields.startAt = 'startAt must be a valid ISO datetime.'
          if (!submissionKey.trim()) fields.submissionKey = 'submissionKey is required.'
          if (Object.keys(fields).length > 0) return validationEnvelope(fields)

          const enrichServices =
            state.slug === slug ? servicesState.map((s) => serviceFromOwnerView(s)) : getServices(slug)
          if (enrichServices.length === 0) {
            return envelope(404, 'NOT_FOUND', 'Not found', 'Business not found.')
          }
          const wireSelections: AvailabilitySelection[] = selections.map((sel) => {
            const s = sel as Record<string, unknown>
            return {
              serviceId: String(s.serviceId ?? ''),
              variationId: typeof s.variationId === 'string' ? s.variationId : undefined,
              addOnIds: Array.isArray(s.addOnIds) ? s.addOnIds.map((id) => String(id)) : undefined,
            }
          })
          const totals = computeAppointmentTotals(enrichServices, wireSelections)
          if (!totals.ok) {
            return validationEnvelope(totals.fields ?? {})
          }

          const seqSignature = (sel: AvailabilitySelection) => {
            const addOns = [...(sel.addOnIds ?? [])].sort().join(',')
            return `${sel.serviceId}|${sel.variationId ?? ''}|${addOns}`
          }
          const signature = wireSelections.map(seqSignature).join(';;')
          const existing = idempotentKeys.get(submissionKey)
          if (existing) {
            if (
              existing.businessSlug !== slug ||
              existing.startAt !== startAtText ||
              existing.signature !== signature
            ) {
              return envelope(
                409,
                'CONFLICT',
                'Conflict',
                'This submission key was already used for a different booking request.',
              )
            }
            return json(existing.response)
          }

          // Same first-wins + idempotency contract as the backend: the slot is
          // conceded to whoever claimed it first (existing store bookings), and
          // a mock-only "requested time was taken meanwhile" race is possible.
          const start = new Date(startAtText)
          const [y, mo, d] = [start.getFullYear(), start.getMonth() + 1, start.getDate()]
          const date = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
          const hh = String(start.getHours()).padStart(2, '0')
          const mm = String(start.getMinutes()).padStart(2, '0')
          const time = `${hh}:${mm}`
          const bizSlug = state.slug === slug ? storeSlug : slug
          const business = state.slug === slug ? getBusiness(storeSlug) : getBusiness(slug)

          const race = mockRaceSlot(bizSlug)
          if (race && race.date === date && race.time === time) {
            return envelope(409, 'SLOT_UNAVAILABLE', 'Conflict', 'The requested time is no longer available.')
          }
          const times = computeAvailableTimes(
            business!,
            date,
            totals.durationMinutes,
            getOccupiedBlocks(bizSlug, date),
          )
          if (!times.includes(time)) {
            return envelope(409, 'SLOT_UNAVAILABLE', 'Conflict', 'The requested time is no longer available.')
          }

          const lineItems = buildLineItems(
            enrichServices,
            wireSelections.map((sel) => ({
              serviceId: sel.serviceId,
              variationId: sel.variationId ?? null,
              addOnIds: sel.addOnIds ?? [],
            })),
          )
          const total = totalPrice(lineItems)
          const deposit = prepaymentAmount(business!.prepayment, total) ?? 0
          // Backend rule (REQ-117/118): a deposit-bearing booking must carry a
          // valid proof; the server is authoritative and re-validates content.
          if (deposit > 0 && !proofFile) {
            return validationEnvelope({ proof: 'A proof file is required.' })
          }
          const created = createBookingEntry({
            businessSlug: bizSlug,
            lineItems: lineItems.map((item) => ({
              name: item.name,
              unitPrice: item.unitPrice,
              durationMinutes: item.durationMinutes,
            })),
            total,
            totalDurationMinutes: totalDurationMinutes(lineItems),
            deposit,
            customer: { name: customerName, phone: customerPhone, note: String(payload.note ?? '') },
            date,
            time,
            paymentMethod: String(payload.paymentMethod ?? 'bank-transfer') as 'bank-transfer',
            proof: proofFile
              ? {
                  fileName: proofFile.name,
                  sizeBytes: proofFile.size,
                  mimeType: proofFile.type,
                }
              : {
                  fileName: 'proof.png',
                  sizeBytes: 1024,
                  mimeType: 'image/png',
                },
          })
          if (!created.ok) {
            return envelope(409, 'SLOT_UNAVAILABLE', 'Conflict', 'The requested time is no longer available.')
          }

          const response = {
            status: 'awaiting-verification',
            startAt: new Date(
              start.getFullYear(),
              start.getMonth(),
              start.getDate(),
              start.getHours(),
              start.getMinutes(),
            ).toISOString(),
            endAt: new Date(
              start.getTime() + totalDurationMinutes(lineItems) * 60_000,
            ).toISOString(),
            serviceNames: lineItems.map((item) => item.name),
            businessSlug: slug,
            totalPriceMinor: total,
            prepaidMinor: deposit,
            paymentMethod: String(payload.paymentMethod ?? 'BANK_TRANSFER'),
            note: String(payload.note ?? '') || null,
          }
          idempotentKeys.set(submissionKey, {
            businessSlug: slug,
            startAt: startAtText,
            signature,
            response,
          })
          return json(response)
        }

        if (action === 'status' && method === 'GET') {
          const searchParams = new URL(url, 'http://localhost').searchParams
          const slugParam = searchParams.get('slug')
          const phoneParam = searchParams.get('phone') ?? ''
          if (!slugParam) {
            return envelope(400, 'VALIDATION_ERROR', 'Validation failed', 'slug is required.')
          }
          if (state.slug !== slugParam && !getBusiness(slugParam)) {
            return envelope(404, 'NOT_FOUND', 'Not found', 'Business not found.')
          }
          const bizSlug = state.slug === slugParam ? storeSlug : slugParam
          const storeBookings = getBookingsByPhone(bizSlug, phoneParam)
          return json({
            bookings: storeBookings.map((booking) => {
              const start = new Date()
              const [yy, moo, dd] = booking.date.split('-').map(Number)
              const [hhh, mmm] = booking.time.split(':').map(Number)
              start.setFullYear(yy, moo - 1, dd)
              start.setHours(hhh, mmm, 0, 0)
              return {
                startAt: start.toISOString(),
                endAt: new Date(
                  start.getTime() + booking.totalDurationMinutes * 60_000,
                ).toISOString(),
                status:
                  booking.state === 'payment-pending'
                    ? 'awaiting-verification'
                    : booking.state,
              }
            }),
          })
        }

        if (action === 'resubmission' && method === 'POST') {
          const sub = rest[2]
          const payload = (body ?? {}) as Record<string, unknown>
          const slug = String(payload.businessSlug ?? '')
          const phone = String(payload.phone ?? '')
          const bizSlug = state.slug === slug ? storeSlug : slug
          const known =
            state.slug === slug || Boolean(getBusiness(slug))

          if (sub === 'request-code') {
            const fields: Record<string, string> = {}
            if (!slug.trim() || slug.trim().length < 2) fields.businessSlug = 'Business slug is required.'
            if (!phone.trim()) fields.phone = 'Phone number is required.'
            if (Object.keys(fields).length > 0) return validationEnvelope(fields)
            if (!known) {
              return envelope(404, 'NOT_FOUND', 'Not found', 'Business not found.')
            }
            if (!latestRejectedFor(bizSlug, phone)) {
              return envelope(404, 'NOT_FOUND', 'Not found', 'Booking not found.')
            }
            const expiresAt = Date.now() + 10 * 60 * 1000
            resubmissionCodes.set(`${slug}|${phone}`, {
              code: RESUBMISSION_TEST_CODE,
              used: false,
              expiresAt,
            })
            return json({ expiresAt: new Date(expiresAt).toISOString() })
          }

          if (sub === 'verify') {
            const code = String(payload.code ?? '')
            const submissionKey = String(payload.submissionKey ?? '')
            const fields: Record<string, string> = {}
            if (!slug.trim() || slug.trim().length < 2) fields.businessSlug = 'Business slug is required.'
            if (!phone.trim()) fields.phone = 'Phone number is required.'
            if (!/^\d{6}$/.test(code)) fields.code = 'Verification code must be exactly 6 digits.'
            if (!submissionKey.trim()) fields.submissionKey = 'submissionKey is required.'
            if (Object.keys(fields).length > 0) return validationEnvelope(fields)
            if (!known) {
              return envelope(404, 'NOT_FOUND', 'Not found', 'Business not found.')
            }
            const entry = resubmissionCodes.get(`${slug}|${phone}`)
            if (!entry || entry.used || Date.now() > entry.expiresAt || code !== entry.code) {
              return validationEnvelope(
                { code: 'The provided verification code is invalid.' },
                'The verification code is invalid.',
              )
            }
            if (!proofFile) {
              return validationEnvelope({ proof: 'A proof file is required.' })
            }
            const rejected = latestRejectedFor(bizSlug, phone)
            if (!rejected) {
              return envelope(404, 'NOT_FOUND', 'Not found', 'Booking not found.')
            }
            const result = resubmitRejectedProof(bizSlug, rejected.id, {
              fileName: proofFile.name,
              sizeBytes: proofFile.size,
              mimeType: proofFile.type,
            })
            if (!result.ok) {
              return envelope(404, 'NOT_FOUND', 'Not found', result.error ?? 'Booking not found.')
            }
            entry.used = true
            return json({
              booking: customerBookingViewOf(result.value, slug),
              outcome: 'PROOF_RECEIVED',
            })
          }

          return envelope(404, 'NOT_FOUND', 'Not found', 'No fetch stub for this resubmission route.')
        }

        return envelope(404, 'NOT_FOUND', 'Not found', 'No fetch stub for this customer route.')
      }

      if (rest[0] === 'public' && rest[1] === 'businesses' && rest[2]) {
        if (method === 'GET') {
          if (rest[3] === 'schedule') {
            if (state.slug === rest[2]) return json(publicScheduleViewFor(storeSlug))
            // A renamed owner business has no store page under its old slug.
            const exists =
              rest[2] === initialOwnedSlug ? undefined : getBusiness(rest[2])
            if (!exists) {
              return envelope(404, 'NOT_FOUND', 'Not found', 'Business not found.')
            }
            return json(publicScheduleViewFor(rest[2]))
          }
          if (rest[3] === 'services') {
            if (state.slug === rest[2]) {
              return json(servicesState.filter((s) => s.isActive).map((s) => publicServiceFromOwner(s)))
            }
            if (rest[2] === initialOwnedSlug) {
              return envelope(404, 'NOT_FOUND', 'Not found', 'Business not found.')
            }
            const storeServices = getServices(rest[2])
            if (!getBusiness(rest[2]) || storeServices.length === 0) {
              return envelope(404, 'NOT_FOUND', 'Not found', 'Business not found.')
            }
            return json(storeServices.filter((s) => s.isActive).map(ownerServiceFromStore).map((s) => publicServiceFromOwner(s)))
          }
          if (state.slug === rest[2]) return json(publicViewOf(state))
          const other =
            rest[2] === initialOwnedSlug ? undefined : publicViewFromStore(rest[2])
          if (other) return json(other)
          return envelope(404, 'NOT_FOUND', 'Not found', 'Business not found.')
        }

        if (rest[3] === 'availability' && method === 'POST') {
          if (rest[2] === initialOwnedSlug && !getBusiness(rest[2])) {
            return envelope(404, 'NOT_FOUND', 'Not found', 'Business not found.')
          }
          const business = state.slug === rest[2] ? getBusiness(storeSlug) : getBusiness(rest[2])
          if (!business) {
            return envelope(404, 'NOT_FOUND', 'Not found', 'Business not found.')
          }
          const body = (init?.body ?? '{}') as string
          const parsed = JSON.parse(body) as { date?: unknown; selections?: unknown }
          if (typeof parsed.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
            return envelope(422, 'VALIDATION_ERROR', 'Validation failed', 'date must be a YYYY-MM-DD date string.')
          }
          if (options.failAvailabilityFor?.(parsed.date)) {
            return envelope(500, 'SERVER_ERROR', 'Server error', 'Availability could not be loaded.')
          }
          const selections = parsed.selections
          if (!Array.isArray(selections) || selections.length === 0) {
            return envelope(422, 'VALIDATION_ERROR', 'Validation failed', 'selections must not be empty.')
          }
          const wireSelections: AvailabilitySelection[] = selections.map((sel) => {
            const s = sel as Record<string, unknown>
            return {
              serviceId: String(s.serviceId ?? ''),
              variationId: typeof s.variationId === 'string' ? s.variationId : undefined,
              addOnIds: Array.isArray(s.addOnIds) ? s.addOnIds.map((id) => String(id)) : undefined,
            }
          })
          const enrichServices =
            state.slug === rest[2]
              ? servicesState.map((s) => serviceFromOwnerView(s))
              : getServices(rest[2])
          const totals = computeAppointmentTotals(enrichServices, wireSelections)
          if (!totals.ok) {
            return validationEnvelope(totals.fields ?? {})
          }
          const date = String(parsed.date)
          const times = computeAvailableTimes(
            business,
            date,
            totals.durationMinutes,
            getOccupiedBlocks(rest[2], date),
          )
          return json({
            date,
            slots: times.map((time) => slotInstants(date, time, totals.durationMinutes)),
            computedDurationMinutes: totals.durationMinutes,
            computedTotalPriceMinor: totals.totalPriceMinor,
          })
        }

        return envelope(404, 'NOT_FOUND', 'Not found', 'No fetch stub for this public route.')
      }
    }

    return delegateTo(input, init)
  }) as typeof fetch

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch
    },
  }
}