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

  it('no route, page or config hard-codes a demo business identity', async () => {
    const router = await source('src/routes/router.tsx')
    const notFound = await source('src/pages/NotFoundPage.tsx')
    const site = await source('src/config/site.ts')
    const publicPage = await source('src/features/public-booking/PublicBookingPage.tsx')
    const statusPage = await source('src/features/customer-status/BookingStatusPage.tsx')
    for (const s of [router, notFound, publicPage, statusPage]) {
      expect(s).not.toMatch(/@\/mock\//)
      expect(s).not.toMatch(/SITE_HOME_SLUG/)
      // The demo businesses that used to back these surfaces must not appear.
      expect(s).not.toMatch(/addis-beauty-lounge|marathon-auto-care|riverside-dry-cleaning/)
      // No user-visible offer of a demo business.
      expect(s).not.toMatch(/go to the demo|the demo business/i)
    }
    // The site config carries no business identity at all any more.
    expect(site).not.toMatch(/addis-beauty-lounge/)
    expect(site).not.toMatch(/SITE_HOME_SLUG\s*=/)
    // `/` is not a redirect into a seeded business; it falls through to 404.
    expect(router).not.toMatch(/path:\s*'\/'[\s\S]{0,200}?Navigate/)
  })

  it('the public payment step never shows invented payment instructions', async () => {
    const step = await source('src/features/public-booking/components/steps/PaymentStep.tsx')
    expect(step).not.toMatch(/PAYMENT_METHOD_FALLBACK/)
    expect(step).not.toMatch(/Demo Bank|placeholder/i)
    // The deposit amount still comes from the backend availability view.
    expect(step).toMatch(/formatMoney\(deposit, business\.currency\)/)
  })

  it('the payment/proof requirement comes from the real backend deposit, not mock prepayment state', async () => {
    const step = await source('src/features/public-booking/components/steps/DateTimeStep.tsx')
    expect(step).toMatch(/onDeposit\?\.\(/)
    const flow = await source('src/features/public-booking/state/useBookingFlow.ts')
    expect(flow).toMatch(/requiresPayment = \(depositMinor \?\? 0\) > 0/)
  })
})