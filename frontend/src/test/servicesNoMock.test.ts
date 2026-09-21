import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * No-mock migration boundary (Prompt 46).
 *
 * The owner services and public booking verticals now consume the real Service
 * Catalog API, so the SERVICE data in those production paths must never flow
 * from the `@/mock/*` seam. The seam is still legitimately used for what this
 * slice does not cover yet (owner profile cosmetics, today preview, booking
 * creation), so the assertions below check the specific service signals rather
 * than blanket mock imports.
 */

async function source(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

describe('service catalog is wired to the real API (no mock on the production path)', () => {
  it('useOwnedBusiness loads services through listOwnerServices, not the mock store', async () => {
    const s = await source('src/features/owner-portal/state/useOwnedBusiness.ts')
    expect(s).toMatch(/from ['"]@\/api\/catalog['"]/)
    expect(s).not.toMatch(/mockOwnerApi\.getServices/)
    expect(s).toMatch(/listOwnerServices\(/)
  })

  it('ServicesPage deactivating/reactivating hits the real endpoints', async () => {
    const s = await source('src/features/owner-portal/pages/ServicesPage.tsx')
    expect(s).toMatch(/from ['"]@\/api\/catalog['"]/)
    expect(s).not.toMatch(/mockOwnerApi/)
    expect(s).not.toMatch(/mockOwnerApi\.setServiceActive/)
    expect(s).toMatch(/deactivateOwnerService\(/)
    expect(s).toMatch(/reactivateOwnerService\(/)
  })

  it('ServiceEditorPage keeps the mock store out of create/update', async () => {
    const s = await source('src/features/owner-portal/pages/ServiceEditorPage.tsx')
    expect(s).not.toMatch(/@\/mock\//)
    expect(s).toMatch(/createOwnerService\(/)
    expect(s).toMatch(/updateOwnerService\(/)
    expect(s).toMatch(/createServiceVariation\(/)
    expect(s).toMatch(/createServiceAddOn\(/)
  })

  it('PublicBookingPage takes its services from getPublicServices, not the mock page', async () => {
    const s = await source('src/features/public-booking/PublicBookingPage.tsx')
    expect(s).toMatch(/getPublicServices\(/)
    expect(s).not.toMatch(/mockPage\?\.services/)
    expect(s).not.toMatch(/getBusinessPage.*services/)
  })

  it('useBookingFlow submits selections to the real customer booking API, never the mock', async () => {
    const s = await source('src/features/public-booking/state/useBookingFlow.ts')
    expect(s).toMatch(/from ['"]@\/api\/booking['"]/)
    expect(s).toMatch(/createCustomerBooking\(/)
    expect(s).not.toMatch(/@\/mock\//)
    expect(s).not.toMatch(/getServices\(/)
  })

  it('mock createBooking keeps demanding the real services it must not resolve itself', async () => {
    const s = await source('src/mock/api.ts')
    expect(s).toMatch(/createBooking\(draft, business, services, durationMinutes\)/)
    expect(s).not.toMatch(/const services = getServices\(business\.slug\)/)
    expect(s).toMatch(/buildLineItems\(services, draft\.selections\)/)
  })
})