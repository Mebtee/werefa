import type {
  BlockedPeriod,
  Booking,
  BookingLineSnapshot,
  BookingState,
  BusinessDetails,
  BusinessPage,
  CustomerDetails,
  CustomerNotificationType,
  CustomerTelegramNotification,
  DateString,
  Money,
  PauseState,
  PaymentMethodId,
  ProofFile,
  ScheduleConflict,
  ScheduleConflictAction,
  ScheduleSnapshot,
  ScheduleVersion,
  ScheduleVersionStatus,
  Service,
  ServiceAddOn,
  ServiceVariation,
  SpecialDay,
  TimeOfDay,
  Timestamp,
  WeeklyWorkingHours,
} from '@/types/models'
import { buildPages } from '@/mock/data'
import { buildDemoBookings } from '@/mock/seedBookings'
import { computeAvailableTimes, periodsForSchedule } from '@/mock/availability'
import { minutesOf, nowTimestamp } from '@/lib/time'
import { normalizePhoneForMatch } from '@/lib/validation'
import {
  MOCK_OWNER_ACTOR_NAME,
  resetMockOwnedBusinessSlug,
} from '@/mock/ownedBusinessFixture'

/**
 * In-memory mock store — the single source of truth for business data in this
 * phase (mock repository boundary).
 *
 * Both the public booking surface and the owner portal read and write through
 * this store, so owner edits are immediately reflected on the public page
 * without a second copy of the data. It is deliberately mutable: the real
 * backend (later phase) replaces this module, not the UI.
 *
 * `resetStore()` restores the pristine seed data and is used by tests.
 */

export const PUBLIC_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{3,62}[a-z0-9]$/

interface StorePage {
  business: BusinessDetails
  services: Service[]
}

let pages: StorePage[]
let bookings: Booking[]

/**
 * Retained schedule versions (REQ-162): every saved schedule state is kept as
 * a version so the owner can see who changed what, when and why (REQ-163).
 * Automatic changes (e.g. resume-applied schedules) use the System actor with
 * an automatic reason (REQ-165). Paused-period saves are stored as "pending"
 * until resume promotes the latest one to active (REQ-150/151/152).
 */
let scheduleVersions: ScheduleVersion[]

/**
 * Open/resolved schedule conflicts between the active schedule and live
 * bookings (REQ-091/092/099). Schedule changes are warned, never blocked; each
 * affected booking is listed and the owner resolves it with Reschedule /
 * Cancel / Keep Booking.
 */
let scheduleConflicts: ScheduleConflict[]

/**
 * Mock customer Telegram connection state, keyed per business + normalized
 * phone (canonical: "the connection is per business and per phone", §18).
 * Telegram is optional for customers (REQ-056): the default — a phone that was
 * never connected — is "not connected". This is development-only state for
 * exercising notification behavior; there is no real Telegram authorization.
 */
const customerTelegramConnections = new Map<string, boolean>()

/** Deterministic, append-only notification event ids (`ntf-1`, `ntf-2`, …). */
let telegramNoticeSeq = 0

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8)
  const stamp = Date.now().toString(36).slice(-3)
  return `${prefix}-${rand}${stamp}`
}

function shiftTime(time: TimeOfDay, minutes: number): TimeOfDay {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + minutes
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function seed(): void {
  pages = buildPages().map((page: BusinessPage) => ({
    business: page.business,
    services: page.services.map((service) => ({
      ...service,
      variations: service.variations.map((v) => ({ ...v })),
      addOns: service.addOns.map((a) => ({ ...a })),
    })),
  }))
  bookings = [...buildDemoBookings()]
  scheduleVersions = []
  scheduleConflicts = []
  customerTelegramConnections.clear()
  telegramNoticeSeq = 0
  // The mock domain data always represents the primary business. Rebuilding the
  // store must realign it, or a changed public link from an earlier
  // test/state would leave the portal pointing at a business that no longer
  // exists under the old slug.
  resetMockOwnedBusinessSlug()
}

seed()

export function resetStore(): void {
  seed()
}

export function getPage(slug: string): StorePage | undefined {
  return pages.find((page) => page.business.slug === slug)
}

export function getBusinessPage(slug: string): BusinessPage | undefined {
  const page = getPage(slug)
  return page ? { business: page.business, services: page.services } : undefined
}

export function getBusiness(slug: string): BusinessDetails | undefined {
  return getPage(slug)?.business
}

export function getServices(slug: string): readonly Service[] {
  return getPage(slug)?.services ?? []
}

export type StoreResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; error: string }

function missing(): { ok: false; error: 'Business not found.' } {
  return { ok: false, error: 'Business not found.' }
}

export function updateBusiness(
  slug: string,
  patch: Partial<BusinessDetails>,
): StoreResult<BusinessDetails> {
  const page = getPage(slug)
  if (!page) return missing()
  page.business = { ...page.business, ...patch }
  return { ok: true, value: page.business }
}

