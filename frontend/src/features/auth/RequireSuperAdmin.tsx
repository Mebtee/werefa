import type { ReactNode } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { Alert } from '@/components/ui/Alert'
import { AuthLoadingScreen } from './RequireOwner'
import { useAuth } from './useAuth'

/**
 * Route guard for Super-Admin-only administration surfaces (REQ-217/219/220,
 * REQ-198–206). A UX gate only: the backend independently re-authorizes every
 * request (`requireSuperAdmin`), so an Admin session reaching a Super-Admin
 * route would still receive 403.
 *
 * Must be nested inside `RequireAdmin`, which already establishes an
 * authenticated Admin/Super Admin session.
 */
export function RequireSuperAdmin({ children }: { children?: ReactNode }) {
  const { status, principal } = useAuth()

  if (status === 'loading' || status === 'authenticating') {
    return <AuthLoadingScreen label="Checking your admin session" />
  }

  if (status !== 'authenticated' || !principal) {
    return <Navigate to="/owner/login" replace />
  }

  if (principal.role !== 'SUPER_ADMIN') {
    return (
      <div className="auth-screen page-root">
        <div className="auth-screen__inner container">
          <Alert tone="danger" title="Super Admin access only">
            This section is reserved to the Super Admin account.
          </Alert>
        </div>
      </div>
    )
  }

  return <>{children ?? <Outlet />}</>
}
