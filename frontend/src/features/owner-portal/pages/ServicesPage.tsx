import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useOwnedBusiness } from '@/features/owner-portal/state/useOwnedBusiness'
import { LoadState } from '@/features/owner-portal/components/LoadState'
import { deactivateOwnerService, reactivateOwnerService } from '@/api/catalog'
import { formatMoney } from '@/lib/format'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'

interface ServicesLocationState {
  saved?: boolean
  message?: string
}

export function ServicesPage() {
  const { business, businessId, services, loading, error, reload } = useOwnedBusiness()
  const location = useLocation()
  const locationState = (location.state ?? {}) as ServicesLocationState
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [acting, setActing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const toggleActive = async (serviceId: string, active: boolean) => {
    if (!businessId) return
    setActing(true)
    setActionError(null)
    try {
      if (active) {
        await reactivateOwnerService(businessId, serviceId)
      } else {
        await deactivateOwnerService(businessId, serviceId)
      }
      setConfirmingId(null)
      await reload()
    } catch {
      setActionError('Could not update the service. Please try again.')
    } finally {
      setActing(false)
    }
  }

  return (
    <LoadState loading={loading} error={error} onRetry={reload}>
      {business && (
        <>
          <div className="page-head">
            <div>
              <h1 className="page-title">Services</h1>
              <p className="page-subtitle">
                Inactive services stay hidden from your public page.
              </p>
            </div>
            <Link className="btn btn--primary" to="/owner/services/new">
              Add service
            </Link>
          </div>

          {locationState.saved && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <Alert tone="success" live="polite">
                {locationState.message ?? 'Service saved.'}
              </Alert>
            </div>
          )}
          {actionError && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <Alert tone="danger">{actionError}</Alert>
            </div>
          )}

          {services.length === 0 ? (
            <Alert tone="info">You have no services yet. Add your first one.</Alert>
          ) : (
            <ul className="service-list">
              {services.map((service) => (
                <li key={service.id} className="card card--padded service-row">
                  <div className="service-row__main">
                    <h2 className="service-row__name">{service.name}</h2>
                    <ul className="service-row__facts">
                      <li>{formatMoney(service.basePriceMinor, business.currency)}</li>
                      <li>{service.baseDurationMinutes} min</li>
                      <li>
                        {service.variations.length} variation
                        {service.variations.length === 1 ? '' : 's'}
                      </li>
                      <li>
                        {service.addOns.length} add-on
                        {service.addOns.length === 1 ? '' : 's'}
                      </li>
                    </ul>
                  </div>
                  <div className="service-row__side">
                    <span
                      className={service.isActive ? 'status-pill status-pill--on' : 'status-pill'}
                    >
                      {service.isActive ? 'Active' : 'Inactive'}
                    </span>
                    <div className="service-row__actions">
                      <Link className="btn btn--outline" to={`/owner/services/${service.id}`}>
                        Edit
                      </Link>
                      {confirmingId === service.id ? (
                        <span className="confirm-inline">
                          <Button
                            variant="primary"
                            loading={acting}
                            onClick={() => void toggleActive(service.id, false)}
                          >
                            Deactivate
                          </Button>
                          <Button variant="outline" onClick={() => setConfirmingId(null)}>
                            Cancel
                          </Button>
                        </span>
                      ) : service.isActive ? (
                        <Button variant="outline" onClick={() => setConfirmingId(service.id)}>
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          loading={acting}
                          onClick={() => void toggleActive(service.id, true)}
                        >
                          Reactivate
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {confirmingId && (
            <Alert tone="warning" title="Deactivate this service?">
              It will disappear from your public page and can no longer be
              booked. Existing bookings are not affected.
            </Alert>
          )}
        </>
      )}
    </LoadState>
  )
}