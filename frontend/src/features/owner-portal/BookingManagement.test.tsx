import { beforeEach, describe, expect, it } from 'vitest'
import {
  fireEvent,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderAppAt } from '@/test/auth'
import {
  resetStore,
  listBookings,
  createBookingEntry,
  getServices,
  getBusiness,
  getOccupiedBlocks,
  acceptBooking,
  rejectBooking,
  cancelBooking,
  markNoShowBooking,
  completeDueBookings,
  saveSchedule,
  keepBooking,
  setCustomerTelegramConnected,
} from '@/mock/store'
import { PRIMARY_BUSINESS_SLUG } from '@/mock/data'
import { formatDateLong } from '@/lib/time'
import { formatBytes, formatMoney } from '@/lib/format'
import type { Booking, WeeklyWorkingHours } from '@/types/models'

const user = userEvent.setup()
const SECONDARY_SLUG = 'marathon-auto-care'

function renderAt(path: string) {
  return renderAppAt(path)
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

/** Seeds a Payment Pending booking on a deterministic weekday slot. */
function seedBooking(overrides?: {
  name?: string
  phone?: string
  date?: string
  time?: string
}): Booking {
  const services = getServices(PRIMARY_BUSINESS_SLUG)
  const service = services[0]
  const created = createBookingEntry({
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
    customer: {
      name: overrides?.name ?? 'Casey Doe',
      phone: overrides?.phone ?? '+251922334455',
      note: '',
    },
    date: overrides?.date ?? '2030-03-04',
    time: overrides?.time ?? '09:00',
    paymentMethod: 'bank-transfer' as const,
    proof: { fileName: 'receipt.png', sizeBytes: 128000, mimeType: 'image/png' },
  })
  if (!created.ok) throw new Error('seed booking failed')
  return created.booking
}

function seedConfirmedAt(date: string, time: string): Booking {
  const booking = seedBooking({ name: 'Monday Patron', date, time })
  const accepted = acceptBooking(PRIMARY_BUSINESS_SLUG, booking.id)
  if (!accepted.ok) throw new Error('seed accept failed')
  return accepted.value
}

function stored(id: string): Booking {
  return listBookings(PRIMARY_BUSINESS_SLUG).find((b) => b.id === id)!
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
    expect((await screen.findAllByText('Confirmed')).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByRole('button', { name: 'Accept booking' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject booking' })).not.toBeInTheDocument()
  })

  it('rejects a pending booking when a reason is supplied', async () => {
    const pending = seededPending()
    renderAt(`/owner/bookings/${pending.id}`)
    await screen.findByRole('heading', { name: pending.customer.name })
    await user.type(screen.getByPlaceholderText(/e\.g\./), 'Invalid receipt')
    await user.click(screen.getByRole('button', { name: 'Reject booking' }))
    expect(await screen.findByText('Invalid receipt')).toBeInTheDocument()
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

describe('booking detail information (REQ-174)', () => {
  it('renders customer, appointment, line items, payment proof and history', async () => {
    const b = seededConfirmed()
    renderAt(`/owner/bookings/${b.id}`)
    await screen.findByRole('heading', { name: b.customer.name })

    // Customer + phone in header and customer card.
    expect(
      screen.getAllByText((node) => node === b.customer.phone).length,
    ).toBeGreaterThanOrEqual(1)

    // Appointment with the exact date/time, duration and line items.
    expect(
      screen.getByText(`${formatDateLong(b.date)} at ${b.time}`),
    ).toBeInTheDocument()
    expect(screen.getByText(/Total time \d+ minutes/)).toBeInTheDocument()
    expect(screen.getByText(b.lineItems[0].name)).toBeInTheDocument()
    expect(screen.getByText(`${b.lineItems[0].durationMinutes} min`)).toBeInTheDocument()
    const totalRow = screen.getByText('Total').closest('p') as HTMLElement
    expect(totalRow.textContent).toContain(formatMoney(b.total, 'ETB'))

    // Payment: method label, proof metadata.
    expect(screen.getByText('Bank transfer')).toBeInTheDocument()
    expect(screen.getByText(b.proof.fileName)).toBeInTheDocument()
    expect(
      screen.getByText(`(${formatBytes(b.proof.sizeBytes)} · ${b.proof.mimeType})`),
    ).toBeInTheDocument()

    // State history carries the current marker and the actor trail. The last
    // transition's actor is the owner (label from the wire actor code).
    expect(screen.getByText(/\(current\)/)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(`from .* · Owner ·`))).toBeInTheDocument()

    // No Telegram section is rendered — the owner surface never fabricates
    // customer Telegram state (Prompt 49).
    expect(screen.queryByText('Not connected')).not.toBeInTheDocument()
    expect(
      screen.queryByText('No Telegram notifications sent so far.'),
    ).not.toBeInTheDocument()
  })
})

describe('payment-pending actions: cancel (SM-08)', () => {
  it('cancels a pending booking, keeps the slot blocked and issues no notice', async () => {
    const pending = seedBooking({
      name: 'Pending Pat',
      phone: '+251911100099',
      date: '2030-03-04',
      time: '10:30',
    })
    renderAt(`/owner/bookings/${pending.id}`)
    await screen.findByRole('heading', { name: 'Pending Pat' })

    await user.click(screen.getByRole('button', { name: 'Cancel booking' }))
    expect(screen.getByText(/Cancel this booking\?/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }))

    const cancelledChips = await screen.findAllByText('Cancelled')
    expect(cancelledChips.length).toBeGreaterThanOrEqual(1)
    const changed = stored(pending.id)
    expect(changed.state).toBe('cancelled')
    expect(changed.slotReleased).toBe(false)
    expect(changed.telegramNotices).toHaveLength(0)
    expect(
      getOccupiedBlocks(PRIMARY_BUSINESS_SLUG, pending.date).some(
        (block) => block.start === pending.time,
      ),
    ).toBe(true)
    expect(
      screen.queryByRole('button', { name: 'Accept booking' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Reject booking' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Cancel booking' }),
    ).not.toBeInTheDocument()
  })
})

describe('confirmed actions: No Show / Cancel / Reschedule (REQ-103..107)', () => {
  it('marks a confirmed booking as No Show and releases its slot', async () => {
    const booking = seedConfirmedAt('2030-03-04', '09:00')
    renderAt(`/owner/bookings/${booking.id}`)
    await screen.findByRole('heading', { name: booking.customer.name })

    await user.click(screen.getByRole('button', { name: 'Mark as No Show' }))
    expect(screen.getByText(/appointment as No Show\?/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm No Show' }))

    await waitFor(() => {
      const changed = stored(booking.id)
      expect(changed.state).toBe('no-show')
      expect(changed.slotReleased).toBe(true)
    })
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Mark as No Show' }),
      ).not.toBeInTheDocument()
    })
  })

  it('cancels a confirmed booking and releases its slot', async () => {
    const booking = seedConfirmedAt('2030-03-04', '10:30')
    renderAt(`/owner/bookings/${booking.id}`)
    await screen.findByRole('heading', { name: booking.customer.name })

    await user.click(screen.getByRole('button', { name: 'Cancel booking' }))
    expect(screen.getByText(/Cancel this booking\?/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }))

    await waitFor(() => {
      const changed = stored(booking.id)
      expect(changed.state).toBe('cancelled')
      expect(changed.slotReleased).toBe(true)
    })
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Confirm cancellation' }),
      ).not.toBeInTheDocument()
    })
  })

  it('reschedules a confirmed booking to a free slot and keeps the payment', async () => {
    const booking = seedConfirmedAt('2030-03-04', '09:00')
    renderAt(`/owner/bookings/${booking.id}`)
    await screen.findByRole('heading', { name: booking.customer.name })

    await user.click(screen.getByRole('button', { name: 'Reschedule / Modify' }))
    fireEvent.change(screen.getByLabelText('New date'), {
      target: { value: '2030-03-05' },
    })
    const timeSelect = (await screen.findByLabelText('New time')) as HTMLSelectElement
    await waitFor(() => {
      expect(
        Array.from(timeSelect.options).some((option) => option.value === '14:00'),
      ).toBe(true)
    })
    fireEvent.change(timeSelect, { target: { value: '14:00' } })
    await user.click(screen.getByRole('button', { name: 'Confirm reschedule' }))

    expect(await screen.findByText(/at 14:00/)).toBeInTheDocument()
    const changed = stored(booking.id)
    expect(changed.date).toBe('2030-03-05')
    expect(changed.time).toBe('14:00')
    expect(changed.state).toBe('confirmed')
    expect(changed.paymentState).toBe('accepted')
    expect(changed.deposit).toBe(booking.deposit)
  })
})

