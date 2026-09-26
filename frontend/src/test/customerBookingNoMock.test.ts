import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * No-mock migration boundary (Prompt 55).
 *
 * The customer booking path (public business page → wizard → status page →
 * not-found/home) must never import the `@/mock/*` seam in production: the
 * public context, services, availability, booking creation, payment state and
 * Telegram connection all flow through the real API clients. The `@/mock/*`
 * seam remains only for deterministic test fixtures and test doubles.
 */

async function source(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

describe('customer booking path is wired to the real API (no mock in production)', () => {
  it('PublicBookingPage loads the public business, services and schedule from real clients only', async () => {
    const s = await source('src/features/public-booking/PublicBookingPage.tsx')
    expect(s).not.toMatch(/@\/mock\//)
    expect(s).not.toMatch(/mockApi\./)
    expect(s).not.toMatch(/getBusinessPage\(/)
    expect(s).toMatch(/from ['"]@\/api\/business['"]/)
    expect(s).toMatch(/getPublicBusiness\(/)
    expect(s).toMatch(/getPublicServices\(/)
    expect(s).toMatch(/hybridizePublicBusiness\(/)
    expect(s).toMatch(/getPublicSchedule\(/)
  })

  it('BookingStatusPage never seeds services from the mock seam', async () => {
    const s = await source('src/features/customer-status/BookingStatusPage.tsx')
    expect(s).not.toMatch(/@\/mock\//)
    expect(s).not.toMatch(/mockApi\./)
    expect(s).not.toMatch(/mockPage/)
    expect(s).toMatch(/getCustomerBookingStatus\(/)
    expect(s).toMatch(/hybridizePublicBusiness\(/)
    expect(s).not.toMatch(/services: mockPage/)
  })

  it('BookingWizard and useBookingFlow keep the mock seam off the production path', async () => {
    const wizard = await source('src/features/public-booking/components/BookingWizard.tsx')
    const flow = await source('src/features/public-booking/state/useBookingFlow.ts')
    const payment = await source('src/features/public-booking/components/steps/PaymentStep.tsx')
    for (const s of [wizard, flow, payment]) {
      expect(s).not.toMatch(/@\/mock\//)
      expect(s).not.toMatch(/mockApi\./)
    }
    expect(flow).toMatch(/createCustomerBooking\(/)
    expect(flow).not.toMatch(/business\.prepayment\.mode/)
  })

  it('the router and not-found page use the site (non-mock) home slug', async () => {
    const router = await source('src/routes/router.tsx')
    const notFound = await source('src/pages/NotFoundPage.tsx')
    for (const s of [router, notFound]) {
      expect(s).not.toMatch(/@\/mock\//)
      expect(s).toMatch(/@\/config\/site['"]/)
    }
  })

  it('the payment/proof requirement comes from the real backend deposit, not mock prepayment state', async () => {
    const step = await source('src/features/public-booking/components/steps/DateTimeStep.tsx')
    expect(step).toMatch(/onDeposit\?\.\(/)
    const flow = await source('src/features/public-booking/state/useBookingFlow.ts')
    expect(flow).toMatch(/requiresPayment = \(depositMinor \?\? 0\) > 0/)
  })
})