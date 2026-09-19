import { render, type RenderResult } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach } from 'vitest'
import type { AuthPrincipal } from '@/api/types'
import { AuthProvider } from '@/features/auth/AuthProvider'
import type { AuthState } from '@/features/auth/auth-context'
import { appRoutes } from '@/routes'
import { installBusinessApiStub } from './businessApi'

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

const cleanupStubs: Array<() => void> = []
afterEach(() => {
  while (cleanupStubs.length > 0) {
    const restore = cleanupStubs.shift()
    if (restore) restore()
  }
})

/**
 * Renders the full retail routes inside an `AuthProvider`.
 *
 * The real business API client is served by a dedicated stateful test double so
 * the owner profile and public pages exercise the true wire contract; all other
 * URLs fall through to the stub `fetch` previously installed by the test.
 */
export function renderAppAt(
  path: string,
  options: RenderAppOptions = {},
): RenderResult & { router: ReturnType<typeof createMemoryRouter> } {
  const stub = installBusinessApiStub()
  cleanupStubs.push(stub.restore)
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  const result = render(
    <AuthProvider initialState={options.auth ?? AUTHENTICATED_OWNER}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
  return { router, ...result }
}