describe('rejected booking recovery (T9, REQ-230)', () => {
  it('shows the rejection reason and releases the booking via the detail page', async () => {
    const booking = seedBooking({
      name: 'Rejected Pat',
      phone: '+251933445566',
      date: '2030-03-04',
      time: '10:30',
    })
    const rejected = rejectBooking(
      PRIMARY_BUSINESS_SLUG,
      booking.id,
      'The receipt does not match.',
    )
    if (!rejected.ok) throw new Error('seed reject failed')

    renderAt(`/owner/bookings/${booking.id}`)
    await screen.findByRole('heading', { name: 'Rejected Pat' })
    expect(screen.getAllByText('Rejected').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('The receipt does not match.')).toBeInTheDocument()

    // Only the release action exists for a rejected booking.
    expect(screen.getByRole('button', { name: 'Release booking' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Accept booking' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject booking' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reschedule / Modify' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Release booking' }))

    await waitFor(() => {
      const changed = stored(booking.id)
      expect(changed.state).toBe('cancelled')
      expect(changed.paymentState).toBe('rejected')
      expect(changed.slotReleased).toBe(true)
    })
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Release booking' }),
      ).not.toBeInTheDocument()
    })
  })
})

describe('terminal state guards (REQ-102/103/104)', () => {
  it('exposes no lifecycle actions for a completed booking', async () => {
    const booking = seedConfirmedAt('2030-03-04', '09:00')
    completeDueBookings(PRIMARY_BUSINESS_SLUG, '2030-03-05T00:00')

    renderAt(`/owner/bookings/${booking.id}`)
    await screen.findByRole('heading', { name: booking.customer.name })
    expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(1)

    expect(screen.queryByRole('button', { name: 'Accept booking' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject booking' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reschedule / Modify' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark as No Show' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Release booking' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm cancellation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Review decision' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Manage booking' })).not.toBeInTheDocument()
  })

  it('no-show is permanent: the detail page offers no further actions', async () => {
    const booking = seedConfirmedAt('2030-03-04', '10:30')
    markNoShowBooking(PRIMARY_BUSINESS_SLUG, booking.id)

    renderAt(`/owner/bookings/${booking.id}`)
    await screen.findByRole('heading', { name: booking.customer.name })
    expect(screen.getAllByText('No Show').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByRole('button', { name: 'Mark as No Show' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reschedule / Modify' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Release booking' })).not.toBeInTheDocument()
  })
})

