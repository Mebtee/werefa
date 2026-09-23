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
import type { Booking } from '@/types/models'
import {
  resetStore,
  listBookings,
  createBookingEntry,
  acceptBooking,
  rejectBooking,
  cancelBooking,
  markNoShowBooking,
  completeDueBookings,
  setCustomerTelegramConnected,
} from '@/mock/store'
import { PRIMARY_BUSINESS_SLUG } from '@/mock/data'
import {
  installBusinessApiStub,
  RESUBMISSION_TEST_CODE,
  type BusinessApiStub,
} from '@/test/businessApi'
import { BOOKING_STATE_LABEL } from '@/features/customer-status/lib/labels'
import { formatDateTime } from '@/lib/time'

const user = userEvent.setup()
const STATUS_URL = `/p/${PRIMARY_BUSINESS_SLUG}/status`

let restoreFetch: (() => void) | undefined
let stub: BusinessApiStub | undefined

beforeEach(() => {
  resetStore()
  stub = installBusinessApiStub()
  restoreFetch = stub.restore
})

afterEach(() => {
  restoreFetch?.()
  restoreFetch = undefined
})

function renderAt(path: string): RenderResult {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return render(<RouterProvider router={router} />)
}

async function renderStatusPage(): Promise<void> {
  renderAt(STATUS_URL)
  await screen.findByRole('heading', { name: 'Check my booking', level: 1 })
}

async function lookup(phone: string): Promise<void> {
  const input = screen.getByLabelText('Phone number')
  await user.clear(input)
  await user.type(input, phone)
  await user.click(screen.getByRole('button', { name: 'Check my booking' }))
}

function createBookingFor(
  phone: string,
  name: string,
  slot?: { date: string; time: string },
): { ok: true; booking: Booking } | { ok: false; error: 'unavailable' } {
  return createBookingEntry({
    businessSlug: PRIMARY_BUSINESS_SLUG,
    lineItems: [
      {
        name: 'Women’s Haircut & Styling',
        unitPrice: 18000,
        durationMinutes: 60,
      },
    ],
    total: 18000,
    totalDurationMinutes: 60,
    deposit: 18000,
    customer: { name, phone, note: '' },
    date: slot?.date ?? '2030-03-04',
    time: slot?.time ?? '09:00',
    paymentMethod: 'bank-transfer',
    proof: { fileName: 'receipt.png', sizeBytes: 100, mimeType: 'image/png' },
  })
}

/** The honest card title for a store booking: "Booking on <date/time>". */
function bookingTitle(date: string, time: string): string {
  const [y, mo, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return `Booking on ${formatDateTime(new Date(y, mo - 1, d, hh, mm).toISOString())}`
}

function bookingCards(): HTMLElement[] {
  return screen.getAllByRole('article')
}

/** Drives the full public wizard to create a booking, then lands on Done. */
async function bookViaUi(phone: string, name: string): Promise<void> {
  renderAt(`/p/${PRIMARY_BUSINESS_SLUG}`)
  await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })
  await user.click(
    (await screen.findAllByRole('button', { name: /add to booking/i }))[0],
  )
  await user.click(screen.getByRole('button', { name: /continue.*\d+ selected/i }))

  await screen.findByRole('heading', { name: 'Pick a date and time', level: 2 })
  const continueDateStep = screen.getByRole('button', { name: /^continue$/i })
  expect(continueDateStep).toBeDisabled()
  await waitFor(() => {
    expect(document.querySelectorAll('.date-chip').length).toBeGreaterThan(0)
  })
  const chips = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.date-chip'),
  ).filter((chip) => !chip.disabled)
  await user.click(chips[1] ?? chips[0])
  await waitFor(() => {
    expect(
      document.querySelectorAll('.time-grid__item button').length,
    ).toBeGreaterThan(0)
  })
  const slot = document.querySelector<HTMLButtonElement>(
    '.time-grid__item button',
  )
  if (!slot) throw new Error('no time slot rendered')
  await user.click(slot)
  expect(continueDateStep).toBeEnabled()

  await user.click(continueDateStep)
  await screen.findByRole('heading', { name: 'Your details', level: 2 })
  await user.type(screen.getByLabelText('Your name'), name)
  await user.type(screen.getByLabelText('Phone number'), phone)
  await user.click(screen.getByRole('button', { name: /continue to review/i }))

  await screen.findByRole('heading', { name: 'Review your booking', level: 2 })
  await user.click(screen.getByRole('button', { name: /continue to payment/i }))

  await screen.findByRole('heading', { name: 'Payment & confirmation', level: 2 })
  await user.click(screen.getByRole('radio', { name: /bank transfer/i }))
  const proofInput = document.querySelector<HTMLInputElement>('#proof-upload')
  if (!proofInput) throw new Error('proof input missing')
  const file = new File(['x'], 'receipt.png', { type: 'image/png' })
  await user.upload(proofInput, file)
  await user.click(
    screen.getByRole('button', { name: /confirm & send booking request/i }),
  )

  expect(await screen.findByText('Booking request received')).toBeInTheDocument()
}

