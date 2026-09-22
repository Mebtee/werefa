import { apiDownload, apiRequest } from './http'
import type { OwnerBookingDetailView } from './types'

/**
 * Owner payment-proof review API client (Prompt 51).
 *
 * Consumes exactly the implemented owner routes:
 *  - `GET  /api/v1/owner/businesses/:businessId/bookings/:bookingId` (detail:
 *    booking + payment status + history + proof timeline);
 *  - `POST …/bookings/:bookingId/accept` (accept a Payment Pending booking);
 *  - `POST …/bookings/:bookingId/reject` (reject with a required reason, REQ-118);
 *  - `GET  …/bookings/:bookingId/proofs/:proofId` (authenticated binary stream).
 *
 * Tenancy is enforced server-side: the owner-scoped `businessId` is always part
 * of the path, so a proof can never be fetched across businesses. The backend is
 * authoritative for both the booking status and the separate payment status; the
 * client never derives one from the other.
 */

/** Base path for one owner booking within an owner-scoped business. */
function ownerBookingPath(businessId: string, bookingId: string): string {
  return `/owner/businesses/${encodeURIComponent(businessId)}/bookings/${encodeURIComponent(bookingId)}`
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
