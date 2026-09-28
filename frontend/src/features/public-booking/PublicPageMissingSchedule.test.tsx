import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, type RenderResult } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { appRoutes } from '@/routes'
import { installBusinessApiStub } from '@/test/businessApi'

/**
 * Regression (Prompt 67 follow-up).
 *
 * `GET /public/businesses/:slug/schedule` answers 404 with
 * `{ code: 'NOT_FOUND' }` when a business has never published a schedule, and
 * the backend deliberately reports that as "No active schedule version." — a
 * brand-new business has no working hours yet, so this is an ordinary empty
 * state.
 *
 * The public page used to load the business, the service catalog and the
 * schedule in a single `Promise.all`, so that schedule 404 rejected the whole
 * batch and the catch mapped any not-found to the "Business not found" page.
 * The business existed and had been fetched successfully (200), yet the owner
 * who followed "View public page" was told the business did not exist.
 *
 * Only the business lookup may report a missing business. A missing schedule
 * must render the real business with no bookable slots.
 */

const SLUG = 'addis-beauty-lounge'

let restoreFetch: (() => void) | undefined

function renderPage(initialPath = `/p/${SLUG}`): RenderResult {
  const router = createMemoryRouter(appRoutes, { initialEntries: [initialPath] })
  return render(<RouterProvider router={router} />)
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** The real backend's 404 for a business with no published schedule version. */
function scheduleNotFound(): Response {
  return json({ error: { code: 'NOT_FOUND', title: 'NOT_FOUND', fields: null } }, 404)
}

function businessNotFound(): Response {
  return json(
    { error: { code: 'NOT_FOUND', title: 'Not found', detail: 'Business not found.', fields: null } },
    404,
  )
}

/**
 * Installs the real-client API stub, then forces one public route to fail so
 * the page's resilience to that single failure can be asserted.
 */
function installStub(overrides: (url: string) => Response | undefined): void {
  // `installBusinessApiStub` swaps `globalThis.fetch` for the real-client double
  // and keeps the original for `restore()`, so wrap what it installed.
  const installed = installBusinessApiStub(globalThis.fetch)
  const doubleFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const override = overrides(url)
    if (override) return override
    return doubleFetch(input, init)
  }) as typeof fetch
  restoreFetch = () => {
    installed.restore()
  }
}

beforeEach(() => {
  document.title = ''
})

afterEach(() => {
  restoreFetch?.()
  restoreFetch = undefined
})

describe('public page when the business has no schedule yet', () => {
  it('renders the real business instead of "Business not found" when only the schedule 404s', async () => {
    let scheduleCalls = 0
    installStub((url) => {
      if (url.includes(`/public/businesses/${SLUG}/schedule`)) {
        scheduleCalls += 1
        return scheduleNotFound()
      }
      return undefined
    })

    renderPage()

    // The real business profile is fetched and rendered, not a not-found alert.
    await waitFor(() => {
      expect(screen.getByText('Addis Beauty Lounge')).toBeInTheDocument()
    })
    expect(screen.queryByText('Business not found')).not.toBeInTheDocument()
    expect(screen.queryByText(/No business was found at this address/)).not.toBeInTheDocument()
    expect(screen.queryByText('Could not load this page')).not.toBeInTheDocument()

    // The missing schedule was actually requested and then tolerated, not skipped.
    expect(scheduleCalls).toBeGreaterThan(0)
  })

  it('still reports "Business not found" when the business lookup itself 404s', async () => {
    installStub((url) => {
      if (new RegExp(`/public/businesses/${SLUG}$`).test(new URL(url).pathname)) {
        return businessNotFound()
      }
      return undefined
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Business not found')).toBeInTheDocument()
    })
    expect(screen.getByText(/No business was found at this address/)).toBeInTheDocument()
  })
})
