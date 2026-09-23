import { beforeEach, describe, expect, it } from 'vitest'
import {
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OWNER_PRINCIPAL, renderAppAt, type RenderAppOptions } from '@/test/auth'
import { resetStore, getBusiness, setPause, listScheduleHistory, getOpenConflicts, createBookingEntry, acceptBooking, getBooking, cancelBooking, cancelPaymentPendingBooking } from '@/mock/store'
import { computeAvailableTimes } from '@/mock/availability'
import { isoWeekdayOf, nextDateStrings } from '@/lib/time'
import { PRIMARY_BUSINESS_SLUG } from '@/mock/data'

const user = userEvent.setup()

// A known future Monday (used by the availability fixture).
const MONDAY = '2030-03-04'
const TUESDAY = '2030-03-05'

/** The `.hours-day` section whose label is `name` (the weekday name also appears as a select option). */
function hoursDay(name: string): HTMLElement {
  const section = screen
    .getAllByText(name)
    .map((candidate) => candidate.closest('.hours-day'))
    .find((container): container is HTMLElement => Boolean(container))
  if (!section) throw new Error(`No hours-day section for ${name}`)
  return section
}

/** Every Monday inside the availability booking window (weekly blocks expand to dated entries there). */
function mondayDatesInWindow(): string[] {
  const windowDays = getBusiness(PRIMARY_BUSINESS_SLUG)!.bookingWindowDays ?? 14
  return nextDateStrings(windowDays).filter((date) => isoWeekdayOf(date) === 1)
}

function seedConfirmedBooking(
  date: string,
  time: string,
  name = 'Test Customer',
): { id: string } {
  const created = createBookingEntry({
    businessSlug: PRIMARY_BUSINESS_SLUG,
    lineItems: [{ name: 'Haircut & blowout', unitPrice: 10000, durationMinutes: 60 }],
    total: 10000,
    totalDurationMinutes: 60,
    deposit: 0,
    customer: { name, phone: '+251900000001', note: '' },
    date,
    time,
    paymentMethod: 'bank-transfer',
    proof: { fileName: 'proof.png', sizeBytes: 100, mimeType: 'image/png' },
  })
  if (!created.ok) throw new Error('seed booking failed')
  const accepted = acceptBooking(PRIMARY_BUSINESS_SLUG, created.booking.id)
  if (!accepted.ok) throw new Error('seed accept failed')
  return { id: accepted.value.id }
}

function renderAt(path: string, options?: RenderAppOptions) {
  return renderAppAt(path, options)
}

beforeEach(() => {
  resetStore()
  // The demo seed books the first two usable weekdays near "today", which
  // drifts with the run date and would add non-deterministic schedule
  // conflicts when a schedule test closes that weekday. Remove them up front
  // so the schedule assertions stay hermetic.
  cancelBooking(PRIMARY_BUSINESS_SLUG, 'bk-demo-confirmed')
  cancelPaymentPendingBooking(PRIMARY_BUSINESS_SLUG, 'bk-demo-pending')
})

