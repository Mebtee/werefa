import { Link } from 'react-router-dom'
import { useOwnedBusiness } from '@/features/owner-portal/state/useOwnedBusiness'
import { LoadState } from '@/features/owner-portal/components/LoadState'
import { PauseCard } from '@/features/owner-portal/components/PauseCard'
import { CATEGORY_LABEL } from '@/features/owner-portal/lib/labels'

export function DashboardPage() {
  const { business, services, bookingsToday, loading, error, reload } =
    useOwnedBusiness()

  return (
    <LoadState
      loading={loading && business === null}
      error={error && business === null}
      onRetry={reload}
    >
      {business && (
        <>
          <h1 className="page-title">Dashboard</h1>

          <div className="owner-grid">
            <section className="card card--padded" aria-labelledby="dash-business-title">
              <h2 className="card__title" id="dash-business-title">
                Your business
              </h2>
              <p className="card__subtitle">
                <span className="badge">{CATEGORY_LABEL[business.category]}</span>{' '}
                <span className="badge" aria-label="Subscription active">
                  Subscription active
                </span>
              </p>
              <p className="dashboard-name">{business.name}</p>
              {business.pause ? (
                <p className="dashboard-pause">
                  New bookings are paused
                  {business.pause.kind === 'until'
                    ? ` until ${business.pause.reopenDate}`
                    : ' indefinitely'}
                  .
                </p>
              ) : (
                <p className="dashboard-pause">Open for new bookings.</p>
              )}
              <div className="dashboard-actions">
                <Link className="btn btn--outline" to="/owner/business">
                  Edit profile
                </Link>
                <Link className="btn" to={`/p/${business.slug}`}>
                  View public page
                </Link>
              </div>
            </section>

            <section className="card card--padded" aria-labelledby="dash-services-title">
              <h2 className="card__title" id="dash-services-title">
                Services
              </h2>
              <p className="card__subtitle">
                Published on your public page
              </p>
              <p className="stat">
                {services.filter((service) => service.isActive).length}
                <span className="stat__label"> active of {services.length} total</span>
              </p>
              <div className="dashboard-actions">
                <Link className="btn btn--outline" to="/owner/services">
                  Manage services
                </Link>
                <Link className="btn" to="/owner/services/new">
                  Add service
                </Link>
              </div>
            </section>

            <section className="card card--padded" aria-labelledby="dash-today-title">
              <h2 className="card__title" id="dash-today-title">
                Today
              </h2>
              <p className="card__subtitle">Summary for the demo business</p>
              <p className="stat">
                {bookingsToday}
                <span className="stat__label">
                  {' '}
                  {bookingsToday === 1 ? 'booking' : 'bookings'} today
                </span>
              </p>
            </section>

            <section className="card card--padded" aria-labelledby="dash-link-title">
              <h2 className="card__title" id="dash-link-title">
                Public booking link
              </h2>
              <p className="card__subtitle">
                Share it so customers can book you
              </p>
              <p className="link-value">
                werefa.app/p/{business.slug}
              </p>
              <div className="dashboard-actions">
                <Link className="btn" to={`/p/${business.slug}`}>
                  Open public page
                </Link>
              </div>
            </section>
          </div>

          <h2 className="page-subtitle">Quick actions</h2>
          <nav className="shortcut-list" aria-label="Quick actions">
            <Link className="shortcut" to="/owner/business">
              Business profile
            </Link>
            <Link className="shortcut" to="/owner/services/new">
              Add a service
            </Link>
            <Link className="shortcut" to="/owner/schedule">
              Working hours
            </Link>
          </nav>

          <PauseCard business={business} onChanged={reload} />
        </>
      )}
    </LoadState>
  )
}