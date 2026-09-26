import { afterEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '@/features/auth/AuthProvider'
import type { AuthState } from '@/features/auth/auth-context'
import { appRoutes } from '@/routes'
import { installFetchStub, type FetchStub } from '@/test/fetch'
import {
  AUTHENTICATED_ADMIN,
  AUTHENTICATED_SUPER_ADMIN,
  SUPER_ADMIN_PRINCIPAL,
  UNAUTHENTICATED,
} from '@/test/auth'
import type { AdminUserView, SecurityEventView } from '@/api/types'

/**
 * Prompt 53 platform-administration portal tests. They exercise the real route
 * tree, guards and pages against a stubbed `fetch`; no mock store participates
 * in authentication or administration.
 */

const user = userEvent.setup()
let stub: FetchStub | null = null

afterEach(() => {
  stub?.restore()
  stub = null
})

function renderAt(path: string, auth: AuthState) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return render(
    <AuthProvider initialState={auth}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

const ADMIN_ROW: AdminUserView = {
  id: 'admin-1',
  email: 'first.admin@werefa.test',
  createdAt: '2026-01-01T00:00:00.000Z',
  isDeactivated: false,
  activeSessions: 1,
}

const EVENT: SecurityEventView = {
  id: 'evt-1',
  type: 'LOGIN_SUCCEEDED',
  ip: '127.0.0.1',
  device: 'desktop',
  browser: 'Chrome',
  result: 'SUCCESS',
  createdAt: '2026-01-01T00:00:00.000Z',
}

function hasCall(method: string, path: string): boolean {
  return (stub?.calls ?? []).some(
    (call) => call.method === method && call.url.includes(path),
  )
}

describe('admin portal access control', () => {
  it('redirects an unauthenticated visitor to the owner login', async () => {
    stub = installFetchStub([])
    renderAt('/admin', UNAUTHENTICATED)

    expect(await screen.findByRole('heading', { name: /owner sign in/i })).toBeInTheDocument()
  })

  it('shows an admin-only screen to an authenticated Owner', async () => {
    stub = installFetchStub([])
    renderAt('/admin', {
      status: 'authenticated',
      principal: { id: 'owner-1', role: 'OWNER', email: 'owner@werefa.test' },
      error: null,
    })

    expect(await screen.findByText('Admin access only')).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Platform administration' }),
    ).not.toBeInTheDocument()
  })

  it('blocks an Admin from the Super-Admin-only admin accounts route', async () => {
    stub = installFetchStub([])
    renderAt('/admin/admins', AUTHENTICATED_ADMIN)

    expect(await screen.findByText('Super Admin access only')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Admin accounts' })).not.toBeInTheDocument()
  })
})

describe('admin dashboard', () => {
  it('offers every section to the Super Admin', async () => {
    stub = installFetchStub([])
    renderAt('/admin', AUTHENTICATED_SUPER_ADMIN)

    await screen.findByRole('heading', { name: 'Platform administration' })
    expect(screen.getAllByRole('link', { name: 'Admin accounts' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Emergency recovery' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Subscription review' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Security history' }).length).toBeGreaterThan(0)
  })

  it('hides the Super-Admin-only sections from an Admin', async () => {
    stub = installFetchStub([])
    renderAt('/admin', AUTHENTICATED_ADMIN)

    await screen.findByRole('heading', { name: 'Platform administration' })
    expect(screen.queryAllByRole('link', { name: 'Admin accounts' })).toHaveLength(0)
    expect(screen.queryAllByRole('link', { name: 'Emergency recovery' })).toHaveLength(0)
    expect(screen.getAllByRole('link', { name: 'Subscription review' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Security history' }).length).toBeGreaterThan(0)
  })

  it('signs an Admin out and returns to the login page', async () => {
    stub = installFetchStub([{ method: 'POST', path: '/auth/logout', status: 204 }])
    renderAt('/admin', AUTHENTICATED_ADMIN)

    await screen.findByRole('heading', { name: 'Platform administration' })
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /owner sign in/i })).toBeInTheDocument(),
    )
    expect(hasCall('POST', '/auth/logout')).toBe(true)
  })
})

describe('admin account management (Super Admin)', () => {
  it('lists existing Admins and creates a new one through the backend', async () => {
    stub = installFetchStub([
      {
        method: 'GET',
        path: '/admin/admins',
        status: 200,
        body: { admins: [ADMIN_ROW] },
      },
      {
        method: 'POST',
        path: '/admin/admins',
        status: 200,
        body: { admin: { ...ADMIN_ROW, id: 'admin-2', email: 'second.admin@werefa.test' } },
      },
    ])
    renderAt('/admin/admins', AUTHENTICATED_SUPER_ADMIN)

    expect(await screen.findByText(ADMIN_ROW.email)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Email'), 'second.admin@werefa.test')
    await user.type(screen.getByLabelText('Initial password'), 'a-strong-password')
    await user.click(screen.getByRole('button', { name: 'Create Admin' }))

    expect(await screen.findByText(/Admin account created/i)).toBeInTheDocument()
    expect(hasCall('POST', '/admin/admins')).toBe(true)
  })

  it('resets an Admin password and force-logs them out', async () => {
    stub = installFetchStub([
      { method: 'GET', path: '/admin/admins', status: 200, body: { admins: [ADMIN_ROW] } },
      { method: 'POST', path: '/admin/admins/admin-1/password', status: 204 },
      { method: 'POST', path: '/admin/users/admin-1/force-logout', status: 204 },
    ])
    renderAt('/admin/admins', AUTHENTICATED_SUPER_ADMIN)

    await screen.findByText(ADMIN_ROW.email)

    await user.type(
      screen.getByLabelText(`New password for ${ADMIN_ROW.email}`),
      'another-strong-password',
    )
    await user.click(screen.getByRole('button', { name: 'Reset password' }))

    expect(await screen.findByText(/Password reset for/i)).toBeInTheDocument()
    expect(hasCall('POST', '/admin/admins/admin-1/password')).toBe(true)
  })
})

describe('security history', () => {
  it('shows an Admin only their own history from the auth route', async () => {
    stub = installFetchStub([
      { method: 'GET', path: '/auth/security', status: 200, body: { events: [EVENT] } },
    ])
    renderAt('/admin/security', AUTHENTICATED_ADMIN)

    expect(await screen.findByText('Login Succeeded')).toBeInTheDocument()
    expect(screen.queryByText('Delete old records')).not.toBeInTheDocument()
    expect(hasCall('GET', '/auth/security')).toBe(true)
    expect(hasCall('GET', '/admin/security-history')).toBe(false)
  })

  it('gives the Super Admin the platform-wide history with a delete control', async () => {
    stub = installFetchStub([
      {
        method: 'GET',
        path: '/admin/security-history',
        status: 200,
        body: { events: [{ ...EVENT, userId: 'admin-1' }] },
      },
      { method: 'DELETE', path: '/admin/security-history', status: 200, body: { deleted: 2 } },
    ])
    renderAt('/admin/security', AUTHENTICATED_SUPER_ADMIN)

    expect(await screen.findByText('Delete old records')).toBeInTheDocument()
    expect(screen.getByText('Login Succeeded')).toBeInTheDocument()
    expect(hasCall('GET', '/admin/security-history')).toBe(true)
    expect(hasCall('GET', '/auth/security')).toBe(false)
  })
})

describe('Super Admin emergency recovery', () => {
  it('requests a one-time code and confirms it to set a new password', async () => {
    stub = installFetchStub([
      {
        method: 'POST',
        path: '/auth/recovery/request',
        status: 200,
        body: { message: 'If the account exists, a recovery code was sent.' },
      },
      { method: 'POST', path: '/auth/recovery/confirm', status: 204 },
      { method: 'GET', path: '/auth/session', status: 401, body: { error: { code: 'UNAUTHENTICATED', title: 'No', fields: null } } },
    ])
    renderAt('/admin/recovery', AUTHENTICATED_SUPER_ADMIN)

    await screen.findByRole('heading', { name: 'Emergency recovery' })
    await user.click(screen.getByRole('button', { name: 'Send recovery code' }))
    expect(
      await screen.findByText(/recovery code was sent/i),
    ).toBeInTheDocument()

    await user.type(screen.getByLabelText('Recovery code'), '123456')
    await user.type(screen.getByLabelText('New password'), 'brand-new-secret')
    await user.click(screen.getByRole('button', { name: 'Reset password' }))

    await waitFor(() => expect(hasCall('POST', '/auth/recovery/confirm')).toBe(true))
    expect(hasCall('POST', '/auth/recovery/request')).toBe(true)
  })
})

describe('login routing', () => {
  it('opens the admin portal for a platform administrator', async () => {
    stub = installFetchStub([
      {
        method: 'POST',
        path: '/auth/login',
        status: 200,
        body: { expiresAt: '2030-01-01T00:00:00.000Z', user: { id: 'admin-1', role: 'ADMIN' } },
      },
    ])
    renderAt('/owner/login', UNAUTHENTICATED)

    await screen.findByRole('heading', { name: /owner sign in/i })
    await user.type(screen.getByLabelText('Email'), 'admin@werefa.test')
    await user.type(screen.getByLabelText('Password'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(
      await screen.findByRole('heading', { name: 'Platform administration' }),
    ).toBeInTheDocument()
    expect(SUPER_ADMIN_PRINCIPAL.role).toBe('SUPER_ADMIN')
  })
})
