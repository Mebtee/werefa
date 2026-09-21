import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  render,
  screen,
  waitFor,
  type RenderResult,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { appRoutes } from '@/routes'
import {
  installBusinessApiStub,
  type BusinessApiStub,
} from '@/test/businessApi'
import { PRIMARY_BUSINESS_SLUG } from '@/mock/data'
import { getBusiness, getOccupiedBlocks, getServices } from '@/mock/store'
import { computeAvailableTimes } from '@/mock/availability'
import { nextDateStrings } from '@/lib/time'

/**
 * Prompt 48 flow tests: the date & time step now queries the real availability
 * client (one POST per window date) instead of the mock seam. These assert the
 * wire contract (selections, never a client-computed duration), that the date
 * strip reflects exactly what the shared time projection offers, and the
 * per-date / full-list error paths via the stub's controlled failure knob.
 */

const user = userEvent.setup()

const PRIMARY_DURATION = getServices(PRIMARY_BUSINESS_SLUG)[0].baseDurationMinutes
const PRIMARY_IDS = getServices(PRIMARY_BUSINESS_SLUG).map((s) => s.id)

let restoreFetch: (() => void) | undefined
let stub: BusinessApiStub | undefined
let failAvailability: ((date: string) => boolean) | undefined

beforeEach(() => {
  failAvailability = undefined
  const installed = installBusinessApiStub(
    globalThis.fetch,
    { failAvailabilityFor: (date) => failAvailability?.(date) ?? false },
  )
  stub = installed
  restoreFetch = installed.restore
})

afterEach(() => {
  restoreFetch?.()
  restoreFetch = undefined
  stub = undefined
})

function renderPage(): RenderResult {
  const router = createMemoryRouter(appRoutes, {
    initialEntries: ['/p/addis-beauty-lounge'],
  })
  return render(<RouterProvider router={router} />)
}

function availabilityCalls(stub: BusinessApiStub) {
  return stub.calls.filter((c) => c.method === 'POST' && c.url.includes('/availability'))
}

async function reachDateStep() {
  const addButtons = await screen.findAllByRole('button', {
    name: /add to booking/i,
  })
  await user.click(addButtons[0])
  await user.click(
    screen.getByRole('button', { name: /continue[\s–—-]*\d+ selected/i }),
  )
  await screen.findByRole('heading', { name: 'Pick a date and time', level: 2 })
}

function expectedDates() {
  const business = getBusiness(PRIMARY_BUSINESS_SLUG)!
  return nextDateStrings(business.bookingWindowDays).map((date) => ({
    date,
    hasTimes:
      computeAvailableTimes(
        business,
        date,
        PRIMARY_DURATION,
        getOccupiedBlocks(PRIMARY_BUSINESS_SLUG, date),
      ).length > 0,
  }))
}

