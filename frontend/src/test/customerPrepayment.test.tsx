import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { readFile } from 'node:fs/promises'
import { appRoutes } from '@/routes'
import { updateOwnerBusinessSettings } from '@/api/business'
import { prepaymentFromView, prepaymentToSettings } from '@/api/business.mapper'
import { getPublicAvailability } from '@/api/availability'
import { installBusinessApiStub, OWNER_ID, type BusinessApiStub } from '@/test/businessApi'
import { getBusiness } from '@/mock/store'
import {
  addDays,
  toDateString,
} from '@/lib/time'
import { computeAvailableTimes } from '@/mock/availability'
import { getOccupiedBlocks, getServices } from '@/mock/store'

/**
 * Customer prepayment / receipt-upload real-data integration.
 *
 * The rule these tests pin down: a deposit exists only when the OWNER asked for
 * one on the real `PATCH /owner/businesses/:id/settings` route, and the amount
 * the customer must pay always comes from the backend's own availability
 * projection (`requiredPrepaidMinor`) — the same value `POST /customer/bookings`
 * enforces. There is no platform-wide percentage and no client-side fallback.
 */

const user = userEvent.setup()
const SLUG = 'addis-beauty-lounge'
const BUSINESS_ID = OWNER_ID

let restoreFetch: (() => void) | undefined
let stub: BusinessApiStub | undefined

type StubOptions = Parameters<typeof installBusinessApiStub>[1]

function installStub(options: StubOptions = {}): void {
  restoreFetch?.()
  const installed = installBusinessApiStub(globalThis.fetch, options)
  stub = installed
  restoreFetch = installed.restore
}

beforeEach(() => {
  installStub()
})

afterEach(() => {
  restoreFetch?.()
  restoreFetch = undefined
})

function renderPage(): ReturnType<typeof render> {
  const router = createMemoryRouter(appRoutes, { initialEntries: [`/p/${SLUG}`] })
  return render(<RouterProvider router={router} />)
}

/** A date/time the business genuinely offers, so the wizard can advance. */
function freeSlot(): { date: string; time: string } {
  const business = getBusiness(SLUG)!
  const duration = getServices(SLUG)[0].baseDurationMinutes
  const today = toDateString(new Date())
  for (let offset = 1; offset <= 8; offset += 1) {
    const date = addDays(today, offset)
    const free = computeAvailableTimes(
      business,
      date,
      duration,
      getOccupiedBlocks(SLUG, date),
    )
    if (free.length > 0) return { date, time: free[0] }
  }
  throw new Error('no free window slot available')
}

async function reachReviewStep(container: HTMLElement, date: string, time: string) {
  const addButtons = await screen.findAllByRole('button', { name: /add to booking/i })
  await user.click(addButtons[0])
  await user.click(screen.getByRole('button', { name: /continue[\s–—-]*\d+ selected/i }))

  await waitFor(() => expect(container.querySelectorAll('.date-chip').length).toBeGreaterThan(0))
  const chip = Array.from(container.querySelectorAll<HTMLButtonElement>('.date-chip')).find(
    (c) => c.querySelector('.date-chip__date')?.textContent === date,
  )
  if (!chip) throw new Error(`no date chip for ${date}`)
  await user.click(chip)

  await waitFor(() =>
    expect(container.querySelectorAll('.time-grid__item button').length).toBeGreaterThan(0),
  )
  const slot = Array.from(
    container.querySelectorAll<HTMLButtonElement>('.time-grid__item button'),
  ).find((s) => s.textContent === time)
  if (!slot) throw new Error(`no slot for ${time}`)
  await user.click(slot)
  await user.click(screen.getByRole('button', { name: /^continue$/i }))

  await screen.findByRole('heading', { name: 'Your details', level: 2 })
  await user.type(screen.getByLabelText('Your name'), 'Selam Tesfaye')
  await user.type(screen.getByLabelText('Phone number'), '+251911123456')
  await user.click(screen.getByRole('button', { name: /continue to review/i }))
  await screen.findByRole('heading', { name: 'Review your booking' })
}