describe('BookingStatusPage', () => {
  it('renders the status lookup page for a known business', async () => {
    await renderStatusPage()
    expect(
      screen.getByRole('heading', { name: 'Check my booking', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Phone number')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Addis Beauty Lounge' })).toHaveAttribute(
      'href',
      `/p/${PRIMARY_BUSINESS_SLUG}`,
    )
  })

  it('rejects invalid phone numbers without querying', async () => {
    await renderStatusPage()
    await lookup('not-a-phone')
    expect(screen.getByText('Please enter a valid phone number.')).toBeInTheDocument()
    expect(screen.queryByText(/No booking found/)).not.toBeInTheDocument()
  })

  it('shows each customer booking as an honest date/time + status card', async () => {
    // The seeded demo store already has one payment-pending booking for this
    // phone; its date/time is dynamic, so assert by status + card shape.
    await renderStatusPage()
    await lookup('+251911223344')
    await waitFor(() => {
      expect(bookingCards()).toHaveLength(1)
    })
    const title = bookingCards()[0].querySelector('.status-card__title')?.textContent
    expect(title).toMatch(/^Booking on /)
    // The honest card shows date/time + status — never the customer name,
    // services, payment internals (REQ-109 projection). Telegram state is a
    // SEPARATE page-level line, never part of a booking card.
    expect(screen.queryByText('Martha Bekele')).not.toBeInTheDocument()
    expect(screen.queryByText(/Women’s Haircut/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Payment Accepted|Payment Rejected/)).not.toBeInTheDocument()
    expect(
      screen.getAllByText(BOOKING_STATE_LABEL['payment-pending']).length,
    ).toBeGreaterThan(0)
  })

  it('shows the missing Telegram link as a page-level line (REQ-056)', async () => {
    await renderStatusPage()
    await lookup('+251911223344')
    await waitFor(() => {
      expect(bookingCards()).toHaveLength(1)
    })
    // Not in any card — the connection state is projected alongside results.
    expect(screen.getByText('Not connected to Telegram')).toBeInTheDocument()
    expect(screen.queryByText('Telegram connected')).not.toBeInTheDocument()
  })

  it('shows "Telegram connected" when the phone is linked to the business', async () => {
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, '+251911223344', true)
    await renderStatusPage()
    await lookup('+251911223344')
    await waitFor(() => {
      expect(bookingCards()).toHaveLength(1)
    })
    expect(screen.getByText('Telegram connected')).toBeInTheDocument()
    expect(screen.queryByText('Not connected to Telegram')).not.toBeInTheDocument()
  })

  it('shows a clear message when no booking matches', async () => {
    await renderStatusPage()
    await lookup('+251999999999')
    expect(
      await screen.findByText('No booking found for this phone number.'),
    ).toBeInTheDocument()
  })

  it('is scoped to the business in the URL', async () => {
    createBookingFor('+251911223344', 'Martha Bekele', {
      date: '2030-03-04',
      time: '09:00',
    })
    renderAt('/p/marathon-auto-care/status')
    await screen.findByRole('heading', { name: 'Check my booking', level: 1 })
    await lookup('+251911223344')
    expect(
      await screen.findByText('No booking found for this phone number.'),
    ).toBeInTheDocument()
  })

  it('lists every booking for a phone, newest first', async () => {
    createBookingFor('+251912000001', 'Hiwot', {
      date: '2030-03-04',
      time: '09:00',
    })
    createBookingFor('+251912000001', 'Aster', {
      date: '2030-03-04',
      time: '10:30',
    })
    await renderStatusPage()
    await lookup('+251912000001')
    await screen.findByText(bookingTitle('2030-03-04', '10:30'))
    const titles = bookingCards().map((card) =>
      card.querySelector('.status-card__title')?.textContent,
    )
    expect(titles).toEqual([
      bookingTitle('2030-03-04', '10:30'),
      bookingTitle('2030-03-04', '09:00'),
    ])
  })

  it('never reveals internal booking ids or the status history', async () => {
    createBookingFor('+251911223344', 'Martha Bekele', {
      date: '2030-03-04',
      time: '09:00',
    })
    await renderStatusPage()
    await lookup('+251911223344')
    await screen.findByText(bookingTitle('2030-03-04', '09:00'))
    expect(screen.queryByText(/bk-demo-pending/)).not.toBeInTheDocument()
    expect(screen.queryByText(/status history/i)).not.toBeInTheDocument()
  })

  describe('booking state display', () => {
    it('shows Confirmed after the owner accepts the proof', async () => {
      const created = createBookingFor('+251912000002', 'Abebe')
      if (!created.ok) throw new Error('slot unavailable')
      expect(acceptBooking(PRIMARY_BUSINESS_SLUG, created.booking.id).ok).toBe(true)
      await renderStatusPage()
      await lookup('+251912000002')
      expect(
        await screen.findByText(BOOKING_STATE_LABEL.confirmed),
      ).toBeInTheDocument()
      expect(bookingCards()).toHaveLength(1)
    })

    it('shows Rejected after the owner rejects the proof', async () => {
      const created = createBookingFor('+251912000003', 'Kidist')
      if (!created.ok) throw new Error('slot unavailable')
      const rejected = rejectBooking(
        PRIMARY_BUSINESS_SLUG,
        created.booking.id,
        'Proof did not match the amount.',
      )
      expect(rejected.ok).toBe(true)
      await renderStatusPage()
      await lookup('+251912000003')
      expect(
        await screen.findByText(BOOKING_STATE_LABEL.rejected),
      ).toBeInTheDocument()
    })

    it('shows Cancelled after an owner cancel', async () => {
      const created = createBookingFor('+251912000012', 'Bethe')
      if (!created.ok) throw new Error('slot unavailable')
      expect(acceptBooking(PRIMARY_BUSINESS_SLUG, created.booking.id).ok).toBe(true)
      expect(cancelBooking(PRIMARY_BUSINESS_SLUG, created.booking.id).ok).toBe(true)
      await renderStatusPage()
      await lookup('+251912000012')
      expect(
        await screen.findByText(BOOKING_STATE_LABEL.cancelled),
      ).toBeInTheDocument()
    })

    it('shows No Show after the owner marks it', async () => {
      const created = createBookingFor('+251912000013', 'Hanna')
      if (!created.ok) throw new Error('slot unavailable')
      expect(acceptBooking(PRIMARY_BUSINESS_SLUG, created.booking.id).ok).toBe(true)
      expect(markNoShowBooking(PRIMARY_BUSINESS_SLUG, created.booking.id).ok).toBe(true)
      await renderStatusPage()
      await lookup('+251912000013')
      expect(
        await screen.findByText(BOOKING_STATE_LABEL['no-show']),
      ).toBeInTheDocument()
    })

    it('shows Completed for a finished appointment', async () => {
      const created = createBookingFor('+251912000004', 'Liya', {
        date: '2030-03-04',
        time: '09:00',
      })
      if (!created.ok) throw new Error('slot unavailable')
      expect(
        acceptBooking(PRIMARY_BUSINESS_SLUG, created.booking.id).ok,
      ).toBe(true)
      expect(
        completeDueBookings(PRIMARY_BUSINESS_SLUG, '2099-01-01T23:59').ok,
      ).toBe(true)
      await renderStatusPage()
      await lookup('+251912000004')
      expect(
        await screen.findByText(BOOKING_STATE_LABEL.completed),
      ).toBeInTheDocument()
    })
  })

  it('reflects every lifecycle state on its own card', async () => {
    const cases = [
      { phone: '+251912000005', name: 'Ruth', time: '09:00', want: BOOKING_STATE_LABEL['payment-pending'] },
      { phone: '+251912000006', name: 'Sara', time: '10:00', want: BOOKING_STATE_LABEL.confirmed },
      { phone: '+251912000007', name: 'Tigist', time: '11:00', want: BOOKING_STATE_LABEL.rejected },
    ]
    for (const entry of cases) {
      const created = createBookingFor(entry.phone, entry.name, {
        date: '2030-03-04',
        time: entry.time as '09:00',
      })
      if (!created.ok) throw new Error('slot unavailable')
      if (entry.want === BOOKING_STATE_LABEL.confirmed) {
        expect(acceptBooking(PRIMARY_BUSINESS_SLUG, created.booking.id).ok).toBe(true)
      } else if (entry.want === BOOKING_STATE_LABEL.rejected) {
        expect(
          rejectBooking(PRIMARY_BUSINESS_SLUG, created.booking.id, 'Proof unclear').ok,
        ).toBe(true)
      }
    }
    await renderStatusPage()
    for (const entry of cases) {
      await lookup(entry.phone)
      expect(await screen.findByText(entry.want)).toBeInTheDocument()
    }
  })

  it('lives the shared mock store: a status change is visible on a new lookup', async () => {
    const created = createBookingFor('+251912000008', 'Mulu')
    if (!created.ok) throw new Error('slot unavailable')
    await renderStatusPage()
    await lookup('+251912000008')
    expect(
      await screen.findByText(BOOKING_STATE_LABEL['payment-pending']),
    ).toBeInTheDocument()

    expect(acceptBooking(PRIMARY_BUSINESS_SLUG, created.booking.id).ok).toBe(true)

    await lookup('+251912000008')
    expect(await screen.findByText(BOOKING_STATE_LABEL.confirmed)).toBeInTheDocument()
  })

  it('does not show a booking to a different business owner slice', async () => {
    createBookingFor('+251912000009', 'Weyni')
    await renderStatusPage()
    await lookup('+251912000009')
    await screen.findByText(bookingTitle('2030-03-04', '09:00'))
    expect(screen.queryByText(/bk-/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Demo Owner/)).not.toBeInTheDocument()
  })

  it('keeps the other business phone-separated on its own page', async () => {
    createBookingFor('+251912000010', 'Zara')
    renderAt('/p/marathon-auto-care/status')
    await screen.findByRole('heading', { name: 'Check my booking', level: 1 })
    await lookup('+251912000010')
    expect(
      await screen.findByText('No booking found for this phone number.'),
    ).toBeInTheDocument()
  })

  it('shows the no-match message but keeps the form usable for retries', async () => {
    createBookingFor('+251911223344', 'Martha Bekele', {
      date: '2030-03-04',
      time: '09:00',
    })
    await renderStatusPage()
    await lookup('+251999999999')
    await screen.findByText('No booking found for this phone number.')
    await lookup('+251911223344')
    expect(
      await screen.findByText(bookingTitle('2030-03-04', '09:00')),
    ).toBeInTheDocument()
  })

  it('reports how many bookings were found for the customer', async () => {
    createBookingFor('+251912000011', 'Meseret', {
      date: '2030-03-04',
      time: '09:00',
    })
    createBookingFor('+251912000011', 'Bontu', {
      date: '2030-03-04',
      time: '10:30',
    })
    await renderStatusPage()
    await lookup('+251912000011')
    await screen.findByText(bookingTitle('2030-03-04', '10:30'))
    expect(screen.getByText('2 bookings found.')).toBeInTheDocument()
  })

  it('querying is scoped to the real status endpoint (no mock seam)', async () => {
    createBookingFor('+251911223344', 'Martha Bekele', {
      date: '2030-03-04',
      time: '09:00',
    })
    await renderStatusPage()
    await lookup('+251911223344')
    await screen.findByText(bookingTitle('2030-03-04', '09:00'))
    const get = stub?.calls.find(
      (call) => call.method === 'GET' && call.url.includes('/customer/status'),
    )
    expect(get).toBeTruthy()
    const query = new URLSearchParams(get!.url.split('?')[1] ?? '')
    expect(query.get('slug')).toBe(PRIMARY_BUSINESS_SLUG)
    expect(query.get('phone')).toBe('+251911223344')
  })
})

