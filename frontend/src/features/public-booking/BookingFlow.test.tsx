import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  render,
  screen,
  waitFor,
  within,
  type RenderResult,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { appRoutes } from '@/routes'
import { addDays, toDateString } from '@/lib/time'
import { createCustomerBooking } from '@/api/booking'
import { TelegramConnectCard } from '@/features/public-booking/components/steps/TelegramConnectCard'
import {
  installBusinessApiStub,
  type BusinessApiStub,
} from '@/test/businessApi'
import { getBookingsByPhone, getBusiness, getOccupiedBlocks, getServices } from '@/mock/store'
import { computeAvailableTimes } from '@/mock/availability'

const user = userEvent.setup()

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

function renderPage(initialPath = '/p/addis-beauty-lounge'): RenderResult {
  const router = createMemoryRouter(appRoutes, {
    initialEntries: [initialPath],
  })
  return render(<RouterProvider router={router} />)
}

/**
 * A deterministic date (not today) that actually offers a free slot for the
 * first service — it walks the window ahead of today so the race/idempotency
 * tests never depend on the weekday (the demo salon is closed on Mondays) or
 * the seeded bookings that block days 0–2.
 */
function freeWindowSlot(): { date: string; time: string } {
  const business = getBusiness('addis-beauty-lounge')!
  const duration = getServices('addis-beauty-lounge')[0].baseDurationMinutes
  const today = toDateString(new Date())
  for (let offset = 1; offset <= 8; offset += 1) {
    const date = addDays(today, offset)
    const free = computeAvailableTimes(
      business,
      date,
      duration,
      getOccupiedBlocks('addis-beauty-lounge', date),
    )
    if (free.length > 0) return { date, time: free[0] }
  }
  throw new Error('no free window slot available')
}

async function bookToPaymentStep(container: HTMLElement, date: string, time: string) {
  const addButtons = await screen.findAllByRole('button', {
    name: /add to booking/i,
  })
  await user.click(addButtons[0])
  await user.click(
    screen.getByRole('button', { name: /continue[\s–—-]*\d+ selected/i }),
  )

  await waitFor(() => {
    expect(
      container.querySelectorAll('.date-chip').length,
    ).toBeGreaterThan(0)
  })
  const chips = Array.from(
    container.querySelectorAll<HTMLButtonElement>('.date-chip'),
  )
  const chip = chips.find(
    (c) => c.querySelector('.date-chip__date')?.textContent === date,
  )
  if (!chip) throw new Error(`no date chip for ${date}`)
  expect(chip.disabled).toBe(false)
  await user.click(chip)

  await waitFor(() => {
    expect(
      container.querySelectorAll('.time-grid__item button').length,
    ).toBeGreaterThan(0)
  })
  const slots = Array.from(
    container.querySelectorAll<HTMLButtonElement>('.time-grid__item button'),
  )
  const slot = slots.find((s) => s.textContent === time)
  if (!slot) throw new Error(`no slot for ${time}`)
  await user.click(slot)
  await user.click(screen.getByRole('button', { name: /^continue$/i }))

  await screen.findByRole('heading', { name: 'Your details', level: 2 })
  await user.type(screen.getByLabelText('Your name'), 'Selam Tesfaye')
  await user.type(screen.getByLabelText('Phone number'), '+251911123456')
  await user.click(screen.getByRole('button', { name: /continue to review/i }))

  await screen.findByRole('heading', { name: 'Review your booking' })
  await user.click(screen.getByRole('button', { name: /continue to payment/i }))
  await screen.findByRole('heading', { name: 'Payment & confirmation' })

  await user.click(screen.getByRole('radio', { name: /bank transfer/i }))
  const proofInput = container.querySelector<HTMLInputElement>('#proof-upload')
  if (!proofInput) throw new Error('proof upload input missing')
  await user.upload(
    proofInput,
    new File(['proof'], 'proof.png', { type: 'image/png' }),
  )
  await screen.findByText('proof.png')
}

