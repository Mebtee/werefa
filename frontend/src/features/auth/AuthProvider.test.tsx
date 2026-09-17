import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { apiRequest } from '@/api/http'
import { installFetchStub, type FetchStub } from '@/test/fetch'
import { AUTHENTICATED_ADMIN, OWNER_PRINCIPAL, UNAUTHENTICATED } from '@/test/auth'
import { AuthProvider } from './AuthProvider'
import { useAuth } from './useAuth'

const user = userEvent.setup()

let stub: FetchStub | null = null

afterEach(() => {
  stub?.restore()
  stub = null
})

function AuthProbe() {
  const { status, principal, error, login, logout } = useAuth()
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="email">{principal?.email ?? ''}</span>
      <span data-testid="error">{error ?? ''}</span>
      <button
        onClick={() =>
          void login({ email: 'owner@werefa.test', password: 'secret' })
        }
      >
        login
      </button>
      <button onClick={() => void logout()}>logout</button>
      <button
        onClick={() => {
          void apiRequest('/owner/bookings').catch(() => undefined)
        }}
      >
        protected-call
      </button>
    </div>
  )
}

describe('AuthProvider', () => {
  it('restores an owner session from the cookie on mount', async () => {
    stub = installFetchStub([
      { method: 'GET', path: '/auth/session', status: 200, body: { user: OWNER_PRINCIPAL } },
    ])
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated'),
    )
    expect(screen.getByTestId('email')).toHaveTextContent(OWNER_PRINCIPAL.email)
  })

  it('treats a 401 session probe as unauthenticated, without an error', async () => {
    stub = installFetchStub([
      {
        method: 'GET',
        path: '/auth/session',
        status: 401,
        body: { error: { code: 'UNAUTHENTICATED', title: 'No', fields: null } },
      },
    ])
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'),
    )
    expect(screen.getByTestId('error')).toBeEmptyDOMElement()
  })

  it('surfaces a non-auth restoration failure as an error but stays unauthenticated', async () => {
    const original = globalThis.fetch
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('offline'))
    try {
      render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>,
      )
      await waitFor(() =>
        expect(screen.getByTestId('status')).toHaveTextContent('error'),
      )
      expect(screen.getByTestId('email')).toBeEmptyDOMElement()
      expect(screen.getByTestId('error')).toHaveTextContent(/couldn't reach the server/i)
    } finally {
      globalThis.fetch = original
    }
  })

  it('authenticates after a successful login', async () => {
    stub = installFetchStub([
      {
        method: 'POST',
        path: '/auth/login',
        status: 200,
        body: { expiresAt: '2030-01-01T00:00:00.000Z', user: { id: 'owner-test', role: 'OWNER' } },
      },
    ])
    render(
      <AuthProvider initialState={UNAUTHENTICATED}>
        <AuthProbe />
      </AuthProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'login' }))
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated'),
    )
    expect(screen.getByTestId('email')).toHaveTextContent('owner@werefa.test')
    expect(stub.calls.some((call) => call.url.includes('/auth/login'))).toBe(true)
  })

  it('shows a generic, non-enumerating message when login fails', async () => {
    stub = installFetchStub([
      {
        method: 'POST',
        path: '/auth/login',
        status: 401,
        body: {
          error: {
            code: 'UNAUTHENTICATED',
            title: 'No',
            detail: 'unknown email',
            fields: null,
          },
        },
      },
    ])
    render(
      <AuthProvider initialState={UNAUTHENTICATED}>
        <AuthProbe />
      </AuthProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'login' }))
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('error'),
    )
    expect(screen.getByTestId('error')).toHaveTextContent(
      'Your email or password is incorrect.',
    )
    expect(screen.getByTestId('error')).not.toHaveTextContent('unknown email')
  })

  it('clears the principal on logout', async () => {
    stub = installFetchStub([
      { method: 'POST', path: '/auth/logout', status: 204 },
    ])
    render(
      <AuthProvider initialState={AUTHENTICATED_ADMIN}>
        <AuthProbe />
      </AuthProvider>,
    )
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated')

    await user.click(screen.getByRole('button', { name: 'logout' }))
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'),
    )
    expect(screen.getByTestId('email')).toBeEmptyDOMElement()
  })

  it('clears the principal when any request returns 401', async () => {
    stub = installFetchStub([
      {
        method: 'GET',
        path: '/owner/bookings',
        status: 401,
        body: { error: { code: 'UNAUTHENTICATED', title: 'No', fields: null } },
      },
    ])
    render(
      <AuthProvider initialState={AUTHENTICATED_ADMIN}>
        <AuthProbe />
      </AuthProvider>,
    )
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated')

    await user.click(screen.getByRole('button', { name: 'protected-call' }))
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'),
    )
  })
})
