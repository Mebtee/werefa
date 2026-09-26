import { Fragment, type ReactNode } from 'react'
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/features/auth/useAuth'
import { OwnerBusinessProvider } from '@/features/owner-portal/state/OwnerBusinessProvider'
import { useOwnerBusinessContext } from '@/features/owner-portal/state/OwnerBusinessContext'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { SubscriptionWarning } from './SubscriptionWarning'

function BusinessSelection({ onSelect }: { onSelect: (businessId: string) => void }) {
  const { businesses } = useOwnerBusinessContext()
  return (
    <section className="owner-business-picker" aria-labelledby="owner-business-picker-title">
      <h1 className="page-title" id="owner-business-picker-title">
        Choose a business
      </h1>
      <p className="page-subtitle">
        Select the business you want to manage. Subscription and operational data stay isolated by
        this choice.
      </p>
      <div className="owner-business-picker__list">
        {businesses.map((business) => (
          <button
            key={business.id}
            type="button"
            className="owner-business-picker__option"
            onClick={() => onSelect(business.id)}
          >
            <span className="owner-business-picker__name">{business.name}</span>
            <span className="owner-business-picker__meta">
              {business.address ?? 'Location not set'} · {business.category.label}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

export function OwnerLayoutApp() {
  return (
    <OwnerBusinessProvider>
      <OwnerLayout />
    </OwnerBusinessProvider>
  )
}

export function OwnerLayout({ children }: { children?: ReactNode }) {
  const { principal, logout } = useAuth()
  const {
    businesses,
    selectedBusiness,
    loading,
    error,
    selectBusiness,
    reload,
  } = useOwnerBusinessContext()
  const location = useLocation()
  const creatingBusiness = location.pathname === '/owner/business/new'
  const subscriptionPage = location.pathname === '/owner/subscription'
  const selectionRequired = businesses.length > 1 && !selectedBusiness

  if (!principal) return <Navigate to="/signin" replace />

  return (
    <div className="owner-shell">
      <header className="owner-header">
        <div className="owner-header__inner">
          <div className="owner-brand">
            <span className="owner-brand__mark" aria-hidden="true">
              W
            </span>
            <span className="owner-brand__text">
              <span className="owner-brand__name">Werefa</span>
              <span className="owner-brand__sub">Owner workspace</span>
            </span>
          </div>

          <nav className="owner-nav" aria-label="Owner portal">
            <ul>
              <li>
                <NavLink className="owner-nav__link" to="/owner">
                  Dashboard
                </NavLink>
              </li>
              <li>
                <NavLink className="owner-nav__link" to="/owner/services">
                  Services
                </NavLink>
              </li>
              <li>
                <NavLink className="owner-nav__link" to="/owner/schedule">
                  Schedule
                </NavLink>
              </li>
              <li>
                <NavLink className="owner-nav__link" to="/owner/bookings">
                  Bookings
                </NavLink>
              </li>
              <li>
                <NavLink className="owner-nav__link" to="/owner/subscription">
                  Subscription
                </NavLink>
              </li>
              <li>
                <NavLink className="owner-nav__link" to="/owner/business">
                  Business
                </NavLink>
              </li>
            </ul>
          </nav>

          {businesses.length > 0 && (
            <label className="owner-business-switcher">
              <span>Active business</span>
              <select
                value={selectedBusiness?.id ?? ''}
                disabled={loading}
                onChange={(event) => {
                  if (event.target.value) selectBusiness(event.target.value)
                }}
              >
                <option value="" disabled>
                  Select a business
                </option>
                {businesses.map((business) => (
                  <option key={business.id} value={business.id}>
                    {business.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="owner-session">
            <span className="owner-session__owner">{principal.email}</span>
            {selectedBusiness && (
              <a
                className="owner-session__public"
                href={`/p/${selectedBusiness.slug}`}
                target="_blank"
                rel="noreferrer"
              >
                View public page
              </a>
            )}
            <button
              type="button"
              className="owner-session__signout"
              onClick={() => {
                logout()
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="owner-main">
        {loading ? (
          <div className="owner-load">
            <Spinner label="Loading businesses…" />
          </div>
        ) : error ? (
          <Alert tone="danger" title="Business workspace unavailable">
            <p>{error}</p>
            <p>Check your connection and try again.</p>
            <Button type="button" onClick={() => void reload()}>
              Retry
            </Button>
          </Alert>
        ) : businesses.length === 0 && !creatingBusiness ? (
          <Navigate to="/owner/business/new" replace />
        ) : businesses.length === 0 && creatingBusiness ? (
          <Outlet />
        ) : selectionRequired ? (
          <BusinessSelection onSelect={selectBusiness} />
        ) : (
          selectedBusiness && (
            <Fragment key={selectedBusiness.id}>
              {!subscriptionPage && <SubscriptionWarning businessId={selectedBusiness.id} />}
              {children ?? <Outlet />}
            </Fragment>
          )
        )}
      </main>

      <footer className="owner-footer">
        <div className="shell">
          <p>Manage your business, schedule, bookings, and subscription in one place.</p>
          <p>Werefa owner portal</p>
        </div>
      </footer>
    </div>
  )
}