async function pickFirstAvailableSlot(container: HTMLElement) {
  await waitFor(() => {
    expect(container.querySelectorAll('.date-chip').length).toBeGreaterThan(0)
  })
  const chips = Array.from(
    container.querySelectorAll<HTMLButtonElement>('.date-chip'),
  )
  const enabled = chips.filter((chip) => !chip.disabled)
  // The mock race simulation only ever targets today's next 30-minute slot, so
  // book on a later date to keep the happy path deterministic.
  const today = toDateString(new Date())
  const target = enabled.find((chip) => {
    const dateLabel = chip.querySelector('.date-chip__date')
    return dateLabel && dateLabel.textContent !== today
  }) ?? enabled[0]
  if (!target) throw new Error('no enabled date chip found')
  await user.click(target)

  await waitFor(() => {
    expect(
      container.querySelectorAll('.time-grid__item button').length,
    ).toBeGreaterThan(0)
  })
  const slots = Array.from(
    container.querySelectorAll<HTMLButtonElement>('.time-grid__item button'),
  )
  await user.click(slots[0])
}

/** Add the first service, pick a date & time, and land on the details step. */
async function reachCustomerStep(container: HTMLElement) {
  const addButtons = await screen.findAllByRole('button', {
    name: /add to booking/i,
  })
  await user.click(addButtons[0])
  await user.click(
    screen.getByRole('button', { name: /continue[\s–—-]*\d+ selected/i }),
  )

  await pickFirstAvailableSlot(container)
  await user.click(screen.getByRole('button', { name: /^continue$/i }))

  await screen.findByRole('heading', { name: 'Your details', level: 2 })
}

/** Add the first service and land on the Date & time step (no time selected). */
async function reachDateStep(container: HTMLElement) {
  const addButtons = await screen.findAllByRole('button', {
    name: /add to booking/i,
  })
  await user.click(addButtons[0])
  await user.click(
    screen.getByRole('button', { name: /continue[\s–—-]*\d+ selected/i }),
  )
  await screen.findByRole('heading', { name: 'Pick a date and time', level: 2 })
  await waitFor(() => {
    expect(container.querySelectorAll('.date-chip').length).toBeGreaterThan(0)
  })
}