/** Validates a custom public link (REQ-048). */
export function validatePublicSlug(slug: string): string | null {
  if (!PUBLIC_SLUG_PATTERN.test(slug)) {
    return 'Use 5–64 characters: lowercase letters, numbers and single hyphens, no leading or trailing dash.'
  }
  return null
}

export function isSlugTakenByOther(slug: string, current: string): boolean {
  return pages.some((page) => page.business.slug === slug && slug !== current)
}

export function changeBusinessSlug(
  slug: string,
  next: string,
): StoreResult<string> {
  const invalid = validatePublicSlug(next)
  if (invalid) return { ok: false, error: invalid }
  const page = getPage(slug)
  if (!page) return missing()
  if (next === slug) return { ok: true, value: slug }
  if (isSlugTakenByOther(next, slug)) {
    return { ok: false, error: 'That public link is already taken by another business.' }
  }
  page.business = { ...page.business, slug: next }
  return { ok: true, value: next }
}

export interface NewServiceInput {
  id?: string
  name: string
  basePriceMinor: number
  baseDurationMinutes: number
  variations?: readonly ServiceVariation[]
  addOns?: readonly ServiceAddOn[]
}

export function createService(
  slug: string,
  input: NewServiceInput,
): StoreResult<Service> {
  const page = getPage(slug)
  if (!page) return missing()
  const service: Service = {
    id: input.id ?? makeId('svc'),
    name: input.name,
    basePriceMinor: input.basePriceMinor,
    baseDurationMinutes: input.baseDurationMinutes,
    variations: input.variations ? input.variations.map((v) => ({ ...v })) : [],
    addOns: input.addOns ? input.addOns.map((a) => ({ ...a })) : [],
    isActive: true,
  }
  page.services = [...page.services, service]
  return { ok: true, value: service }
}

export function updateService(
  slug: string,
  serviceId: string,
  patch: Partial<Service>,
): StoreResult<Service> {
  const page = getPage(slug)
  if (!page) return missing()
  const index = page.services.findIndex((s) => s.id === serviceId)
  if (index < 0) return { ok: false, error: 'Service not found.' }
  const next: Service = { ...page.services[index], ...patch }
  page.services = [
    ...page.services.slice(0, index),
    next,
    ...page.services.slice(index + 1),
  ]
  return { ok: true, value: next }
}

export function setServiceActive(
  slug: string,
  serviceId: string,
  active: boolean,
): StoreResult<Service> {
  return updateService(slug, serviceId, { isActive: active })
}

export function saveWorkingHours(
  slug: string,
  workingHours: WeeklyWorkingHours,
): StoreResult<BusinessDetails> {
  return updateBusiness(slug, { workingHours })
}

export function saveBookingInterval(
  slug: string,
  bookingIntervalMinutes: number,
): StoreResult<BusinessDetails> {
  return updateBusiness(slug, { bookingIntervalMinutes })
}

export function saveSpecialDays(
  slug: string,
  specialDays: Readonly<Record<DateString, SpecialDay>>,
): StoreResult<BusinessDetails> {
  return updateBusiness(slug, { specialDays })
}

export function setPause(slug: string, pause: PauseState): StoreResult<BusinessDetails> {
  const business = getBusiness(slug)
  if (!business) return missing()
  const result = updateBusiness(slug, { pause })
  if (result.ok && pause === null) {
    // REQ-150/151/152: changes made while paused were stored as pending
    // versions; resuming promotes the latest one to active.
    promotePendingSchedule(slug)
  }
  return result
}

/* ---------------------------------------------------------------------------
 * Schedule versions, conflicts and blocked-period management (REQ-084/085,
 * REQ-090…REQ-099, REQ-150…REQ-152, REQ-162…REQ-169)
 * ------------------------------------------------------------------------- */

/** The full saved schedule state of a business (REQ-162's "saved schedule state"). */
export function scheduleSnapshotOf(business: BusinessDetails): ScheduleSnapshot {
  return {
    workingHours: business.workingHours,
    bookingIntervalMinutes: business.bookingIntervalMinutes,
    blockedDays: business.blockedDays,
    blockedPeriods: business.blockedPeriods,
    specialDays: business.specialDays,
  }
}

export interface SaveScheduleOptions {
  /** Owner-entered reason; optional (REQ-164). */
  reason?: string
}

export interface SaveScheduleResult {
  business: BusinessDetails
  version: ScheduleVersion
  /** Conflicts detected for the active save (REQ-092). Empty while paused. */
  conflicts: readonly ScheduleConflict[]
}

/**
 * The single owner save path for the whole schedule. Records a retained
 * version (REQ-162), applies the state to the business the public page reads,
 * and — for active saves — detects and records affected-booking conflicts
 * (REQ-091/092). While paused the save is stored as a pending version
 * (REQ-150) and activates on resume (REQ-151); no conflicts are warned yet
 * because the public page is closed (REQ-147).
 */