describe('no Telegram section on the detail page (Prompt 49)', () => {
  it('renders no customer Telegram state for a connected or unconnected customer', async () => {
    setCustomerTelegramConnected(PRIMARY_BUSINESS_SLUG, '+251900123456', true)

    const booking = seedBooking({
      name: 'Silent Pat',
      phone: '+251911223377',
      date: '2030-03-04',
      time: '10:30',
    })
    rejectBooking(PRIMARY_BUSINESS_SLUG, booking.id, 'Reason here')

    renderAt(`/owner/bookings/${booking.id}`)
    await screen.findByRole('heading', { name: 'Silent Pat' })
    expect(screen.queryByText('Not connected')).not.toBeInTheDocument()
    expect(screen.queryByText('Connected')).not.toBeInTheDocument()
    expect(
      screen.queryByText('No Telegram notifications sent so far.'),
    ).not.toBeInTheDocument()
    expect(document.querySelectorAll('.telegram-notice')).toHaveLength(0)
  })
})

describe('schedule conflicts on the detail page (REQ-093/160)', () => {
  it('warns about an open conflict and links to the schedule page', async () => {
    const booking = seedConfirmedAt('2030-03-04', '09:00')
    const business = getBusiness(PRIMARY_BUSINESS_SLUG)!
    saveSchedule(PRIMARY_BUSINESS_SLUG, {
      workingHours: business.workingHours.map((day, index) =>
        index === 1 ? [] : day,
      ) as WeeklyWorkingHours,
      bookingIntervalMinutes: business.bookingIntervalMinutes,
      blockedDays: business.blockedDays,
      blockedPeriods: business.blockedPeriods,
      specialDays: business.specialDays,
    })

    renderAt(`/owner/bookings/${booking.id}`)
    await screen.findByRole('heading', { name: booking.customer.name })
    expect(
      await screen.findByText('Affected by a schedule change'),
    ).toBeInTheDocument()
    expect(screen.getByText(/closed on 2030-03-04/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open schedule' })).toBeInTheDocument()
  })
})

describe('tenant isolation on the detail page', () => {
  it('never loads a booking that belongs to another business', async () => {
    const services = getServices(SECONDARY_SLUG)
    const created = createBookingEntry({
      businessSlug: SECONDARY_SLUG,
      lineItems: [
        {
          name: services[0].name,
          unitPrice: services[0].basePriceMinor,
          durationMinutes: services[0].baseDurationMinutes,
        },
      ],
      total: services[0].basePriceMinor,
      totalDurationMinutes: services[0].baseDurationMinutes,
      deposit: 0,
      customer: { name: 'Intruder', phone: '+251922112233', note: '' },
      date: '2030-03-04',
      time: '09:00',
      paymentMethod: 'bank-transfer' as const,
      proof: { fileName: 'receipt.png', sizeBytes: 100, mimeType: 'image/png' },
    })
    if (!created.ok) throw new Error('seed failed')

    renderAt(`/owner/bookings/${created.booking.id}`)
    expect(await screen.findByText('Booking not found')).toBeInTheDocument()
    expect(
      screen.getByText(/We could not find that booking for your business\./),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to bookings' })).toBeInTheDocument()
  })
})

describe('booking detail: customer note (Prompt 38)', () => {
  it('shows the customer note when one is present', async () => {
    const pending = seededPending()
    renderAt(`/owner/bookings/${pending.id}`)
    await screen.findByRole('heading', { name: pending.customer.name })
    if (pending.customer.note) {
      expect(screen.getByText(`"${pending.customer.note}"`)).toBeInTheDocument()
    }
  })
})

describe('terminal state guards: Cancelled (Prompt 38, REQ-104)', () => {
  it('a cancelled booking exposes no lifecycle actions', async () => {
    const booking = seedConfirmedAt('2030-03-04', '09:00')
    cancelBooking(PRIMARY_BUSINESS_SLUG, booking.id)
    renderAt(`/owner/bookings/${booking.id}`)
    await screen.findByRole('heading', { name: booking.customer.name })
    expect(screen.queryByRole('button', { name: 'Reschedule / Modify' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark as No Show' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Accept booking' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Release booking' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Manage booking' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Review decision' })).not.toBeInTheDocument()
  })
})

describe('rejection: whitespace-only reason (Prompt 38)', () => {
  it('prevents rejection when the reason is only whitespace', async () => {
    const pending = seedBooking({ name: 'Spacey Pat', phone: '+251944001122', date: '2030-03-04', time: '10:30' })
    renderAt(`/owner/bookings/${pending.id}`)
    await screen.findByRole('heading', { name: 'Spacey Pat' })
    await user.type(screen.getByPlaceholderText(/e\.g\./), '   ')
    await user.click(screen.getByRole('button', { name: 'Reject booking' }))
    expect(await screen.findByText(/provide a reason/i)).toBeInTheDocument()
    expect(listBookings(PRIMARY_BUSINESS_SLUG).find((b) => b.id === pending.id)!.state).toBe('payment-pending')
  })
})

describe('rejected recovery: resubmission path text (Prompt 38, T10)', () => {
  it('rejected detail explains the supported customer resubmission path', async () => {
    const booking = seedBooking({ name: 'Resubmit Pat', phone: '+251933445599', date: '2030-03-05', time: '09:00' })
    rejectBooking(PRIMARY_BUSINESS_SLUG, booking.id, 'Bad proof')
    renderAt(`/owner/bookings/${booking.id}`)
    await screen.findByRole('heading', { name: 'Resubmit Pat' })
    expect(screen.getByText(/may resubmit valid proof/i)).toBeInTheDocument()
    expect(screen.getByText(/slot stays blocked/i)).toBeInTheDocument()
  })
})

describe('schedule exception absent from the detail page (Prompt 49)', () => {
  it('a kept booking stays Confirmed with no mock-only Schedule Exception card', async () => {
    const booking = seedConfirmedAt('2030-03-04', '09:00')
    const business = getBusiness(PRIMARY_BUSINESS_SLUG)!
    saveSchedule(PRIMARY_BUSINESS_SLUG, {
      workingHours: business.workingHours.map((day, index) => (index === 1 ? [] : day)) as WeeklyWorkingHours,
      bookingIntervalMinutes: business.bookingIntervalMinutes,
      blockedDays: business.blockedDays,
      blockedPeriods: business.blockedPeriods,
      specialDays: business.specialDays,
    })
    keepBooking(PRIMARY_BUSINESS_SLUG, booking.id, 'Customer confirmed by phone.')
    renderAt(`/owner/bookings/${booking.id}`)
    await screen.findByRole('heading', { name: booking.customer.name })
    // Keeping the booking resolves the conflict, so the real Schedule card does
    // not appear and no mock-only Schedule Exception card is rendered either.
    expect(screen.getAllByText('Confirmed').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByRole('heading', { name: 'Schedule Exception' })).not.toBeInTheDocument()
    expect(screen.queryByText('Customer confirmed by phone.')).not.toBeInTheDocument()
  })
})
