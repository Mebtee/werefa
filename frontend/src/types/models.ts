/**
 * Shared domain models for the Werefa customer-facing frontend.
 *
 * This is the public (customer) booking surface. Customers are anonymous:
 * they are identified solely by their phone number. No accounts, no logins,
 * no customer dashboard, no customer-visible booking reference.
 *
 * Money amounts are integers in minor units (cents) to mirror the approved
 * API/backend contract (integer-minor money). The display currency is part of
 * the mock business data; the specification does not define a currency.
 */

/** A wall-clock time in 24-hour "HH:MM" form (e.g. "14:30"). */
export type TimeOfDay = string

/** Calendar date in "YYYY-MM-DD" form (REQ-225). */
export type DateString = string

/** Money amount in minor units (cents). */
export type Money = number

/** The two fixed business categories (REQ-215). */
export type BusinessCategory = 'salon-barber' | 'other'

export type MapProvider = 'google' | 'osm'

/**
 * A deterministic mock image asset stored inline as a data URL (development
 * preview only — no real object storage or backend upload exists).
 *
 * `alt` is owner-authored descriptive text rendered as the image's accessible
 * label. `dataUrl` carries the browser-safe data: URI used as the `<img src>`.
 */
export interface ImageAsset {
  dataUrl: string
  alt: string
}

export interface WorkingPeriod {
  start: TimeOfDay
  end: TimeOfDay
}

/** Working hours for one weekday: Sunday = 0 … Saturday = 6. */
export type WeeklyWorkingHours = readonly (readonly WorkingPeriod[])[]

export interface BlockedPeriod {
  date: DateString
  start: TimeOfDay
  end: TimeOfDay
}

export type SpecialDay =
  | { kind: 'closed' }
  | { kind: 'hours'; periods: readonly WorkingPeriod[] }

/**
 * A complete saved schedule state (REQ-162). Every save produces one retained
 * schedule version so the owner can see who changed what and when.
 */
export interface ScheduleSnapshot {
  workingHours: WeeklyWorkingHours
  bookingIntervalMinutes: number
  blockedDays: readonly DateString[]
  blockedPeriods: readonly BlockedPeriod[]
  specialDays: Readonly<Record<DateString, SpecialDay>>
}

export type ScheduleVersionStatus = 'active' | 'pending' | 'superseded'

/**
 * One retained schedule state with its audit trail (REQ-162/163): every saved
 * schedule state is stored as a version, and history records who changed it,
 * when, what changed and (optionally) the owner's reason.
 */
export interface ScheduleVersion {
  id: string
  businessSlug: string
  snapshot: ScheduleSnapshot
  /** Who made the change (owner name, or "System" for automatic changes; REQ-165). */
  actor: string
  /** Owner-entered reason; optional (REQ-164). Null when none was provided. */
  reason: string | null
  /** Automatic changes (e.g. resume-applied schedules) use System (REQ-165). */
  automatic: boolean
  at: Timestamp
  status: ScheduleVersionStatus
}

/**
 * Canonical schedule state as the real backend stores it (Prompt 41 §7 /
 * Prompt 42 §8). Weekdays are ISO 1 (Monday) … 7 (Sunday). Blocked periods
 * recur weekly (a null dayOfWeek blocks every day); special dates are unique
 * per date and are either closed or one custom window.
 */
export interface CanonicalWorkingPeriod {
  weekday: number
  startMinutes: number
  endMinutes: number
}

export interface WeeklyBlockedPeriod {
  dayOfWeek: number | null
  startMinutes: number
  endMinutes: number
}

export type CanonicalSpecialDate =
  | { date: DateString; kind: 'CLOSED'; startMinutes: null; endMinutes: null }
  | { date: DateString; kind: 'CUSTOM'; startMinutes: number; endMinutes: number }