describe('owner dashboard', () => {
  it('renders the business status, public link, service count and today summary', async () => {
    renderAt('/owner')

    await screen.findByRole('heading', { name: 'Dashboard' })
    expect(screen.getAllByText('Addis Beauty Lounge').length).toBeGreaterThan(0)
    expect(screen.getByText(OWNER_PRINCIPAL.email)).toBeInTheDocument()
    expect(screen.getByText('werefa.app/p/addis-beauty-lounge')).toBeInTheDocument()
    expect(screen.getByText(/active of 4 total/)).toBeInTheDocument()
    expect(screen.getByText(/bookings? today/)).toBeInTheDocument()
    expect(screen.getByText('Open for new bookings.')).toBeInTheDocument()

    expect(
      screen.getByRole('navigation', { name: 'Owner portal' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('connects Telegram through a one-time deep link — no plain code is shown (REQ-065)', async () => {
    renderAt('/owner')
    await screen.findByRole('heading', { name: 'Dashboard' })

    const card = screen
      .getByRole('heading', { name: 'Telegram' })
      .closest('.card') as HTMLElement | null
    expect(card).not.toBeNull()
    // The connection lookup is async (owner status route) — wait for it to land.
    expect(
      await within(card!).findByText('Not connected'),
    ).toBeInTheDocument()

    await user.click(within(card!).getByRole('button', { name: 'Connect Telegram' }))

    const link = await within(card!).findByRole('link', { name: 'Open Telegram' })
    expect(link).toHaveAttribute(
      'href',
      'https://t.me/werefademo?start=owner-connect-test',
    )
    // The card keeps the countdown while the link is live; the code itself
    // travels only inside the deep link (never a bare field/string).
    expect(
      within(card!).getByText(/Link expires in \d+:\d+\./),
    ).toBeInTheDocument()
    expect(within(card!).queryByText('owner-connect-test')).not.toBeInTheDocument()
  })

  it('shows the connected state on the dashboard once Telegram is linked (REQ-066)', async () => {
    renderAt('/owner', { businessApi: { ownerTelegramConnected: true } })
    await screen.findByRole('heading', { name: 'Dashboard' })

    const card = screen
      .getByRole('heading', { name: 'Telegram' })
      .closest('.card') as HTMLElement | null
    expect(card).not.toBeNull()
    expect(await within(card!).findByText('Telegram connected')).toBeInTheDocument()
    // Connection actions are hidden — the backend has no disconnect endpoint.
    expect(
      within(card!).queryByRole('button', { name: 'Connect Telegram' }),
    ).not.toBeInTheDocument()
  })
})

describe('business profile', () => {
  it('shows the unsaved-changes notice and discards restore the saved values', async () => {
    renderAt('/owner/business')

    await screen.findByRole('heading', { name: 'Business profile' })
    const nameInput = screen.getByLabelText('Business name')
    expect(nameInput).toHaveValue('Addis Beauty Lounge')

    await user.clear(nameInput)
    await user.type(nameInput, 'Changed Salon')
    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Business name')).toHaveValue(
      'Addis Beauty Lounge',
    )
  })

  it('saves profile edits and reflects them on the public page', async () => {
    const { router } = renderAt('/owner/business')

    await screen.findByRole('heading', { name: 'Business profile' })
    const nameInput = screen.getByLabelText('Business name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Addis Hair Studio')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText(/Profile saved\./)).toBeInTheDocument()

    router.navigate('/p/addis-beauty-lounge')
    expect(
      await screen.findByRole('heading', { name: 'Addis Hair Studio' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Addis Beauty Lounge' }),
    ).not.toBeInTheDocument()
  })

  it('does not save the profile when the name is missing', async () => {
    renderAt('/owner/business')

    await screen.findByRole('heading', { name: 'Business profile' })
    await user.clear(screen.getByLabelText('Business name'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(
      await screen.findByText('Please enter your business name.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Profile saved.')).not.toBeInTheDocument()
  })

  it('validates the public link and rejects a slug that is already taken', async () => {
    renderAt('/owner/business')

    await screen.findByRole('heading', { name: 'Business profile' })
    const slugInput = screen.getByLabelText('Public booking link')

    await user.clear(slugInput)
    await user.type(slugInput, 'Bad! Slug')
    await user.click(screen.getByRole('button', { name: 'Save link' }))
    expect(
      await screen.findByText(/use 5–64 characters/i),
    ).toBeInTheDocument()

    await user.clear(slugInput)
    await user.type(slugInput, 'marathon-auto-care')
    await user.click(screen.getByRole('button', { name: 'Save link' }))
    expect(
      await screen.findByText(/already taken by another business/i),
    ).toBeInTheDocument()
  })

  it('saves a new public link that the public page serves from', async () => {
    const { router } = renderAt('/owner/business')

    await screen.findByRole('heading', { name: 'Business profile' })
    const slugInput = screen.getByLabelText('Public booking link')
    await user.clear(slugInput)
    await user.type(slugInput, 'adde-urban-lounge')
    await user.click(screen.getByRole('button', { name: 'Save link' }))
    expect(await screen.findByText('Public link updated.')).toBeInTheDocument()

    router.navigate('/p/adde-urban-lounge')
    expect(
      await screen.findByRole('heading', { name: 'Addis Beauty Lounge' }),
    ).toBeInTheDocument()

    router.navigate('/p/addis-beauty-lounge')
    expect(await screen.findByText('Business not found')).toBeInTheDocument()
  })
})

describe('services', () => {
  it('deactivates a service after confirmation and hides it from the public page; reactivation restores it', async () => {
    const { router } = renderAt('/owner/services')

    await screen.findByRole('heading', { name: 'Services' })
    const row = screen
      .getByRole('heading', { name: 'Men’s Cut' })
      .closest('.service-row') as HTMLElement

    await user.click(within(row).getByRole('button', { name: 'Deactivate' }))
    expect(
      await screen.findByText(/deactivate this service\?/i),
    ).toBeInTheDocument()
    expect(within(row).getByText('Cancel')).toBeInTheDocument()

    await user.click(within(row).getByRole('button', { name: 'Deactivate' }))
    await waitFor(() => {
      const refreshed = screen
        .getByRole('heading', { name: 'Men’s Cut' })
        .closest('.service-row') as HTMLElement
      expect(within(refreshed).getByText('Inactive')).toBeInTheDocument()
      expect(
        within(refreshed).getByRole('button', { name: 'Reactivate' }),
      ).toBeInTheDocument()
    })

    router.navigate('/p/addis-beauty-lounge')
    await screen.findByRole('heading', { name: 'Choose your services' })
    expect(
      screen.queryByRole('heading', { name: 'Men’s Cut' }),
    ).not.toBeInTheDocument()

    router.navigate('/owner/services')
    await screen.findByRole('heading', { name: 'Services', level: 1 })
    const rowAgain = screen
      .getByRole('heading', { name: 'Men’s Cut' })
      .closest('.service-row') as HTMLElement
    await user.click(within(rowAgain).getByRole('button', { name: 'Reactivate' }))
    await waitFor(() => {
      const refreshed = screen
        .getByRole('heading', { name: 'Men’s Cut' })
        .closest('.service-row') as HTMLElement
      expect(within(refreshed).getByText('Active')).toBeInTheDocument()
    })

    router.navigate('/p/addis-beauty-lounge')
    await screen.findByRole('heading', { name: 'Book now' })
    expect(
      screen.getByRole('heading', { name: 'Men’s Cut' }),
    ).toBeInTheDocument()
  })

  it('adds a service with a price and duration and publishes it publicly', async () => {
    const { router } = renderAt('/owner/services/new')

    await screen.findByRole('heading', { name: 'Add a service' })
    await user.type(screen.getByLabelText('Service name'), 'Facial Massage')
    await user.type(screen.getByLabelText('Price (Birr)'), '250')
    await user.type(screen.getByLabelText('Duration (minutes)'), '45')
    await user.click(screen.getByRole('button', { name: 'Save service' }))

    expect(
      await screen.findByText('Service created. It is now live on your public page.'),
    ).toBeInTheDocument()

    router.navigate('/p/addis-beauty-lounge')
    await screen.findByRole('heading', { name: 'Book now' })
    const card = screen
      .getByRole('heading', { name: 'Facial Massage' })
      .closest('.service-card') as HTMLElement
    expect(within(card).getByText(/ETB 250\.00/)).toBeInTheDocument()
    expect(within(card).getByText('45 min')).toBeInTheDocument()
  })

  it('blocks saving a service without a price or duration', async () => {
    renderAt('/owner/services/new')

    await screen.findByRole('heading', { name: 'Add a service' })
    await user.type(screen.getByLabelText('Service name'), 'Hair Spa')
    await user.click(screen.getByRole('button', { name: 'Save service' }))

    expect(await screen.findByText('Enter a valid price (Birr).')).toBeInTheDocument()
    expect(
      screen.getByText('Enter a whole number of minutes, at least 1.'),
    ).toBeInTheDocument()
  })

  it('edits a service price and duration and the public page shows the update', async () => {
    const { router } = renderAt('/owner/services/haircut-styling')

    await screen.findByRole('heading', { name: 'Edit service' })

    const priceInput = screen.getByLabelText('Price (Birr)')
    const durationInput = screen.getByLabelText('Duration (minutes)')
    await waitFor(() => {
      expect(priceInput).not.toHaveValue('')
      expect(durationInput).not.toHaveValue('')
    })
    await user.clear(priceInput)
    await user.type(priceInput, '120')
    await user.clear(durationInput)
    await user.type(durationInput, '40')
    await user.click(screen.getByRole('button', { name: 'Save service' }))

    expect(
      await screen.findByText('Changes to this service are saved.'),
    ).toBeInTheDocument()

    router.navigate('/p/addis-beauty-lounge')
    await screen.findByRole('heading', { name: 'Book now' })
    const card = screen
      .getByRole('heading', { name: 'Women’s Haircut & Styling' })
      .closest('.service-card') as HTMLElement
    expect(within(card).getByText(/ETB 120\.00/)).toBeInTheDocument()
    expect(within(card).getByText('40 min')).toBeInTheDocument()
  })
})

describe('schedule', () => {
  it('closing a weekday stops that weekday from offering times publicly', async () => {
    renderAt('/owner/schedule')

    await screen.findByRole('heading', { name: 'Working hours' })
    const monday = hoursDay('Monday')
    await user.click(within(monday).getByRole('button', { name: 'Open' }))

    const mondayClosed = hoursDay('Monday')
    expect(
      within(mondayClosed).getByRole('button', { name: 'Closed' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(await screen.findByText(/Schedule saved\./)).toBeInTheDocument()

    const business = getBusiness(PRIMARY_BUSINESS_SLUG)!
    expect(business.workingHours[1]).toHaveLength(0)
    expect(computeAvailableTimes(business, MONDAY, 30)).toEqual([])
  })

  it('a special closed date overrides availability on that date', async () => {
    renderAt('/owner/schedule')

    await screen.findByRole('heading', { name: 'Working hours' })
    await user.click(screen.getByRole('button', { name: 'Add special date' }))

    const newDateInput = screen
      .getAllByLabelText(/^Special date \d+$/)
      .find((input) => (input as HTMLInputElement).value === '') as HTMLInputElement
    fireEvent.change(newDateInput, { target: { value: MONDAY } })
    const specialRow = screen
      .getAllByLabelText(/^Special date \d+$/)
      .find((input) => (input as HTMLInputElement).value === MONDAY)!
      .closest('.special-day') as HTMLElement
    await user.click(within(specialRow).getByRole('radio', { name: 'Closed' }))

    await user.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(await screen.findByText(/Schedule saved\./)).toBeInTheDocument()

    const business = getBusiness(PRIMARY_BUSINESS_SLUG)!
    expect(business.specialDays[MONDAY]).toEqual({ kind: 'closed' })
    expect(computeAvailableTimes(business, MONDAY, 30)).toEqual([])
  })

  it('rejects working-hours periods whose end is not after the start', async () => {
    renderAt('/owner/schedule')

    await screen.findByRole('heading', { name: 'Working hours' })
    const monday = hoursDay('Monday')
    const startInput = within(monday).getByLabelText('Monday period 1 start')
    const endInput = within(monday).getByLabelText('Monday period 1 end')
    fireEvent.change(startInput, { target: { value: '14:00' } })
    fireEvent.change(endInput, { target: { value: '09:00' } })

    await user.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(
      await screen.findByText('The end time must be after the start time.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Schedule saved\./)).not.toBeInTheDocument()
  })
})

describe('pause and resume', () => {
  it('pausing with a reopen date blocks new public bookings; resume reopens them', async () => {
    const { router } = renderAt('/owner')

    await screen.findByRole('heading', { name: 'Dashboard' })
    await user.click(screen.getByRole('button', { name: 'Pause bookings' }))

    await user.click(screen.getByRole('radio', { name: /until a chosen date/i }))
    fireEvent.change(screen.getByLabelText('Reopen date'), {
      target: { value: '2030-06-01' },
    })
    await user.type(
      screen.getByLabelText('Message to customers (optional)'),
      'Closed for renovations.',
    )
    await user.click(screen.getByRole('button', { name: 'Save pause' }))

    expect(
      await screen.findByText('Pause bookings now?'),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'Yes, pause bookings' }),
    )
    expect(
      await screen.findByText('Bookings are paused on your public page.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Paused until 2030-06-01')).toBeInTheDocument()

    router.navigate('/p/addis-beauty-lounge')
    expect(
      await screen.findByText('We are currently closed to new bookings'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Closed for renovations\./)).toBeInTheDocument()
    expect(screen.getByText(/Bookings reopen on 2030-06-01\./)).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Book now' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Services & prices' }),
    ).toBeInTheDocument()

    router.navigate('/owner')
    await screen.findByRole('heading', { name: 'Dashboard' })
    await user.click(screen.getByRole('button', { name: 'Resume bookings now' }))
    expect(
      await screen.findByText('Bookings are open again on your public page.'),
    ).toBeInTheDocument()

    router.navigate('/p/addis-beauty-lounge')
    expect(
      await screen.findByRole('heading', { name: 'Book now' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('We are currently closed to new bookings'),
    ).not.toBeInTheDocument()
  })
})

describe('business branding and public preview', () => {
  function fakeImage(seed = 1): File {
    const bytes = new Uint8Array(64)
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * seed) % 256
    return new File([bytes], 'image.png', { type: 'image/png' })
  }

  function pickImage(container: HTMLElement, picker: number, file: File) {
    const input = container.querySelectorAll<HTMLInputElement>(
      'input[type="file"]',
    )[picker]
    fireEvent.change(input, { target: { files: [file] } })
  }

  it('uploads a logo and cover photo and the public page renders both', async () => {
    const { container, router } = renderAt('/owner/business')

    await screen.findByRole('heading', { name: 'Business profile' })
    await screen.findByRole('heading', { name: 'Branding', level: 2 })

    pickImage(container, 0, fakeImage(1))
    await user.click(await screen.findByRole('button', { name: 'Keep' }))
    expect(await screen.findByText(/Branding updated/)).toBeInTheDocument()

    await waitFor(() => {
      const stored = getBusiness(PRIMARY_BUSINESS_SLUG)!
      expect(stored.logo?.dataUrl).toMatch(/^data:image\/png;base64/)
    })

    pickImage(container, 1, fakeImage(2))
    await user.click(await screen.findByRole('button', { name: 'Keep' }))
    await waitFor(() => {
      const stored = getBusiness(PRIMARY_BUSINESS_SLUG)!
      expect(stored.coverPhoto?.dataUrl).toMatch(/^data:image\/png;base64/)
    })

    router.navigate('/p/addis-beauty-lounge')
    await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })
    const logoImg = container.querySelector('.hero__logo-img') as HTMLImageElement
    expect(logoImg).not.toBeNull()
    expect(logoImg.src).toMatch(/^data:image\/png;base64/)
    const coverImg = container.querySelector('.hero__cover') as HTMLImageElement
    expect(coverImg).not.toBeNull()
    expect(coverImg.src).toMatch(/^data:image\/png;base64/)
  })

  it('keeps exactly one logo: replacing removes the old image (no gallery)', async () => {
    const { container } = renderAt('/owner/business')

    await screen.findByRole('heading', { name: 'Business profile' })

    pickImage(container, 0, fakeImage(1))
    await user.click(await screen.findByRole('button', { name: 'Keep' }))
    await screen.findByText(/Branding updated/)

    const firstDataUrl = getBusiness(PRIMARY_BUSINESS_SLUG)!.logo!.dataUrl
    expect(firstDataUrl).toBeTruthy()
    expect(container.querySelectorAll('.image-picker__preview')).toHaveLength(1)

    pickImage(container, 0, fakeImage(2))
    await user.click(await screen.findByRole('button', { name: 'Keep' }))
    await waitFor(() => {
      const stored = getBusiness(PRIMARY_BUSINESS_SLUG)!
      expect(stored.logo).not.toBeNull()
      expect(stored.logo!.dataUrl).not.toBe(firstDataUrl)
    })

    // No gallery surface: a single preview replaces the previous one.
    expect(container.querySelectorAll('.image-picker__preview')).toHaveLength(1)
  })

  it('removing the logo falls back to initials on the public page', async () => {
    const { container, router } = renderAt('/owner/business')

    await screen.findByRole('heading', { name: 'Business profile' })

    pickImage(container, 0, fakeImage(1))
    await user.click(await screen.findByRole('button', { name: 'Keep' }))
    await screen.findByText(/Branding updated/)

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText(/Branding updated/)).toBeInTheDocument()
    expect(getBusiness(PRIMARY_BUSINESS_SLUG)!.logo).toBeNull()

    router.navigate('/p/addis-beauty-lounge')
    await screen.findByRole('heading', { name: 'Addis Beauty Lounge' })
    expect(container.querySelector('.hero__logo-img')).toBeNull()
    expect(screen.getByText('AL')).toBeInTheDocument()
  })

  it('previews the public URL, opens the public page, and shows the map link', async () => {
    const { router } = renderAt('/owner/business')

    await screen.findByRole('heading', { name: 'Business profile' })
    expect(screen.getByTestId('public-page-link')).toHaveTextContent(
      'werefa.app/p/addis-beauty-lounge',
    )
    expect(screen.getByTestId('open-public-page')).toHaveAttribute(
      'href',
      '/p/addis-beauty-lounge',
    )
    expect(screen.getByRole('link', { name: /OpenStreetMap preview/ })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/?mlat=9.0108&mlon=38.7612#map=16/9.0108/38.7612',
    )

    router.navigate('/p/addis-beauty-lounge')
    expect(
      await screen.findByRole('heading', { name: 'Addis Beauty Lounge' }),
    ).toBeInTheDocument()
  })

  it('regenerates the QR mock when the public link changes', async () => {
    renderAt('/owner/business')

    await screen.findByRole('heading', { name: 'Business profile' })
    const first = screen
      .getByRole('img', { name: 'QR code' })
      .querySelector('g') as SVGElement
    const firstInner = first.innerHTML

    const slugInput = screen.getByLabelText('Public booking link')
    await user.clear(slugInput)
    await user.type(slugInput, 'adie-urban-lounge')
    await user.click(screen.getByRole('button', { name: 'Save link' }))
    expect(await screen.findByText('Public link updated.')).toBeInTheDocument()

    await waitFor(() => {
      const next = screen
        .getByRole('img', { name: 'QR code' })
        .querySelector('g') as SVGElement
      expect(next.innerHTML).not.toBe(firstInner)
    })
    expect(screen.getByTestId('public-page-link')).toHaveTextContent(
      'werefa.app/p/adie-urban-lounge',
    )
  })

  it('serves the same public page regardless of which owner owns it; another business is untouched', async () => {
    const { container, router } = renderAt('/owner/business')

    await screen.findByRole('heading', { name: 'Business profile' })
    pickImage(container, 0, fakeImage(3))
    await user.click(await screen.findByRole('button', { name: 'Keep' }))
    await screen.findByText(/Branding updated/)

    const business = getBusiness(PRIMARY_BUSINESS_SLUG)!
    expect(business.logo).not.toBeNull()

    const others = [getBusiness('marathon-auto-care')!, getBusiness('riverside-dry-cleaning')!]
    for (const other of others) expect(other.logo).toBeNull()

    router.navigate('/p/riverside-dry-cleaning')
    await screen.findByRole('heading', { name: 'Riverside Dry Cleaning' })
    expect(container.querySelector('.hero__logo-img')).toBeNull()
  })

  it('lets the owner pause bookings from the business profile page', async () => {
    const { router } = renderAt('/owner/business')

    await screen.findByRole('heading', { name: 'Business profile' })
    await user.click(screen.getByRole('button', { name: 'Pause bookings' }))

    await user.click(screen.getByRole('radio', { name: /until a chosen date/i }))
    fireEvent.change(screen.getByLabelText('Reopen date'), {
      target: { value: '2030-07-01' },
    })
    await user.click(screen.getByRole('button', { name: 'Save pause' }))
    await user.click(
      await screen.findByRole('button', { name: 'Yes, pause bookings' }),
    )
    expect(
      await screen.findByText('Bookings are paused on your public page.'),
    ).toBeInTheDocument()

    router.navigate('/p/addis-beauty-lounge')
    expect(
      await screen.findByText('We are currently closed to new bookings'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Book now' })).not.toBeInTheDocument()
  })
})

describe('schedule editor: blocked days & periods (REQ-084/085)', () => {
  it('blocks a whole day through the editor and saves it', async () => {
    renderAt('/owner/schedule')
    await screen.findByRole('heading', { name: 'Working hours' })

    // REQ-085 in the current UI: a one-off closed date blocks the whole day.
    await user.click(screen.getByRole('button', { name: 'Add special date' }))
    const newDateInput = screen
      .getAllByLabelText(/^Special date \d+$/)
      .find((input) => (input as HTMLInputElement).value === '') as HTMLInputElement
    fireEvent.change(newDateInput, { target: { value: MONDAY } })
    const specialRow = screen
      .getAllByLabelText(/^Special date \d+$/)
      .find((input) => (input as HTMLInputElement).value === MONDAY)!
      .closest('.special-day') as HTMLElement
    await user.click(within(specialRow).getByRole('radio', { name: 'Closed' }))

    await user.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(await screen.findByText(/Schedule saved\./)).toBeInTheDocument()

    const business = getBusiness(PRIMARY_BUSINESS_SLUG)!
    expect(business.specialDays[MONDAY]).toEqual({ kind: 'closed' })
    expect(business.blockedDays).toContain(MONDAY)
    expect(computeAvailableTimes(business, MONDAY, 30)).toEqual([])
  })

  it('adds and removes a blocked period; only a saved one reaches the store', async () => {
    renderAt('/owner/schedule')
    await screen.findByRole('heading', { name: 'Working hours' })

    fireEvent.change(screen.getByLabelText('Blocked period weekday'), {
      target: { value: '1' },
    })
    fireEvent.change(screen.getByLabelText('Blocked period start'), {
      target: { value: '09:30' },
    })
    fireEvent.change(screen.getByLabelText('Blocked period end'), {
      target: { value: '10:30' },
    })
    await user.click(screen.getByRole('button', { name: 'Add blocked period' }))
    expect(
      screen.getByText('Blocked 09:30–10:30 on Monday'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(await screen.findByText(/Schedule saved\./)).toBeInTheDocument()

    // The weekly block is expanded into a dated blocked period on every Monday
    // in the availability booking window (REQ-084).
    const mondays = mondayDatesInWindow()
    expect(mondays.length).toBeGreaterThan(0)
    const business = getBusiness(PRIMARY_BUSINESS_SLUG)!
    for (const date of mondays) {
      expect(business.blockedPeriods).toContainEqual({
        date,
        start: '09:30',
        end: '10:30',
      })
    }

    await user.click(
      screen.getByRole('button', {
        name: 'Remove blocked period on Monday',
      }),
    )
    expect(screen.queryByText('Blocked 09:30–10:30 on Monday')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(await screen.findByText(/Schedule saved\./)).toBeInTheDocument()
    for (const date of mondays) {
      expect(getBusiness(PRIMARY_BUSINESS_SLUG)!.blockedPeriods).not.toContainEqual({
        date,
        start: '09:30',
        end: '10:30',
      })
    }
  })

  it('rejects overlapping weekly periods with a focused error', async () => {
    renderAt('/owner/schedule')
    await screen.findByRole('heading', { name: 'Working hours' })

    const monday = hoursDay('Monday')
    await user.click(within(monday).getByRole('button', { name: 'Add period' }))
    // Default 09:00–13:00 plus added 09:00–12:00 overlap.
    await user.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(
      await screen.findByText('Working periods must not overlap.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Schedule saved\./)).not.toBeInTheDocument()
  })
})

describe('schedule editor: multi-period days (REQ-083)', () => {
  it('offers the public page a weekday with two working periods', async () => {
    renderAt('/owner/schedule')
    await screen.findByRole('heading', { name: 'Working hours' })

    const monday = hoursDay('Monday')
    await user.click(within(monday).getByRole('button', { name: 'Add period' }))
    // The added row defaults to 09:00–12:00 (overlapping); set an evening
    // window that is open on Monday.
    fireEvent.change(within(monday).getByLabelText('Monday period 3 start'), {
      target: { value: '18:00' },
    })
    fireEvent.change(within(monday).getByLabelText('Monday period 3 end'), {
      target: { value: '20:00' },
    })

    await user.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(await screen.findByText(/Schedule saved\./)).toBeInTheDocument()

    const business = getBusiness(PRIMARY_BUSINESS_SLUG)!
    expect(business.workingHours[1]).toHaveLength(3)
    // Both periods are offered publicly: daytime and the added evening window.
    const times = computeAvailableTimes(business, MONDAY, 60)
    expect(times).toContain('09:00')
    expect(times).toContain('18:00')
    expect(times).toContain('19:00')
  })
})

describe('schedule history + reason (REQ-162/163/164/166/169)', () => {
  it('records a version without a reason and shows no reason line', async () => {
    renderAt('/owner/schedule')
    await screen.findByRole('heading', { name: 'Working hours' })
    await user.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(await screen.findByText(/Schedule saved\./)).toBeInTheDocument()

    const history = listScheduleHistory(PRIMARY_BUSINESS_SLUG)
    expect(history).toHaveLength(1)
    expect(history[0].reason).toBeNull()
    expect(screen.getByText('Schedule history')).toBeInTheDocument()
    expect(await screen.findByText('Initial schedule.')).toBeInTheDocument()
    expect(screen.queryByText(/Reason:/)).not.toBeInTheDocument()
  })

  it('shows the owner reason and newest-first status on the history card', async () => {
    const { router } = renderAt('/owner/schedule')
    await screen.findByRole('heading', { name: 'Working hours' })

    await user.type(
      screen.getByLabelText('Reason (optional)'),
      'Q3 opening hours',
    )
    await user.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(await screen.findByText(/Schedule saved\./)).toBeInTheDocument()

    const monday = hoursDay('Monday')
    fireEvent.change(within(monday).getByLabelText('Monday period 2 end'), {
      target: { value: '17:00' },
    })
    await user.type(
      screen.getByLabelText('Reason (optional)'),
      'Evening slots for students',
    )
    await user.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(await screen.findByText(/Schedule saved\./)).toBeInTheDocument()

    const history = listScheduleHistory(PRIMARY_BUSINESS_SLUG)
    expect(history).toHaveLength(2)
    expect(history[0].reason).toBe('Evening slots for students')

    const list = screen.getByText('Schedule history').closest('section')!
    await within(list).findByText(/Weekly hours changed\./)
    const chips = within(list).getAllByText(
      /^(Active|Superseded|Pending)$/,
    )
    expect(chips[0]).toHaveTextContent('Active')
    expect(chips[1]).toHaveTextContent('Superseded')
    expect(
      within(list).getByText(/Reason:.*Evening slots for students/),
    ).toBeInTheDocument()
    expect(
      within(list).getByText(/Reason:.*Q3 opening hours/),
    ).toBeInTheDocument()
    expect(within(list).getByText(/Weekly hours changed\./)).toBeInTheDocument()

    router.navigate('/owner/business')
    expect(
      await screen.findByRole('heading', { name: 'Business profile' }),
    ).toBeInTheDocument()
  })
})

describe('saving while paused (REQ-147/150)', () => {
  it('warns and stores the save as a pending version, activated on resume', async () => {
    setPause(PRIMARY_BUSINESS_SLUG, { kind: 'indefinite', message: 'Holiday' })
    renderAt('/owner/schedule')
    await screen.findByRole('heading', { name: 'Working hours' })

    expect(
      screen.getByText('Changes you save here are recorded as a pending schedule and apply when you resume bookings.'),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Booking interval'), {
      target: { value: '45' },
    })
    await user.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(
      await screen.findByText(/Schedule saved and recorded as pending/),
    ).toBeInTheDocument()

    const history = listScheduleHistory(PRIMARY_BUSINESS_SLUG)
    expect(history[0].status).toBe('pending')
    // The schedule version does not carry the booking interval — that lives on
    // business settings and is saved through its own settings PATCH (REQ-086).
    expect(getOpenConflicts(PRIMARY_BUSINESS_SLUG)).toEqual([])
    expect(getBusiness(PRIMARY_BUSINESS_SLUG)!.bookingIntervalMinutes).toBe(45)

    setPause(PRIMARY_BUSINESS_SLUG, null)
    const after = listScheduleHistory(PRIMARY_BUSINESS_SLUG)
    expect(after[0].automatic).toBe(true)
    expect(after[0].status).toBe('active')
    expect(
      getBusiness(PRIMARY_BUSINESS_SLUG)!.bookingIntervalMinutes,
    ).toBe(45)
  })
})

describe('schedule conflicts (REQ-091/092/093/099/159/160)', () => {
  it('warns about a future booking made impossible by closing its day', async () => {
    seedConfirmedBooking(MONDAY, '10:00')
    renderAt('/owner/schedule')
    await screen.findByRole('heading', { name: 'Working hours' })

    const monday = hoursDay('Monday')
    await user.click(within(monday).getByRole('button', { name: 'Open' }))
    await user.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(await screen.findByText(/Schedule saved\./)).toBeInTheDocument()

    const panel = (await screen.findByRole('heading', { name: 'Affected bookings' }))
      .closest('section') as HTMLElement
    expect(await within(panel).findByText('Test Customer')).toBeInTheDocument()
    expect(
      within(panel).getByText('The business is closed on 2030-03-04.'),
    ).toBeInTheDocument()
    expect(
      within(panel).getByText(/existing booking/),
    ).toBeInTheDocument()
  })

  it('resolving via Cancel releases the booking and clears the panel', async () => {
    seedConfirmedBooking(MONDAY, '10:00')
    const { router } = renderAt('/owner/schedule')
    await screen.findByRole('heading', { name: 'Working hours' })
    const monday = hoursDay('Monday')
    await user.click(within(monday).getByRole('button', { name: 'Open' }))
    await user.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(await screen.findByText(/Schedule saved\./)).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(
      screen.getByText(/Cancel this booking\?/),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }))

    await waitFor(() =>
      expect(getOpenConflicts(PRIMARY_BUSINESS_SLUG)).toEqual([]),
    )
    await waitFor(() => {
      expect(screen.queryByText('Affected bookings')).not.toBeInTheDocument()
    })

    router.navigate('/owner/bookings')
    const card = (await screen.findByText('Test Customer'))
      .closest('.booking-card') as HTMLElement
    expect(within(card).getByText('Cancelled')).toBeInTheDocument()
  })

  it('Keep Booking resolves the conflict without a mock Schedule Exception card', async () => {
    const { id } = seedConfirmedBooking(MONDAY, '10:00')
    const { router } = renderAt('/owner/schedule')
    await screen.findByRole('heading', { name: 'Working hours' })
    const monday = hoursDay('Monday')
    await user.click(within(monday).getByRole('button', { name: 'Open' }))
    await user.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(await screen.findByText(/Schedule saved\./)).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'Keep Booking' }))
    await user.type(
      screen.getByLabelText('Reason / details (optional)'),
      'Confirmed by phone.',
    )
    await user.click(screen.getByRole('button', { name: 'Keep this booking' }))

    await waitFor(() =>
      expect(getOpenConflicts(PRIMARY_BUSINESS_SLUG)).toEqual([]),
    )
    await waitFor(() => {
      expect(screen.queryByText('Affected bookings')).not.toBeInTheDocument()
    })

    router.navigate('/owner/bookings')
    const card = await screen
      .findByText('Test Customer')
      .then((node) => node.closest('.booking-card') as HTMLElement)
    // Keeping resolves the conflict; the booking is unchanged and no mock-only
    // Schedule Exception badge is drawn (Prompt 49).
    expect(within(card).getByText('Confirmed')).toBeInTheDocument()
    expect(within(card).queryByText('Schedule Exception')).not.toBeInTheDocument()

    router.navigate(`/owner/bookings/${id}`)
    await screen.findByRole('heading', { name: 'Test Customer' })
    expect(
      screen.queryByRole('heading', { name: 'Schedule Exception' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Confirmed by phone.')).not.toBeInTheDocument()
  })

  it('Reschedule moves the affected booking to a free slot and clears the conflict', async () => {
    const { id: bookingId } = seedConfirmedBooking(MONDAY, '10:00')
    const { router } = renderAt('/owner/schedule')
    await screen.findByRole('heading', { name: 'Working hours' })
    const monday = hoursDay('Monday')
    await user.click(within(monday).getByRole('button', { name: 'Open' }))
    await user.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(await screen.findByText(/Schedule saved\./)).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'Reschedule' }))
    fireEvent.change(screen.getByLabelText('New date'), {
      target: { value: TUESDAY },
    })

    const timeSelect = (await screen.findByLabelText('New time')) as HTMLSelectElement
    await waitFor(() => {
      expect(Array.from(timeSelect.options).some((o) => o.value === '14:00')).toBe(true)
    })
    fireEvent.change(timeSelect, { target: { value: '14:00' } })
    await user.click(screen.getByRole('button', { name: 'Confirm reschedule' }))

    await waitFor(() =>
      expect(getOpenConflicts(PRIMARY_BUSINESS_SLUG)).toEqual([]),
    )
    await waitFor(() => {
      expect(screen.queryByText('Affected bookings')).not.toBeInTheDocument()
    })

    router.navigate(`/owner/bookings/${bookingId}`)
    expect(
      await screen.findByText(/at 14:00/),
    ).toBeInTheDocument()
  })

  it('exceptions are attributed to the schedule version that caused the conflict and are not re-flagged later', async () => {
    const { id } = seedConfirmedBooking(MONDAY, '10:00')
    renderAt('/owner/schedule')
    await screen.findByRole('heading', { name: 'Working hours' })
    const monday = hoursDay('Monday')
    await user.click(within(monday).getByRole('button', { name: 'Open' }))
    await user.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(await screen.findByText(/Schedule saved\./)).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'Keep Booking' }))
    await user.click(screen.getByRole('button', { name: 'Keep this booking' }))
    await waitFor(() =>
      expect(getOpenConflicts(PRIMARY_BUSINESS_SLUG)).toEqual([]),
    )

    const booking = getBooking(PRIMARY_BUSINESS_SLUG, id)!
    const version = listScheduleHistory(PRIMARY_BUSINESS_SLUG).find(
      (v) => v.status === 'active',
    )
    expect(version).toBeDefined()
    expect(booking.scheduleException).not.toBeNull()
    expect(booking.scheduleException!.scheduleVersionId).toBe(version!.id)

    // Closing a different (demo-free) day afterwards does not re-flag the kept
    // Monday booking.
    const saturday = hoursDay('Saturday')
    await user.click(within(saturday).getByRole('button', { name: 'Open' }))
    await user.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(await screen.findByText(/Schedule saved\./)).toBeInTheDocument()
    expect(getOpenConflicts(PRIMARY_BUSINESS_SLUG)).toEqual([])
  })
})