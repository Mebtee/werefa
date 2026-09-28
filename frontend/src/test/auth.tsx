import { StrictMode } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach } from 'vitest'
import type { AuthPrincipal } from '@/api/types'
import { AuthProvider } from '@/features/auth/AuthProvider'
import type { AuthState } from '@/features/auth/auth-context'
import { appRoutes } from '@/routes'
import { ownerBusinessStorageKey } from '@/features/owner-portal/state/OwnerBusinessContext'
import {
  installBusinessApiStub,
  type BusinessApiStub,
  type BusinessApiStubOptions,
} from './businessApi'

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

export const SUPER_ADMIN_PRINCIPAL: AuthPrincipal = {
  id: 'super-admin-test',
  role: 'SUPER_ADMIN',
  email: 'superadmin@werefa.test',
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

export const AUTHENTICATED_SUPER_ADMIN: AuthState = {
  status: 'authenticated',
  principal: SUPER_ADMIN_PRINCIPAL,
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
  /** Extra behavior for the stateful business API test double. */
  businessApi?: BusinessApiStubOptions
  initialSelectedBusinessId?: string
  /**
   * Renders under `<StrictMode>`, as the real entry point does (`main.tsx`
   * wraps `<App />` in it). Off by default so existing tests are unchanged.
   *
   * This matters for effect lifecycles: StrictMode double-invokes effects
   * (mount, cleanup, mount), so a one-shot "already initialised" latch combined
   * with a `cancelled` cleanup guard discards the only request it ever issues
   * and pins the page on its loading state. A test that omits StrictMode cannot
   * see that class of defect at all.
   */
  strict?: boolean
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
): RenderResult & {
  router: ReturnType<typeof createMemoryRouter>
  stub: BusinessApiStub
} {
  const stub = installBusinessApiStub(undefined, options.businessApi)
  cleanupStubs.push(stub.restore)
  const auth = options.auth ?? AUTHENTICATED_OWNER
  window.localStorage.clear()
  if (options.initialSelectedBusinessId && auth.principal?.role === 'OWNER') {
    window.localStorage.setItem(
      ownerBusinessStorageKey(auth.principal.id),
      options.initialSelectedBusinessId,
    )
  }
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  const tree = (
    <AuthProvider initialState={auth}>
      <RouterProvider router={router} />
    </AuthProvider>
  )
  const result = render(options.strict ? <StrictMode>{tree}</StrictMode> : tree)
  return { router, stub, ...result }
}
