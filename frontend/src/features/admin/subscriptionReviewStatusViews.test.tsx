import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '@/features/auth/AuthProvider'
import type { AuthState } from '@/features/auth/auth-context'
import { appRoutes } from '@/routes'
import { AUTHENTICATED_ADMIN } from '@/test/auth'
import type { AdminSubscriptionProofView } from '@/api/types'

/**
 * Admin subscription proof review — status views (Prompt 57).
 *
 * Regression cover for "an approved subscription payment disappears from the
 * Admin page and cannot be found":
 *
 *  - the PENDING queue keeps its existing semantics (it lists only proofs
 *    awaiting a decision, and a decision removes the row from it);
 *  - the SAME proof row is still readable afterwards under its own state
 *    through the existing `GET /admin/subscription/proofs?state=` route;
 *  - the approved receipt (and its authorized proof bytes) stays reachable,
 *    with the status obvious and no decision controls on a decided record;
 *  - no refetch under the wrong state, no optimistic removal, no invented row.
 *
 * The double mirrors the server: approve/reject MUTATES the existing row (same
 * id, same proof bytes) and only changes which `state` list it appears in.
 */

const user = userEvent.setup()

function proof(
  overrides: Partial<AdminSubscriptionProofView> & Pick<AdminSubscriptionProofView, 'id'>,
): AdminSubscriptionProofView {
  return {
    reviewState: 'PENDING',
    requestedAt: '2026-01-02T03:04:05.000Z',
    reviewedBy: null,
    rejectionReason: null,
    approvedUntil: null,
    createdAt: '2026-01-02T03:04:05.000Z',
    businessId: 'b1',
    businessName: 'My Salon',
    ownerEmail: 'owner@werefa.test',
    ...overrides,
  }
}

const PENDING_ROW = proof({ id: 'p1' })
const APPROVED_ROW = proof({
  id: 'p1',
  reviewState: 'APPROVED',
  requestedAt: '2026-01-01T03:04:05.000Z',
  reviewedBy: 'admin-1',
  approvedUntil: '2026-01-31T00:00:00.000Z',
})
const REJECTED_ROW = proof({
  id: 'p2',
  reviewState: 'REJECTED',
  requestedAt: '2026-01-03T03:04:05.000Z',
  reviewedBy: 'admin-1',
  rejectionReason: 'Amount does not match the invoice.',
})

interface HarnessOptions {
  /** Initial rows per review state (the double's whole dataset). */
  rows?: Partial<Record<string, AdminSubscriptionProofView[]>>
  /** Serve an error for this `state`, to cover the failure path. */
  failState?: { state: string; status: number }
}

interface Harness {
  /** The `state` query value of every queue request, in order. */
  requestedStates: string[]
  proofFileCalls: string[]
  restore(): void
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Mirrors the server's 409 for deciding an already-decided proof. */
function conflict(): Response {
  return json(
    {
      error: {
        code: 'CONFLICT',
        title: 'Conflict',
        detail: 'This subscription proof is no longer pending.',
      },
    },
    409,
  )
}

function installHarness(options: HarnessOptions = {}): Harness {
  const byState: Record<string, AdminSubscriptionProofView[]> = {
    PENDING: [PENDING_ROW],
    APPROVED: [],
    REJECTED: [REJECTED_ROW],
    ...options.rows,
  }
  const requestedStates: string[] = []
  const proofFileCalls: string[] = []
  const original = globalThis.fetch

  const decide = (id: string, next: Partial<AdminSubscriptionProofView>) => {
    const row = (byState.PENDING ?? []).find((candidate) => candidate.id === id)
    if (!row) return conflict()
    byState.PENDING = byState.PENDING.filter((candidate) => candidate.id !== id)
    const decided = { ...row, ...next }
    const state = next.reviewState as string
    byState[state] = [...(byState[state] ?? []), decided]
    return json(decided)
  }

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input.href : String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const relative = url.replace(/^https?:\/\/[^/]+/, '')
    const id = /\/admin\/subscription\/proofs\/([^/?]+)/.exec(relative)?.[1] ?? ''

    if (method === 'POST' && relative.includes('/approve')) {
      return decide(id, {
        reviewState: 'APPROVED',
        approvedUntil: '2026-01-31T00:00:00.000Z',
        reviewedBy: 'admin-1',
        rejectionReason: null,
      })
    }
    if (method === 'POST' && relative.includes('/reject')) {
      return decide(id, {
        reviewState: 'REJECTED',
        rejectionReason: 'Amount does not match the invoice.',
        reviewedBy: 'admin-1',
        approvedUntil: null,
      })
    }
    if (method === 'GET' && relative.endsWith('/file')) {
      proofFileCalls.push(`/admin/subscription/proofs/${id}/file`)
      return new Response(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    }
    if (method === 'GET' && relative.includes('/admin/subscription/proofs')) {
      const state = new URL(url, 'http://localhost').searchParams.get('state') ?? 'PENDING'
      requestedStates.push(state)
      if (options.failState?.state === state) {
        return json(
          { error: { code: 'INTERNAL_ERROR', title: 'Error', detail: 'Queue unavailable.' } },
          options.failState.status,
        )
      }
      return json(byState[state] ?? [])
    }
    return json(
      { error: { code: 'NOT_FOUND', title: 'Not found', detail: `No stub for ${method} ${url}` } },
      404,
    )
  }) as typeof fetch

  return {
    requestedStates,
    proofFileCalls,
    restore() {
      globalThis.fetch = original
    },
  }
}