describe('public booking flow', () => {
  // The end-to-end booking (service → availability window → times → details →
  // review → payment → proof upload → submit) runs long under full-suite
  // parallel load, so it gets a dedicated timeout.
  it(
    'lets a customer book a service, pay a deposit and submit proof without any booking reference',
    { timeout: 20_000 },
    async () => {
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })
    await reachCustomerStep(container)

    const nameInput = screen.getByLabelText('Your name')
    const phoneInput = screen.getByLabelText('Phone number')
    await user.type(nameInput, 'Selam Tesfaye')
    await user.type(phoneInput, '+251911123456')
    await user.click(screen.getByRole('button', { name: /continue to review/i }))

    await screen.findByRole('heading', { name: 'Review your booking' })
    expect(
      screen.getAllByText('Women’s Haircut & Styling').length,
    ).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: /continue to payment/i }))

    await screen.findByRole('heading', { name: 'Payment & confirmation' })
    expect(screen.getByText(/deposit to pay/i)).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /bank transfer/i }))
    // The API carries no owner-published payment instructions, so the step must
    // say so instead of rendering a fabricated account.
    expect(
      within(screen.getByRole('radiogroup')).getByText(/bank transfer/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/payment details are not published online/i)).toBeInTheDocument()
    expect(screen.queryByText(/demo bank/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/account number/i)).not.toBeInTheDocument()

    const proofInput = container.querySelector<HTMLInputElement>('#proof-upload')
    if (!proofInput) throw new Error('proof upload input missing')
    await user.upload(
      proofInput,
      new File(['proof'], 'proof.png', { type: 'image/png' }),
    )
    expect(await screen.findByText('proof.png')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /confirm & send booking request/i }),
    )

    expect(await screen.findByText('Booking request received')).toBeInTheDocument()
    expect(
      screen.getByText(/identified by your phone number/i),
    ).toBeInTheDocument()

    expect(
      screen.queryByText(/booking (id|code|reference)/i),
    ).not.toBeInTheDocument()
    expect(screen.getByText(/do you use telegram/i)).toBeInTheDocument()

    // Boundary proof (Prompt 49): the submit went out over the REAL booking
    // client to POST /api/v1/customer/bookings, not the mock seam.
    const post = stub?.calls.find(
      (call) => call.method === 'POST' && call.url.includes('/customer/bookings'),
    )
    expect(post).toBeTruthy()
    const posted = post?.body as Record<string, unknown> | undefined
    expect(posted?.businessSlug).toBe('addis-beauty-lounge')
    expect(Array.isArray(posted?.selections)).toBe(true)
    expect((posted?.selections as unknown[])[0]).toMatchObject({
      serviceId: expect.any(String),
    })
    expect(typeof posted?.startAt).toBe('string')
    expect(typeof posted?.submissionKey).toBe('string')
    expect(posted?.customerName).toBe('Selam Tesfaye')
    expect(posted?.customerPhone).toBe('+251911123456')
    expect(posted?.paymentMethod).toBe('BANK_TRANSFER')
  })

  it(
    'lets the customer link Telegram on the done step via a one-time deep link (REQ-056)',
    { timeout: 20_000 },
    async () => {
      const { container } = renderPage()

      await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })
      await reachCustomerStep(container)

      await user.type(screen.getByLabelText('Your name'), 'Selam Tesfaye')
      await user.type(screen.getByLabelText('Phone number'), '+251911123456')
      await user.click(screen.getByRole('button', { name: /continue to review/i }))
      await screen.findByRole('heading', { name: 'Review your booking' })
      await user.click(screen.getByRole('button', { name: /continue to payment/i }))
      await screen.findByRole('heading', { name: 'Payment & confirmation' })

      await user.click(screen.getByRole('radio', { name: /bank transfer/i }))
      const proofInput = container.querySelector<HTMLInputElement>('#proof-upload')
      if (!proofInput) throw new Error('proof upload input missing')
      await user.upload(
        proofInput,
        new File(['proof'], 'proof.png', { type: 'image/png' }),
      )
      await user.click(
        screen.getByRole('button', { name: /confirm & send booking request/i }),
      )
      expect(await screen.findByText('Booking request received')).toBeInTheDocument()

      const card = screen
        .getByRole('heading', { name: /do you use telegram/i })
        .closest('.card') as HTMLElement | null
      expect(card).not.toBeNull()

      // The phone is prefilled from the booking details (telegram-optional stays
      // optional — no automatic call).
      expect(within(card!).getByLabelText('Phone number to link')).toHaveValue(
        '+251911123456',
      )

      await user.click(within(card!).getByRole('button', { name: 'Connect Telegram' }))

      const link = await within(card!).findByRole('link', { name: 'Open Telegram' })
      expect(link).toHaveAttribute(
        'href',
        'https://t.me/werefademo?start=customer-connect-test',
      )
      expect(
        within(card!).getByText(/Link expires in \d+:\d+ — then you can ask/),
      ).toBeInTheDocument()

      // Boundary proof (Prompt 51): the link came from the REAL customer
      // telegram client posting to the public connect route with the phone.
      const connect = stub?.calls.find(
        (call) =>
          call.method === 'POST' &&
          call.url.includes('/api/v1/public/businesses/') &&
          call.url.endsWith('/telegram/connect'),
      )
      expect(connect?.url).toContain(
        '/api/v1/public/businesses/addis-beauty-lounge/telegram/connect',
      )
      expect((connect?.body as { phone?: unknown } | undefined)?.phone).toBe(
        '+251911123456',
      )
    },
  )

  it('keeps the customer on the details step when validation fails', async () => {
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })
    await reachCustomerStep(container)

    await user.click(screen.getByRole('button', { name: /continue to review/i }))

    expect(await screen.findByText('Please enter your name.')).toBeInTheDocument()
    expect(
      screen.getByText(/please enter your phone number/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Your details', level: 2 }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Review your booking' }),
    ).not.toBeInTheDocument()
  })

  it('reminds the customer what is missing when they try to submit payment without choosing', async () => {
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })
    await reachCustomerStep(container)

    await user.type(screen.getByLabelText('Your name'), 'Selam Tesfaye')
    await user.type(screen.getByLabelText('Phone number'), '+251911123456')
    await user.click(screen.getByRole('button', { name: /continue to review/i }))

    await screen.findByRole('heading', { name: 'Review your booking', level: 2 })
    await user.click(screen.getByRole('button', { name: /continue to payment/i }))

    await screen.findByRole('heading', {
      name: 'Payment & confirmation',
      level: 2,
    })
    await user.click(
      screen.getByRole('button', { name: /confirm & send booking request/i }),
    )

    expect(
      await screen.findByText(/choose a payment method/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/attach your payment proof/i)).toBeInTheDocument()
  })

  it('cannot continue on the date step before picking an available time', async () => {
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })

    const addButtons = await screen.findAllByRole('button', {
      name: /add to booking/i,
    })
    await user.click(addButtons[0])
    await user.click(
      screen.getByRole('button', { name: /continue[\s–—-]*\d+ selected/i }),
    )

    await waitFor(() => {
      expect(container.querySelectorAll('.date-chip').length).toBeGreaterThan(0)
    })

    const continueButton = screen.getByRole('button', {
      name: /^continue$/i,
    })
    expect(continueButton).toBeDisabled()

    const chips = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.date-chip'),
    )
    const firstEnabled = chips.find((chip) => !chip.disabled)
    if (!firstEnabled) throw new Error('no enabled date chip found')
    await user.click(firstEnabled)

    await waitFor(() => {
      expect(
        container.querySelectorAll('.time-grid__item button').length,
      ).toBeGreaterThan(0)
    })
    expect(
      screen.getByRole('button', { name: /^continue$/i }),
    ).toBeDisabled()

    const slots = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.time-grid__item button'),
    )
    await user.click(slots[0])
    expect(
      screen.getByRole('button', { name: /^continue$/i }),
    ).not.toBeDisabled()
  })

  it('shows the compact mobile summary disclosure once a service is added', async () => {
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })

    const disclosureBefore = container.querySelector('.summary-disclosure')
    expect(disclosureBefore).not.toBeInTheDocument()

    const addButtons = await screen.findAllByRole('button', {
      name: /add to booking/i,
    })
    await user.click(addButtons[0])

    const disclosure = container.querySelector('.summary-disclosure')
    expect(disclosure).toBeInTheDocument()
    const details = within(disclosure as HTMLElement)
    const summary = details.getByText(/view summary/i).closest('summary')
    expect(summary).toBeInTheDocument()
    expect(within(summary as HTMLElement).getByText(/1 service ·/i)).toBeInTheDocument()
    expect(within(summary as HTMLElement).getByText(/· 60 min/i)).toBeInTheDocument()
    expect(details.getByText(/view summary/i)).toBeInTheDocument()

    await user.click(details.getByText(/view summary/i))
    expect(
      within(disclosure as HTMLElement).getByText('Women’s Haircut & Styling'),
    ).toBeInTheDocument()
  })
})

