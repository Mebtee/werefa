import { describe, expect, it } from 'vitest'
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

const user = userEvent.setup()

function renderPage(): RenderResult {
  const router = createMemoryRouter(appRoutes, {
    initialEntries: ['/p/addis-beauty-lounge'],
  })
  return render(<RouterProvider router={router} />)
}

async function pickFirstAvailableSlot(container: HTMLElement) {
  await waitFor(() => {
    expect(container.querySelectorAll('.date-chip').length).toBeGreaterThan(0)
  })
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

describe('public booking flow', () => {
  it('lets a customer book a service, pay a deposit and submit proof without any booking reference', async () => {
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
    expect(
      within(screen.getByRole('radiogroup')).getByText(/demo bank/i),
    ).toBeInTheDocument()

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
  })

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
      name: /^pick an available time$/i,
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
      screen.getByRole('button', { name: /^pick an available time$/i }),
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