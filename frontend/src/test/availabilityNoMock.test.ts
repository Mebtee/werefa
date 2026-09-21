import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * No-mock migration boundary (Prompt 48).
 *
 * The public date & time step now consumes the real availability API client
 * (one POST per window date) instead of the `@/mock` availability seam, and it
 * must never know the front-end appointment duration — the backend computes
 * the totals (REQ-074). The mock seam stays for what this slice does not cover
 * yet (booking creation, cancellation and rescheduling).
 */

async function source(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

describe('availability is wired to the real API (no mock on the production path)', () => {
  it('DateTimeStep consumes @/api/availability and never the mock seam', async () => {
    const s = await source('src/features/public-booking/components/steps/DateTimeStep.tsx')
    expect(s).toMatch(/from ['"]@\/api\/availability['"]/)
    expect(s).toMatch(/getPublicAvailability\(/)
    expect(s).toMatch(/bookingDatesFromViews\(/)
    expect(s).toMatch(/slotTimesFromView\(/)
    expect(s).not.toMatch(/@\/mock\//)
    expect(s).not.toMatch(/mockApi\.getBookingDates/)
    expect(s).not.toMatch(/mockApi\.getSlotTimes/)
    expect(s).not.toMatch(/totalDurationMinutes/)
  })

  it('BookingWizard passes the flow selections into DateTimeStep', async () => {
    const s = await source('src/features/public-booking/components/BookingWizard.tsx')
    expect(s).toMatch(/selections=\{flow\.selections\}/)
  })
})