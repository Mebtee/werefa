import { useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/features/auth/useAuth'

interface NavItem {
  to: string
  label: string
  end?: boolean
  superAdminOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/subscriptions', label: 'Subscriptions' },
  { to: '/admin/admins', label: 'Admin accounts', superAdminOnly: true },
  { to: '/admin/security', label: 'Security history' },
  { to: '/admin/reports', label: 'Booking reports', superAdminOnly: true },
  { to: '/admin/recovery', label: 'Emergency recovery', superAdminOnly: true },
]

/**
 * Platform administration shell (Prompt 53; spec §27.3).
 *
 * A role-aware navigation frame for Admin and Super Admin sessions. The
 * Super-Admin-only entries are hidden for an Admin; the route guards and the
 * backend enforce the boundary regardless.
 */
export function AdminLayout({ children }: { children?: ReactNode }) {
  const { principal, logout } = useAuth()
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)

  const isSuperAdmin = principal?.role === 'SUPER_ADMIN'
  const items = NAV_ITEMS.filter((item) => !item.superAdminOnly || isSuperAdmin)

  async function handleSignOut() {
    setSigningOut(true)
    await logout()
    navigate('/owner/login', { replace: true })
  }

  return (
    <div className="admin-shell page-root">
      <a className="skip-link" href="#admin-main">
        Skip to main content
      </a>

      <header className="admin-header">
        <div className="container admin-header__inner">
          <div className="admin-brand">
            <span className="admin-brand__mark" aria-hidden="true">
              W
            </span>
            <span className="admin-brand__text">
              <span className="admin-brand__name">Werefa</span>
              <span className="admin-brand__sub">Platform administration</span>
            </span>
          </div>

          <nav className="admin-nav" aria-label="Platform administration">
            <ul>
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} end={item.end} className="admin-nav__link">
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <div className="admin-session">
            <span className="badge" aria-hidden="true">
              {isSuperAdmin ? 'Super Admin' : 'Admin'}
            </span>
            <span className="admin-session__user">
              {principal?.email ?? principal?.id ?? ''}
            </span>
            <Link className="admin-session__link" to="/owner/login">
              Owner sign in
            </Link>
            <Button
              variant="outline"
              className="admin-session__signout"
              loading={signingOut}
              onClick={() => void handleSignOut()}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main id="admin-main" className="admin-main page-root__main">
        <div className="container">{children ?? <Outlet />}</div>
      </main>

      <footer className="admin-footer">
        <div className="container">
          Werefa platform administration — real sessions, subscriptions, Admin
          accounts, security history and emergency recovery are stored on the
          backend.
        </div>
      </footer>
    </div>
  )
}
