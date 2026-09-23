import { apiRequest } from './http'
import type { AdminSubscriptionProofView, SubscriptionReviewState } from './types'

/**
 * Admin subscription proof-queue client (Prompt 52; REQ-137/138).
 *
 * Consumes exactly the implemented backend routes:
 *  - `GET  /admin/subscription/proofs?state=PENDING`
 *  - `POST /admin/subscription/proofs/:id/approve`
 *  - `POST /admin/subscription/proofs/:id/reject`  (body: `{ reason }`)
 *
 * All are gated to Admin + Super Admin sessions server-side
 * (`requireAdminOrSuperAdmin`); an owner session receives 403.
 */

export function listSubscriptionProofs(
  state: SubscriptionReviewState = 'PENDING',
  signal?: AbortSignal,
): Promise<AdminSubscriptionProofView[]> {
  return apiRequest<AdminSubscriptionProofView[]>('/admin/subscription/proofs', {
    method: 'GET',
    query: { state },
    signal,
  }).then(({ data }) => data)
}

export function approveSubscriptionProof(proofId: string): Promise<AdminSubscriptionProofView> {
  return apiRequest<AdminSubscriptionProofView>(
    `/admin/subscription/proofs/${encodeURIComponent(proofId)}/approve`,
    { method: 'POST' },
  ).then(({ data }) => data)
}

export function rejectSubscriptionProof(
  proofId: string,
  reason: string,
): Promise<AdminSubscriptionProofView> {
  return apiRequest<AdminSubscriptionProofView>(
    `/admin/subscription/proofs/${encodeURIComponent(proofId)}/reject`,
    { method: 'POST', body: { reason } },
  ).then(({ data }) => data)
}