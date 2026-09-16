import { beforeEach, describe, expect, it } from 'vitest'
import {
  fireEvent,
  render,
  screen,
  type RenderResult,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { appRoutes } from '@/routes'
import {
  resetStore,
  listBookings,
  createBookingEntry,
  acceptBooking,
  getServices,
  getBusiness,
  rejectBooking,
  markNoShowBooking,
  cancelPaymentPendingBooking,
  completeDueBookings,
  saveSchedule,
  keepBooking,
} from '@/mock/store'
import { PRIMARY_BUSINESS_SLUG } from '@/mock/data'
import {
  sortBookings,
  type BookingSort,
} from '@/features/owner-portal/lib/bookingQuery'
import type { BookingState, WeeklyWorkingHours } from '@/types/models'

const user = userEvent.setup()
const SECONDARY_SLUG = 'marathon-auto-care'

function renderAt(path: string): RenderResult & { router: ReturnType<typeof createMemoryRouter> } {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  const result = render(<RouterProvider router={router} />)
  return { router, ...result }
}

beforeEach(() => {
  resetStore()
})

function fakeBooking(overrides?: { businessSlug?: string; date?: string; time?: string; name?: string; phone?: string }) {
  const slug = overrides?.businessSlug ?? PRIMARY_BUSINESS_SLUG
  const services = getServices(slug)
  const service = services[0]
  return {
    businessSlug: slug,
    lineItems: [{ name: service.name, unitPrice: service.basePrice, durationMinutes: service.baseDurationMinutes }],
    total: service.basePrice,
    totalDurationMinutes: service.baseDurationMinutes,
    deposit: 18000,
    customer: {
      name: overrides?.name ?? 'Test Customer',
      phone: overrides?.phone ?? '+251911111111',
      note: '',
    },
    date: overrides?.date ?? '2030-03-04',
    time: overrides?.time ?? '09:00',
    paymentMethod: 'bank-transfer' as const,
    proof: { fileName: 'receipt.png', sizeBytes: 100, mimeType: 'image/png' },
  }
}

/** Seeds 5 bookings with distinct fixtures (2 seeded demo bookings also exist). */
function seedUnits() {
  createBookingEntry(fakeBooking({ date: '2030-03-04', time: '09:00', name: 'Alpha', phone: '+251911111111' }))
  createBookingEntry(fakeBooking({ date: '2030-03-04', time: '10:30', name: 'Bravo', phone: '+251922222222' }))
  const confirmed = createBookingEntry(fakeBooking({ date: '2030-03-05', time: '09:00', name: 'Charlie', phone: '+251933333333' }))
  if (confirmed.ok) acceptBooking(PRIMARY_BUSINESS_SLUG, confirmed.booking.id)
  const rejected = createBookingEntry(fakeBooking({ date: '2030-03-05', time: '10:30', name: 'Delta', phone: '+251944444444' }))
  if (rejected.ok) rejectBooking(PRIMARY_BUSINESS_SLUG, rejected.booking.id, 'Poor quality')
  createBookingEntry(fakeBooking({ date: '2030-03-06', time: '09:00', name: 'Echo', phone: '+251955555555' }))
}

function allBookings() {
  return listBookings(PRIMARY_BUSINESS_SLUG)
}

function stateCount(state: BookingState) {
  return allBookings().filter((b) => b.state === state).length
}

async function waitForBookings() {
  await screen.findByRole('heading', { name: 'Bookings' })
}

function cardNames(): string[] {
  return screen
    .getAllByRole('link')
    .filter((el) => el.getAttribute('href')?.startsWith('/owner/bookings/bk-'))
    .map((el) => el.querySelector('.booking-card__name')?.textContent ?? '')
}

async function setDate(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

async function clickStatusPill(label: string) {
  await user.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }))
}

