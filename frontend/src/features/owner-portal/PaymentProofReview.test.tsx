import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderAppAt } from '@/test/auth'
import { getBooking, listBookings, resetStore } from '@/mock/store'
import { PRIMARY_BUSINESS_SLUG } from '@/mock/data'
import { mockOwnerApi } from '@/mock/ownerApi'

/**
 * Prompt 51 — owner payment-proof review on the real backend.
 *
 * These tests drive the migrated surface through the real API client and assert
 * on the requests the stateful test double recorded, so they fail if the UI
 * falls back to the mock owner API. Error paths are injected by the double's
 * `failOwnerBookingRequest` seam.
 */

const user = userEvent.setup()

const OWNER_ID = '00000000-0000-4000-8000-0000000000a'

function bookingEndpoint(id: string): string {
  return `/api/v1/owner/businesses/${OWNER_ID}/bookings/${id}`
}

function seededPending() {
  return listBookings(PRIMARY_BUSINESS_SLUG).find((b) => b.state === 'payment-pending')!
}

function errorEnvelope(status: number, code: string, detail: string): Response {
  return new Response(JSON.stringify({ error: { code, title: code, detail } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  resetStore()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('owner payment-proof review — real API', () => {
  it('loads the proof from the owner-scoped detail endpoint', async () => {
    const pending = seededPending()
    const { stub } = renderAppAt(`/owner/bookings/${pending.id}`)
    await screen.findByRole('heading', { name: pending.customer.name })

    expect(await screen.findByText(pending.proof!.fileName)).toBeInTheDocument()
    expect(
      stub.calls.some(
        (call) => call.url.endsWith(bookingEndpoint(pending.id)) && call.method === 'GET',
      ),
    ).toBe(true)
  })

  it('accepts through the real route and never the mock owner API', async () => {
    const acceptSpy = vi.spyOn(mockOwnerApi, 'acceptBooking')
    const pending = seededPending()
    const { stub } = renderAppAt(`/owner/bookings/${pending.id}`)
    await screen.findByRole('heading', { name: pending.customer.name })

    await user.click(screen.getByRole('button', { name: 'Accept booking' }))

    expect((await screen.findAllByText('Confirmed')).length).toBeGreaterThanOrEqual(1)
    expect(
      stub.calls.some(
        (call) => call.url.endsWith(`${bookingEndpoint(pending.id)}/accept`) && call.method === 'POST',
      ),
    ).toBe(true)
    expect(acceptSpy).not.toHaveBeenCalled()
    expect(getBooking(PRIMARY_BUSINESS_SLUG, pending.id)?.state).toBe('confirmed')
  })

  it('rejects through the real route with the entered reason', async () => {
    const pending = seededPending()
    const { stub } = renderAppAt(`/owner/bookings/${pending.id}`)
    await screen.findByRole('heading', { name: pending.customer.name })

    await user.type(screen.getByPlaceholderText(/e\.g\./), 'Invalid receipt')
    await user.click(screen.getByRole('button', { name: 'Reject booking' }))

    expect(await screen.findByText('Invalid receipt')).toBeInTheDocument()
    const call = stub.calls.find(
      (entry) => entry.url.endsWith(`${bookingEndpoint(pending.id)}/reject`),
    )
    expect(call?.method).toBe('POST')
    expect(call?.body).toEqual({ reason: 'Invalid receipt' })
  })

  it('does not call the rejection route without a reason', async () => {
    const pending = seededPending()
    const { stub } = renderAppAt(`/owner/bookings/${pending.id}`)
    await screen.findByRole('heading', { name: pending.customer.name })

    await user.click(screen.getByRole('button', { name: 'Reject booking' }))

    expect(await screen.findByText(/provide a reason/i)).toBeInTheDocument()
    expect(stub.calls.some((call) => call.url.endsWith('/reject'))).toBe(false)
  })

  it('downloads the proof through the real tenant-scoped route', async () => {
    const createObjectURL = vi.fn(() => 'blob:proof')
    const revokeObjectURL = vi.fn()
    const urlWithObjectUrls = URL as unknown as {
      createObjectURL?: (blob: Blob) => string
      revokeObjectURL?: (url: string) => void
    }
    urlWithObjectUrls.createObjectURL = createObjectURL
    urlWithObjectUrls.revokeObjectURL = revokeObjectURL

    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})

    const pending = seededPending()
    const { stub } = renderAppAt(`/owner/bookings/${pending.id}`)
    await screen.findByRole('heading', { name: pending.customer.name })

    await user.click(await screen.findByRole('button', { name: 'Download proof' }))

    await waitFor(() => expect(createObjectURL).toHaveBeenCalled())
    expect(
      stub.calls.some(
        (call) =>
          call.url.endsWith(`${bookingEndpoint(pending.id)}/proofs/proof-${pending.id}`) &&
          call.method === 'GET',
      ),
    ).toBe(true)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:proof')
    expect(clickSpy).toHaveBeenCalled()
  })
})

describe('owner payment-proof review — error handling', () => {
  it('does not leak mock booking data when the detail cannot be loaded', async () => {
    const pending = seededPending()
    renderAppAt(`/owner/bookings/${pending.id}`, {
      businessApi: {
        failOwnerBookingRequest: ({ method, path }) =>
          method === 'GET' && path.endsWith(`/bookings/${pending.id}`)
            ? errorEnvelope(500, 'INTERNAL_ERROR', 'Boom')
            : null,
      },
    })

    // The detail shell and the review share the same real endpoint, so a
    // failed load yields the safe not-found state, never mock data.
    expect(await screen.findByText(/Booking not found/i)).toBeInTheDocument()
    expect(screen.queryByText(pending.customer.name)).not.toBeInTheDocument()
    expect(screen.queryByText(pending.proof!.fileName)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Download proof' }),
    ).not.toBeInTheDocument()
  })

  it('keeps the booking Payment Pending when accept conflicts', async () => {
    const pending = seededPending()
    renderAppAt(`/owner/bookings/${pending.id}`, {
      businessApi: {
        failOwnerBookingRequest: ({ method, path }) =>
          method === 'POST' && path.endsWith('/accept')
            ? errorEnvelope(409, 'INVALID_TRANSITION', 'Only a Payment Pending booking can be accepted.')
            : null,
      },
    })
    await screen.findByRole('heading', { name: pending.customer.name })

    await user.click(screen.getByRole('button', { name: 'Accept booking' }))

    expect(
      await screen.findByText('Only a Payment Pending booking can be accepted.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept booking' })).toBeInTheDocument()
  })

  it('does not leak mock proof data when the booking is not reviewable', async () => {
    const pending = seededPending()
    renderAppAt(`/owner/bookings/${pending.id}`, {
      businessApi: {
        failOwnerBookingRequest: ({ method, path }) =>
          method === 'GET' && path.endsWith(`/bookings/${pending.id}`)
            ? errorEnvelope(404, 'NOT_FOUND', 'Booking not found for this business.')
            : null,
      },
    })

    expect(await screen.findByText(/Booking not found/i)).toBeInTheDocument()
    expect(screen.queryByText(pending.proof!.fileName)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Download proof' }),
    ).not.toBeInTheDocument()
  })
})

/** jsdom does not implement object URLs, so a preview test installs them. */
function installObjectUrls(prefix: string) {
  const createObjectURL = vi.fn(() => prefix)
  const revokeObjectURL = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', {
    value: createObjectURL,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: revokeObjectURL,
    configurable: true,
    writable: true,
  })
  return { createObjectURL, revokeObjectURL }
}