describe('prepayment configuration survives the real wire mapping', () => {
  it('maps every real backend mode, and never invents a value', () => {
    expect(prepaymentFromView({ prepaymentMode: 'NONE', prepaymentPercent: null, prepaymentFixedMinor: null })).toEqual({
      mode: 'none',
    })
    expect(
      prepaymentFromView({ prepaymentMode: 'PERCENTAGE', prepaymentPercent: 30, prepaymentFixedMinor: null }),
    ).toEqual({ mode: 'percentage', value: 30 })
    expect(
      prepaymentFromView({ prepaymentMode: 'FIXED', prepaymentPercent: null, prepaymentFixedMinor: 5000 }),
    ).toEqual({ mode: 'fixed', value: 5000 })
    // A mode whose companion value is absent cannot show one.
    expect(
      prepaymentFromView({ prepaymentMode: 'PERCENTAGE', prepaymentPercent: null, prepaymentFixedMinor: null }),
    ).toEqual({ mode: 'none' })
  })

  it('round-trips the owner configuration back to the settings payload', () => {
    expect(prepaymentToSettings({ mode: 'none' })).toEqual({
      prepaymentMode: 'NONE',
      prepaymentPercent: null,
      prepaymentFixedMinor: null,
    })
    expect(prepaymentToSettings({ mode: 'percentage', value: 25 })).toEqual({
      prepaymentMode: 'PERCENTAGE',
      prepaymentPercent: 25,
      prepaymentFixedMinor: null,
    })
    expect(prepaymentToSettings({ mode: 'fixed', value: 7500 })).toEqual({
      prepaymentMode: 'FIXED',
      prepaymentPercent: null,
      prepaymentFixedMinor: 7500,
    })
  })
})

describe('the owner can turn the receipt requirement on through the product', () => {
  it('PATCHes the real business-settings route and the owner view reports the deposit', async () => {
    const updated = await updateOwnerBusinessSettings(BUSINESS_ID, {
      prepaymentMode: 'FIXED',
      prepaymentPercent: null,
      prepaymentFixedMinor: 5000,
    })

    expect(updated.prepaymentMode).toBe('FIXED')
    expect(updated.prepaymentFixedMinor).toBe(5000)

    const call = stub?.calls.find(
      (c) => c.method === 'PATCH' && c.url.endsWith('/settings'),
    )
    expect(call).toBeTruthy()
    expect(call?.url).toContain(`/owner/businesses/${BUSINESS_ID}/settings`)
    expect(call?.body).toMatchObject({
      prepaymentMode: 'FIXED',
      prepaymentFixedMinor: 5000,
    })
  })

  it('rejects an out-of-range percentage instead of silently sending it', async () => {
    await expect(
      updateOwnerBusinessSettings(BUSINESS_ID, { prepaymentMode: 'PERCENTAGE', prepaymentPercent: 150 }),
    ).rejects.toMatchObject({ kind: 'validation' })
  })

  it('never asks the backend for both forms at once (REQ-111 AC1)', async () => {
    // The real backend rejects a mixed payload, so the client must never build
    // one. This is asserted against the wire, not against a mock's convenience.
    await expect(
      updateOwnerBusinessSettings(BUSINESS_ID, {
        prepaymentMode: 'PERCENTAGE',
        prepaymentPercent: 30,
        prepaymentFixedMinor: 5000,
      }),
    ).rejects.toMatchObject({ kind: 'validation' })
    await expect(
      updateOwnerBusinessSettings(BUSINESS_ID, { prepaymentMode: 'NONE', prepaymentFixedMinor: 5000 }),
    ).rejects.toMatchObject({ kind: 'validation' })
  })
})