export function saveSchedule(
  slug: string,
  snapshot: ScheduleSnapshot,
  opts: SaveScheduleOptions = {},
): StoreResult<SaveScheduleResult> {
  const business = getBusiness(slug)
  if (!business) return missing()

  const paused = business.pause !== null
  applySnapshot(slug, snapshot)
  const version = recordScheduleVersion(slug, snapshot, {
    actor: MOCK_OWNER_ACTOR_NAME,
    reason: opts.reason?.trim() || null,
    automatic: false,
    status: paused ? 'pending' : 'active',
  })

  if (paused) {
    return { ok: true, value: { business: getBusiness(slug)!, version, conflicts: [] } }
  }
  return {
    ok: true,
    value: { business: getBusiness(slug)!, version, conflicts: recordConflictsForSchedule(slug, version) },
  }
}

function applySnapshot(slug: string, snapshot: ScheduleSnapshot): void {
  const page = getPage(slug)
  if (!page) return
  page.business = {
    ...page.business,
    workingHours: snapshot.workingHours,
    bookingIntervalMinutes: snapshot.bookingIntervalMinutes,
    blockedDays: snapshot.blockedDays,
    blockedPeriods: snapshot.blockedPeriods,
    specialDays: snapshot.specialDays,
  }
}

function recordScheduleVersion(
  slug: string,
  snapshot: ScheduleSnapshot,
  meta: {
    actor: string
    reason: string | null
    automatic: boolean
    status: ScheduleVersionStatus
  },
): ScheduleVersion {
  if (meta.status === 'active') {
    for (const version of scheduleVersions) {
      if (version.businessSlug === slug && version.status === 'active') {
        version.status = 'superseded'
      }
    }
  }
  const version: ScheduleVersion = {
    id: makeId('sch-v'),
    businessSlug: slug,
    snapshot,
    actor: meta.actor,
    reason: meta.reason,
    automatic: meta.automatic,
    at: nowTimestamp(),
    status: meta.status,
  }
  scheduleVersions = [...scheduleVersions, version]
  return version
}

/**
 * Detects bookings affected by a schedule save and records an open conflict
 * for each (REQ-092/093). Only live, slot-holding bookings count: confirmed and
 * payment-pending ones (terminal/no-show/released slots cannot "conflict").
 * A booking the owner already approved as a Schedule Exception (REQ-160) is
 * exempt — the label and reason already record the owner's explicit decision,
 * so later saves must not nag again about the same booking.
 */
export function recordConflictsForSchedule(
  slug: string,
  version: ScheduleVersion,
): readonly ScheduleConflict[] {
  const created: ScheduleConflict[] = []
  const affected = bookings.filter(
    (b) =>
      b.businessSlug === slug &&
      (b.state === 'confirmed' || b.state === 'payment-pending') &&
      b.scheduleException === null,
  )
  for (const booking of affected) {
    const reason = conflictReasonFor(version.snapshot, booking)
    if (reason === null) continue
    const conflict: ScheduleConflict = {
      id: makeId('cnf'),
      businessSlug: slug,
      versionId: version.id,
      bookingId: booking.id,
      reason,
      status: 'open',
      action: null,
      at: nowTimestamp(),
    }
    scheduleConflicts = [...scheduleConflicts, conflict]
    created.push(conflict)
  }
  return created
}

/**
 * Why a booking no longer fits the given schedule, or null when it still fits
 * (REQ-093: the warning identifies the affected booking, date/time and reason).
 */
function conflictReasonFor(
  snapshot: ScheduleSnapshot,
  booking: Booking,
): string | null {
  const start = minutesOf(booking.time)
  const end = start + booking.totalDurationMinutes
  const periods = periodsForSchedule(snapshot, booking.date)
  if (periods.length === 0) {
    return `The business is closed on ${booking.date}.`
  }
  const blockedOverlap = snapshot.blockedPeriods.some((block) => {
    if (block.date !== booking.date) return false
    const bs = minutesOf(block.start)
    const be = minutesOf(block.end)
    return start < be && bs < end
  })
  if (blockedOverlap) {
    return `A blocked period overlaps the appointment on ${booking.date}.`
  }
  const fits = periods.some(
    (period) => minutesOf(period.start) <= start && end <= minutesOf(period.end),
  )
  if (!fits) {
    return `Working hours on ${booking.date} no longer cover the full appointment.`
  }
  return null
}

/** Retained schedule versions for a business, newest first (REQ-162/166). */
export function listScheduleHistory(slug: string): readonly ScheduleVersion[] {
  // Versions are appended in creation order, so the newest is the last match;
  // reverse the (already filtered) copy instead of relying on minute-precision
  // timestamps that can tie within the same minute.
  return scheduleVersions.filter((version) => version.businessSlug === slug).reverse()
}

/** Open conflicts for a business (REQ-092: warns until the owner resolves). */
export function getOpenConflicts(slug: string): readonly ScheduleConflict[] {
  return scheduleConflicts.filter(
    (conflict) => conflict.businessSlug === slug && conflict.status === 'open',
  )
}

/** All conflicts (open + resolved) for a business, for audit/tests. */
export function getScheduleConflicts(slug: string): readonly ScheduleConflict[] {
  return scheduleConflicts.filter((conflict) => conflict.businessSlug === slug)
}