describe('book-then-lookup end to end', () => {
  it('creates a booking, finds it by phone, and shows live state transitions', async () => {
    await bookViaUi('+251913000001', 'Theo Alem')

    const sentNav = screen.getByRole('navigation', { name: 'Booking sent actions' })
    const statusLink = within(sentNav).getByRole('link', {
      name: 'Check my booking status',
    })
    expect(statusLink).toHaveAttribute('href', STATUS_URL)
    await user.click(statusLink)

    await screen.findByRole('heading', { name: 'Check my booking', level: 1 })
    await lookup('+251913000001')
    expect(
      await screen.findByText(BOOKING_STATE_LABEL['payment-pending']),
    ).toBeInTheDocument()
    expect(bookingCards()).toHaveLength(1)

    const created = listBookings(PRIMARY_BUSINESS_SLUG).find(
      (booking) => booking.customer.phone === '+251913000001',
    )
    if (!created) throw new Error('created booking not in store')

    expect(acceptBooking(PRIMARY_BUSINESS_SLUG, created.id).ok).toBe(true)
    await lookup('+251913000001')
    expect(await screen.findByText(BOOKING_STATE_LABEL.confirmed)).toBeInTheDocument()

    expect(completeDueBookings(PRIMARY_BUSINESS_SLUG, '2099-01-01T23:59').ok).toBe(true)
    await lookup('+251913000001')
    expect(await screen.findByText(BOOKING_STATE_LABEL.completed)).toBeInTheDocument()
  })
})

