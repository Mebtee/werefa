import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Alert } from '@/components/ui/Alert'
import { AuthLoadingScreen } from './RequireOwner'
import { useAuth } from './useAuth'

/**
 * Route guard for the admin subscription workbench.
 *
 * A UX gate only: the backend independently re-authorizes every admin request
 * with `requireAdminOrSuperAdmin` (an owner session gets 403). Unauthenticated
 * visitors go to the owner login; a logged-in Owner sees an explicit
 * "admin access only" screen.
 */
export function RequireAdmin({ children }: { children?: ReactNode }) {
  const { status, principal } = useAuth()
  const location = useLocation()

  if (status === 'loading' || status === 'authenticating') {
    return <AuthLoadingScreen label="Checking your admin session" />
  }

  if (status !== 'authenticated' || !principal) {
    return (
      <Navigate
        to="/owner/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    )
  }

  if (principal.role !== 'ADMIN' && principal.role !== 'SUPER_ADMIN') {
    return (
      <div className="auth-screen page-root">
        <div className="auth-screen__inner container">
          <Alert tone="danger" title="Admin access only">
            This account does not have review access to the admin workbench.
          </Alert>
        </div>
      </div>
    )
  }

  return <>{children ?? <Outlet />}</>
}