import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * No-mock migration boundary (Prompt 47).
 *
 * The owner schedule and public schedule verticals now consume the real
 * schedule API, so the SCHEDULE data in those production paths must never flow
 * from the `@/mock/*` seam. The seam is still legitimately used for what this
 * slice does not cover yet (booking creation, cancellation and rescheduling),
 * so the assertions below check the specific schedule signals rather than
 * blanket mock imports.
 */

async function source(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

describe('schedule is wired to the real API (no mock on the production path)', () => {
  it('SchedulePage reads and saves the schedule through the @/api client only', async () => {
    const s = await source('src/features/owner-portal/pages/SchedulePage.tsx')
    expect(s).toMatch(/from ['"]@\/api\/schedule['"]/)
    expect(s).not.toMatch(/@\/mock\//)
    expect(s).toMatch(/getOwnerSchedule\(/)
    expect(s).toMatch(/listOwnerScheduleVersions\(/)
    expect(s).toMatch(/listOwnerScheduleConflicts\(/)
    expect(s).toMatch(/saveOwnerSchedule\(/)
    expect(s).toMatch(/updateOwnerScheduleInterval\(/)
    expect(s).toMatch(/getScheduleViewFromApi|scheduleFormFromApi/)
  })

  it('the SchedulePage mirror seam is gone from the codebase', async () => {
    const s = await source('src/features/owner-portal/pages/SchedulePage.tsx')
    expect(s).not.toMatch(/mirrorScheduleIntoBusiness/)
    expect(s).not.toMatch(/@\/mock\/scheduleMirror/)
  })

  it('Keep Booking in ScheduleConflicts records a Schedule Exception through the API, not the mock', async () => {
    const s = await source('src/features/owner-portal/components/ScheduleConflicts.tsx')
    expect(s).toMatch(/recordScheduleException\(/)
    expect(s).toMatch(/from ['"]@\/api\/schedule['"]/)
    expect(s).not.toMatch(/mockOwnerApi\.recordScheduleException/)
    expect(s).not.toMatch(/mockOwnerApi\.applyScheduleException/)
  })

  it('ScheduleHistory renders API-derived entries without touching the mock store', async () => {
    const s = await source('src/features/owner-portal/components/ScheduleHistory.tsx')
    expect(s).not.toMatch(/@\/mock\//)
    expect(s).toMatch(/describeVersionChange\(/)
  })

  it('PublicBookingPage takes its schedule from getPublicSchedule, not the mock page', async () => {
    const s = await source('src/features/public-booking/PublicBookingPage.tsx')
    expect(s).toMatch(/getPublicSchedule\(/)
    expect(s).toMatch(/availabilityScheduleFromView\(/)
    expect(s).not.toMatch(/mockPage\?\.workingHours/)
    expect(s).not.toMatch(/getBusinessPage.*workingHours/)
    expect(s).not.toMatch(/mockPage\?\.specialDays/)
  })
})