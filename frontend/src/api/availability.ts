import { apiRequest } from './http'
import type { AvailabilityQueryPayload, PublicAvailabilityView } from './types'

/**
 * Public availability API client (Prompt 48).
 *
 * Consumes exactly the implemented backend route: `POST
 * /api/v1/public/businesses/:slug/availability` (REQ-070/074). The backend
 * validates the whole multi-service selection, sums its duration/price and
 * returns the resulting slot starts — the client sends selections only, never
 * a computed duration. Read-only: nothing is reserved by asking (the same
 * contract the backend's GET endpoint always had).
 */

export function getPublicAvailability(
  slug: string,
  payload: AvailabilityQueryPayload,
  signal?: AbortSignal,
): Promise<PublicAvailabilityView> {
  return apiRequest<PublicAvailabilityView>(
    `/public/businesses/${slug}/availability`,
    { method: 'POST', body: payload, signal },
  ).then(({ data }) => data)
}