function renderAt(path: string, auth: AuthState = AUTHENTICATED_ADMIN) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return render(
    <AuthProvider initialState={auth}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

let harness: Harness | null = null

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:admin-receipt'),
    configurable: true,
    writable: true,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn(),
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  harness?.restore()
  harness = null
  vi.restoreAllMocks()
})

describe('admin subscription proof status views', () => {
  it('opens on the pending queue and lists the submitted proof with its decision controls', async () => {
    harness = installHarness()
    renderAt('/admin/subscriptions')

    expect(await screen.findByText('My Salon')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
    expect(screen.getByTestId('proof-review-state')).toHaveTextContent('PENDING')

    // Pending-queue semantics are unchanged: it asks only for PENDING.
    expect(harness.requestedStates).toEqual(['PENDING'])
  })

  it('keeps the approved proof findable after approval: it leaves the queue and is listed under Approved', async () => {
    harness = installHarness()
    renderAt('/admin/subscriptions')

    await screen.findByText('My Salon')
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    // The decision is confirmed and the reviewer is told where the proof went.
    expect(await screen.findByText(/listed under Approved/i)).toBeInTheDocument()

    // The row left the PENDING queue because it is no longer pending, and the
    // refetch stayed on PENDING instead of silently switching views.
    await waitFor(() => expect(screen.queryByText('My Salon')).not.toBeInTheDocument())
    expect(screen.getByText('No pending proofs.')).toBeInTheDocument()
    expect(harness.requestedStates).toEqual(['PENDING', 'PENDING'])

    // The SAME proof is still listed, with the same id, under Approved.
    await user.click(screen.getByRole('tab', { name: 'Approved' }))
    await screen.findByText('My Salon')
    expect(harness.requestedStates).toEqual(['PENDING', 'PENDING', 'APPROVED'])
    const row = within(screen.getByRole('list', { name: /Approved proofs/i })).getByRole('listitem')
    expect(within(row).getByTestId('proof-review-state')).toHaveTextContent('APPROVED')
    expect(within(row).getByTestId('proof-approved-until')).toHaveTextContent(
      /Approved through/i,
    )
  })

  it('keeps a rejected proof findable with its reason after rejection', async () => {
    harness = installHarness({ rows: { REJECTED: [] } })
    renderAt('/admin/subscriptions')

    await screen.findByText('My Salon')
    await user.type(
      screen.getByLabelText('Rejection reason for My Salon'),
      'Amount does not match the invoice.',
    )
    await user.click(screen.getByRole('button', { name: 'Reject' }))

    expect(await screen.findByText(/listed under Rejected/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('No pending proofs.')).toBeInTheDocument())

    await user.click(screen.getByRole('tab', { name: 'Rejected' }))
    await screen.findByText('My Salon')
    expect(screen.getByTestId('proof-review-state')).toHaveTextContent('REJECTED')
    expect(screen.getByTestId('proof-rejection-reason')).toHaveTextContent(
      'Review note: Amount does not match the invoice.',
    )
  })

  it('shows decided proofs read-only, with the authorized proof file still openable', async () => {
    harness = installHarness({ rows: { APPROVED: [APPROVED_ROW] } })
    renderAt('/admin/subscriptions')

    await screen.findByRole('img', { name: /Payment receipt/ })
    const beforeSwitch = harness.proofFileCalls.length

    await user.click(await screen.findByRole('tab', { name: 'Approved' }))
    await screen.findByText('My Salon')

    // No decision controls on an already-decided record: approval is final, and
    // a replay is a server-side 409, never a second 30-day extension.
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()

    // The real receipt is still inspectable over the Admin-authorized route, and
    // only over it — no public URL and no storage path is ever used.
    expect(await screen.findByRole('img', { name: /Payment receipt/ })).toBeInTheDocument()
    expect(harness.proofFileCalls.length).toBeGreaterThan(beforeSwitch)
    expect(
      harness.proofFileCalls.every((url) => url === '/admin/subscription/proofs/p1/file'),
    ).toBe(true)
  })

  it('finds the decided proof again after a full page remount (no record loss)', async () => {
    harness = installHarness({ rows: { APPROVED: [APPROVED_ROW] } })
    const first = renderAt('/admin/subscriptions')
    await screen.findByText('My Salon')
    first.unmount()

    renderAt('/admin/subscriptions')
    await user.click(await screen.findByRole('tab', { name: 'Approved' }))
    await screen.findByText('My Salon')
    // The remounted page re-reads its default view, then the chosen one.
    expect(harness.requestedStates).toEqual(['PENDING', 'PENDING', 'APPROVED'])
    expect(screen.getByTestId('proof-review-state')).toHaveTextContent('APPROVED')
  })

  it('reports a failed decided-view load honestly and keeps the views usable', async () => {
    harness = installHarness({
      rows: { APPROVED: [APPROVED_ROW] },
      failState: { state: 'APPROVED', status: 500 },
    })
    renderAt('/admin/subscriptions')

    await user.click(await screen.findByRole('tab', { name: 'Approved' }))
    expect(await screen.findByText(/Could not load the queue/i)).toBeInTheDocument()
    expect(screen.getByText('Something went wrong on our side. Please try again.')).toBeInTheDocument()

    // The reviewer can still move to another view; no record is fabricated.
    await user.click(screen.getByRole('tab', { name: 'Rejected' }))
    await screen.findByTestId('proof-review-state')
    expect(harness.requestedStates).toEqual(['PENDING', 'APPROVED', 'REJECTED'])
  })
})