describe('bookings page workspace', () => {
  it('renders seeded bookings with customer names and phone numbers', async () => {
    renderAt('/owner/bookings')
    await waitForBookings()
    for (const b of allBookings()) {
      expect(screen.getAllByText((node) => node === b.customer.name)[0]).toBeInTheDocument()
    }
  })

  it('shows accurate counts on the status pills', async () => {
    seedUnits()
    renderAt('/owner/bookings')
    await waitForBookings()
    const pending = stateCount('payment-pending')
    const confirmed = stateCount('confirmed')
    const rejected = stateCount('rejected')
    const allPill = screen.getByRole('button', { name: /^All/ })
    expect(allPill.textContent).toContain(String(allBookings().length))
    const pendingPill = screen.getByRole('button', { name: /^Payment Pending/ })
    expect(pendingPill.textContent).toContain(String(pending))
    const confirmedPill = screen.getByRole('button', { name: /^Confirmed/ })
    expect(confirmedPill.textContent).toContain(String(confirmed))
    const rejectedPill = screen.getByRole('button', { name: /^Rejected/ })
    expect(rejectedPill.textContent).toContain(String(rejected))
  })

  it('shows a live count summary line', async () => {
    renderAt('/owner/bookings')
    await waitForBookings()
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain(`Showing ${allBookings().length} of ${allBookings().length}`)
  })
})

describe('multi-select status filter', () => {
  it('ORs selected statuses: Confirmed + Rejected shows both, hides the rest', async () => {
    seedUnits()
    renderAt('/owner/bookings')
    await waitForBookings()
    await clickStatusPill('Confirmed')
    await clickStatusPill('Rejected')
    expect(screen.getByText('Charlie')).toBeInTheDocument()
    expect(screen.getByText('Delta')).toBeInTheDocument()
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    expect(screen.queryByText('Bravo')).not.toBeInTheDocument()
    expect(screen.queryByText('Echo')).not.toBeInTheDocument()
    expect(screen.queryByText('Martha Bekele')).not.toBeInTheDocument()
  })

  it('toggling a selected pill on second click clears it', async () => {
    seedUnits()
    renderAt('/owner/bookings')
    await waitForBookings()
    await clickStatusPill('Payment Pending')
    await clickStatusPill('Payment Pending')
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain(`Showing ${allBookings().length} of ${allBookings().length}`)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Martha Bekele')).toBeInTheDocument()
  })

  it('All pill resets the selection to show every booking', async () => {
    seedUnits()
    renderAt('/owner/bookings')
    await waitForBookings()
    await clickStatusPill('Confirmed')
    await clickStatusPill('All')
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain(`Showing ${allBookings().length} of ${allBookings().length}`)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })
})

describe('status pills: all six states (REQ-101/184)', () => {
  it('counts cancelled, no-show and completed bookings and filters each', async () => {
    seedUnits()

    // Reach the three states not covered by the earlier pill test.
    const pending = allBookings().find((b) => b.state === 'payment-pending')!
    cancelPaymentPendingBooking(PRIMARY_BUSINESS_SLUG, pending.id)
    const confirmed = allBookings().find((b) => b.state === 'confirmed')!
    markNoShowBooking(PRIMARY_BUSINESS_SLUG, confirmed.id)
    completeDueBookings(PRIMARY_BUSINESS_SLUG, '2030-03-08T00:00')

    renderAt('/owner/bookings')
    await waitForBookings()

    const cancelledPill = screen.getByRole('button', { name: /^Cancelled/ })
    expect(cancelledPill.textContent).toContain(String(stateCount('cancelled')))
    const noShowPill = screen.getByRole('button', { name: /^No Show/ })
    expect(noShowPill.textContent).toContain(String(stateCount('no-show')))
    const completedPill = screen.getByRole('button', { name: /^Completed/ })
    expect(completedPill.textContent).toContain(String(stateCount('completed')))

    await clickStatusPill('No Show')
    expect(cardNames()).toHaveLength(stateCount('no-show'))

    await user.click(screen.getByRole('button', { name: /^All/ }))
    await clickStatusPill('Cancelled')
    expect(cardNames()).toHaveLength(stateCount('cancelled'))

    await user.click(screen.getByRole('button', { name: /^All/ }))
    await clickStatusPill('Completed')
    expect(cardNames()).toHaveLength(stateCount('completed'))
  })
})

