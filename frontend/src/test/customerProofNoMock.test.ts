import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * No-mock migration boundary for payment proof (Prompt 50).
 *
 * The customer payment-proof workflow now consumes the real backend routes, so
 * the proof data on those paths must never flow from the `@/mock/*` seam, and
 * the client must speak the real multipart contract. The owner review UI is a
 * deliberately deferred slice and keeps using the mock seam, so these checks
 * target the customer paths only.
 */

async function source(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

describe('payment proof is wired to the real API (no mock on the customer path)', () => {
  it('api/booking sends the proof over multipart to the real routes', async () => {
    const s = await source('src/api/booking.ts')
    expect(s).toMatch(/from ['"]\.\/http['"]/)
    expect(s).toMatch(/instanceof FormData|new FormData\(\)/)
    expect(s).toMatch(/form\.append\('payload'/)
    expect(s).toMatch(/form\.append\('proof'/)
    expect(s).toMatch(/createCustomerBooking\(/)
    expect(s).toMatch(/requestResubmissionCode\(/)
    expect(s).toMatch(/verifyResubmission\(/)
    expect(s).not.toMatch(/@\/mock\//)
  })

  it('the HTTP client lets FormData set its own Content-Type', async () => {
    const s = await source('src/api/http.ts')
    expect(s).toMatch(/options\.body instanceof FormData/)
    // The multipart branch must run before the JSON stringify/Content-Type.
    const formDataIndex = s.indexOf('options.body instanceof FormData')
    const jsonIndex = s.indexOf("headers['Content-Type'] = 'application/json'")
    expect(formDataIndex).toBeGreaterThan(-1)
    expect(formDataIndex).toBeLessThan(jsonIndex)
  })

  it('useBookingFlow uploads the raw proof file to the real booking API', async () => {
    const s = await source('src/features/public-booking/state/useBookingFlow.ts')
    expect(s).toMatch(/from ['"]@\/api\/booking['"]/)
    expect(s).toMatch(/createCustomerBooking\(/)
    expect(s).toMatch(/proof\?\.file/)
    expect(s).not.toMatch(/@\/mock\//)
  })

  it('ResubmissionPanel verifies through the real API and never claims a code was sent', async () => {
    const s = await source('src/features/customer-status/ResubmissionPanel.tsx')
    expect(s).toMatch(/from ['"]@\/api\/booking['"]/)
    expect(s).toMatch(/requestResubmissionCode\(/)
    expect(s).toMatch(/verifyResubmission\(/)
    expect(s).not.toMatch(/@\/mock\//)
    // Delivery is out of scope, so the copy must not claim a code was sent.
    expect(s).not.toMatch(/code\s+(was\s+)?sent/i)
    expect(s).not.toMatch(/we\s+(have\s+)?sent/i)
  })

  it('the status page offers resubmission from the real panel, not the mock', async () => {
    const s = await source('src/features/customer-status/BookingStatusPage.tsx')
    expect(s).toMatch(/ResubmissionPanel/)
    expect(s).not.toMatch(/mockOwnerApi/)
    expect(s).toMatch(/onResubmit/)
  })

  it('the upload copy no longer pretends nothing is uploaded', async () => {
    const s = await source('src/features/public-booking/components/steps/PaymentStep.tsx')
    expect(s).not.toMatch(/nothing is really uploaded/i)
    expect(s).not.toMatch(/@\/mock\//)
  })
})