/** Full canonical schedule state (the backend wire shape, mapped). */
export interface CanonicalScheduleState {
  workingPeriods: readonly CanonicalWorkingPeriod[]
  blockedPeriods: readonly WeeklyBlockedPeriod[]
  specialDates: readonly CanonicalSpecialDate[]
}

/**
 * A retained schedule version as shown in the owner's read-only history
 * (REQ-166/169), mapped from the backend versions endpoint. Live in this
 * slice (Prompt 47): the schedule is real, the history diff runs on the
 * canonical wire shape.
 */
export interface ScheduleVersionHistoryEntry {
  id: string
  versionNo: number
  status: ScheduleVersionStatus
  name: string | null
  actor: string
  automatic: boolean
  reason: string | null
  at: Timestamp
  snapshot: CanonicalScheduleState
}

export type ScheduleConflictAction = 'reschedule' | 'cancel' | 'keep'

/**
 * A booking affected by a schedule change (REQ-092/093). Schedule changes are
 * warned, never blocked (REQ-091); the owner resolves each one with the quick
 * actions Reschedule / Cancel / Keep Booking (REQ-099).
 */
export interface ScheduleConflict {
  id: string
  businessSlug: string
  versionId: string
  bookingId: string
  /** Human-readable reason (e.g. the day is now closed). */
  reason: string
  status: 'open' | 'resolved'
  /** How the owner resolved it, once resolved. */
  action: ScheduleConflictAction | null
  at: Timestamp
}

/**
 * Booking-specific approved schedule exception (REQ-160). Created when the
 * owner chooses Keep Booking: the booking stays intact, is labeled "Schedule
 * Exception" with its reason/details, persists after the appointment completes,
 * and never notifies the customer (AC6).
 */
export interface BookingScheduleException {
  /** When the owner kept the booking. */
  at: Timestamp
  /** Reason/details the owner entered (REQ-160 AC2). */
  reason: string
  /** The schedule version whose change caused the conflict (audit link). */
  scheduleVersionId: string
}

/** Owner-deactivated / paused trading state (REQ-216). */
export type PauseState =
  | { kind: 'indefinite'; message?: string }
  | { kind: 'until'; reopenDate: DateString; message?: string }
  | null

export type SubscriptionStatus = 'active' | 'suspended' | 'deactivated'

/** Owner-controlled prepayment configuration (REQ-110 / REQ-111). */
export type PrepaymentMode = 'none' | 'percentage' | 'fixed'

export interface PrepaymentConfig {
  mode: PrepaymentMode
  /** For mode "percentage": percent of the booking total. For "fixed": minor units amount. */
  value?: number
}

/** The fixed payment methods (REQ-112 / REQ-115). */
export type PaymentMethodId = 'bank-transfer' | 'telebirr'

export interface PaymentMethodInstruction {
  id: PaymentMethodId
  label: string
  steps: readonly string[]
}

export interface BusinessPaymentInstructions {
  methods: readonly PaymentMethodInstruction[]
}

export interface BusinessDetails {
  slug: string
  name: string
  category: BusinessCategory
  tagline: string
  description: string
  accentColor: string
  address: string
  /** Null when the business has no saved location (REQ-211). */
  lat: number | null
  lng: number | null
  mapProvider: MapProvider
  phone: string
  workingHours: WeeklyWorkingHours
  bookingIntervalMinutes: number
  blockedDays: readonly DateString[]
  blockedPeriods: readonly BlockedPeriod[]
  specialDays: Readonly<Record<DateString, SpecialDay>>
  pause: PauseState
  subscriptionStatus: SubscriptionStatus
  prepayment: PrepaymentConfig
  paymentInstructions: BusinessPaymentInstructions
  currency: string
  /** How many days ahead (from today, inclusive) customers can book. */
  bookingWindowDays: number
  /**
   * Whether the owner has provisioned Telegram for this business (owner-side
   * side-channel). This does NOT gate customer notifications — those gate on
   * the per-customer connection (per business + phone).
   */
  telegramConnected: boolean
  /**
   * Owner-configurable public logo (REQ-209). Rendered on the public page;
   * initials are used as the fallback when null.
   */
  logo: ImageAsset | null
  /**
   * Exactly one main cover photo per business (REQ-208); no gallery. Rendered
   * at the top of the public page when configured.
   */
  coverPhoto: ImageAsset | null
}

