import { apiRequest } from './http'
import type {
  CreateCustomerBookingInput,
  CustomerBookingView,
  CustomerResubmissionResultView,
  CustomerStatusView,
  ResubmissionRequestCodeView,
  ResubmissionRequestInput,
  ResubmissionVerifyInput,
} from './types'

/**
 * Customer booking API client (Prompts 49–50).
 *
 * Consumes exactly the implemented backend routes:
 *  - `POST /api/v1/customer/bookings` (PDF 50: multipart — a JSON `payload`
 *    text field plus an optional `proof` file field; idempotent by
 *    `submissionKey`, REQ-121);
 *  - `GET /api/v1/customer/status?slug=…&phone=…` (customer-safe status, REQ-109);
 *  - `POST /api/v1/customer/resubmission/request-code` (JSON, one-time code);
 *  - `POST /api/v1/customer/resubmission/verify` (multipart, REQ-230).
 * The backend derives duration/price from the selections and snapshots every
 * component (REQ-074/076); the client only ever sends selections and the
 * customer's preferred start instant — never prices or durations.
 */

/**
 * Wraps a JSON payload + optional proof file in the backend's multipart
 * contract: the JSON lives in a `payload` text field and the raw bytes in a
 * `proof` file field. Used by booking create and resubmission verify alike; the
 * backend re-validates the file by content (magic bytes) and is authoritative.
 */
function multipartPayload(payload: unknown, proof?: File | null): FormData {
  const form = new FormData()
  form.append('payload', JSON.stringify(payload))
  if (proof) form.append('proof', proof, proof.name)
  return form
}

export function createCustomerBooking(
  payload: CreateCustomerBookingInput,
  proof?: File | null,
  signal?: AbortSignal,
): Promise<CustomerBookingView> {
  return apiRequest<CustomerBookingView>('/customer/bookings', {
    method: 'POST',
    body: multipartPayload(payload, proof),
    signal,
  }).then(({ data }) => data)
}

/** Requests a one-time resubmission code for the latest rejected booking. */
export function requestResubmissionCode(
  payload: ResubmissionRequestInput,
  signal?: AbortSignal,
): Promise<ResubmissionRequestCodeView> {
  return apiRequest<ResubmissionRequestCodeView>('/customer/resubmission/request-code', {
    method: 'POST',
    body: payload,
    signal,
  }).then(({ data }) => data)
}

/** Verifies the code and replaces the rejected booking's proof (REQ-230). */
export function verifyResubmission(
  payload: ResubmissionVerifyInput,
  proof: File,
  signal?: AbortSignal,
): Promise<CustomerResubmissionResultView> {
  return apiRequest<CustomerResubmissionResultView>('/customer/resubmission/verify', {
    method: 'POST',
    body: multipartPayload(payload, proof),
    signal,
  }).then(({ data }) => data)
}

/** Read-only customer status lookup, newest first (REQ-053/058/109). */
export function getCustomerBookingStatus(
  slug: string,
  phone: string,
  signal?: AbortSignal,
): Promise<CustomerStatusView> {
  return apiRequest<CustomerStatusView>('/customer/status', {
    method: 'GET',
    query: { slug, phone },
    signal,
  }).then(({ data }) => data)
}