import type {
  OwnerBookingDetailView,
  OwnerBookingHistoryView,
  OwnerBookingView,
} from '@/api/types'
import type {
  Booking,
  BookingStatusEntry,
  DateString,
  TimeOfDay,
} from '@/types/models'
import {
  ownerBookingStateFromWire,
  ownerPaymentStateFromWire,
} from '@/features/owner-portal/lib/paymentReview'

/**
 * Maps the real owner booking projections to the mounting `Booking` model
 * (Prompt 49 + 51). The backend stays authoritative for statuses, prices and
 * times; this module only adapts shapes. The wire `startAt`/`endAt` are UTC
 * instants and the product timezone is global, so the booking slot is extracted
 * in UTC — tests round-trip in any machine timezone.
 *
 * The owner projection carries no Telegram state, no per-booking schedule
 * exception and no slot-release flag, so those mock-only fields map to stable
 * defaults (the UI no longer renders them). List rows have no history/proofs —
 * they get a single synthetic history entry from `actorType` so the owner actor
 * sort (REQ-188/190) keeps working client-side.
 */

const ACTOR_LABEL: Record<string, string> = {
  OWNER: 'Owner',
  CUSTOMER: 'Customer',
  SYSTEM: 'System',
  ADMIN: 'Admin',
  SUPER_ADMIN: 'Super Admin',
}

/** Wire status-transition actor code → the mounting display label. */
export function ownerActorLabel(actorType: string | null | undefined): string {
  if (!actorType) return 'System'
  return ACTOR_LABEL[actorType] ?? actorType
}

const PAYMENT_METHOD_FROM_WIRE: Record<string, 'bank-transfer' | 'telebirr'> = {
  BANK_TRANSFER: 'bank-transfer',
  TELEBIRR_MOBILE_MONEY: 'telebirr',
}

/** Extracts the booking slot (date + time) in the global timezone from a UTC instant. */
export function slotFromUtcInstant(startAt: string): { date: DateString; time: TimeOfDay } | null {
  const date = new Date(startAt)
  if (Number.isNaN(date.getTime())) return null
  const y = date.getUTCFullYear()
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const mm = String(date.getUTCMinutes()).padStart(2, '0')
  return { date: `${y}-${mo}-${d}`, time: `${hh}:${mm}` }
}

/** Tolerant timestamp → the mounting minute-precision timestamp ('YYYY-MM-DDTHH:MM'). */
function localMinuteTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d}T${hh}:${mm}`
}

function historyEntryFromWire(entry: OwnerBookingHistoryView): BookingStatusEntry {
  return {
    state: ownerBookingStateFromWire(entry.toStatus),
    previous: entry.fromStatus ? ownerBookingStateFromWire(entry.fromStatus) : null,
    actor: ownerActorLabel(entry.actorType),
    at: localMinuteTimestamp(entry.occurredAt),
  }
}

/**
 * Maps an owner booking projection (list row or detail) to the mounting Booking.
 *
 * - List rows carry `actorType` only → a synthetic single-entry history.
 * - Detail rows carry the full ascending `history` + `proofs` → real history and
 *   the latest proof (the detail proof timeline is rendered by the payment
 *   review surface, which already consumes the wire directly).
 */
export function ownerBookingFromWire(view: OwnerBookingView): Booking {
  const detail = view as Partial<OwnerBookingDetailView>
  const slot = slotFromUtcInstant(view.startAt)
  const state = ownerBookingStateFromWire(view.status)

  const historyWire: OwnerBookingHistoryView[] =
    detail.history && detail.history.length > 0
      ? detail.history
      : [
          {
            occurredAt: view.updatedAt,
            fromStatus: null,
            toStatus: view.status,
            actorType: view.actorType,
            actorUserId: null,
            reason: null,
          },
        ]
  const history = [...historyWire]
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .map(historyEntryFromWire)

  const proofs = detail.proofs ?? []
  const latestProof = proofs[proofs.length - 1]

  return {
    // The backend booking id is a numeric surrogate; route params round-trip
    // as strings (the backend `BookingIdParamDto` converts back to a number).
    id: String(view.bookingId),
    businessSlug: '',
    state,
    paymentState: ownerPaymentStateFromWire(view.payment?.status) ?? 'pending',
    lineItems: view.components.map((c) => ({
      name: c.name,
      unitPrice: c.unitPriceMinor,
      durationMinutes: c.durationMinutes,
    })),
    total: view.totalPriceMinor,
    totalDurationMinutes: view.components.reduce((sum, c) => sum + c.durationMinutes, 0),
    deposit: view.payment?.prepaidMinor ?? 0,
    date: slot?.date ?? '1970-01-01',
    time: slot?.time ?? '00:00',
    customer: {
      name: view.customerName,
      phone: view.customerPhone,
      note: view.note ?? '',
    },
    paymentMethod:
      (view.payment && PAYMENT_METHOD_FROM_WIRE[view.payment.method]) ?? 'bank-transfer',
    proof: latestProof
      ? {
          fileName: latestProof.fileName,
          sizeBytes: latestProof.sizeBytes,
          mimeType: latestProof.mimeType,
        }
      : { fileName: '', sizeBytes: 0, mimeType: 'image/png' },
    rejectionReason:
      historyWire
        .filter((entry) => entry.toStatus === 'REJECTED')
        .reverse()
        .find((entry) => entry.reason && entry.reason.trim())
        ?.reason?.trim() ?? null,
    createdAt: localMinuteTimestamp(view.createdAt),
    updatedAt: localMinuteTimestamp(view.updatedAt),
    history,
    telegramNotices: [],
    slotReleased: false,
    scheduleException: null,
  }
}

/** Maps the owner list projection (newest first) to mounting Bookings. */
export function ownerBookingsFromWire(views: readonly OwnerBookingView[]): Booking[] {
  return views.map(ownerBookingFromWire)
}