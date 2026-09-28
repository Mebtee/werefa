import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OwnerBusinessView, OwnerServiceView } from '@/api/types'
import { renderAppAt } from '@/test/auth'

/**
 * Regression (Prompt 67 follow-up).
 *
 * A freshly created business has never published a schedule version, so the
 * backend answers 404 for `GET /owner/businesses/:id/schedule/current` with
 * `{ code: 'NOT_FOUND' }` and "No active schedule version."
 *
 * The owner Schedule page mapped that 404 to a fatal load error and left its
 * form state null, so it rendered the error screen instead of the editor — and
 * because the page could only ever re-request the same missing version, the
 * retry button could never succeed. A new owner was therefore unable to set
 * working hours at all, which is the only way to create version 1.
 *
 * The page must open on a blank week and let the owner save the first schedule.
 */

const user = userEvent.setup()

function business(id: string, slug: string, name: string): OwnerBusinessView {
  return {
    id,
    slug,
    name,
    category: { code: 'SALON_AND_BARBER', label: 'Salon & Barber' },
    description: `${name} description`,
    address: `${name} address`,
    phonePublic: null,
    coordinates: { latitude: null, longitude: null },
    isDeactivated: false,
    isPaused: false,
    pauseMessage: null,
    reopenAt: null,
    bookingIntervalMinutes: 30,
    prepaymentMode: 'NONE',
    prepaymentPercent: null,
    prepaymentFixedMinor: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function service(id: string, name: string): OwnerServiceView {
  return {
    id,
    name,
    basePriceMinor: 1000,
    baseDurationMinutes: 30,
    isActive: true,
    variations: [],
    addOns: [],
  }
}

const alpha = business('business-alpha', 'alpha-salon', 'Alpha Salon')
const beta = business('business-beta', 'beta-studio', 'Beta Studio')

/** Two owned businesses, mirroring a real multi-business owner account. */
const twoBusinesses = {
  ownedBusinesses: [alpha, beta],
  servicesByBusinessId: {
    [alpha.id]: [service('service-alpha', 'Alpha haircut')],
    [beta.id]: [service('service-beta', 'Beta styling')],
  },
}

/** The `.hours-day` section whose label is `name`. */
function hoursDay(name: string): HTMLElement {
  const section = screen
    .getAllByText(name)
    .map((candidate) => candidate.closest('.hours-day'))
    .find((container): container is HTMLElement => Boolean(container))
  if (!section) throw new Error(`No hours-day section for ${name}`)
  return section
}

/** A real backend error envelope, so the API client classifies it properly. */
function serverError(): Response {
  return new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', title: 'Error', fields: null } }), {
    status: 500,
    headers: { 'content-type': 'application/json' },
  })
}

describe('owner schedule page under StrictMode (the real entry point)', () => {
  // `main.tsx` renders <App /> inside <StrictMode>, which double-invokes effects:
  // mount, cleanup, mount. The page used to gate its load behind a one-shot
  // `initialized` latch that it set *before* awaiting, while its cleanup set
  // `cancelled = true`. The first run's request was therefore cancelled by its
  // own cleanup and the second run skipped the work entirely, so the only
  // response ever received was discarded. `form` stayed null and the page
  // rendered "Loading your business" forever with no error and no retry —
  // reproduced against the running app, where /schedule/current returned 404
  // and was silently dropped.
  it('reaches the editor on the 404 no-schedule path', async () => {
    renderAppAt('/owner/schedule', { businessApi: { noScheduleVersionYet: true }, strict: true })

    expect(await screen.findByRole('heading', { name: 'Working hours' }, { timeout: 10000 })).toBeInTheDocument()
    expect(screen.queryByText('Loading your business')).not.toBeInTheDocument()
    expect(document.querySelectorAll('.hours-day')).toHaveLength(7)
  })

  it('reaches the editor on the has-schedule path', async () => {
    renderAppAt('/owner/schedule', { strict: true })

    expect(await screen.findByRole('heading', { name: 'Working hours' }, { timeout: 10000 })).toBeInTheDocument()
    expect(document.querySelectorAll('.hours-day')).toHaveLength(7)
  })

  it('reaches the editor for a multi-business owner with a persisted selection', async () => {
    renderAppAt('/owner/schedule', {
      businessApi: { ...twoBusinesses, noScheduleVersionYet: true },
      initialSelectedBusinessId: alpha.id,
      strict: true,
    })

    expect(await screen.findByRole('heading', { name: 'Working hours' }, { timeout: 10000 })).toBeInTheDocument()
    expect(screen.queryByText('Loading your business')).not.toBeInTheDocument()
  })
})

