import { apiDownload, apiRequest } from './http'
import type {
  AdminSubscriptionProofView,
  AdminUserView,
  CreateAdminRequest,
  OwnerScheduleView,
  SecurityEventView,
  SubscriptionReviewState,
} from './types'

/**
 * Platform administration client (Prompt 52 subscription review; Prompt 53
 * Admin/Super Admin portal).
 *
 * Consumes exactly the implemented backend routes under `/api/v1`:
 *  - `GET    /admin/subscription/proofs?state=PENDING`
 *  - `POST   /admin/subscription/proofs/:id/approve`
 *  - `POST   /admin/subscription/proofs/:id/reject`  (body: `{ reason }`)
 *  - `GET    /admin/admins`                            (Super Admin, REQ-217)
 *  - `POST   /admin/admins`                            (Super Admin, REQ-217)
 *  - `DELETE /admin/admins/:id`                        (Super Admin, REQ-217)
 *  - `POST   /admin/admins/:id/password`               (Super Admin, REQ-219)
 *  - `POST   /admin/users/:id/force-logout`            (Super Admin, REQ-220)
 *  - `GET    /admin/security-history`                  (Super Admin, REQ-203)
 *  - `DELETE /admin/security-history`                  (Super Admin, REQ-205)
 *  - `GET    /admin/businesses/:id/schedule/versions`  (Super Admin, REQ-167)
 *
 * All are gated server-side; an owner session receives 403 and an Admin is
 * rejected from Super-Admin-only routes. This client never supplies a role,
 * tenant id or actor id — authorization comes from the session cookie.
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

/**
 * Streams one subscription proof file over the authenticated Admin route so a
 * reviewer can inspect the real receipt before approving/rejecting. The proof
 * is never exposed on a public/unauthenticated URL; the same session-gated
 * authorization boundary as the queue governs it.
 */
export function loadSubscriptionProofFile(
  proofId: string,
): Promise<{ blob: Blob; contentType: string | null; fileName: string | null }> {
  const path = `/admin/subscription/proofs/${encodeURIComponent(proofId)}/file`
  return apiDownload(path, { method: 'GET' }).then(({ data, contentType, fileName }) => ({
    blob: data,
    contentType,
    fileName,
  }))
}

/** Approves a pending subscription proof; activates/extends a 30-day period. */
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

/** List Admin accounts with active-session counts (REQ-217). Super Admin only. */
export function listAdmins(signal?: AbortSignal): Promise<AdminUserView[]> {
  return apiRequest<{ admins: AdminUserView[] }>('/admin/admins', {
    method: 'GET',
    signal,
  }).then(({ data }) => data.admins)
}

/** Create an Admin; the platform enforces the exactly-two-active-Admin cap. */
export function createAdmin(input: CreateAdminRequest): Promise<AdminUserView> {
  return apiRequest<{ admin: AdminUserView }>('/admin/admins', {
    method: 'POST',
    body: input,
  }).then(({ data }) => data.admin)
}

/** Deactivate an Admin (revokes every session; frees an Admin slot). */
export function deactivateAdmin(adminId: string): Promise<void> {
  return apiRequest<void>(`/admin/admins/${encodeURIComponent(adminId)}`, {
    method: 'DELETE',
  }).then(() => undefined)
}

/** Reset an Admin password (REQ-219); logs the Admin out everywhere. */
export function resetAdminPassword(adminId: string, newPassword: string): Promise<void> {
  return apiRequest<void>(`/admin/admins/${encodeURIComponent(adminId)}/password`, {
    method: 'POST',
    body: { newPassword },
  }).then(() => undefined)
}

/** Force-logout an Owner or Admin (REQ-220); revokes all of the target's sessions. */
export function forceLogoutUser(userId: string): Promise<void> {
  return apiRequest<void>(`/admin/users/${encodeURIComponent(userId)}/force-logout`, {
    method: 'POST',
  }).then(() => undefined)
}

/** Platform-wide security history (REQ-203). Super Admin only. */
export function listPlatformSecurityHistory(signal?: AbortSignal): Promise<SecurityEventView[]> {
  return apiRequest<{ events: SecurityEventView[] }>('/admin/security-history', {
    method: 'GET',
    signal,
  }).then(({ data }) => data.events)
}

/**
 * Delete security records strictly older than the given instant (REQ-205).
 * The deletion is itself audited server-side (REQ-206).
 */
export function deleteSecurityHistory(olderThan: string): Promise<number> {
  return apiRequest<{ deleted: number }>('/admin/security-history', {
    method: 'DELETE',
    body: { olderThan },
  }).then(({ data }) => data.deleted)
}

/** Super Admin read-only schedule-version history for a business (REQ-167). */
export function listScheduleVersions(
  businessId: string,
  signal?: AbortSignal,
): Promise<OwnerScheduleView[]> {
  return apiRequest<OwnerScheduleView[]>(
    `/admin/businesses/${encodeURIComponent(businessId)}/schedule/versions`,
    { method: 'GET', signal },
  ).then(({ data }) => data)
}
