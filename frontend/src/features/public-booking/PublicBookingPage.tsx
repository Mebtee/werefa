import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { BusinessPage } from '@/types/models'
import { getPublicBusiness, isNotFoundError } from '@/api/business'
import { getPublicServices } from '@/api/catalog'
import { getPublicSchedule } from '@/api/schedule'
import type { PublicScheduleView } from '@/api/types'
import { availabilityScheduleFromView } from '@/api/schedule.mapper'
import { hybridizePublicBusiness } from '@/api/business.mapper'
import { Alert } from '@/components/ui/Alert'
import { Spinner } from '@/components/ui/Spinner'
import { CalendarIcon, ScissorsIcon } from '@/components/ui/icons'
import { BusinessHero } from '@/features/public-booking/components/BusinessHero'
import { BookingWizard } from '@/features/public-booking/components/BookingWizard'
import { ServicesReadOnly } from '@/features/public-booking/components/ServicesReadOnly'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; page: BusinessPage }
  | { status: 'notfound' }
  | { status: 'error' }

/**
 * A business that has never published a schedule answers 404 on
 * `/public/businesses/:slug/schedule` ("No active schedule version"). That is a
 * legitimate empty state — a brand-new business has no working hours yet — and
 * NOT a missing business. Mapping it to the "Business not found" page sent every
 * owner whose business had no schedule to a dead end, because the whole request
 * batch used to reject on the schedule 404 even though the business itself had
 * been found. The public page therefore renders the real business with no
 * bookable slots until the owner saves a schedule.
 */
const NO_SCHEDULE_YET: PublicScheduleView = {
  workingPeriods: [],
  blockedPeriods: [],
  specialDates: [],
}

/**
 * Public business page (`/p/:slug`).
 *
 * Load order, empty states and error states are unchanged from the pre-redesign
 * implementation: the business lookup alone decides existence, the schedule 404
 * is tolerated, and availability is fetched per date by the wizard's real
 * availability clients. Only presentation changed — the page now mounts inside
 * the customer design scope (`.customer-shell`) and renders an honest empty
 * state when the business publishes no services at all.
 */
export function PublicBookingPage() {
  const { slug } = useParams<{ slug: string }>()
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setLoad({ status: 'loading' })
    void (async () => {
      // The backend is authoritative for existence, profile, pause state,
      // schedule and the active service catalog (REQ-079 hides deactivated
      // services). Availability is fetched per date by the wizard's real
      // availability clients; the public schedule feeds the page frame.
      try {
        // The business lookup alone decides whether this address exists, so it
        // runs first and on its own: only its 404 means "Business not found".
        const view = await getPublicBusiness(slug ?? '')
        const [servicesView, scheduleView] = await Promise.all([
          getPublicServices(slug ?? ''),
          // Tolerate a missing schedule only; any other failure still surfaces.
          getPublicSchedule(slug ?? '').catch((error) =>
            isNotFoundError(error) ? NO_SCHEDULE_YET : Promise.reject(error),
          ),
        ])
        if (cancelled) return
        const business = hybridizePublicBusiness(view)
        business.bookingIntervalMinutes = view.bookingIntervalMinutes
        const availability = availabilityScheduleFromView(scheduleView, {
          intervalMinutes: view.bookingIntervalMinutes,
          bookingWindowDays: business.bookingWindowDays ?? 14,
        })
        business.workingHours = availability.workingHours
        business.specialDays = availability.specialDays
        business.blockedDays = [...availability.blockedDays]
        business.blockedPeriods = [...availability.blockedPeriods]
        setLoad({
          status: 'ready',
          page: {
            business,
            services: servicesView,
          },
        })
      } catch (error) {
        if (cancelled) return
        setLoad(isNotFoundError(error) ? { status: 'notfound' } : { status: 'error' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [slug])

  useEffect(() => {
    if (load.status === 'ready') {
      document.title = `${load.page.business.name} — Werefa`
    } else {
      document.title = 'Werefa'
    }
    return () => {
      document.title = 'Werefa'
    }
  }, [load])

  const ready = load.status === 'ready' ? load.page : null
  const hasServices = ready !== null && ready.services.length > 0

  return (
    <div className="page-root customer-shell">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      <main id="main" className="page-root__main">
        {load.status === 'loading' && (
          <div className="container">
            <div className="loading-state" style={{ paddingBlock: 'var(--cs-9)' }}>
              <Spinner label="Loading the business page" />
              <p className="loading-state__label">Loading this business page…</p>
            </div>
          </div>
        )}

        {load.status === 'notfound' && (
          <div className="container" style={{ paddingBlock: 'var(--cs-8)' }}>
            <Alert tone="warning" title="Business not found">
              No business was found at this address. Check the link you were
              given, or ask the business for its correct booking link.
            </Alert>
          </div>
        )}

        {load.status === 'error' && (
          <div className="container" style={{ paddingBlock: 'var(--cs-8)' }}>
            <Alert tone="danger" title="Could not load this page">
              We could not load this business page right now. Please try again.
            </Alert>
          </div>
        )}

        {ready && (
          <>
            <BusinessHero business={ready.business} />
            <div className="container customer-flow">
              {!hasServices ? (
                // Honest empty state: the catalogue really is empty (no active
                // service is published). Nothing is offered in its place.
                <section className="section-block" aria-labelledby="services-empty-title">
                  <div className="empty-state">
                    <span className="empty-state__icon">
                      <ScissorsIcon size={24} />
                    </span>
                    <h2 className="empty-state__title" id="services-empty-title">
                      No services published yet
                    </h2>
                    <p className="empty-state__body">
                      {ready.business.name} has not published any services for
                      booking yet. Please check back later, or contact the
                      business directly to make an appointment.
                    </p>
                    {ready.business.phone.trim() ? (
                      <p className="empty-state__body">
                        <a href={`tel:${ready.business.phone.replace(/\s/g, '')}`}>
                          Call {ready.business.phone}
                        </a>
                      </p>
                    ) : null}
                  </div>
                </section>
              ) : ready.business.pause ? (
                <ServicesReadOnly
                  business={ready.business}
                  services={ready.services}
                />
              ) : (
                <BookingWizard
                  business={ready.business}
                  services={ready.services}
                />
              )}
            </div>
          </>
        )}
      </main>

      <footer className="page-footer">
        <div className="container page-footer__inner">
          <p style={{ margin: 0, maxWidth: '60ch' }}>
            Booking on this page is handled by {ready?.business.name ?? 'this business'}.
            Werefa stores the request and the payment proof you send; the business
            confirms it.
          </p>
          <p style={{ margin: 0 }}>
            <CalendarIcon size={16} style={{ display: 'inline', verticalAlign: '-3px' }} />{' '}
            Times shown are 24-hour.
          </p>
        </div>
      </footer>
    </div>
  )
}