export interface ServiceVariation {
  id: string
  name: string
  priceDeltaMinor: Money
  durationDeltaMinutes: number
}

export interface ServiceAddOn {
  id: string
  name: string
  priceDeltaMinor: Money
  durationDeltaMinutes: number
}

export interface Service {
  id: string
  name: string
  basePriceMinor: Money
  baseDurationMinutes: number
  variations: readonly ServiceVariation[]
  addOns: readonly ServiceAddOn[]
  /** Owner-deactivated services are hidden from the public page (REQ-079). */
  isActive: boolean
}

/** A business page plus its published services (REQ-214). */
export interface BusinessPage {
  business: BusinessDetails
  services: readonly Service[]
}

/** A single service picked, with optional variation and add-ons. */
export interface ServiceSelection {
  serviceId: string
  variationId: string | null
  addOnIds: readonly string[]
}

export interface CustomerDetails {
  name: string
  phone: string
  note: string
}

/** Proof-of-payment metadata the customer uploads (REQ-117 / REQ-118). */
export interface ProofFile {
  fileName: string
  sizeBytes: number
  mimeType: string
  /**
   * The raw file, carried so the real multipart upload can send the bytes
   * (Prompt 50). Absent on proof records reconstructed from storage/API data,
   * which only ever need the metadata.
   */
  file?: File
}

export interface BookingDraft {
  selections: readonly ServiceSelection[]
  date: DateString | null
  time: TimeOfDay | null
  customer: CustomerDetails
  paymentMethod: PaymentMethodId | null
  proof: ProofFile | null
}

/** What the customer sees after their booking request is submitted. */
export type BookingDisposition =
  | 'payment-pending'
  | 'pending-confirmation'

export type SubmitResult =
  | { status: 'created'; disposition: BookingDisposition }
  | { status: 'unavailable' }
  | { status: 'error' }

/**
 * Booking lifecycle state (REQ-101). No other user-facing booking state exists.
 * The state is modeled separately from the payment status (REQ-100).
 */
export type BookingState =
  | 'payment-pending'
  | 'confirmed'
  | 'completed'
  | 'no-show'
  | 'cancelled'
  | 'rejected'

/** Payment status — exactly Pending, Accepted, Rejected (REQ-100). */
export type PaymentState = 'pending' | 'accepted' | 'rejected'

/** "YYYY-MM-DDTHH:MM", minute precision (REQ-226). */
export type Timestamp = string

/** A resolved service line as recorded on the booking (snapshot, REQ-076). */
export interface BookingLineSnapshot {
  name: string
  unitPrice: Money
  durationMinutes: number
}

/** One recorded status transition of a booking (REQ-173). */
export interface BookingStatusEntry {
  state: BookingState
  previous: BookingState | null
  actor: string
  at: Timestamp
}

/**
 * Customer Telegram notification types (Notification catalog N01–N08; REQ-060
 * … REQ-064, REQ-227 … REQ-229). These are the only supported customer
 * notification cases.
 */
export type CustomerNotificationType =
  | 'payment-proof-received'
  | 'booking-confirmed'
  | 'payment-rejected'
  | 'reminder-24h'
  | 'reminder-1h'
  | 'no-show'
  | 'cancelled'
  | 'reschedule'

/** Mock Telegram delivery state — a generated/simulated event, never a real send. */
export type TelegramDeliveryState = 'generated'

export interface TelegramChannelInfo {
  channel: 'telegram'
  deliveryState: TelegramDeliveryState
}

