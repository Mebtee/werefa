import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { appRoutes } from '@/routes'
import { resetStore } from '@/mock/store'
import { installFetchStub, type FetchStub } from '@/test/fetch'
import {
  AUTHENTICATED_ADMIN,
  AUTHENTICATED_OWNER,
  OWNER_PRINCIPAL,
  renderAppAt,
  UNAUTHENTICATED,
} from '@/test/auth'

const user = userEvent.setup()
let stub: FetchStub | null = null

beforeEach(() => {
  resetStore()
})

afterEach(() => {
  stub?.restore()
  stub = null
})

describe('owner route protection', () => {
  it('restores the session and opens the owner portal for an authenticated owner', async () => {
    stub = installFetchStub([
      { method: 'GET', path: '/auth/session', status: 200, body: { user: OWNER_PRINCIPAL } },
    ])
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/owner'] })
    render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    )

    await screen.findByRole('heading', { name: 'Dashboard' })
    expect(screen.getByText(OWNER_PRINCIPAL.email)).toBeInTheDocument()
  })

  it('redirects an unauthenticated visitor to the login page', async () => {
    renderAppAt('/owner', { auth: UNAUTHENTICATED })

    expect(await screen.findByRole('heading', { name: /owner sign in/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  it('shows an owner-only screen to an authenticated Admin (no portal leakage)', async () => {
    renderAppAt('/owner', { auth: AUTHENTICATED_ADMIN })

    expect(await screen.findByText('Owner access only')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Owner portal' })).not.toBeInTheDocument()
  })

  it('keeps the public booking pages unauthenticated', async () => {
    renderAppAt('/p/addis-beauty-lounge', { auth: UNAUTHENTICATED })

    expect(
      (await screen.findAllByText(/Addis Beauty Lounge/)).length,
    ).toBeGreaterThan(0)
    expect(
      screen.queryByRole('heading', { name: /owner sign in/i }),
    ).not.toBeInTheDocument()
  })
})

describe('owner login surface', () => {
  it('validates empty fields locally without calling the backend', async () => {
    stub = installFetchStub([])
    renderAppAt('/owner/login', { auth: UNAUTHENTICATED })

    await screen.findByRole('heading', { name: /owner sign in/i })
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument()
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    expect(stub.calls).toHaveLength(0)
  })

  it('offers no social sign-in (REQ-025)', async () => {
    renderAppAt('/owner/login', { auth: UNAUTHENTICATED })
    await screen.findByRole('heading', { name: /owner sign in/i })
    expect(screen.queryByRole('button', { name: /google/i })).not.toBeInTheDocument()
  })

  it('signs an owner in and opens the portal', async () => {
    stub = installFetchStub([
      {
        method: 'POST',
        path: '/auth/login',
        status: 200,
        body: { expiresAt: '2030-01-01T00:00:00.000Z', user: { id: 'owner-test', role: 'OWNER' } },
      },
    ])
    renderAppAt('/owner/login', { auth: UNAUTHENTICATED })

    await screen.findByRole('heading', { name: /owner sign in/i })
    await user.type(screen.getByLabelText('Email'), 'owner@werefa.test')
    await user.type(screen.getByLabelText('Password'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await screen.findByRole('heading', { name: 'Dashboard' })
    expect(stub.calls[0]?.url).toContain('/auth/login')
  })

  it('shows a generic message on invalid credentials', async () => {
    stub = installFetchStub([
      {
        method: 'POST',
        path: '/auth/login',
        status: 401,
        body: { error: { code: 'UNAUTHENTICATED', title: 'No', detail: 'no such user', fields: null } },
      },
    ])
    renderAppAt('/owner/login', { auth: UNAUTHENTICATED })

    await screen.findByRole('heading', { name: /owner sign in/i })
    await user.type(screen.getByLabelText('Email'), 'nobody@werefa.test')
    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(
      await screen.findByText('Your email or password is incorrect.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('no such user')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('explains a lockout without revealing internals', async () => {
    stub = installFetchStub([
      {
        method: 'POST',
        path: '/auth/login',
        status: 423,
        body: { error: { code: 'ACCOUNT_LOCKED', title: 'Locked', fields: null } },
      },
    ])
    renderAppAt('/owner/login', { auth: UNAUTHENTICATED })

    await screen.findByRole('heading', { name: /owner sign in/i })
    await user.type(screen.getByLabelText('Email'), 'owner@werefa.test')
    await user.type(screen.getByLabelText('Password'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(
      await screen.findByText(/too many failed attempts/i),
    ).toBeInTheDocument()
  })
})

describe('owner session lifecycle', () => {
  it('returns to the login page after signing out', async () => {
    stub = installFetchStub([{ method: 'POST', path: '/auth/logout', status: 204 }])
    renderAppAt('/owner', { auth: AUTHENTICATED_OWNER })

    await screen.findByRole('heading', { name: 'Dashboard' })
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /owner sign in/i })).toBeInTheDocument(),
    )
  })
})
