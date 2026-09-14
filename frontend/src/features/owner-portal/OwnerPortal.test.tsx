import { beforeEach, describe, expect, it } from 'vitest'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  type RenderResult,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { appRoutes } from '@/routes'
import { resetStore, getBusiness } from '@/mock/store'
import { computeAvailableTimes } from '@/mock/availability'
import { PRIMARY_BUSINESS_SLUG } from '@/mock/data'
import { formatMoney } from '@/lib/format'

const user = userEvent.setup()

// A known future Monday (used by the availability fixture).
const MONDAY = '2030-03-04'

function renderAt(path: string): RenderResult & { router: ReturnType<typeof createMemoryRouter> } {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  const result = render(<RouterProvider router={router} />)
  return { router, ...result }
}

beforeEach(() => {
  resetStore()
})

describe('owner dashboard', () => {
  it('renders the business status, public link, service count and today summary', async () => {
    const { router } = renderAt('/owner')

    await screen.findByRole('heading', { name: 'Dashboard' })
    expect(screen.getAllByText('Addis Beauty Lounge').length).toBeGreaterThan(0)
    expect(screen.getByText('Demo session')).toBeInTheDocument()
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
    await screen.findByRole('heading', { name: 'Services' })
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
    expect(
      await screen.findByRole('heading', { name: 'Men’s Cut' }),
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
    await screen.findByRole('heading', { name: 'Facial Massage' })
    expect(screen.getByText(formatMoney(25000, 'ETB'))).toBeInTheDocument()
    expect(screen.getByText('45 min')).toBeInTheDocument()
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
    await user.clear(priceInput)
    await user.type(priceInput, '120')
    await user.clear(durationInput)
    await user.type(durationInput, '40')
    await user.click(screen.getByRole('button', { name: 'Save service' }))

    expect(
      await screen.findByText('Changes to this service are saved.'),
    ).toBeInTheDocument()

    router.navigate('/p/addis-beauty-lounge')
    const heading = await screen.findByRole('heading', {
      name: 'Women’s Haircut & Styling',
    })
    const card = heading.closest('.service-card') as HTMLElement
    expect(within(card).getByText(formatMoney(12000, 'ETB'))).toBeInTheDocument()
    expect(within(card).getByText('40 min')).toBeInTheDocument()
  })
})

describe('schedule', () => {
  it('closing a weekday stops that weekday from offering times publicly', async () => {
    renderAt('/owner/schedule')

    await screen.findByRole('heading', { name: 'Working hours' })
    const monday = screen
      .getByText('Monday')
      .closest('.hours-day') as HTMLElement
    await user.click(within(monday).getByRole('button', { name: 'Open' }))

    const mondayClosed = screen
      .getByText('Monday')
      .closest('.hours-day') as HTMLElement
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
    const specialRow = newDateInput.closest('.special-day') as HTMLElement
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
    const monday = screen
      .getByText('Monday')
      .closest('.hours-day') as HTMLElement
    const startInput = within(monday).getByLabelText('Monday period 1 start')
    fireEvent.change(startInput, { target: { value: '14:00' } })
    const endInput = within(monday).getByLabelText('Monday period 1 end')
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