/**
 * A customer Telegram notification event recorded by the mock.
 *
 * Deliberately backend-replaceable: the shape mirrors an outbox row and carries
 * enough fields for deterministic UI/tests (event ID, booking ID, business
 * slug, customer phone, type, timestamp, message payload, channel, delivery
 * state). Internal identifiers (booking ID, business slug) are never projected
 * to the public customer UI — see CustomerTelegramNotificationView.
 */
export interface CustomerTelegramNotification extends TelegramChannelInfo {
  id: string
  bookingId: string
  businessSlug: string
  customerPhone: string
  type: CustomerNotificationType
  createdAt: Timestamp
  /** Human-readable message text delivered to the customer's Telegram account. */
  message: string
  /** Appointment context: booking date/time at the event, new date/time for reschedule. */
  date: DateString | null
  time: TimeOfDay | null
  /** Owner's rejection reason when type === 'payment-rejected'. */
  rejectionReason: string | null
}

/**
 * Customer-safe projection of a Telegram notification. Exposes only what a
 * customer may see for their own booking context: purpose, message, relevant
 * date/time, rejection reason (when rejected) and the notification timestamp.
 * It never carries the internal Booking ID, business slug, or customer phone.
 */
export interface CustomerTelegramNotificationView {
  type: CustomerNotificationType
  message: string
  date: DateString | null
  time: TimeOfDay | null
  rejectionReason: string | null
  at: Timestamp
}

/**
 * One customer booking from the real `GET /customer/status` endpoint (Prompt
 * 49). It intentionally carries appointment times + status only — the backend
 * never exposes internal ids, history, line items or owner metadata here.
 */
export interface CustomerBookingStatusEntry {
  startAt: string
  endAt: string
  bookingState: BookingState
}

/**
 * Customer-facing booking status record returned by the phone-number lookup
 * (REQ-109). It intentionally exposes only what a customer may see for their
 * own booking: business, services, date/time, booking status, payment status,
 * (when rejected) the owner's reason (REQ-062) and the customer's own Telegram
 * notification context. It never carries the internal Booking ID, status
 * history, proof metadata, or admin/audit fields.
 */
export interface CustomerBookingStatus {
  business: { slug: string; name: string }
  customerName: string
  lineItems: readonly BookingLineSnapshot[]
  date: DateString
  time: TimeOfDay
  bookingState: BookingState
  paymentState: PaymentState
  rejectionReason: string | null
  createdAt: Timestamp
  /** Whether this phone number is connected to Telegram for the business (per business + phone). */
  telegramConnected: boolean
  /** Customer-safe Telegram notifications for this booking, chronological. */
  telegramNotifications: readonly CustomerTelegramNotificationView[]
}

/**
 * A booking as stored for the owner/dashboard and reporting surfaces.
 *
 * The customer is anonymous and identifies their booking only by phone number
 * (REQ-109). The internal Booking ID exists for the owner/admin/report/audit
 * surfaces; it is never shown to the customer.
 *
 * `slotReleased` mirrors the backend slot lock (LOCKED / ALLOCATED / RELEASED)
 * without a TTL (REQ-121 / OQ-SLOT-001): the slot stays blocked while this is
 * false, even for cancelled-from-Payment-Pending or rejected bookings, until
 * the allowed lifecycle action releases it.
 */
export interface Booking {
  id: string
  businessSlug: string
  state: BookingState
  paymentState: PaymentState
  lineItems: readonly BookingLineSnapshot[]
  total: Money
  totalDurationMinutes: number
  deposit: Money
  date: DateString
  time: TimeOfDay
  customer: CustomerDetails
  paymentMethod: PaymentMethodId
  proof: ProofFile
  rejectionReason: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
  history: readonly BookingStatusEntry[]
  /** Customer Telegram notifications recorded for this booking (N01–N08). */
  telegramNotices: readonly CustomerTelegramNotification[]
  slotReleased: boolean
  /**
   * Approved booking-specific schedule exception (REQ-160). Present when the
   * owner kept the booking during a schedule conflict; null otherwise.
   */
  scheduleException: BookingScheduleException | null
}