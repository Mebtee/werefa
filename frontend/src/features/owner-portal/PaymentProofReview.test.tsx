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

    expect(await screen.findByText(pending.proof.fileName)).toBeInTheDocument()
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
  it('shows a safe message when the proof cannot be loaded', async () => {
    const pending = seededPending()
    renderAppAt(`/owner/bookings/${pending.id}`, {
      businessApi: {
        failOwnerBookingRequest: ({ method, path }) =>
          method === 'GET' && path.endsWith(`/bookings/${pending.id}`)
            ? errorEnvelope(500, 'INTERNAL_ERROR', 'Boom')
            : null,
      },
    })
    await screen.findByRole('heading', { name: pending.customer.name })

    expect(await screen.findByText(/Something went wrong on our side/i)).toBeInTheDocument()
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
    await screen.findByRole('heading', { name: pending.customer.name })

    expect(await screen.findByText(/Could not load the payment proof/i)).toBeInTheDocument()
    expect(screen.queryByText(pending.proof.fileName)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Download proof' }),
    ).not.toBeInTheDocument()
  })
})
