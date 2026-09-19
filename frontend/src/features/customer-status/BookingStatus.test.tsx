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
  emitMockReminder,
  rescheduleBooking,
} from '@/mock/store'
import { PRIMARY_BUSINESS_SLUG, MOCK_BUSINESS_PAGES } from '@/mock/data'
import { installBusinessApiStub } from '@/test/businessApi'
import {
  BOOKING_STATE_LABEL,
  PAYMENT_STATE_LABEL,
} from '@/features/customer-status/lib/labels'

const user = userEvent.setup()
const STATUS_URL = `/p/${PRIMARY_BUSINESS_SLUG}/status`
const SERVICE_NAME = 'Women’s Haircut & Styling'

let restoreFetch: (() => void) | undefined

beforeEach(() => {
  resetStore()
  const stub = installBusinessApiStub()
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
  const page = MOCK_BUSINESS_PAGES.find(
    (candidate) => candidate.business.slug === PRIMARY_BUSINESS_SLUG,
  )
  if (!page) throw new Error('demo business page missing')
  const service = page.services[0]
  return createBookingEntry({
    businessSlug: PRIMARY_BUSINESS_SLUG,
    lineItems: [
      {
        name: service.name,
        unitPrice: service.basePriceMinor,
        durationMinutes: service.baseDurationMinutes,
      },
    ],
    total: service.basePriceMinor,
    totalDurationMinutes: service.baseDurationMinutes,
    deposit: 18000,
    customer: { name, phone, note: '' },
    date: slot?.date ?? '2030-03-04',
    time: slot?.time ?? '09:00',
    paymentMethod: 'bank-transfer',
    proof: { fileName: 'receipt.png', sizeBytes: 100, mimeType: 'image/png' },
  })
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

  it('shows each customer booking for a matching phone', async () => {
    await renderStatusPage()
    await lookup('+251911223344')
    expect(await screen.findByText('Booking for Martha Bekele')).toBeInTheDocument()
    expect(screen.getByText('Women’s Haircut & Styling')).toBeInTheDocument()
    expect(screen.getAllByText('Payment Pending').length).toBeGreaterThanOrEqual(2)
    expect(bookingCards()).toHaveLength(1)
  })

  it('shows a clear message when no booking matches', async () => {
    await renderStatusPage()
    await lookup('+251999999999')
    expect(
      await screen.findByText('No booking found for this phone number.'),
    ).toBeInTheDocument()
  })

  it('is scoped to the business in the URL', async () => {
    renderAt('/p/marathon-auto-care/status')
    await screen.findByRole('heading', { name: 'Check my booking', level: 1 })
    await lookup('+251911223344')
    expect(
      await screen.findByText('No booking found for this phone number.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Booking for Martha Bekele')).not.toBeInTheDocument()
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
    await screen.findByText('Booking for Hiwot')
    const titles = bookingCards().map((card) =>
      card.querySelector('.status-card__title')?.textContent,
    )
    expect(titles).toEqual([
      'Booking for Aster',
      'Booking for Hiwot',
    ])
  })

  it('never reveals internal booking ids or the status history', async () => {
    await renderStatusPage()
    await lookup('+251911223344')
    await screen.findByText('Booking for Martha Bekele')
    expect(screen.queryByText(/bk-demo-pending/)).not.toBeInTheDocument()
    expect(screen.queryByText(/status history/i)).not.toBeInTheDocument()
  })

  describe('booking state display', () => {
    it('shows Confirmed with Payment Accepted after the owner accepts', async () => {
      const created = createBookingFor('+251912000002', 'Abebe')
      if (!created.ok) throw new Error('slot unavailable')
      expect(acceptBooking(PRIMARY_BUSINESS_SLUG, created.booking.id).ok).toBe(true)
      await renderStatusPage()
      await lookup('+251912000002')
      await screen.findByText('Booking for Abebe')
      expect(screen.getByText(BOOKING_STATE_LABEL.confirmed)).toBeInTheDocument()
      expect(screen.getByText('Payment Accepted')).toBeInTheDocument()
    })

    it('shows rejected with the owner-provided reason', async () => {
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
      await screen.findByText('Booking for Kidist')
      expect(
        screen.getByText(BOOKING_STATE_LABEL.rejected),
      ).toBeInTheDocument()
      expect(screen.getByText('Payment Rejected')).toBeInTheDocument()
      expect(
        screen.getByText(/Proof did not match the amount/),
      ).toBeInTheDocument()
    })

    it('shows Cancelled after an owner cancel', async () => {
      const created = createBookingFor('+251912000012', 'Bethe')
      if (!created.ok) throw new Error('slot unavailable')
      expect(acceptBooking(PRIMARY_BUSINESS_SLUG, created.booking.id).ok).toBe(true)
      expect(cancelBooking(PRIMARY_BUSINESS_SLUG, created.booking.id).ok).toBe(true)
      await renderStatusPage()
      await lookup('+251912000012')
      await screen.findByText('Booking for Bethe')
      expect(screen.getByText(BOOKING_STATE_LABEL.cancelled)).toBeInTheDocument()
    })

    it('shows No Show after the owner marks it', async () => {
      const created = createBookingFor('+251912000013', 'Hanna')
      if (!created.ok) throw new Error('slot unavailable')
      expect(acceptBooking(PRIMARY_BUSINESS_SLUG, created.booking.id).ok).toBe(true)
      expect(markNoShowBooking(PRIMARY_BUSINESS_SLUG, created.booking.id).ok).toBe(true)
      await renderStatusPage()
      await lookup('+251912000013')
      await screen.findByText('Booking for Hanna')
      expect(screen.getByText(BOOKING_STATE_LABEL['no-show'])).toBeInTheDocument()
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
      await screen.findByText('Booking for Liya')
      expect(screen.getByText(BOOKING_STATE_LABEL.completed)).toBeInTheDocument()
      expect(screen.getByText('Payment Accepted')).toBeInTheDocument()
    })
  })

  it('reflects payment review outcomes for each payment state', async () => {
    const cases = [
      { phone: '+251912000005', name: 'Ruth', slot: '09:00', want: PAYMENT_STATE_LABEL.pending },
      { phone: '+251912000006', name: 'Sara', slot: '10:00', want: PAYMENT_STATE_LABEL.accepted },
      { phone: '+251912000007', name: 'Tigist', slot: '11:00', want: PAYMENT_STATE_LABEL.rejected },
    ]
    for (const entry of cases) {
      const created = createBookingFor(entry.phone, entry.name, {
        date: '2030-03-04',
        time: entry.slot as '09:00',
      })
      if (!created.ok) throw new Error('slot unavailable')
      if (entry.want === PAYMENT_STATE_LABEL.accepted) {
        expect(acceptBooking(PRIMARY_BUSINESS_SLUG, created.booking.id).ok).toBe(true)
      } else if (entry.want === PAYMENT_STATE_LABEL.rejected) {
        expect(
          rejectBooking(PRIMARY_BUSINESS_SLUG, created.booking.id, 'Proof unclear').ok,
        ).toBe(true)
      }
    }
    await renderStatusPage()
    for (const entry of cases) {
      await lookup(entry.phone)
      await screen.findByText(`Booking for ${entry.name}`)
      expect(
        screen.getAllByText(`Payment ${entry.want}`).length,
      ).toBeGreaterThanOrEqual(1)
    }
  })

  it('lives the shared mock store: a status change is visible on a new lookup', async () => {
    const created = createBookingFor('+251912000008', 'Mulu')
    if (!created.ok) throw new Error('slot unavailable')
    await renderStatusPage()
    await lookup('+251912000008')
    await screen.findByText('Booking for Mulu')
    expect(screen.getAllByText('Payment Pending').length).toBeGreaterThanOrEqual(2)

    expect(acceptBooking(PRIMARY_BUSINESS_SLUG, created.booking.id).ok).toBe(true)

    await lookup('+251912000008')
    expect(await screen.findByText('Booking for Mulu')).toBeInTheDocument()
    expect(screen.getByText('Confirmed')).toBeInTheDocument()
    expect(screen.getByText('Payment Accepted')).toBeInTheDocument()
  })

  it('does not show a booking to a different business owner slice', async () => {
    createBookingFor('+251912000009', 'Weyni')
    await renderStatusPage()
    await lookup('+251912000009')
    await screen.findByText('Booking for Weyni')
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
    expect(screen.queryByText('Booking for Zara')).not.toBeInTheDocument()
  })

  it('shows the no-match message but keeps the form usable for retries', async () => {
    await renderStatusPage()
    await lookup('+251999999999')
    await screen.findByText('No booking found for this phone number.')
    await lookup('+251911223344')
    expect(await screen.findByText('Booking for Martha Bekele')).toBeInTheDocument()
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
    await screen.findByText('Booking for Bontu')
    expect(screen.getByText('2 bookings found.')).toBeInTheDocument()
  })
})