describe('date & time step navigation', () => {
  it('shows a Continue button on the date & time step', async () => {
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })
    await reachDateStep(container)

    const continueButton = screen.getByRole('button', { name: /^continue$/i })
    expect(continueButton).toBeInTheDocument()
    expect(continueButton).toBeDisabled()
  })

  it('keeps Continue disabled before a valid time is selected', async () => {
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })
    await reachDateStep(container)

    expect(
      screen.getByRole('button', { name: /^continue$/i }),
    ).toBeDisabled()
  })

  it('enables Continue after an available time is selected', async () => {
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })
    await reachDateStep(container)

    const chips = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.date-chip'),
    )
    const enabledChips = chips.filter((chip) => !chip.disabled)
    if (!enabledChips[0]) throw new Error('no enabled date chip found')
    await user.click(enabledChips[0])

    await waitFor(() => {
      expect(
        container.querySelectorAll('.time-grid__item button').length,
      ).toBeGreaterThan(0)
    })

    const slots = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.time-grid__item button'),
    )
    await user.click(slots[0])

    expect(
      screen.getByRole('button', { name: /^continue$/i }),
    ).not.toBeDisabled()
  })

  it('moves to Your details when Continue is clicked with a valid time', async () => {
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })
    await reachDateStep(container)

    await pickFirstAvailableSlot(container)
    await user.click(screen.getByRole('button', { name: /^continue$/i }))

    expect(
      await screen.findByRole('heading', { name: 'Your details', level: 2 }),
    ).toBeInTheDocument()
  })

  it('does not advance when Continue is clicked without a valid time', async () => {
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })
    await reachDateStep(container)

    await user.click(screen.getByRole('button', { name: /^continue$/i }))

    expect(
      screen.getByRole('heading', { name: 'Pick a date and time', level: 2 }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Your details', level: 2 }),
    ).not.toBeInTheDocument()
  })

  it('renders Back and Continue together in the step nav', async () => {
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })
    await reachDateStep(container)

    const nav = container.querySelector('.wizard__nav')
    if (!nav) throw new Error('step nav missing')
    const navButtons = within(nav as HTMLElement)

    expect(navButtons.getByRole('button', { name: /^back$/i })).not.toBeDisabled()
    expect(
      navButtons.getByRole('button', { name: /^continue$/i }),
    ).toBeDisabled()
  })

  it('goes back to the services step from the date & time step', async () => {
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })
    await reachDateStep(container)

    await user.click(screen.getByRole('button', { name: /^back$/i }))

    expect(
      await screen.findByRole('heading', {
        name: 'Choose your services',
        level: 2,
      }),
    ).toBeInTheDocument()
  })
})

