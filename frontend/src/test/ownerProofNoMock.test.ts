import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * No-mock migration boundary for the owner payment-proof review (Prompt 51).
 *
 * The review surface now consumes the real owner routes, so its client, mapper
 * and controller must not flow through the `@/mock/*` seam, and the detail page
 * must not accept/reject through `mockOwnerApi` any more. Unrelated owner
 * actions (reschedule/cancel/No Show/release) are still mock in this slice, so
 * the page may keep using `mockOwnerApi` for those — only the proof-review
 * operations are asserted to be real.
 */

async function source(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

describe('owner payment-proof review is wired to the real API', () => {
  it('api/ownerBookings calls the real owner routes and never the mock seam', async () => {
    const s = await source('src/api/ownerBookings.ts')
    expect(s).toMatch(/from ['"]\.\/http['"]/)
    expect(s).toMatch(/getOwnerBookingDetail\(/)
    expect(s).toMatch(/acceptOwnerBooking\(/)
    expect(s).toMatch(/rejectOwnerBooking\(/)
    expect(s).toMatch(/downloadOwnerBookingProof\(/)
    expect(s).toMatch(/\/owner\/businesses\//)
    expect(s).toMatch(/\/proofs\//)
    expect(s).not.toMatch(/@\/mock\//)
  })

  it('the HTTP client exposes an authenticated binary download', async () => {
    const s = await source('src/api/http.ts')
    expect(s).toMatch(/export async function apiDownload/)
    expect(s).toMatch(/credentials: 'include'/)
    expect(s).toMatch(/fileNameFromContentDisposition/)
  })

  it('the review controller and mapper never touch the mock seam', async () => {
    const controller = await source('src/features/owner-portal/state/usePaymentReview.ts')
    expect(controller).toMatch(/from ['"]@\/api\/ownerBookings['"]/)
    expect(controller).not.toMatch(/@\/mock\//)

    const mapper = await source('src/features/owner-portal/lib/paymentReview.ts')
    expect(mapper).toMatch(/@\/api\/types/)
    expect(mapper).not.toMatch(/@\/mock\//)
  })

  it('the detail page accepts/rejects through the real review, not the mock owner API', async () => {
    const s = await source('src/features/owner-portal/pages/BookingDetailPage.tsx')
    expect(s).toMatch(/usePaymentReview/)
    expect(s).not.toMatch(/mockOwnerApi\.acceptBooking/)
    expect(s).not.toMatch(/mockOwnerApi\.rejectBooking/)
    // The migrated surface must not render the mock proof metadata card.
    expect(s).not.toMatch(/Preview only/)
    expect(s).not.toMatch(/booking\.proof\.fileName/)
  })
})
