import type { ReactNode } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { ownerSession } from '@/mock/ownerSession'

const NAV_ITEMS = [
  { to: '/owner', label: 'Dashboard', end: true },
  { to: '/owner/business', label: 'Business', end: false },
  { to: '/owner/services', label: 'Services', end: false },
  { to: '/owner/schedule', label: 'Schedule', end: false },
]

export function OwnerLayoutApp({ children }: { children?: ReactNode }) {
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

          <div className="owner-session" title="Auth is not implemented in this phase">
            <span className="badge" aria-hidden="true">
              Demo session
            </span>
            <span className="owner-session__owner">{ownerSession.owner.name}</span>
            <Link
              className="owner-session__public"
              to={`/p/${ownerSession.businessSlug}`}
            >
              View public page
            </Link>
          </div>
        </div>
      </header>

      <main id="owner-main" className="owner-main page-root__main">
        <div className="container">{children ?? <Outlet />}</div>
      </main>

      <footer className="owner-footer">
        <div className="container">
          Werefa owner portal — preview build. Mock session, no bookings are
          stored and changes affect the public page immediately.
        </div>
      </footer>
    </div>
  )
}