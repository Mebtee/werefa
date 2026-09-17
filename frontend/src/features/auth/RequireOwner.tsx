import type { ReactNode } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { Alert } from '@/components/ui/Alert'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from './useAuth'

/** Full-page session check shown while the principal is being restored. */
export function AuthLoadingScreen({
  label = 'Checking your session',
}: {
  label?: string
}) {
  return (
    <div className="auth-screen page-root">
      <div className="auth-screen__inner">
        <Spinner label={label} />
        <p className="auth-screen__text">{label}…</p>
      </div>
    </div>
  )
}

function OwnerForbidden() {
  return (
    <div className="auth-screen page-root">
      <div className="auth-screen__inner container">
        <Alert tone="danger" title="Owner access only">
          This account does not have access to the owner portal.
        </Alert>
        <p className="auth-screen__actions">
          <Link to="/owner/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  )
}

/**
 * Route guard for the owner portal.
 *
 * This is a UX gate only — the backend independently authorizes every owner
 * request. An authenticated non-owner (Admin / Super Admin) is given an
 * explicit "owner access only" screen rather than being rendered the portal.
 */
export function RequireOwner({ children }: { children?: ReactNode }) {
  const { status, principal } = useAuth()
  const location = useLocation()

  if (status === 'loading' || status === 'authenticating') {
    return <AuthLoadingScreen />
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

  if (principal.role !== 'OWNER') {
    return <OwnerForbidden />
  }

  return <>{children ?? <Outlet />}</>
}