describe('date range filter', () => {
  it('shows only bookings within the inclusive from/to range', async () => {
    seedUnits()
    renderAt('/owner/bookings')
    await waitForBookings()
    await setDate('From date', '2030-03-05')
    await setDate('To date', '2030-03-05')
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('Showing 2 of')
    expect(screen.getByText('Charlie')).toBeInTheDocument()
    expect(screen.getByText('Delta')).toBeInTheDocument()
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    expect(screen.queryByText('Echo')).not.toBeInTheDocument()
  })

  it('from-only shows bookings on and after the date', async () => {
    seedUnits()
    renderAt('/owner/bookings')
    await waitForBookings()
    await setDate('From date', '2030-03-06')
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('Showing 1 of')
    expect(screen.getByText('Echo')).toBeInTheDocument()
    expect(screen.queryByText('Charlie')).not.toBeInTheDocument()
  })

  it('to-only shows bookings up to and including the date', async () => {
    seedUnits()
    renderAt('/owner/bookings')
    await waitForBookings()
    await setDate('To date', '2030-03-04')
    const expected = allBookings().filter((b) => b.date <= '2030-03-04').length
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain(`Showing ${expected} of ${allBookings().length}`)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Bravo')).toBeInTheDocument()
    expect(screen.queryByText('Charlie')).not.toBeInTheDocument()
  })
})

describe('customer search', () => {
  it('matches customer name as a case-insensitive substring', async () => {
    seedUnits()
    renderAt('/owner/bookings')
    await waitForBookings()
    await user.type(screen.getByPlaceholderText('Name or phone'), 'arl')
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('Showing 1 of')
    expect(screen.getByText('Charlie')).toBeInTheDocument()
  })

  it('matches phone number as a substring', async () => {
    seedUnits()
    renderAt('/owner/bookings')
    await waitForBookings()
    await user.type(screen.getByPlaceholderText('Name or phone'), '2519222')
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('Showing 1 of')
    expect(screen.getByText('Bravo')).toBeInTheDocument()
  })

  it('shows the no-results empty state and an inline Reset Filters when active', async () => {
    seedUnits()
    renderAt('/owner/bookings')
    await waitForBookings()
    await user.type(screen.getByPlaceholderText('Name or phone'), 'zzz-none')
    expect(screen.getByText('No bookings match the current filters.')).toBeInTheDocument()
    const resets = screen.getAllByRole('button', { name: 'Reset filters' })
    expect(resets.length).toBeGreaterThanOrEqual(1)
  })
})

describe('combined filters', () => {
  it('ANDs across categories: status + date range + search', async () => {
    seedUnits()
    renderAt('/owner/bookings')
    await waitForBookings()
    await clickStatusPill('Payment Pending')
    await setDate('From date', '2030-03-04')
    await setDate('To date', '2030-03-04')
    await user.type(screen.getByPlaceholderText('Name or phone'), 'Alp')
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('Showing 1 of')
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.queryByText('Bravo')).not.toBeInTheDocument()
  })
})

describe('sort controls', () => {
  it('defaults to newest-first on date & time', async () => {
    seedUnits()
    renderAt('/owner/bookings')
    await waitForBookings()
    const dirBtn = screen.getByRole('button', { name: /Sort direction/ })
    expect(dirBtn.textContent).toContain('Newest first')
    const names = cardNames()
    const first = allBookings()
      .map((b) => b.customer.name)
      .sort(
        (a, b) =>
          dateOf(a).localeCompare(dateOf(b)) || timeOf(a).localeCompare(timeOf(b)),
      )
      .reverse()
    expect(names[0]).toBe(first[0])
  })

  it('sorts A–Z by customer name and flips to Z–A via the direction toggle', async () => {
    seedUnits()
    renderAt('/owner/bookings')
    await waitForBookings()
    const sortSelect = screen.getByLabelText('Sort by')
    await user.selectOptions(sortSelect, 'customer')
    const dirBtn = screen.getByRole('button', { name: /Sort direction/ })
    expect(dirBtn.textContent).toContain('A–Z')
    const namesAsc = cardNames()
    expect(namesAsc).toEqual([...namesAsc].sort((a, b) => a.localeCompare(b)))
    await user.click(dirBtn)
    expect(dirBtn.textContent).toContain('Z–A')
    const namesDesc = cardNames()
    expect(namesDesc).toEqual([...namesAsc].reverse())
  })

  it('groups bookings by status when the status column is chosen', async () => {
    seedUnits()
    renderAt('/owner/bookings')
    await waitForBookings()
    const sortSelect = screen.getByLabelText('Sort by')
    await user.selectOptions(sortSelect, 'status')
    const dirBtn = screen.getByRole('button', { name: /Sort direction/ })
    expect(dirBtn.textContent).toContain('A–Z')
    const cards = screen
      .getAllByRole('link')
      .filter((el) => el.getAttribute('href')?.startsWith('/owner/bookings/bk-'))
    const weights = cards.map((el) => {
      const chip = el.querySelector('.booking-card__status .booking-chip')
      return chipWeight(chip?.textContent ?? '')
    })
    for (let i = 1; i < weights.length; i += 1) {
      expect(weights[i - 1]).toBeLessThanOrEqual(weights[i])
    }
  })
})