describe('owner schedule page leaves its loading state on every outcome', () => {
  it('business list failure exits loading and offers a retry', async () => {
    // A parent-provider failure must not leave this route spinning.
    renderAppAt('/owner/schedule', {
      businessApi: {
        failOwnerBusinessRequest: ({ path }) =>
          path === '/api/v1/owner/businesses' ? serverError() : null,
      },
      strict: true,
    })

    expect(
      await screen.findByText('Business workspace unavailable', undefined, { timeout: 4000 }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(document.querySelector('.spinner-wrap')).toBeNull()
  })

  it('a schedule failure that is not "no version yet" exits loading into the error state', async () => {
    renderAppAt('/owner/schedule', {
      businessApi: {
        noScheduleVersionYet: true,
        failOwnerBusinessRequest: ({ path }) =>
          path.endsWith('/schedule/current') ? serverError() : null,
      },
      strict: true,
    })

    expect(
      await screen.findByText('Could not load your business data', undefined, { timeout: 4000 }),
    ).toBeInTheDocument()
    expect(document.querySelector('.spinner-wrap')).toBeNull()
  })
})

describe('owner schedule page when the business has no schedule version yet', () => {
  it('opens the working-hours editor instead of a dead-end error', async () => {
    renderAppAt('/owner/schedule', { businessApi: { noScheduleVersionYet: true } })

    // The editor renders — not the generic "could not find" load failure.
    expect(await screen.findByRole('heading', { name: 'Working hours' }, { timeout: 10000 })).toBeInTheDocument()
    expect(screen.queryByText(/We could not find what you were looking for/)).not.toBeInTheDocument()

    // All seven weekdays are present and start closed, with no version yet.
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
      expect(within(hoursDay(day)).getByRole('button', { name: 'Closed' })).toBeInTheDocument()
    }
  })

  it('lets the owner create the first schedule version', async () => {
    renderAppAt('/owner/schedule', { businessApi: { noScheduleVersionYet: true } })

    await screen.findByRole('heading', { name: 'Working hours' }, { timeout: 10000 })

    // Open Monday. The toggle seeds a default 09:00–17:00 period, so this is a
    // first version created from the empty state with no other setup.
    await user.click(within(hoursDay('Monday')).getByRole('button', { name: 'Closed' }))
    expect(within(hoursDay('Monday')).getByLabelText('Monday period 1 start')).toHaveValue('09:00')
    expect(within(hoursDay('Monday')).getByLabelText('Monday period 1 end')).toHaveValue('17:00')

    await user.click(screen.getByRole('button', { name: 'Save schedule' }))

    expect(await screen.findByText(/Schedule saved\./)).toBeInTheDocument()

    // The page is now showing a real version rather than the empty state.
    await waitFor(() => {
      expect(screen.queryByText(/We could not find what you were looking for/)).not.toBeInTheDocument()
    })
  })

  it('opens the editor for a multi-business owner with no schedule version', async () => {
    // The real account owns two businesses and has one of them selected, so the
    // schedule route must render on a selection — not sit on a spinner.
    const { stub } = renderAppAt('/owner/schedule', {
      businessApi: { ...twoBusinesses, noScheduleVersionYet: true },
      initialSelectedBusinessId: alpha.id,
    })

    expect(await screen.findByRole('heading', { name: 'Working hours' }, { timeout: 10000 })).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()

    // The selected business drives the editor.
    expect(within(hoursDay('Monday')).getByRole('button', { name: 'Closed' })).toBeInTheDocument()

    // The editor reads only the business, so it must not wait on the service
    // catalog or the booking list. Both used to be fetched here and the page
    // stayed on its spinner until they settled, even though neither is rendered.
    const getUrls = stub.calls
      .filter((call) => call.method === 'GET')
      .map((call) => call.url)
    expect(getUrls.some((url) => url.endsWith(`/owner/businesses/${alpha.id}/services`))).toBe(false)
    expect(getUrls.some((url) => url.endsWith(`/owner/businesses/${alpha.id}/bookings`))).toBe(false)
  })
})