describe('availability API integration in the date & time step', () => {
  it('asks the availability endpoint once per window date with the selections, not a duration', async () => {
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })
    await reachDateStep()
    await waitFor(() => {
      expect(container.querySelectorAll('.date-chip').length).toBeGreaterThan(0)
    })

    const calls = availabilityCalls(stub!)
    expect(calls).toHaveLength(
      nextDateStrings(getBusiness(PRIMARY_BUSINESS_SLUG)!.bookingWindowDays).length,
    )
    const dates = new Set<string>()
    for (const call of calls) {
      const body = call.body as { date: string; selections: unknown }
      expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      dates.add(body.date)
      expect(body.selections).toEqual([{ serviceId: PRIMARY_IDS[0] }])
      expect('durationMinutes' in body).toBe(false)
      expect('totalPriceMinor' in body).toBe(false)
    }
    expect(dates.size).toBe(calls.length)
  })

  it('re-queries with the fuller selection once a second service is added', async () => {
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })
    const addButtons = await screen.findAllByRole('button', {
      name: /add to booking/i,
    })
    await user.click(addButtons[0])
    const continueButton = screen.getByRole('button', {
      name: /continue[\s–—-]*\d+ selected/i,
    })
    await user.click(continueButton)

    await waitFor(() => {
      expect(container.querySelectorAll('.date-chip').length).toBeGreaterThan(0)
    })
    const firstBatch = availabilityCalls(stub!)

    await user.click(screen.getByRole('button', { name: /^back$/i }))
    const addButtons2 = await screen.findAllByRole('button', {
      name: /add to booking/i,
    })
    await user.click(addButtons2[1])
    await user.click(
      screen.getByRole('button', { name: /continue[\s–—-]*\d+ selected/i }),
    )
    await waitFor(() => {
      expect(availabilityCalls(stub!).length).toBeGreaterThan(firstBatch.length)
    })

    // The selections must carry whatever services the customer actually chose
    // (the API derives duration/price itself), regardless of card presentation
    // order — so derive the expected pair from the page the customer saw.
    const firstName =
      (addButtons[0].closest('.service-card')?.querySelector('.service-card__name')
        ?.textContent ?? '').trim()
    const secondName =
      (addButtons2[1].closest('.service-card')?.querySelector('.service-card__name')
        ?.textContent ?? '').trim()
    const nameToId = new Map(
      getServices(PRIMARY_BUSINESS_SLUG).map((s) => [s.name, s.id]),
    )
    const expectedIds = new Set([nameToId.get(firstName), nameToId.get(secondName)])

    const all = availabilityCalls(stub!)
    const later = all.slice(firstBatch.length)
    expect(later.length).toBeGreaterThan(0)
    for (const call of later) {
      const body = call.body as { selections: { serviceId: string }[] }
      expect(body.selections).toHaveLength(2)
      const picked = new Set(body.selections.map((s) => s.serviceId))
      expect(picked).toEqual(expectedIds)
    }
  })

  it('renders a disabled chip exactly for window dates with nothing to offer', async () => {
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })
    await reachDateStep()
    await waitFor(() => {
      expect(container.querySelectorAll('.date-chip').length).toBe(
        getBusiness(PRIMARY_BUSINESS_SLUG)!.bookingWindowDays,
      )
    })

    const expected = expectedDates()
    const chips = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.date-chip'),
    )
    expect(chips).toHaveLength(expected.length)
    for (let i = 0; i < chips.length; i += 1) {
      const chip = chips[i]
      const dateLabel = chip.querySelector('.date-chip__date')?.textContent
      expect(dateLabel).toBe(expected[i].date)
      expect(chip.disabled).toBe(!expected[i].hasTimes)
    }
  })

  it('shows the retryable error state when every window-date lookup fails', async () => {
    renderPage()

    await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })
    failAvailability = () => true
    await reachDateStep()

    expect(
      await screen.findByRole('heading', { name: 'Pick a date and time', level: 2 }),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Could not load the date list')).toBeInTheDocument()
    expect(document.querySelector('.date-chip')).not.toBeInTheDocument()

    failAvailability = () => false
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => {
      expect(document.querySelectorAll('.date-chip').length).toBeGreaterThan(0)
    })
  })

  it('shows the retryable error state when a selected date’s lookup fails', async () => {
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })
    await reachDateStep()
    await waitFor(() => {
      expect(container.querySelectorAll('.date-chip').length).toBeGreaterThan(0)
    })

    const chips = Array.from(container.querySelectorAll<HTMLButtonElement>('.date-chip'))
    const enabled = chips.find((chip) => !chip.disabled)
    if (!enabled) throw new Error('no enabled date chip found')
    const target = enabled.querySelector('.date-chip__date')?.textContent
    if (!target) throw new Error('date chip label missing')

    failAvailability = (date) => date === target
    await user.click(enabled)
    await waitFor(() => {
      expect(screen.getByText('Could not load the times')).toBeInTheDocument()
    })
    expect(
      screen.getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument()

    failAvailability = () => false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(
        container.querySelectorAll('.time-grid__item button').length,
      ).toBeGreaterThan(0)
    })
  })
})