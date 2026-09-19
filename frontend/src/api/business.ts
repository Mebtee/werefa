import { ApiError, isApiError } from './errors'
import { apiRequest } from './http'
import type {
  ChangePublicSlugInput,
  OwnerBusinessView,
  PauseBusinessInput,
  PublicBusinessView,
  UpdateBusinessProfileInput,
} from './types'

/**
 * Owner business + public business API client (Prompt 45).
 *
 * Exactly the implemented backend routes are consumed (Prompt 42/43); no
 * endpoint names are invented here. Owner routes require the session cookie and
 * are authorized server-side through the tenant guard — the frontend never
 * trusts a client-supplied business id for authorization.
 *
 * Branding note: the backend exposes only metadata (`logoUrl`/`coverUrl`,
 * always null until the real file-storage service lands). There is deliberately
 * NO upload client in this slice.
 */

const OWNER_BUSINESSES = '/owner/businesses'
const PUBLIC_BUSINESSES = '/public/businesses'

export function listOwnedBusinesses(signal?: AbortSignal): Promise<OwnerBusinessView[]> {
  return apiRequest<OwnerBusinessView[]>(OWNER_BUSINESSES, { signal }).then(({ data }) => data)
}

export function getOwnedBusiness(businessId: string, signal?: AbortSignal): Promise<OwnerBusinessView> {
  return apiRequest<OwnerBusinessView>(`${OWNER_BUSINESSES}/${businessId}`, { signal }).then(({ data }) => data)
}

export function updateOwnedBusinessProfile(
  businessId: string,
  input: UpdateBusinessProfileInput,
): Promise<OwnerBusinessView> {
  return apiRequest<OwnerBusinessView>(`${OWNER_BUSINESSES}/${businessId}`, {
    method: 'PATCH',
    body: input,
  }).then(({ data }) => data)
}

export function changeOwnedBusinessSlug(businessId: string, publicSlug: string): Promise<OwnerBusinessView> {
  const body: ChangePublicSlugInput = { publicSlug }
  return apiRequest<OwnerBusinessView>(`${OWNER_BUSINESSES}/${businessId}/slug`, {
    method: 'PATCH',
    body,
  }).then(({ data }) => data)
}

export function pauseOwnedBusiness(
  businessId: string,
  input: PauseBusinessInput,
): Promise<OwnerBusinessView> {
  return apiRequest<OwnerBusinessView>(`${OWNER_BUSINESSES}/${businessId}/pause`, {
    method: 'POST',
    body: input,
  }).then(({ data }) => data)
}

export function resumeOwnedBusiness(businessId: string): Promise<OwnerBusinessView> {
  return apiRequest<OwnerBusinessView>(`${OWNER_BUSINESSES}/${businessId}/resume`, {
    method: 'POST',
  }).then(({ data }) => data)
}

export function getPublicBusiness(slug: string, signal?: AbortSignal): Promise<PublicBusinessView> {
  return apiRequest<PublicBusinessView>(`${PUBLIC_BUSINESSES}/${slug}`, { signal }).then(({ data }) => data)
}

export function isNotFoundError(error: unknown): boolean {
  return isApiError(error) && error.kind === 'not-found'
}

// ---------------------------------------------------------------------------
// Primary owned business (single-tenant owner UI). The backend lists the
// businesses the caller actually owns; the first is treated as the primary one
// for this slice. The cache lets the owner layout derive the real public slug
// without duplicating the list fetch; the detail hook refreshes it on reload.
// ---------------------------------------------------------------------------

export interface PrimaryOwnedBusiness {
  id: string
  slug: string
}

let primaryOwned: PrimaryOwnedBusiness | null = null
let primaryLoad: Promise<PrimaryOwnedBusiness> | null = null
const primaryListeners = new Set<() => void>()

export function getPrimaryOwnedBusiness(): PrimaryOwnedBusiness | null {
  return primaryOwned
}

export function setPrimaryOwnedBusiness(next: PrimaryOwnedBusiness | null): void {
  primaryOwned = next
  for (const listener of primaryListeners) listener()
}

export function subscribePrimaryOwnedBusiness(listener: () => void): () => void {
  primaryListeners.add(listener)
  return () => {
    primaryListeners.delete(listener)
  }
}

export function loadPrimaryOwnedBusiness(signal?: AbortSignal): Promise<PrimaryOwnedBusiness> {
  // Collapse concurrent callers (owner layout + pages mount together) into a
  // single network request and one cache write, so a navigation yields one
  // re-render wave instead of several.
  if (primaryLoad && !signal) return primaryLoad
  primaryLoad = (async () => {
    try {
      const list = await listOwnedBusinesses(signal)
      const first = list[0]
      if (!first) {
        throw new ApiError({
          status: 404,
          code: 'NO_OWNED_BUSINESS',
          title: 'No business yet',
          detail: 'Your account does not own a business yet.',
        })
      }
      const primary = { id: first.id, slug: first.slug }
      setPrimaryOwnedBusiness(primary)
      return primary
    } finally {
      primaryLoad = null
    }
  })()
  return primaryLoad
}