import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '@/features/auth/AuthProvider'
import type { AuthState } from '@/features/auth/auth-context'
import { appRoutes } from '@/routes'
import { installFetchStub } from '@/test/fetch'
import { AUTHENTICATED_ADMIN } from '@/test/auth'
import type { AdminSubscriptionProofView } from '@/api/types'

/**
 * Admin subscription payment-proof preview (review before decision).
 *
 * The admin page consumes the real Admin routes; the queue/approve/reject calls
 * are JSON and the proof file is binary, so the shared JSON stub is wrapped with
 * a binary route for the proof file. These tests assert the ACTUAL uploaded
 * proof is fetched over the authenticated Admin route (never a public URL) and
 * that the approve/reject controls remain.
 */

const user = userEvent.setup()

const ROW: AdminSubscriptionProofView = {
  id: 'p1',
  reviewState: 'PENDING',
  requestedAt: '2026-01-02T03:04:05.000Z',
  reviewedBy: null,
  rejectionReason: null,
  approvedUntil: null,
  createdAt: '2026-01-02T03:04:05.000Z',
  businessId: 'b1',
  businessName: 'My Salon',
  ownerEmail: 'owner@werefa.test',
}

const PROOF_PATH = '/admin/subscription/proofs/p1/file'

function renderAt(path: string, auth: AuthState) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return render(
    <AuthProvider initialState={auth}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

interface Installed {
  fileCalls: string[]
  restore(): void
}

/** Installs the JSON stub and a binary handler for the proof-file route. */
function installAdminStub(fileResponse: () => Response): Installed {
  const base = installFetchStub([
    { method: 'GET', path: '/admin/subscription/proofs', body: [ROW] },
  ])
  const baseFetch = globalThis.fetch
  const fileCalls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof URL ? input.href : input)
    if (url.includes(PROOF_PATH)) {
      fileCalls.push(url)
      return fileResponse()
    }
    return baseFetch(input, init)
  }) as typeof fetch
  return {
    fileCalls,
    restore() {
      base.restore()
    },
  }
}

function binaryResponse(type: string): Response {
  return new Response(new Blob([new Uint8Array([1, 2, 3, 4])], { type }), {
    status: 200,
    headers: { 'content-type': type },
  })
}

function notFound(): Response {
  return new Response(
    JSON.stringify({ error: { code: 'NOT_FOUND', title: 'NotFound', detail: 'Proof not found.' } }),
    { status: 404, headers: { 'content-type': 'application/json' } },
  )
}

let installed: Installed | null = null

beforeEach(() => {
  const createObjectURL = vi.fn(() => 'blob:admin-receipt')
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
})

afterEach(() => {
  installed?.restore()
  installed = null
  vi.restoreAllMocks()
})

describe('admin subscription proof preview', () => {
  it('renders the real image receipt over the authenticated admin route', async () => {
    installed = installAdminStub(() => binaryResponse('image/png'))
    renderAt('/admin/subscriptions', AUTHENTICATED_ADMIN)

    await screen.findByText('My Salon')
    expect(await screen.findByRole('img', { name: /Payment receipt/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open / Enlarge' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download receipt' })).toBeInTheDocument()

    // Approve/reject remain, and the file came from the Admin API path only.
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
    expect(installed.fileCalls.every((url) => url.includes(PROOF_PATH))).toBe(true)
    expect(
      installed.fileCalls.every((url) => !/\/uploads\/|storageKey|proof-storage/i.test(url)),
    ).toBe(true)
  })

  it('renders a PDF receipt in the browser viewer with an open action', async () => {
    installed = installAdminStub(() => binaryResponse('application/pdf'))
    renderAt('/admin/subscriptions', AUTHENTICATED_ADMIN)

    await screen.findByText('My Salon')
    expect(
      await screen.findByTitle(/Payment receipt/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open receipt' })).toBeInTheDocument()
  })

  it('shows an honest error state when the proof file is missing, keeping the decision controls', async () => {
    installed = installAdminStub(() => notFound())
    renderAt('/admin/subscriptions', AUTHENTICATED_ADMIN)

    await screen.findByText('My Salon')
    expect(
      await screen.findByText(/Could not load the payment receipt/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
  })

  it('retries the proof file when the reviewer asks it to', async () => {
    installed = installAdminStub(() => notFound())
    renderAt('/admin/subscriptions', AUTHENTICATED_ADMIN)

    await screen.findByText('My Salon')
    await screen.findByText(/Could not load the payment receipt/i)
    const before = installed.fileCalls.length
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(installed!.fileCalls.length).toBeGreaterThan(before))
  })
})
