import { PRIMARY_BUSINESS_SLUG } from '@/mock/data'

/**
 * Isolated mock owner session.
 *
 * Real authentication is intentionally out of scope for this phase. The owner
 * portal surfaces render against this fixed session so every ownership
 * decision (which business, who the owner is) is explicit and easy to swap for
 * a real Auth result later.
 */
export interface MockOwnerSession {
  owner: {
    id: string
    name: string
    email: string
  }
  businessSlug: string
  /** Marker so the UI can label itself as a demo session, never confuse real auth. */
  isMockSession: true
}

export const ownerSession: MockOwnerSession = {
  owner: {
    id: 'owner-demo',
    name: 'Demo Owner',
    email: 'owner@werefa.demo',
  },
  businessSlug: PRIMARY_BUSINESS_SLUG,
  isMockSession: true,
}