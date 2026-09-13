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
  lat: number
  lng: number
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
}

export interface ServiceVariation {
  id: string
  name: string
  priceDelta: Money
  durationDeltaMinutes: number
}

export interface ServiceAddOn {
  id: string
  name: string
  price: Money
  durationMinutes: number
}

export interface Service {
  id: string
  name: string
  description?: string
  basePrice: Money
  baseDurationMinutes: number
  variations: readonly ServiceVariation[]
  addOns: readonly ServiceAddOn[]
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