describe('public business page states (Prompt 55)', () => {
  it('shows Business not found for an invalid slug, with no demo fallback', async () => {
    renderPage('/p/this-business-does-not-exist')

    expect(
      await screen.findByText('Business not found'),
    ).toBeInTheDocument()
    expect(screen.getByText(/no business was found at this address/i)).toBeInTheDocument()

    // A missing business stays missing: no demo business is offered, and no
    // link to any hard-coded business identity is rendered.
    expect(screen.queryByRole('link', { name: /demo/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /addis beauty lounge/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Addis Beauty Lounge' })).not.toBeInTheDocument()
  })

  it('renders a read-only page with the pause notice for a paused business (REQ-146/147/148)', async () => {
    installStub({
      seed: {
        isPaused: true,
        pauseMessage: 'We are moving to a new location. See you soon!',
        reopenAt: '2026-12-01T00:00:00.000Z',
      },
    })
    renderPage()

    await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })
    expect(
      screen.getByText('We are currently closed to new bookings'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/we are moving to a new location\. see you soon!/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/bookings reopen on 2026-12-01/i)).toBeInTheDocument()

    // Canonical §13.5: the page stays visible and shows the service catalog, but
    // no booking wizard is offered.
    expect(
      screen.getByRole('heading', { name: 'Services & prices' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Women’s Haircut & Styling')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Book now' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /add to booking/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Check my booking status' }),
    ).toBeInTheDocument()
  })

  it('keeps a deactivated business page visible but without bookable times (REQ-216)', async () => {
    installStub({ seed: { isDeactivated: true } })
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })
    expect(
      screen.queryByRole('heading', { name: /business not found/i }),
    ).not.toBeInTheDocument()

    // Page stays visible: the wizard renders…
    expect(screen.getByRole('heading', { name: 'Book now' })).toBeInTheDocument()

    // …but the availability gate (deactivated) leaves no enabled dates.
    const addButtons = await screen.findAllByRole('button', {
      name: /add to booking/i,
    })
    await user.click(addButtons[0])
    await user.click(
      screen.getByRole('button', { name: /continue[\s–—-]*\d+ selected/i }),
    )
    await waitFor(() => {
      expect(container.querySelectorAll('.date-chip').length).toBeGreaterThan(0)
    })
    const chips = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.date-chip'),
    )
    expect(chips.length).toBeGreaterThan(0)
    expect(chips.every((chip) => chip.disabled)).toBe(true)
    expect(
      screen.getByText(/pick an available date and time to continue/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /^continue$/i }),
    ).toBeDisabled()
  })

  it('keeps a subscription-expired business page visible but not bookable', async () => {
    installStub({ seed: { bookingsClosed: true } })
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })

    const addButtons = await screen.findAllByRole('button', {
      name: /add to booking/i,
    })
    await user.click(addButtons[0])
    await user.click(
      screen.getByRole('button', { name: /continue[\s–—-]*\d+ selected/i }),
    )
    await waitFor(() => {
      expect(container.querySelectorAll('.date-chip').length).toBeGreaterThan(0)
    })
    const chips = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.date-chip'),
    )
    expect(chips.length).toBeGreaterThan(0)
    expect(chips.every((chip) => chip.disabled)).toBe(true)
    expect(
      screen.getByRole('button', { name: /^continue$/i }),
    ).toBeDisabled()
  })
})

