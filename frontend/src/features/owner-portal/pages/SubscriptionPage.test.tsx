import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  OwnerBusinessView,
  OwnerSubscriptionView,
  SubscriptionProofView,
  SubscriptionStatusCode,
} from '@/api/types'
import { renderAppAt } from '@/test/auth'

const user = userEvent.setup()

const business: OwnerBusinessView = {
  id: 'subscription-business',
  slug: 'subscription-salon',
  name: 'Subscription Salon',
  category: { code: 'SALON_AND_BARBER', label: 'Salon & Barber' },
  description: null,
  address: null,
  phonePublic: null,
  coordinates: { latitude: null, longitude: null },
  isDeactivated: false,
  isPaused: false,
  pauseMessage: null,
  reopenAt: null,
  bookingIntervalMinutes: 30,
  prepaymentMode: 'NONE',
  prepaymentPercent: null,
  prepaymentFixedMinor: null,
  createdAt: '2026-01-01T00:00:00.000Z',
}

function subscription(
  status: SubscriptionStatusCode,
  bookingsEnabled: boolean,
): OwnerSubscriptionView {
  return {
    status,
    trialStartedAt: '2026-01-01T00:00:00.000Z',
    trialEndsAt: '2026-01-15T00:00:00.000Z',
    trialGraceEndsAt: '2026-01-20T00:00:00.000Z',
    periodEndsAt: '2026-02-01T00:00:00.000Z',
    paidGraceEndsAt: '2026-02-08T00:00:00.000Z',
    bookingsEnabled,
    proofs: [],
  }
}

const statusCases: Array<{
  status: SubscriptionStatusCode
  label: string
  bookingsEnabled: boolean
}> = [
  { status: 'TRIAL', label: 'Free trial', bookingsEnabled: true },
  { status: 'TRIAL_GRACE', label: 'Trial grace', bookingsEnabled: true },
  { status: 'ACTIVE', label: 'Active', bookingsEnabled: true },
  { status: 'PAID_GRACE', label: 'Paid grace', bookingsEnabled: true },
  { status: 'EXPIRED', label: 'Expired', bookingsEnabled: false },
  { status: 'NONE', label: 'None', bookingsEnabled: false },
]

describe('SubscriptionPage', () => {
  it.each(statusCases)(
    'renders the backend $status lifecycle and booking projection',
    async ({ status, label, bookingsEnabled }) => {
      renderAppAt('/owner/subscription', {
        businessApi: {
          ownedBusinesses: [business],
          subscriptionsByBusinessId: {
            [business.id]: subscription(status, bookingsEnabled),
          },
        },
      })

      expect(await screen.findByTestId('subscription-status-chip')).toHaveTextContent(label)
      expect(
        screen.getByText(
          `Bookings ${bookingsEnabled ? 'are open' : 'are closed'} on your public page.`,
        ),
      ).toBeInTheDocument()
      expect(screen.getByLabelText('Subscription payment proof')).toHaveAttribute(
        'accept',
        'image/bmp,image/gif,image/jpeg,image/png,image/webp,application/pdf',
      )
    },
  )

  it.each([
    ['TRIAL_GRACE', 'Trial grace period'],
    ['PAID_GRACE', 'Paid grace period'],
    ['EXPIRED', 'New bookings are closed'],
    ['NONE', 'New bookings are closed'],
  ] as Array<[SubscriptionStatusCode, string]>)(
    'shows the selected-business %s warning outside the subscription page',
    async (status, title) => {
      renderAppAt('/owner', {
        businessApi: {
          ownedBusinesses: [business],
          subscriptionsByBusinessId: {
            [business.id]: subscription(status, status !== 'EXPIRED' && status !== 'NONE'),
          },
        },
      })

      expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent(title)
      expect(screen.getByRole('link', { name: 'Review subscription' })).toHaveAttribute(
        'href',
        '/owner/subscription',
      )
    },
  )

  it.each([
    ['TRIAL', true],
    ['ACTIVE', true],
  ] as Array<[SubscriptionStatusCode, boolean]>)(
    'does not show a warning for eligible %s',
    async (status, bookingsEnabled) => {
      renderAppAt('/owner', {
        businessApi: {
          ownedBusinesses: [business],
          subscriptionsByBusinessId: {
            [business.id]: subscription(status, bookingsEnabled),
          },
        },
      })

      expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Review subscription' })).not.toBeInTheDocument()
    },
  )

  it('does not duplicate the warning on the dedicated subscription page', async () => {
    renderAppAt('/owner/subscription', {
      businessApi: {
        ownedBusinesses: [business],
        subscriptionsByBusinessId: {
          [business.id]: subscription('EXPIRED', false),
        },
      },
    })

    expect(await screen.findByText('New bookings are closed')).toBeInTheDocument()
    expect(screen.getAllByText('New bookings are closed')).toHaveLength(1)
    expect(screen.queryByRole('link', { name: 'Review subscription' })).not.toBeInTheDocument()
  })

  it('shows rejected proof history with the review reason', async () => {
    const rejectedProof: SubscriptionProofView = {
      id: 'proof-rejected',
      reviewState: 'REJECTED',
      requestedAt: '2026-02-02T10:00:00.000Z',
      reviewedBy: 'admin-test',
      rejectionReason: 'The transfer reference is unreadable.',
      approvedUntil: null,
      createdAt: '2026-02-02T10:00:00.000Z',
    }
    renderAppAt('/owner/subscription', {
      businessApi: {
        ownedBusinesses: [business],
        subscriptionsByBusinessId: {
          [business.id]: {
            ...subscription('EXPIRED', false),
            proofs: [rejectedProof],
          },
        },
      },
    })

    expect(await screen.findByTestId('proof-review-state')).toHaveTextContent('REJECTED')
    expect(screen.getByTestId('proof-rejection-reason')).toHaveTextContent(
      'Review note: The transfer reference is unreadable.',
    )
  })

  it('uploads a supported proof and immediately shows it in history', async () => {
    const { stub } = renderAppAt('/owner/subscription', {
      businessApi: {
        ownedBusinesses: [business],
        subscriptionsByBusinessId: {
          [business.id]: subscription('NONE', false),
        },
      },
    })

    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'transfer.png', {
      type: 'image/png',
    })
    await user.upload(
      await screen.findByLabelText('Subscription payment proof'),
      file,
    )
    await user.click(screen.getByRole('button', { name: 'Upload proof' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Payment proof received')
    expect(await screen.findByTestId('proof-review-state')).toHaveTextContent('PENDING')
    await waitFor(() => {
      expect(
        stub.calls.some(
          (call) =>
            call.method === 'POST' &&
            call.url.endsWith(`/owner/businesses/${business.id}/subscription/proof`),
        ),
      ).toBe(true)
    })
    expect(stub.calls.find((call) => call.method === 'POST')?.proof).toEqual({
      fileName: 'transfer.png',
      sizeBytes: 4,
      mimeType: 'image/png',
    })
  })

  it('rejects a proof larger than 5 MB before upload', async () => {
    const { stub } = renderAppAt('/owner/subscription')
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', {
      type: 'image/png',
    })

    await user.upload(
      await screen.findByLabelText('Subscription payment proof'),
      file,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Payment proof must be 5 MB or smaller.',
    )
    expect(stub.calls.some((call) => call.method === 'POST')).toBe(false)
  })
})