describe('owner payment-receipt preview before the decision', () => {
  it('renders the real uploaded receipt fetched over the tenant-scoped route', async () => {
    installObjectUrls('blob:receipt')
    const pending = seededPending()
    const { stub } = renderAppAt(`/owner/bookings/${pending.id}`)
    await screen.findByRole('heading', { name: pending.customer.name })

    // The preview must use the same authenticated proof route as the download.
    expect(
      stub.calls.some(
        (call) =>
          call.method === 'GET' &&
          call.url.endsWith(`${bookingEndpoint(pending.id)}/proofs/proof-${pending.id}`),
      ),
    ).toBe(true)

    // The actual image renders (contained), with open/enlarge + download.
    expect(await screen.findByRole('img', { name: /deposit-receipt\.png/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open / Enlarge' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download receipt' })).toBeInTheDocument()

    // The decision controls stay available next to the receipt.
    expect(screen.getByRole('button', { name: 'Accept booking' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject booking' })).toBeInTheDocument()
  })

  it('opens the enlarged receipt and closes it with Escape', async () => {
    installObjectUrls('blob:receipt')
    const pending = seededPending()
    renderAppAt(`/owner/bookings/${pending.id}`)
    await screen.findByRole('heading', { name: pending.customer.name })

    await user.click(await screen.findByRole('button', { name: 'Open / Enlarge' }))
    expect(
      await screen.findByRole('dialog', { name: /deposit-receipt\.png/ }),
    ).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows an honest no-proof state without fabricating a receipt', async () => {
    const pending = seededPending()
    // A booking can legitimately carry no proof (file-less proofs are dropped
    // from the owner projection); the UI must say so, not invent one.
    getBooking(PRIMARY_BUSINESS_SLUG, pending.id)!.proof = null
    renderAppAt(`/owner/bookings/${pending.id}`)
    await screen.findByRole('heading', { name: pending.customer.name })

    expect(await screen.findByText('No payment proof uploaded.')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /receipt/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept booking' })).toBeInTheDocument()
  })

  it('shows an honest error state when the receipt fails to load, keeping the decision controls', async () => {
    const pending = seededPending()
    renderAppAt(`/owner/bookings/${pending.id}`, {
      businessApi: {
        failOwnerBookingRequest: ({ method, path }) =>
          method === 'GET' && path.endsWith(`/proofs/proof-${pending.id}`)
            ? errorEnvelope(404, 'NOT_FOUND', 'Proof not found.')
            : null,
      },
    })
    await screen.findByRole('heading', { name: pending.customer.name })

    expect(
      await screen.findByText(/Could not load the payment receipt/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept booking' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject booking' })).toBeInTheDocument()
  })
})
