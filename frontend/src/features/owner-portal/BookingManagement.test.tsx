import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { appRoutes } from '@/routes'
import {
  resetStore,
  listBookings,
} from '@/mock/store'
import { PRIMARY_BUSINESS_SLUG } from '@/mock/data'

const user = userEvent.setup()

function renderAt(path: string): RenderResult & { router: ReturnType<typeof createMemoryRouter> } {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  const result = render(<RouterProvider router={router} />)
  return { router, ...result }
}

beforeEach(() => {
  resetStore()
})

function seededPending() {
  return listBookings(PRIMARY_BUSINESS_SLUG).find((b) => b.state === 'payment-pending')!
}

function seededConfirmed() {
  return listBookings(PRIMARY_BUSINESS_SLUG).find((b) => b.state === 'confirmed')!
}

function renderBookingBanner() {
  return screen.findByRole('heading', { name: 'Bookings' })
}

describe('booking list', () => {
  it('renders seeded bookings with state and payment badges', async () => {
    renderAt('/owner/bookings')
    await screen.findByRole('heading', { name: 'Bookings' })
    const pending = seededPending()
    expect(screen.getByText(pending.customer.name)).toBeInTheDocument()
    expect(
      screen.getAllByText((node) => node === pending.customer.phone).length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('filters bookings by state', async () => {
    renderAt('/owner/bookings')
    await renderBookingBanner()
    const filter = screen.getByRole('button', { name: /Confirmed/ })
    await user.click(filter)
    const pending = seededPending()
    expect(screen.queryByText(pending.customer.name)).not.toBeInTheDocument()
  })
})

describe('booking detail', () => {
  it('shows a seeded pending booking with accept and reject UI', async () => {
    const pending = seededPending()
    renderAt(`/owner/bookings/${pending.id}`)
    await screen.findByRole('heading', { name: pending.customer.name })
    expect(
      screen.getAllByText((node) => node === pending.customer.phone).length,
    ).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Payment Pending').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: 'Accept booking' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject booking' })).toBeInTheDocument()
  })

  it('accepts a pending booking and transitions it to confirmed', async () => {
    const pending = seededPending()
    renderAt(`/owner/bookings/${pending.id}`)
    await screen.findByRole('heading', { name: pending.customer.name })
    await user.click(screen.getByRole('button', { name: 'Accept booking' }))
    expect(screen.getAllByText('Confirmed').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByRole('button', { name: 'Accept booking' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject booking' })).not.toBeInTheDocument()
  })

  it('rejects a pending booking when a reason is supplied', async () => {
    const pending = seededPending()
    renderAt(`/owner/bookings/${pending.id}`)
    await screen.findByRole('heading', { name: pending.customer.name })
    await user.type(screen.getByPlaceholderText(/e\.g\./), 'Invalid receipt')
    await user.click(screen.getByRole('button', { name: 'Reject booking' }))
    expect(screen.getByText('Invalid receipt')).toBeInTheDocument()
    expect(screen.getAllByText('Rejected').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByRole('button', { name: 'Reject booking' })).not.toBeInTheDocument()
  })

  it('prevents rejection without a reason', async () => {
    const pending = seededPending()
    renderAt(`/owner/bookings/${pending.id}`)
    await screen.findByRole('heading', { name: pending.customer.name })
    await user.click(screen.getByRole('button', { name: 'Reject booking' }))
    expect(await screen.findByText(/provide a reason/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept booking' })).toBeInTheDocument()
    expect(screen.getAllByText('Payment Pending').length).toBeGreaterThanOrEqual(1)
  })

  it('does not show action buttons for a confirmed booking', async () => {
    const confirmed = seededConfirmed()
    renderAt(`/owner/bookings/${confirmed.id}`)
    await screen.findByRole('heading', { name: confirmed.customer.name })
    expect(screen.getAllByText('Confirmed').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByRole('button', { name: 'Accept booking' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject booking' })).not.toBeInTheDocument()
  })
})
