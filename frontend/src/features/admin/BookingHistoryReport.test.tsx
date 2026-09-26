import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '@/features/auth/AuthProvider'
import type { AuthState } from '@/features/auth/auth-context'
import { appRoutes } from '@/routes'
import { installFetchStub, type FetchStub } from '@/test/fetch'
import { AUTHENTICATED_ADMIN, AUTHENTICATED_SUPER_ADMIN } from '@/test/auth'
import type { BookingHistoryReportView } from '@/api/types'

/**
 * Prompt 59 Super Admin booking-history report: real API data (no mock history),
 * canonical filters carried into the export, and the Super Admin-only guard.
 */

const user = userEvent.setup()
let stub: FetchStub | null = null

const createObjectURL = vi.fn(() => 'blob:report')

beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true, writable: true })
})

afterEach(() => {
  stub?.restore()
  stub = null
  createObjectURL.mockClear()
})

function renderAt(path: string, auth: AuthState) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return render(
    <AuthProvider initialState={auth}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

const REPORT: BookingHistoryReportView = {
  rows: [
    {
      occurredAt: '2026-09-20T10:00:00.000Z',
      bookingId: 42,
      customerName: 'Liya Tesfaye',
      businessName: 'Alpha Salon',
      fromStatus: 'PAYMENT_PENDING',
      toStatus: 'CONFIRMED',
      actorType: 'OWNER',
    },
  ],
  total: 1,
  from: '2026-08-26T00:00:00.000Z',
  to: '2026-09-25T00:00:00.000Z',
  sortBy: 'date',
  sortDirection: 'desc',
}

function hasCall(path: string): boolean {
  return (stub?.calls ?? []).some((call) => call.url.includes(path))
}

describe('Super Admin booking-history report', () => {
  it('renders real backend rows', async () => {
    stub = installFetchStub([{ path: '/admin/reports/booking-history', body: REPORT }])
    renderAt('/admin/reports', AUTHENTICATED_SUPER_ADMIN)

    expect(await screen.findByText('Liya Tesfaye')).toBeInTheDocument()
    expect(screen.getByText('Alpha Salon')).toBeInTheDocument()
    expect(hasCall('/admin/reports/booking-history')).toBe(true)
  })

  it('carries a status filter into the request (OR within category)', async () => {
    stub = installFetchStub([{ path: '/admin/reports/booking-history', body: REPORT }])
    renderAt('/admin/reports', AUTHENTICATED_SUPER_ADMIN)
    await screen.findByText('Liya Tesfaye')

    await user.click(screen.getByRole('checkbox', { name: /COMPLETED/ }))

    await waitFor(() => {
      expect((stub?.calls ?? []).some((call) => call.url.includes('status=COMPLETED'))).toBe(true)
    })
  })

  it('exports the current filters through the real PDF endpoint', async () => {
    stub = installFetchStub([
      { path: '/admin/reports/booking-history.pdf', body: {} },
      { path: '/admin/reports/booking-history', body: REPORT },
    ])
    renderAt('/admin/reports', AUTHENTICATED_SUPER_ADMIN)
    await screen.findByText('Liya Tesfaye')

    await user.click(screen.getByRole('button', { name: /export pdf/i }))

    await waitFor(() => {
      expect(hasCall('/admin/reports/booking-history.pdf')).toBe(true)
      expect(createObjectURL).toHaveBeenCalled()
    })
  })

  it('blocks an Admin from the Super Admin report', async () => {
    stub = installFetchStub([])
    renderAt('/admin/reports', AUTHENTICATED_ADMIN)

    expect(await screen.findByText('Super Admin access only')).toBeInTheDocument()
    expect(hasCall('/admin/reports/booking-history')).toBe(false)
  })
})