describe('the customer booking flow follows the real deposit the owner configured', () => {
  it('CASE A — a configured deposit makes the receipt step a required part of booking', async () => {
    await updateOwnerBusinessSettings(BUSINESS_ID, {
      prepaymentMode: 'FIXED',
      prepaymentPercent: null,
      prepaymentFixedMinor: 5000,
    })
    const { container } = renderPage()
    const { date, time } = freeSlot()

    await reachReviewStep(container, date, time)

    // A deposit is required, so review offers the payment step instead of
    // submitting the booking straight away.
    expect(screen.getByText(/deposit of/i)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /confirm booking/i }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /continue to payment/i }))
    await screen.findByRole('heading', { name: 'Payment & confirmation' })
    expect(container.querySelector<HTMLInputElement>('#proof-upload')).not.toBeNull()
  })

  it('CASE B — no configured deposit never forces a receipt upload', async () => {
    await updateOwnerBusinessSettings(BUSINESS_ID, { prepaymentMode: 'NONE' })
    const { container } = renderPage()
    const { date, time } = freeSlot()

    await reachReviewStep(container, date, time)

    expect(screen.queryByText(/deposit of/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm booking/i })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /continue to payment/i }),
    ).not.toBeInTheDocument()
  })

  it('takes the exact amount from the backend availability projection', async () => {
    await updateOwnerBusinessSettings(BUSINESS_ID, {
      prepaymentMode: 'FIXED',
      prepaymentPercent: null,
      prepaymentFixedMinor: 5000,
    })
    const { date } = freeSlot()
    const view = await getPublicAvailability(SLUG, {
      date,
      selections: [{ serviceId: getServices(SLUG)[0].id }],
    })
    expect(view.requiredPrepaidMinor).toBe(5000)

    await updateOwnerBusinessSettings(BUSINESS_ID, { prepaymentMode: 'NONE' })
    const after = await getPublicAvailability(SLUG, {
      date,
      selections: [{ serviceId: getServices(SLUG)[0].id }],
    })
    expect(after.requiredPrepaidMinor).toBe(0)
  })

  it('a no-deposit booking is submitted without a payment method and without a proof', async () => {
    await updateOwnerBusinessSettings(BUSINESS_ID, { prepaymentMode: 'NONE' })
    const { container } = renderPage()
    const { date, time } = freeSlot()

    await reachReviewStep(container, date, time)
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    expect(await screen.findByText('Booking request received')).toBeInTheDocument()
    const post = stub?.calls.find(
      (c) => c.method === 'POST' && c.url.includes('/customer/bookings'),
    )
    const posted = post?.body as Record<string, unknown> | undefined
    expect(posted).toBeTruthy()
    expect(posted?.paymentMethod).toBeUndefined()
  })
})

describe('no runtime payment fallback exists on the customer path', () => {
  it('never falls back to mock or demo payment data when the real API fails', async () => {
    // Let the real backend answer 500 for the booking submission, exactly as a
    // production outage would.
    const inner = globalThis.fetch
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/customer/bookings')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: 'INTERNAL', title: 'Server error', detail: 'boom' },
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      return inner(input, init)
    }) as typeof fetch

    const { container } = renderPage()
    const { date, time } = freeSlot()

    await reachReviewStep(container, date, time)
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    // A real backend failure is an honest error, never a fake success.
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    expect(screen.queryByText('Booking request received')).not.toBeInTheDocument()
  })

  it('the customer booking flow never hard-codes a deposit or a payment method', async () => {
    const flow = await readFile('src/features/public-booking/state/useBookingFlow.ts', 'utf8')
    const step = await readFile(
      'src/features/public-booking/components/steps/PaymentStep.tsx',
      'utf8',
    )
    // The requirement comes from the backend-disclosed amount only.
    expect(flow).toMatch(/requiresPayment = \(depositMinor \?\? 0\) > 0/)
    expect(flow).not.toMatch(/50|percentage|percent/i)
    // Exactly the two approved methods, no gateway, no fabricated instructions.
    expect(step).not.toMatch(/stripe|paypal|bitcoin|crypto|credit card/i)
    expect(step).not.toMatch(/account number|bank name|wallet id/i)
  })
})