function resolveConflictsForBooking(
  slug: string,
  bookingId: string,
  action: ScheduleConflictAction,
): void {
  scheduleConflicts = scheduleConflicts.map((conflict) =>
    conflict.businessSlug === slug &&
    conflict.bookingId === bookingId &&
    conflict.status === 'open'
      ? { ...conflict, status: 'resolved', action }
      : conflict,
  )
}

/**
 * REQ-150/151/152 + REQ-165: on resume, the latest pending schedule becomes the
 * active schedule and the promotion is recorded as an automatic System change.
 */
function promotePendingSchedule(slug: string): void {
  const pending = scheduleVersions.filter(
    (version) => version.businessSlug === slug && version.status === 'pending',
  )
  if (pending.length === 0) return
  const latest = pending[pending.length - 1]
  applySnapshot(slug, latest.snapshot)
  for (const version of scheduleVersions) {
    if (version.businessSlug === slug && version.status === 'pending') {
      version.status = 'superseded'
    }
  }
  const version = recordScheduleVersion(slug, latest.snapshot, {
    actor: 'System',
    reason: 'Schedule applied on resume.',
    automatic: true,
    status: 'active',
  })
  recordConflictsForSchedule(slug, version)
}

/**
 * REQ-159/160/161 — Keep Booking: the booking stays intact and becomes an
 * approved booking-specific schedule exception, labeled with the owner's
 * reason/details. It persists after the appointment completes, never alters
 * the normal schedule, and issues no customer notification. The decision is
 * recorded in the booking's audit history.
 *
 * Only a booking affected by an open schedule conflict can be kept (REQ-159):
 * the exception is attributed to the schedule version that caused the conflict
 * and cannot be created arbitrarily for an unaffected booking.
 */
export function keepBooking(
  slug: string,
  id: string,
  reason: string,
): StoreResult<Booking> {
  const booking = getBooking(slug, id)
  if (!booking) return { ok: false, error: 'Booking not found.' }
  if (booking.state !== 'confirmed' && booking.state !== 'payment-pending') {
    return { ok: false, error: 'Only a live booking affected by a schedule change can be kept.' }
  }
  const open = scheduleConflicts.find(
    (conflict) =>
      conflict.businessSlug === slug &&
      conflict.bookingId === id &&
      conflict.status === 'open',
  )
  if (!open) {
    return { ok: false, error: 'Only a booking affected by an open schedule conflict can be kept.' }
  }
  booking.scheduleException = {
    at: nowTimestamp(),
    reason: (reason ?? '').trim() || 'Kept as a schedule exception.',
    scheduleVersionId: open.versionId,
  }
  booking.updatedAt = nowTimestamp()
  recordTransition(booking, booking.state, booking.state)
  resolveConflictsForBooking(slug, id, 'keep')
  return { ok: true, value: booking }
}

/**
 * Prompt 47 seam: records a booking-specific schedule exception that was
 * created through the REAL schedule API (`POST …/schedule/exceptions`) onto
 * the still-mock booking record, so the mock bookings vertical keeps showing
 * the Schedule Exception badge, its details and the causing version link. This
 * is the mirror counterpart of `keepBooking` for the migrated Keep-Booking
 * flow; it deliberately does not require a mock-store open conflict.
 */
export function applyScheduleException(
  slug: string,
  id: string,
  params: { reason: string | null; scheduleVersionId: string },
): StoreResult<Booking> {
  const booking = getBooking(slug, id)
  if (!booking) return { ok: false, error: 'Booking not found.' }
  booking.scheduleException = {
    at: nowTimestamp(),
    reason: (params.reason ?? '').trim() || 'Kept as a schedule exception.',
    scheduleVersionId: params.scheduleVersionId,
  }
  booking.updatedAt = nowTimestamp()
  recordTransition(booking, booking.state, booking.state)
  resolveConflictsForBooking(slug, id, 'keep')
  return { ok: true, value: booking }
}

/** Block a whole day (REQ-085). Idempotent. */
export function addBlockedDay(slug: string, date: DateString): StoreResult<BusinessDetails> {
  const business = getBusiness(slug)
  if (!business) return missing()
  if (business.blockedDays.includes(date)) return { ok: true, value: business }
  return updateBusiness(slug, { blockedDays: [...business.blockedDays, date] })
}

/** Unblock a whole day. */
export function removeBlockedDay(slug: string, date: DateString): StoreResult<BusinessDetails> {
  const business = getBusiness(slug)
  if (!business) return missing()
  return updateBusiness(slug, {
    blockedDays: business.blockedDays.filter((d) => d !== date),
  })
}

/** Block a specific period (REQ-084). Idempotent. */
export function addBlockedPeriod(
  slug: string,
  period: BlockedPeriod,
): StoreResult<BusinessDetails> {
  const business = getBusiness(slug)
  if (!business) return missing()
  const duplicate = business.blockedPeriods.some(
    (block) => block.date === period.date && block.start === period.start && block.end === period.end,
  )
  if (duplicate) return { ok: true, value: business }
  return updateBusiness(slug, { blockedPeriods: [...business.blockedPeriods, period] })
}

