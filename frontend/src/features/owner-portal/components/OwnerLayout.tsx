import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/features/auth/useAuth'
import {
  getPrimaryOwnedBusiness,
  loadPrimaryOwnedBusiness,
  subscribePrimaryOwnedBusiness,
} from '@/api/business'

const NAV_ITEMS = [
  { to: '/owner', label: 'Dashboard', end: true },
  { to: '/owner/bookings', label: 'Bookings', end: false },
  { to: '/owner/business', label: 'Business', end: false },
  { to: '/owner/services', label: 'Services', end: false },
  { to: '/owner/schedule', label: 'Schedule', end: false },
]

export function OwnerLayoutApp({ children }: { children?: ReactNode }) {
  const { principal, logout } = useAuth()
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)
  const primary = useSyncExternalStore(
    subscribePrimaryOwnedBusiness,
    getPrimaryOwnedBusiness,
  )

  // The real primary business (first owned business on the tenant) is resolved
  // once so the public-page link reflects slug changes without a navigation.
  useEffect(() => {
    void loadPrimaryOwnedBusiness().catch(() => undefined)
  }, [])

  async function handleSignOut() {
    setSigningOut(true)
    await logout()
    navigate('/owner/login', { replace: true })
  }

  const businessSlug = primary?.slug ?? ''

  return (
    <div className="owner-shell page-root">
      <a className="skip-link" href="#owner-main">
        Skip to main content
      </a>

      <header className="owner-header">
        <div className="container owner-header__inner">
          <div className="owner-brand">
            <span className="owner-brand__mark" aria-hidden="true">
              W
            </span>
            <span className="owner-brand__text">
              <span className="owner-brand__name">Werefa</span>
              <span className="owner-brand__sub">Owner portal</span>
            </span>
          </div>

          <nav className="owner-nav" aria-label="Owner portal">
            <ul>
              {NAV_ITEMS.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className="owner-nav__link"
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <div className="owner-session">
            <span className="badge" aria-hidden="true">
              Owner
            </span>
            <span className="owner-session__owner">
              {principal?.email ?? principal?.id ?? ''}
            </span>
            <Link
              className="owner-session__public"
              to={businessSlug ? `/p/${businessSlug}` : '/owner'}
              aria-disabled={!businessSlug}
            >
              View public page
            </Link>
            <Button
              variant="outline"
              className="owner-session__signout"
              loading={signingOut}
              onClick={() => void handleSignOut()}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main id="owner-main" className="owner-main page-root__main">
        <div className="container">{children ?? <Outlet />}</div>
      </main>

      <footer className="owner-footer">
        <div className="container">
          Werefa owner portal — preview build. Your sign-in, business profile,
          public link and pause state are real and stored. Services, schedule
          and bookings are still sample data.
        </div>
      </footer>
    </div>
  )
}