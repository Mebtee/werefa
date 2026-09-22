import { apiDownload, apiRequest } from './http'
import type {
  OwnerBookingDetailView,
  OwnerBookingListQuery,
  OwnerBookingView,
  OwnerRescheduleAvailabilityView,
  OwnerRescheduleInput,
} from './types'

/**
 * Owner booking management API client (Prompt 51 + Prompt 49 lifecycle).
 *
 * Consumes exactly the implemented owner routes:
 *  - `GET   …/bookings`                    list (filters + newest first);
 *  - `GET   …/bookings/:bookingId`         detail (booking + payment + history + proofs);
 *  - `POST  …/bookings/:bookingId/accept`  accept a Payment Pending booking;
 *  - `POST  …/bookings/:bookingId/reject`  reject with a required reason (REQ-118);
 *  - `POST  …/bookings/:bookingId/cancel`  cancel (state-aware: confirmed/pending/rejected);
 *  - `POST  …/bookings/:bookingId/no-show` mark a Confirmed booking as No Show (REQ-103);
 *  - `POST  …/bookings/:bookingId/reschedule` move to a free + fitting slot (REQ-105/106);
 *  - `POST  …/bookings/:bookingId/release-slot` release a CANCELLED/REJECTED held slot (204);
 *  - `GET   …/bookings/:bookingId/available-times?date=…` free slots for the reschedule picker;
 *  - `GET   …/bookings/:bookingId/proofs/:proofId` authenticated binary stream.
 *
 * Tenancy is enforced server-side: the owner-scoped `businessId` is always part
 * of the path, so a booking or proof can never be fetched across businesses.
 * The backend is authoritative for both the booking status and the separate
 * payment status; the client never derives one from the other.
 */

/** Base path for one owner booking within an owner-scoped business. */
function ownerBookingPath(businessId: string, bookingId: string): string {
  return `/owner/businesses/${encodeURIComponent(businessId)}/bookings/${encodeURIComponent(bookingId)}`
}

/** Owner booking list, newest first (REQ-184/185; owner-side sort stays client-side). */
export function listOwnerBookings(
  businessId: string,
  query: OwnerBookingListQuery = {},
  signal?: AbortSignal,
): Promise<OwnerBookingView[]> {
  return apiRequest<OwnerBookingView[]>(`/owner/businesses/${encodeURIComponent(businessId)}/bookings`, {
    method: 'GET',
    query: query as Record<string, string | number | boolean | null | undefined>,
    signal,
  }).then(({ data }) => data)
}

/** Owner booking detail, including the proof timeline and status history. */
export function getOwnerBookingDetail(
  businessId: string,
  bookingId: string,
  signal?: AbortSignal,
): Promise<OwnerBookingDetailView> {
  return apiRequest<OwnerBookingDetailView>(ownerBookingPath(businessId, bookingId), {
    method: 'GET',
    signal,
  }).then(({ data }) => data)
}

/** Accepts a Payment Pending booking; resolves to the updated detail. */
export function acceptOwnerBooking(
  businessId: string,
  bookingId: string,
  signal?: AbortSignal,
): Promise<OwnerBookingDetailView> {
  return apiRequest<OwnerBookingDetailView>(`${ownerBookingPath(businessId, bookingId)}/accept`, {
    method: 'POST',
    signal,
  }).then(({ data }) => data)
}

/** Rejects a Payment Pending booking with a required reason (REQ-118). */
export function rejectOwnerBooking(
  businessId: string,
  bookingId: string,
  reason: string,
  signal?: AbortSignal,
): Promise<OwnerBookingDetailView> {
  return apiRequest<OwnerBookingDetailView>(`${ownerBookingPath(businessId, bookingId)}/reject`, {
    method: 'POST',
    body: { reason },
    signal,
  }).then(({ data }) => data)
}

/**
 * Cancels a booking (one state-aware endpoint — REQ-104 T6/T8/T9): a Confirmed
 * (or Rejected) booking releases its slot, a Payment Pending one stays blocked.
 */
export function cancelOwnerBooking(
  businessId: string,
  bookingId: string,
  signal?: AbortSignal,
): Promise<OwnerBookingDetailView> {
  return apiRequest<OwnerBookingDetailView>(`${ownerBookingPath(businessId, bookingId)}/cancel`, {
    method: 'POST',
    signal,
  }).then(({ data }) => data)
}

/** Marks a Confirmed booking as No Show (REQ-103); the slot is released. */
export function markOwnerBookingNoShow(
  businessId: string,
  bookingId: string,
  signal?: AbortSignal,
): Promise<OwnerBookingDetailView> {
  return apiRequest<OwnerBookingDetailView>(`${ownerBookingPath(businessId, bookingId)}/no-show`, {
    method: 'POST',
    signal,
  }).then(({ data }) => data)
}

/**
 * Reschedules a Confirmed booking to a free + fitting slot (REQ-105/106/107/108):
 * the payment (and its state) stays attached and no automatic charge is made.
 */
export function rescheduleOwnerBooking(
  businessId: string,
  bookingId: string,
  startAt: string,
  signal?: AbortSignal,
): Promise<OwnerBookingDetailView> {
  const payload: OwnerRescheduleInput = { startAt }
  return apiRequest<OwnerBookingDetailView>(`${ownerBookingPath(businessId, bookingId)}/reschedule`, {
    method: 'POST',
    body: payload,
    signal,
  }).then(({ data }) => data)
}

/** Release the held slot of a CANCELLED/REJECTED booking (204, no body). */
export function releaseOwnerBookingSlot(
  businessId: string,
  bookingId: string,
  signal?: AbortSignal,
): Promise<void> {
  return apiRequest<void>(`${ownerBookingPath(businessId, bookingId)}/release-slot`, {
    method: 'POST',
    signal,
  }).then(() => undefined)
}

/** Free + fitting slots on a date for the reschedule picker (REQ-106/089). */
export function getOwnerBookingAvailableTimes(
  businessId: string,
  bookingId: string,
  date: string,
  signal?: AbortSignal,
): Promise<OwnerRescheduleAvailabilityView> {
  return apiRequest<OwnerRescheduleAvailabilityView>(
    `${ownerBookingPath(businessId, bookingId)}/available-times`,
    { method: 'GET', query: { date }, signal },
  ).then(({ data }) => data)
}

/** A downloaded proof plus the server-supplied filename/content type. */
export interface OwnerProofDownload {
  blob: Blob
  fileName: string | null
  contentType: string | null
}

/** Streams one proof over the authenticated owner route (tenant-scoped). */
export function downloadOwnerBookingProof(
  businessId: string,
  bookingId: string,
  proofId: string,
  signal?: AbortSignal,
): Promise<OwnerProofDownload> {
  const path = `${ownerBookingPath(businessId, bookingId)}/proofs/${encodeURIComponent(proofId)}`
  return apiDownload(path, { method: 'GET', signal }).then(({ data, fileName, contentType }) => ({
    blob: data,
    fileName,
    contentType,
  }))
}