/** Unblock a specific period. */
export function removeBlockedPeriod(
  slug: string,
  date: DateString,
  start: TimeOfDay,
  end: TimeOfDay,
): StoreResult<BusinessDetails> {
  const business = getBusiness(slug)
  if (!business) return missing()
  return updateBusiness(slug, {
    blockedPeriods: business.blockedPeriods.filter(
      (block) => !(block.date === date && block.start === start && block.end === end),
    ),
  })
}

/* ---------------------------------------------------------------------------
 * Bookings
 *
 * The bookings live in the same in-memory store both sides consume: the public
 * flow creates them (T1) and the owner portal reviews them (T2/T3). The slot
 * lock has no TTL; a booking blocks its slot until `slotReleased` is set by
 * the allowed lifecycle action (REQ-121/REQ-123, OQ-SLOT-001).
 * ------------------------------------------------------------------------- */

function bookingBlock(booking: Booking): {
  date: DateString
  start: TimeOfDay
  end: TimeOfDay
} {
  return {
    date: booking.date,
    start: booking.time,
    end: shiftTime(booking.time, booking.totalDurationMinutes),
  }
}

/** Blocks held by live (not slot-released) bookings of a business on a date. */
export function getOccupiedBlocks(
  slug: string,
  date: DateString,
): readonly { date: DateString; start: TimeOfDay; end: TimeOfDay }[] {
  return bookings
    .filter((b) => b.businessSlug === slug && !b.slotReleased && b.date === date)
    .map(bookingBlock)
}