describe('sort controls: remaining fields & direction contract (REQ-188/189/190)', () => {
  it('switching the sort field resets the direction (date-time → desc, others → asc)', async () => {
    seedUnits()
    renderAt('/owner/bookings')
    await waitForBookings()
    const sortSelect = screen.getByLabelText('Sort by')
    const dirBtn = screen.getByRole('button', { name: /Sort direction/ })
    expect(dirBtn.textContent).toContain('Newest first')

    await user.selectOptions(sortSelect, 'customer')
    expect(dirBtn.textContent).toContain('A–Z')
    await user.click(dirBtn)
    expect(dirBtn.textContent).toContain('Z–A')

    // A non-date column always resets to ascending on field change…
    await user.selectOptions(sortSelect, 'payment-status')
    expect(dirBtn.textContent).toContain('A–Z')
    await user.click(dirBtn)
    expect(dirBtn.textContent).toContain('Z–A')

    // …while date & time resets to newest-first (descending) every time.
    await user.selectOptions(sortSelect, 'date-time')
    expect(dirBtn.textContent).toContain('Newest first')
    await user.click(dirBtn)
    expect(dirBtn.textContent).toContain('Oldest first')
  })

  it('actor sort orders by the last audit actor in the chosen direction', async () => {
    seedUnits()
    renderAt('/owner/bookings')
    await waitForBookings()
    await user.selectOptions(screen.getByLabelText('Sort by'), 'actor')
    expect(cardNames()).toEqual(expectedNames({ field: 'actor', direction: 'asc' }))
    await user.click(screen.getByRole('button', { name: /Sort direction/ }))
    expect(cardNames()).toEqual(expectedNames({ field: 'actor', direction: 'desc' }))
  })

  it('payment-status sort orders Pending → Accepted → Rejected and reverses', async () => {
    seedUnits()
    renderAt('/owner/bookings')
    await waitForBookings()
    await user.selectOptions(screen.getByLabelText('Sort by'), 'payment-status')
    expect(cardNames()).toEqual(
      expectedNames({ field: 'payment-status', direction: 'asc' }),
    )
    await user.click(screen.getByRole('button', { name: /Sort direction/ }))
    expect(cardNames()).toEqual(
      expectedNames({ field: 'payment-status', direction: 'desc' }),
    )
  })

  it('booking-id sort is chronological: the oldest booking always sorts first', async () => {
    seedUnits()
    renderAt('/owner/bookings')
    await waitForBookings()
    await user.selectOptions(screen.getByLabelText('Sort by'), 'booking-id')
    const asc = cardNames()
    expect(asc).toEqual(expectedNames({ field: 'booking-id', direction: 'asc' }))
    expect(asc[0]).toBe('Selam Tesfaye')

    await user.click(screen.getByRole('button', { name: /Sort direction/ }))
    const desc = cardNames()
    expect(desc).toEqual(expectedNames({ field: 'booking-id', direction: 'desc' }))
    expect(desc[desc.length - 1]).toBe('Selam Tesfaye')
  })
})

function expectedNames(sort: BookingSort): string[] {
  return sortBookings(allBookings(), sort).map((b) => b.customer.name)
}

describe('Reset Filters', () => {
  it('clears every filter and restores the default newest-first sort', async () => {
    seedUnits()
    renderAt('/owner/bookings')
    await waitForBookings()
    await clickStatusPill('Confirmed')
    await setDate('From date', '2030-03-05')
    await user.type(screen.getByPlaceholderText('Name or phone'), 'Char')
    const sortSelect = screen.getByLabelText('Sort by')
    await user.selectOptions(sortSelect, 'customer')
    const dirBtn = screen.getByRole('button', { name: /Sort direction/ })
    await user.click(dirBtn)
    await user.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(screen.getByLabelText('From date')).toHaveValue('')
    expect(screen.getByLabelText('To date')).toHaveValue('')
    expect(screen.getByPlaceholderText('Name or phone')).toHaveValue('')
    expect(sortSelect).toHaveValue('date-time')
    expect(dirBtn.textContent).toContain('Newest first')
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain(`Showing ${allBookings().length} of ${allBookings().length}`)
  })
})