describe('booking conflict & idempotency (Prompt 55)', () => {
  it('shows the recoverable "time just got taken" state when the slot is lost in a race (REQ-121/REQ-122)', async () => {
    const { date, time } = freeWindowSlot()
    installStub({ raceStart: { date, time } })
    const phone = '+251911123456'
    const before = getBookingsByPhone('addis-beauty-lounge', phone).length
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })
    await bookToPaymentStep(container, date, time)

    await user.click(
      screen.getByRole('button', { name: /confirm & send booking request/i }),
    )

    expect(
      await screen.findByRole('heading', { name: 'That time just got taken' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/another customer requested the same time/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/nothing was reserved for you/i)).toBeInTheDocument()

    // The conflict is recoverable, and nothing was persisted for the customer.
    expect(
      screen.getByRole('button', { name: 'Choose another time' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change services' })).toBeInTheDocument()
    expect(
      getBookingsByPhone('addis-beauty-lounge', phone),
    ).toHaveLength(before)
  })

  it('replays the original booking for a repeated submission key (REQ-121)', async () => {
    installStub()
    const { date, time } = freeWindowSlot()
    const business = getBusiness('addis-beauty-lounge')!
    const serviceId = getServices('addis-beauty-lounge')[0].id
    const submissionKey = 'booking-flow-idempotency-key'
    const phone = '+251911123456'
    const before = getBookingsByPhone(business.slug, phone).length

    const payload = {
      businessSlug: 'addis-beauty-lounge',
      selections: [{ serviceId }],
      customerName: 'Selam Tesfaye',
      customerPhone: phone,
      startAt: new Date(`${date}T${time}:00`).toISOString(),
      submissionKey,
      paymentMethod: 'BANK_TRANSFER' as const,
    }
    const proof = new File(['proof'], 'proof.png', { type: 'image/png' })

    const first = await createCustomerBooking(payload, proof)
    const replay = await createCustomerBooking(payload, proof)

    expect(replay.status).toBe(first.status)
    expect(replay).toEqual(first)

    // A replay is exactly that — not a second booking.
    expect(getBookingsByPhone(business.slug, phone)).toHaveLength(before + 1)
    expect(getBookingsByPhone(business.slug, phone)[0].paymentMethod).toBe('BANK_TRANSFER')
  })
})

describe('Customer Telegram connect states (Prompt 55)', () => {
  it('reports an already-connected phone without showing a link', async () => {
    installStub({
      seed: { telegramCustomerConnectedPhone: '+251911123456' },
    })
    render(
      <TelegramConnectCard
        businessSlug="addis-beauty-lounge"
        phone="+251911123456"
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Connect Telegram' }),
    )

    const status = await screen.findByText(/Telegram connected for \+251911123456/)
    expect(status).toHaveAttribute('data-connected', 'true')
    expect(
      screen.queryByRole('link', { name: 'Open Telegram' }),
    ).not.toBeInTheDocument()
  })

  it('degrades gracefully when the connect call fails, leaving the booking untouched', async () => {
    installStub({ failPublicTelegramConnect: true })
    render(
      <TelegramConnectCard
        businessSlug="addis-beauty-lounge"
        phone="+251911123456"
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Connect Telegram' }),
    )

    expect(
      await screen.findByText(
        /could not link telegram right now — your booking is unaffected\. you can try again\./i,
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Open Telegram' }),
    ).not.toBeInTheDocument()
    // Non-blocking: the card stays in its idle form so the customer can retry.
    expect(
      screen.getByRole('button', { name: 'Connect Telegram' }),
    ).toBeInTheDocument()
  })
})