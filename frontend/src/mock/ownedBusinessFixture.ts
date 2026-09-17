import { PRIMARY_BUSINESS_SLUG } from '@/mock/data'

/**
 * Temporary mock *business-data* fixture (NOT authentication).
 *
 * Real authentication now lives in `@/features/auth` against the backend. Until
 * the business/services/schedule/bookings domain is migrated to the API, the
 * owner portal still reads its domain data from the in-memory mock store. This
 * module holds the small slice of state that the mock store used to borrow from
 * the old `ownerSession`: which business the demo data belongs to, and the
 * display name used for mock history entries.
 *
 * It deliberately contains no credentials, no role and no session — those come
 * only from the backend. Replace this along with the rest of `@/mock` when the
 * domain is migrated.
 */
export const MOCK_OWNER_ACTOR_NAME = 'Demo Owner'

let ownedBusinessSlug = PRIMARY_BUSINESS_SLUG

/** The business slug the mock domain data is currently scoped to. */
export function getMockOwnedBusinessSlug(): string {
  return ownedBusinessSlug
}

/** Re-point the mock domain data at another business (mock store only). */
export function setMockOwnedBusinessSlug(slug: string): void {
  ownedBusinessSlug = slug
}

/** Restore the default demo business (used by the mock store reset). */
export function resetMockOwnedBusinessSlug(): void {
  ownedBusinessSlug = PRIMARY_BUSINESS_SLUG
}