/** All bookings of a business, newest first (owner queue, REQ-175). */
export function listBookings(slug: string): readonly Booking[] {
  return bookings
    .filter((b) => b.businessSlug === slug)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export function getBooking(slug: string, id: string): Booking | undefined {
  return bookings.find(
    (b) => b.businessSlug === slug && b.id === id,
  )
}

/**
 * Customer status lookup (REQ-109): every booking of a business whose stored
 * phone number matches the given one, newest first (same ordering convention
 * as the owner queue, REQ-187). Scoped to `slug` — a phone number alone never
 * surfaces another business's bookings. Phone numbers are normalized on both
 * sides so formatting differences (spaces, hyphens, "+") do not cause a miss.
 */
export function getBookingsByPhone(
  slug: string,
  phone: string,
): readonly Booking[] {
  const normalized = normalizePhoneForMatch(phone)
  return bookings
    .filter(
      (b) =>
        b.businessSlug === slug &&
        normalizePhoneForMatch(b.customer.phone) === normalized,
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export function countBookingsOn(slug: string, date: DateString): number {
  return bookings.filter(
    (b) => b.businessSlug === slug && b.date === date,
  ).length
}

export interface CreateBookingInput {
  businessSlug: string
  lineItems: readonly BookingLineSnapshot[]
  total: Money
  totalDurationMinutes: number
  deposit: Money
  customer: CustomerDetails
  date: DateString
  time: TimeOfDay
  paymentMethod: PaymentMethodId
  proof: ProofFile
}

/**
 * Authoritative slot claim (mirrors REQ-121 / T1). Re-checks the live slot
 * inside the store boundary and creates exactly one booking when the slot is
 * free; otherwise returns "unavailable" and records nothing. Since the claim
 * problem is single-threaded in the mock, the re-check is the atomic winner:
 * the first successful submission owns the slot.
 */
export function createBookingEntry(
  input: CreateBookingInput,
): { ok: true; booking: Booking } | { ok: false; error: 'unavailable' } {
  const business = getBusiness(input.businessSlug)
  if (!business) return { ok: false, error: 'unavailable' }

  const free = computeAvailableTimes(
    business,
    input.date,
    input.totalDurationMinutes,
    getOccupiedBlocks(input.businessSlug, input.date),
  )
  if (!free.includes(input.time)) return { ok: false, error: 'unavailable' }

  const at: Timestamp = nowTimestamp()
  const booking: Booking = {
    id: makeId('bk'),
    businessSlug: input.businessSlug,
    state: 'payment-pending',
    paymentState: 'pending',
    lineItems: input.lineItems,
    total: input.total,
    totalDurationMinutes: input.totalDurationMinutes,
    deposit: input.deposit,
    date: input.date,
    time: input.time,
    customer: input.customer,
    paymentMethod: input.paymentMethod,
    proof: input.proof,
    rejectionReason: null,
    createdAt: at,
    updatedAt: at,
    history: [
      { state: 'payment-pending', previous: null, actor: 'Customer', at },
    ],
    telegramNotices: [],
    slotReleased: false,
    scheduleException: null,
  }
  bookings = [...bookings, booking]
  // T1 same-step side effect: proof-received / verification-pending notice
  // (N01 = REQ-060), only when the customer is connected to Telegram.
  noticeIfConnected(booking, 'payment-proof-received', {
    message: 'Your payment proof has been received and is awaiting review.',
    at,
  })
  return { ok: true, booking }
}

function recordTransition(
  booking: Booking,
  next: BookingState,
  previous: BookingState,
  opts: { actor?: string; at?: Timestamp } = {},
): void {
  booking.history = [
    ...booking.history,
    {
      state: next,
      previous,
      actor: opts.actor ?? MOCK_OWNER_ACTOR_NAME,
      at: opts.at ?? nowTimestamp(),
    },
  ]
}

/** T2 — owner accepts the proof: Payment Pending → Confirmed, Pending → Accepted. */
export function acceptBooking(slug: string, id: string): StoreResult<Booking> {
  const booking = getBooking(slug, id)
  if (!booking) return { ok: false, error: 'Booking not found.' }
  if (booking.state !== 'payment-pending') {
    return { ok: false, error: 'Only a Payment Pending booking can be accepted.' }
  }
  booking.state = 'confirmed'
  booking.paymentState = 'accepted'
  booking.updatedAt = nowTimestamp()
  recordTransition(booking, 'confirmed', 'payment-pending')
  // T2: confirmation notice (N02 = REQ-061), customer Telegram only.
  noticeIfConnected(booking, 'booking-confirmed', {
    message: 'Your booking is confirmed.',
  })
  return { ok: true, value: booking }
}

/** T3 — owner rejects (reason required): Payment Pending → Rejected, -> Rejected. */
export function rejectBooking(
  slug: string,
  id: string,
  reason: string,
): StoreResult<Booking> {
  const trimmed = reason.trim()
  if (!trimmed) {
    return { ok: false, error: 'Please provide a reason for the rejection.' }
  }
  const booking = getBooking(slug, id)
  if (!booking) return { ok: false, error: 'Booking not found.' }
  if (booking.state !== 'payment-pending') {
    return { ok: false, error: 'Only a Payment Pending booking can be rejected.' }
  }
  booking.state = 'rejected'
  booking.paymentState = 'rejected'
  booking.rejectionReason = trimmed
  booking.updatedAt = nowTimestamp()
  recordTransition(booking, 'rejected', 'payment-pending')
  // T3: rejection notice with the owner's reason (N03 = REQ-062/REQ-124),
  // customer Telegram only. No additional rejection fields are added.
  noticeIfConnected(booking, 'payment-rejected', {
    message: 'Your payment proof was rejected.',
    rejectionReason: trimmed,
  })
  return { ok: true, value: booking }
}

/**
 * Whether the owner has provisioned Telegram for the business (owner-side
 * side-channel). It does NOT gate customer notifications — customer Telegram
 * is per business + phone (see isCustomerTelegramConnected).
 */
export function isTelegramConnected(slug: string): boolean {
  return getPage(slug)?.business.telegramConnected ?? false
}

function telegramKey(slug: string, phone: string): string {
  return `${slug}::${normalizePhoneForMatch(phone)}`
}

/** Customer Telegram connection state for a business + phone (canonical §18). */
export function isCustomerTelegramConnected(slug: string, phone: string): boolean {
  return customerTelegramConnections.get(telegramKey(slug, phone)) ?? false
}

/**
 * Demo-only connect/disconnect for the customer Telegram side-channel. This is
 * clearly a development/mock experience — no real Telegram authorization
 * occurs. The connection is scoped to the business so the same phone can have
 * different connections across businesses, matching the canonical model.
 */
export function setCustomerTelegramConnected(
  slug: string,
  phone: string,
  connected: boolean,
): StoreResult<boolean> {
  if (!getPage(slug)) return missing()
  if (!phone.trim()) return { ok: false, error: 'Please enter a phone number.' }
  if (connected) {
    customerTelegramConnections.set(telegramKey(slug, phone), true)
  } else {
    customerTelegramConnections.delete(telegramKey(slug, phone))
  }
  return { ok: true, value: connected }
}

function getConfirmedBooking(slug: string, id: string): StoreResult<Booking> {
  const booking = getBooking(slug, id)
  if (!booking) return { ok: false, error: 'Booking not found.' }
  if (booking.state !== 'confirmed') {
    return { ok: false, error: 'Only a Confirmed booking can be updated.' }
  }
  return { ok: true, value: booking }
}

/**
 * T5 — No Show (REQ-103): Confirmed → No Show, terminal, slot released.
 * Telegram notice to the customer when connected (REQ-227).
 */
export function markNoShowBooking(slug: string, id: string): StoreResult<Booking> {
  const found = getConfirmedBooking(slug, id)
  if (!found.ok) return found
  const booking = found.value
  booking.state = 'no-show'
  booking.slotReleased = true
  booking.updatedAt = nowTimestamp()
  recordTransition(booking, 'no-show', 'confirmed')
  // T5: No Show notice (N06 = REQ-227), customer Telegram only.
  noticeIfConnected(booking, 'no-show', {
    message: 'Your booking was marked as No Show.',
  })
  return { ok: true, value: booking }
}

/**
 * T6 — Cancel (REQ-104): Confirmed → Cancelled, terminal, slot released.
 * Telegram cancellation notice to the customer when connected (REQ-228).
 */
export function cancelBooking(slug: string, id: string): StoreResult<Booking> {
  const found = getConfirmedBooking(slug, id)
  if (!found.ok) return found
  const booking = found.value
  booking.state = 'cancelled'
  booking.slotReleased = true
  booking.updatedAt = nowTimestamp()
  recordTransition(booking, 'cancelled', 'confirmed')
  // Cancelling an affected booking resolves its schedule conflict (REQ-099).
  resolveConflictsForBooking(slug, id, 'cancel')
  // T6: cancellation notice (N07 = REQ-228), customer Telegram only.
  // A Payment Pending cancellation issues no customer notice (SM-08).
  noticeIfConnected(booking, 'cancelled', {
    message: 'Your booking was cancelled.',
  })
  return { ok: true, value: booking }
}

/**
 * T7 — Reschedule / Modify (REQ-105/106): Confirmed → Confirmed on a new
 * date/time. The new slot must be available and fitting (REQ-106): we re-check
 * availability against the live occupied blocks (other live bookings and the
 * business's own blocked periods). No show / cancelled / rejected bookings have
 * released their slot, so they never block a proposed move. Payment stays
 * attached (REQ-107) — totals and deposit never change herechers.
 */
export function rescheduleBooking(
  slug: string,
  id: string,
  date: DateString,
  time: TimeOfDay,
): StoreResult<Booking> {
  const found = getConfirmedBooking(slug, id)
  if (!found.ok) return found
  const booking = found.value
  const business = getBusiness(slug)
  if (!business) return { ok: false, error: 'Business not found.' }

  const free = computeAvailableTimes(
    business,
    date,
    booking.totalDurationMinutes,
    getOccupiedBlocks(slug, date),
  )
  if (!free.includes(time)) {
    return { ok: false, error: 'That time is no longer available for rescheduling.' }
  }

  const previousTime = booking.time
  const previousDate = booking.date
  booking.date = date
  booking.time = time
  booking.updatedAt = nowTimestamp()
  recordTransition(booking, 'confirmed', 'confirmed')
  // Rescheduling an affected booking resolves its schedule conflict (REQ-099).
  resolveConflictsForBooking(slug, id, 'reschedule')
  // T7: reschedule notice with the new appointment date/time (N08 = REQ-229),
  // customer Telegram only. The payment stays attached (REQ-107) and the
  // booking remains Confirmed — neither is changed by the notice.
  if (date !== previousDate || time !== previousTime) {
    noticeIfConnected(booking, 'reschedule', {
      message: 'Your booking has been rescheduled.',
    })
  }
  return { ok: true, value: booking }
}

/**
 * T4 — auto Complete (REQ-102): any Confirmed booking whose scheduled end time
 * has passed is completed by the System (not the owner). Terminal; the slot is
 * released. This mirrors the canonical determinism requirement: a booking ends
 * when (date + time + duration) passes, so the transition is derived from data
 * alone and needs no wall-clock SQL trigger in the mock.
 *
 * `at` is the end-time oracle (`nowTimestamp()` in production; tests may inject
 * a fixed end to keep the transition deterministic).
 */
export function completeDueBookings(
  slug: string,
  at: Timestamp = nowTimestamp(),
): StoreResult<readonly Booking[]> {
  const business = getBusiness(slug)
  if (!business) return { ok: false, error: 'Business not found.' }
  const due = bookings.filter(
    (b) =>
      b.businessSlug === slug &&
      b.state === 'confirmed' &&
      shiftTime(b.time, b.totalDurationMinutes) <= at,
  )
  for (const booking of due) {
    booking.state = 'completed'
    booking.slotReleased = true
    booking.updatedAt = at
    recordTransition(booking, 'completed', 'confirmed', { actor: 'System', at })
  }
  return { ok: true, value: due }
}

/**
 * T9 — Owner releases/cancels a rejected booking (REQ-104/123/230):
 * Rejected → Cancelled, terminal, slot released. No customer notification
 * (T9 spec: "None required"). Payment state remains Rejected.
 */
export function releaseRejectedBooking(slug: string, id: string): StoreResult<Booking> {
  const booking = getBooking(slug, id)
  if (!booking) return { ok: false, error: 'Booking not found.' }
  if (booking.state !== 'rejected') {
    return { ok: false, error: 'Only a Rejected booking can be released.' }
  }
  booking.state = 'cancelled'
  booking.slotReleased = true
  booking.updatedAt = nowTimestamp()
  recordTransition(booking, 'cancelled', 'rejected')
  resolveConflictsForBooking(slug, id, 'cancel')
  return { ok: true, value: booking }
}

/**
 * T8 — Owner cancels a Payment Pending booking (REQ-104, SM-08):
 * Payment Pending → Cancelled. The slot stays blocked (no release) and no
 * customer notification is generated. The owner must subsequently release the
 * slot explicitly, or the customer may resubmit valid proof.
 */
export function cancelPaymentPendingBooking(slug: string, id: string): StoreResult<Booking> {
  const booking = getBooking(slug, id)
  if (!booking) return { ok: false, error: 'Booking not found.' }
  if (booking.state !== 'payment-pending') {
    return { ok: false, error: 'Only a Payment Pending booking can be cancelled.' }
  }
  booking.state = 'cancelled'
  booking.updatedAt = nowTimestamp()
  recordTransition(booking, 'cancelled', 'payment-pending')
  // T8: no customer notification (SM-08). Slot stays blocked until explicit release.
  return { ok: true, value: booking }
}

/**
 * T10 — Customer resubmits valid proof after rejection (REQ-230, SM-09):
 * Rejected → Payment Pending, payment Rejected → Pending, slot stays blocked
 * (REQ-123). Generates the proof-received notice (N01 = REQ-060) when connected.
 *
 * This is the smallest compatible mock seam for the owner workspace to exercise
 * rejected-recovery completeness (prompt §16). The real implementation includes
 * a one-time verification code control (doc 08 §9) that is not modeled here.
 */
export function resubmitRejectedProof(
  slug: string,
  id: string,
  proof: ProofFile,
): StoreResult<Booking> {
  const booking = getBooking(slug, id)
  if (!booking) return { ok: false, error: 'Booking not found.' }
  if (booking.state !== 'rejected') {
    return { ok: false, error: 'Only a Rejected booking can be resubmitted.' }
  }
  booking.state = 'payment-pending'
  booking.paymentState = 'pending'
  booking.proof = proof
  booking.rejectionReason = null
  booking.updatedAt = nowTimestamp()
  recordTransition(booking, 'payment-pending', 'rejected')
  // N01 = REQ-060: proof-received notice (customer Telegram only).
  noticeIfConnected(booking, 'payment-proof-received', {
    message: 'Your payment proof has been received and is awaiting review.',
  })
  return { ok: true, value: booking }
}

/** Open conflicts for a specific booking, for the booking detail/list (REQ-093). */
export function getOpenConflictsForBooking(slug: string, bookingId: string): readonly ScheduleConflict[] {
  return scheduleConflicts.filter(
    (c) => c.businessSlug === slug && c.bookingId === bookingId && c.status === 'open',
  )
}

/**
 * Gating rule for every customer Telegram notification (N01–N08):
 *
 *   IF customer.telegramConnected === true  → generate the Telegram event
 *   ELSE                                     → generate nothing
 *
 * No "failed Telegram delivery" events are invented for unconnected customers,
 * and no fake error is ever surfaced to them. The customer keeps using the
 * booking/status experience normally without Telegram.
 */
function noticeIfConnected(
  booking: Booking,
  type: CustomerNotificationType,
  payload: {
    message: string
    rejectionReason?: string
    at?: Timestamp
  },
): boolean {
  if (!isCustomerTelegramConnected(booking.businessSlug, booking.customer.phone)) {
    return false
  }
  recordTelegramNotice(booking, type, payload)
  return true
}

/**
 * Records a customer Telegram notification event on the booking. `date`/`time`
 * default to the booking's current appointment date/time; for a reschedule the
 * booking has already moved, so the recorded values are the NEW date/time.
 */
function recordTelegramNotice(
  booking: Booking,
  type: CustomerNotificationType,
  payload: {
    message: string
    rejectionReason?: string
    at?: Timestamp
  },
): void {
  const at = payload.at ?? nowTimestamp()
  const notice: CustomerTelegramNotification = {
    id: `ntf-${++telegramNoticeSeq}`,
    bookingId: booking.id,
    businessSlug: booking.businessSlug,
    customerPhone: booking.customer.phone,
    type,
    channel: 'telegram',
    deliveryState: 'generated',
    createdAt: at,
    message: payload.message,
    date: booking.date,
    time: booking.time,
    rejectionReason: payload.rejectionReason ?? null,
  }
  booking.telegramNotices = [...(booking.telegramNotices ?? []), notice]
}

export type ReminderKind = 'reminder-24h' | 'reminder-1h'

/**
 * Mock-only, deterministic reminder emitter (N04/N05 = REQ-063/REQ-064).
 *
 * The canonical product behavior sends each reminder once per confirmed
 * appointment, 24h and 1h before start, via a scheduled worker (see spec §32 /
 * architecture 13). No such worker exists in the frontend mock, and this slice
 * must NOT invent a permanent scheduling rule or a lead-time default. This
 * function is the mock test/demo seam: the caller explicitly chooses which
 * reminder to emit for a confirmed booking, and it records the corresponding
 * Telegram event only when the customer is connected. It is deliberately not
 * wired to any timer.
 */
export function emitMockReminder(
  slug: string,
  id: string,
  kind: ReminderKind,
): StoreResult<Booking> {
  const found = getConfirmedBooking(slug, id)
  if (!found.ok) return found
  const booking = found.value
  const message =
    kind === 'reminder-24h'
      ? 'Reminder: your appointment is tomorrow.'
      : 'Reminder: your appointment is in 1 hour.'
  noticeIfConnected(booking, kind, { message })
  return { ok: true, value: booking }
}