describe('tenant isolation', () => {
  it('never lists bookings from another business', async () => {
    seedUnits()
    createBookingEntry(fakeBooking({ businessSlug: SECONDARY_SLUG, date: '2030-12-01', time: '09:00', name: 'Intruder' }))
    renderAt('/owner/bookings')
    await waitForBookings()
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain(`Showing ${allBookings().length} of ${allBookings().length}`)
    expect(screen.queryByText('Intruder')).not.toBeInTheDocument()
  })
})

describe('navigation', () => {
  it('clicking a booking card opens its detail page', async () => {
    seedUnits()
    renderAt('/owner/bookings')
    await waitForBookings()
    const pending = allBookings().find((b) => b.state === 'payment-pending')!
    const card = screen.getByText(pending.customer.name).closest('a')!
    await user.click(card)
    await screen.findByRole('heading', { name: pending.customer.name })
    expect(screen.getAllByText((node) => node === pending.customer.phone).length).toBeGreaterThanOrEqual(1)
  })
})

describe('combined filters: pairwise (Prompt 38)', () => {
  it('status + search narrow to one booking', async () => {
    seedUnits()
    renderAt('/owner/bookings')
    await waitForBookings()
    await clickStatusPill('Confirmed')
    await user.type(screen.getByPlaceholderText('Name or phone'), 'Char')
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('Showing 1 of')
    expect(screen.getByText('Charlie')).toBeInTheDocument()
    expect(screen.queryByText('Selam Tesfaye')).not.toBeInTheDocument()
  })

  it('date + search narrow to one booking', async () => {
    seedUnits()
    renderAt('/owner/bookings')
    await waitForBookings()
    await setDate('From date', '2030-03-05')
    await setDate('To date', '2030-03-05')
    await user.type(screen.getByPlaceholderText('Name or phone'), 'Delta')
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('Showing 1 of')
    expect(screen.getByText('Delta')).toBeInTheDocument()
    expect(screen.queryByText('Charlie')).not.toBeInTheDocument()
  })
})

describe('date range safety on the page (Prompt 38)', () => {
  it('a reversed from/to range shows the empty state, not a crash', async () => {
    seedUnits()
    renderAt('/owner/bookings')
    await waitForBookings()
    await setDate('From date', '2030-03-06')
    await setDate('To date', '2030-03-04')
    expect(await screen.findByText('No bookings match the current filters.')).toBeInTheDocument()
  })
})

describe('schedule exception indicator in the list (Prompt 38, REQ-160)', () => {
  it('shows a Schedule Exception badge for a kept booking', async () => {
    const created = createBookingEntry(fakeBooking({ date: '2030-03-04', time: '10:30', name: 'Kept Customer', phone: '+251966666666' }))
    if (!created.ok) throw new Error('seed failed')
    acceptBooking(PRIMARY_BUSINESS_SLUG, created.booking.id)
    const business = getBusiness(PRIMARY_BUSINESS_SLUG)!
    saveSchedule(PRIMARY_BUSINESS_SLUG, {
      workingHours: business.workingHours.map((day, index) => (index === 1 ? [] : day)) as WeeklyWorkingHours,
      bookingIntervalMinutes: business.bookingIntervalMinutes,
      blockedDays: business.blockedDays,
      blockedPeriods: business.blockedPeriods,
      specialDays: business.specialDays,
    })
    keepBooking(PRIMARY_BUSINESS_SLUG, created.booking.id, 'Customer confirmed by phone.')
    renderAt('/owner/bookings')
    await waitForBookings()
    expect(screen.getByText('Schedule Exception')).toBeInTheDocument()
  })
})

function dateOf(name: string): string {
  return allBookings().find((b) => b.customer.name === name)?.date ?? ''
}

function timeOf(name: string): string {
  return allBookings().find((b) => b.customer.name === name)?.time ?? ''
}

function chipWeight(label: string): number {
  const names: Record<string, number> = {
    'Payment Pending': 0,
    Confirmed: 1,
    Rejected: 2,
    'No Show': 3,
    Cancelled: 4,
    Completed: 5,
  }
  return names[label] ?? 99
}