describe('rejected-booking resubmission (Prompt 50, REQ-230)', () => {
  function rejectFor(phone: string, name: string): void {
    const created = createBookingFor(phone, name, {
      date: '2030-03-04',
      time: '09:00',
    })
    if (!created.ok) throw new Error('slot unavailable')
    expect(
      rejectBooking(PRIMARY_BUSINESS_SLUG, created.booking.id, 'Proof unclear').ok,
    ).toBe(true)
  }

  it('offers resubmission only for a rejected booking', async () => {
    rejectFor('+251912050001', 'Reb')
    await renderStatusPage()
    await lookup('+251912050001')
    await screen.findByText(BOOKING_STATE_LABEL.rejected)
    expect(
      screen.getByRole('button', { name: 'Resubmit payment proof' }),
    ).toBeInTheDocument()
  })

  it('never offers resubmission for a non-rejected booking', async () => {
    createBookingFor('+251912050002', 'Pay', { date: '2030-03-04', time: '09:00' })
    await renderStatusPage()
    await lookup('+251912050002')
    await screen.findByText(BOOKING_STATE_LABEL['payment-pending'])
    expect(
      screen.queryByRole('button', { name: 'Resubmit payment proof' }),
    ).not.toBeInTheDocument()
  })

  async function startResubmission(): Promise<void> {
    await user.click(screen.getByRole('button', { name: 'Resubmit payment proof' }))
    await user.click(screen.getByRole('button', { name: 'Request a one-time code' }))
    await screen.findByLabelText('One-time code')
  }

  async function submitResubmission(code: string, fileName = 'new-receipt.png'): Promise<void> {
    await user.type(screen.getByLabelText('One-time code'), code)
    const input = document.querySelector<HTMLInputElement>('#resubmit-proof-upload')
    if (!input) throw new Error('resubmit proof input missing')
    await user.upload(input, new File(['new'], fileName, { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: 'Verify & resubmit' }))
  }

  it('verifies the code + proof and returns the booking to Payment Pending', async () => {
    rejectFor('+251912050003', 'Nati')
    await renderStatusPage()
    await lookup('+251912050003')
    await screen.findByText(BOOKING_STATE_LABEL.rejected)

    await startResubmission()
    await submitResubmission(RESUBMISSION_TEST_CODE)

    expect(await screen.findByText(/awaiting review again/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(
        screen.getAllByText(BOOKING_STATE_LABEL['payment-pending']).length,
      ).toBeGreaterThan(0)
    })
  })

  it('sends the code request (JSON) and the proof (multipart) over the real routes', async () => {
    rejectFor('+251912050004', 'Sena')
    await renderStatusPage()
    await lookup('+251912050004')
    await screen.findByText(BOOKING_STATE_LABEL.rejected)

    await startResubmission()
    await submitResubmission(RESUBMISSION_TEST_CODE)
    await screen.findByText(/awaiting review again/i)

    const requestCall = stub?.calls.find((call) =>
      call.url.includes('/customer/resubmission/request-code'),
    )
    expect(requestCall?.body).toMatchObject({
      businessSlug: PRIMARY_BUSINESS_SLUG,
      phone: '+251912050004',
    })
    const verifyCall = stub?.calls.find((call) =>
      call.url.includes('/customer/resubmission/verify'),
    )
    expect(verifyCall?.body).toMatchObject({ code: RESUBMISSION_TEST_CODE })
    expect(verifyCall?.proof).toEqual({
      fileName: 'new-receipt.png',
      sizeBytes: 3,
      mimeType: 'image/png',
    })
  })

  it('reports an invalid code without changing the booking', async () => {
    rejectFor('+251912050005', 'Tade')
    await renderStatusPage()
    await lookup('+251912050005')
    await screen.findByText(BOOKING_STATE_LABEL.rejected)

    await startResubmission()
    await submitResubmission('000000')

    expect(await screen.findByText(/verification code is invalid/i)).toBeInTheDocument()
    expect(screen.getByText(BOOKING_STATE_LABEL.rejected)).toBeInTheDocument()
  })
})