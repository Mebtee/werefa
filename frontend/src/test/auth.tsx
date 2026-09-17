import { render, type RenderResult } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { AuthPrincipal } from '@/api/types'
import { AuthProvider } from '@/features/auth/AuthProvider'
import type { AuthState } from '@/features/auth/auth-context'
import { appRoutes } from '@/routes'

/** Shared principals for tests. Values are obvious fixtures, never real accounts. */
export const OWNER_PRINCIPAL: AuthPrincipal = {
  id: 'owner-test',
  role: 'OWNER',
  email: 'owner@werefa.test',
}

export const ADMIN_PRINCIPAL: AuthPrincipal = {
  id: 'admin-test',
  role: 'ADMIN',
  email: 'admin@werefa.test',
}

export const AUTHENTICATED_OWNER: AuthState = {
  status: 'authenticated',
  principal: OWNER_PRINCIPAL,
  error: null,
}

export const AUTHENTICATED_ADMIN: AuthState = {
  status: 'authenticated',
  principal: ADMIN_PRINCIPAL,
  error: null,
}

export const UNAUTHENTICATED: AuthState = {
  status: 'unauthenticated',
  principal: null,
  error: null,
}

export interface RenderAppOptions {
  /** Defaults to an authenticated owner so existing owner tests are unchanged. */
  auth?: AuthState
}

/**
 * Renders the real app routes inside an `AuthProvider`.
 *
 * By supplying `initialState` the provider skips its bootstrap fetch, so tests
 * that only care about the owner surface need no network stub. Auth-specific
 * tests should instead render `<AuthProvider>` without `initialState` and stub
 * `GET /auth/session` (see `installFetchStub`).
 */
export function renderAppAt(
  path: string,
  options: RenderAppOptions = {},
): RenderResult & { router: ReturnType<typeof createMemoryRouter> } {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  const result = render(
    <AuthProvider initialState={options.auth ?? AUTHENTICATED_OWNER}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
  return { router, ...result }
}