describe('customer Telegram notifications panel (mock demo)', () => {
  const PHONE = '+251914000001'

  /** Wait for the panel to render after a lookup, then scope queries to it. */
  async function openTelegramPanel() {
    const panel = await screen.findByRole('region', {
      name: 'Telegram notifications',
    })
    return panel
  }

  it('shows Not connected with the (demo) connect toggle, scoped to never claiming real authorization', async () => {
    createBookingFor(PHONE, 'Lidya')
    await renderStatusPage()
    await lookup(PHONE)
    const panel = await openTelegramPanel()
    expect(within(panel).getByText('Not connected')).toBeInTheDocument()
    expect(
      within(panel).getByRole('button', { name: 'Connect Telegram (demo)' }),
    ).toBeInTheDocument()
    expect(
      within(panel).getByText(/no real Telegram authorization/),
    ).toBeInTheDocument()
    // Never connected → no history list, no events.
    expect(
      within(panel).queryByRole('heading', { name: 'Notification history' }),
    ).not.toBeInTheDocument()
  })

  it('does not fabricate events while disconnected, even after lifecycle changes', async () => {
    const created = createBookingFor(PHONE, 'Lidya')
    if (!created.ok) throw new Error('slot unavailable')
    acceptBooking(PRIMARY_BUSINESS_SLUG, created.booking.id)
    await renderStatusPage()
    await lookup(PHONE)
    const panel = await openTelegramPanel()
    expect(within(panel).getByText('Not connected')).toBeInTheDocument()
    expect(within(panel).queryByText(/Booking confirmed/)).not.toBeInTheDocument()
  })

  it('connecting via the demo toggle flips the panel to the connected experience', async () => {
    createBookingFor(PHONE, 'Lidya')
    await renderStatusPage()
    await lookup(PHONE)
    await openTelegramPanel()

    await user.click(screen.getByRole('button', { name: 'Connect Telegram (demo)' }))
    await waitFor(() =>
      expect(screen.getByText('Connected')).toBeInTheDocument(),
    )
    expect(
      screen.getByRole('button', { name: 'Disconnect Telegram (demo)' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        name: 'Notification history',
        level: 3,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/No Telegram notifications yet/),
    ).toBeInTheDocument()
  })

  it('shows a chronological notification history after connected lifecycle events', async () => {
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, PHONE, true)
    const created = createBookingFor(PHONE, 'Lidya')
    if (!created.ok) throw new Error('slot unavailable')
    // Rejection is only valid from Payment Pending (REQ-062), so the events
    // on one booking are proof-received then payment-rejected.
    rejectBooking(
      PRIMARY_BUSINESS_SLUG,
      created.booking.id,
      'Proof unclear — please resubmit.',
    )

    await renderStatusPage()
    await lookup(PHONE)
    const panel = await openTelegramPanel()

    const items = within(panel).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Payment proof received'),
      expect.stringContaining('Payment rejected'),
    ])
    expect(
      within(panel).getByText(
        'Your payment proof has been received and is awaiting review.',
      ),
    ).toBeInTheDocument()
    expect(
      within(panel).getByText('Reason: Proof unclear — please resubmit.'),
    ).toBeInTheDocument()
  })

  it('shows deterministic mock reminders (24h and 1h) for a connected confirmed booking', async () => {
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, PHONE, true)
    const created = createBookingFor(PHONE, 'Lidya')
    if (!created.ok) throw new Error('slot unavailable')
    acceptBooking(PRIMARY_BUSINESS_SLUG, created.booking.id)
    emitMockReminder(PRIMARY_BUSINESS_SLUG, created.booking.id, 'reminder-24h')
    emitMockReminder(PRIMARY_BUSINESS_SLUG, created.booking.id, 'reminder-1h')

    await renderStatusPage()
    await lookup(PHONE)
    const panel = await openTelegramPanel()

    expect(
      within(panel).getByText('Reminder: your appointment is tomorrow.'),
    ).toBeInTheDocument()
    expect(
      within(panel).getByText('Reminder: your appointment is in 1 hour.'),
    ).toBeInTheDocument()
    expect(within(panel).getByText('Reminder — 24 hours')).toBeInTheDocument()
    expect(within(panel).getByText('Reminder — 1 hour')).toBeInTheDocument()
  })

  it('shows the reschedule event with the new date/time for a connected confirmed booking', async () => {
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, PHONE, true)
    const created = createBookingFor(PHONE, 'Lidya', {
      date: '2030-03-04',
      time: '09:00',
    })
    if (!created.ok) throw new Error('slot unavailable')
    acceptBooking(PRIMARY_BUSINESS_SLUG, created.booking.id)
    expect(
      rescheduleBooking(
        PRIMARY_BUSINESS_SLUG,
        created.booking.id,
        '2030-03-05',
        '10:00',
      ).ok,
    ).toBe(true)

    await renderStatusPage()
    await lookup(PHONE)
    const panel = await openTelegramPanel()

    const rescheduledItem = within(panel)
      .getAllByRole('listitem')
      .at(-1)
    expect(rescheduledItem?.textContent).toContain('Rescheduled')
    expect(rescheduledItem?.textContent).toContain('Your booking has been rescheduled.')
    expect(rescheduledItem?.textContent).toContain('New appointment:')
  })

  it('projected history never leaks internal ids, the business slug, or the phone', async () => {
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, PHONE, true)
    const created = createBookingFor(PHONE, 'Lidya')
    if (!created.ok) throw new Error('slot unavailable')
    rejectBooking(PRIMARY_BUSINESS_SLUG, created.booking.id, 'Proof unclear')

    await renderStatusPage()
    await lookup(PHONE)
    const panel = await openTelegramPanel()

    expect(within(panel).queryByText(/bk-/)).not.toBeInTheDocument()
    expect(within(panel).queryByText(/ntf-\d/)).not.toBeInTheDocument()
    expect(within(panel).queryByText(/addis-beauty-lounge/)).not.toBeInTheDocument()
    expect(within(panel).queryByText(PHONE)).not.toBeInTheDocument()
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
    expect(await screen.findByText('Booking for Theo Alem')).toBeInTheDocument()
    expect(screen.getByText(SERVICE_NAME)).toBeInTheDocument()
    expect(screen.getAllByText('Payment Pending').length).toBeGreaterThanOrEqual(2)
    expect(
      screen.getAllByText(BOOKING_STATE_LABEL['payment-pending']).length,
    ).toBeGreaterThan(0)

    const created = listBookings(PRIMARY_BUSINESS_SLUG).find(
      (booking) => booking.customer.phone === '+251913000001',
    )
    if (!created) throw new Error('created booking not in store')

    expect(acceptBooking(PRIMARY_BUSINESS_SLUG, created.id).ok).toBe(true)
    await lookup('+251913000001')
    expect(await screen.findByText('Booking for Theo Alem')).toBeInTheDocument()
    expect(screen.getByText(BOOKING_STATE_LABEL.confirmed)).toBeInTheDocument()
    expect(screen.getByText('Payment Accepted')).toBeInTheDocument()

    expect(completeDueBookings(PRIMARY_BUSINESS_SLUG, '2099-01-01T23:59').ok).toBe(true)
    await lookup('+251913000001')
    expect(await screen.findByText('Booking for Theo Alem')).toBeInTheDocument()
    expect(screen.getByText(BOOKING_STATE_LABEL.completed)).toBeInTheDocument()
  })
})