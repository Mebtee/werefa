import { ApiError, isApiError } from './errors'
import { apiRequest } from './http'
import type { OwnerSubscriptionView, SubscriptionProofView } from './types'

/**
 * Owner subscription API client (Prompt 52; spec §17, REQ-135/136/141).
 *
 * Consumes exactly the implemented backend routes:
 *  - `GET  /owner/businesses/:id/subscription`
 *  - `POST /owner/businesses/:id/subscription/proof` (multipart: `payload`
 *    JSON field with `submissionKey` + the proof file as `proof`).
 *
 * Authorized server-side through the tenant guard; the backend never trusts a
 * client-supplied business id. The upload is idempotent by `submissionKey`
 * (REQ-121 architecture): a replayed key returns the original proof.
 */

/** A proof file prepared for upload (browser bytes + declared content type). */
export interface PendingProofFile {
  bytes: Uint8Array
  contentType: string
  filename: string
}

export function getOwnerSubscription(
  businessId: string,
  signal?: AbortSignal,
): Promise<OwnerSubscriptionView> {
  return apiRequest<OwnerSubscriptionView>(
    `/owner/businesses/${encodeURIComponent(businessId)}/subscription`,
    { method: 'GET', signal },
  ).then(({ data }) => data)
}

export function submitSubscriptionProof(
  businessId: string,
  submissionKey: string,
  file: PendingProofFile,
  signal?: AbortSignal,
): Promise<SubscriptionProofView> {
  const form = new FormData()
  form.set('payload', JSON.stringify({ submissionKey }))
  form.set('proof', new Blob([file.bytes], { type: file.contentType }), file.filename)
  return apiRequest<SubscriptionProofView>(
    `/owner/businesses/${encodeURIComponent(businessId)}/subscription/proof`,
    { method: 'POST', body: form, signal },
  ).then(({ data }) => data)
}

/**
 * Narrows any unknown thrown value to the typed ApiError. UI boundaries call
 * this so they can render `toUserMessage` without coupling to fetch internals.
 */
export function asApiError(error: unknown): ApiError | null {
  return isApiError(error) ? error : null
}