import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
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

  return (
    <div
      className="page-root"
      style={
        load.status === 'ready'
          ? ({ '--accent': load.page.business.accentColor } as CSSProperties)
          : undefined
      }
    >
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      <main id="main" className="page-root__main">
        {load.status === 'loading' && (
          <div className="container" style={{ paddingBlock: 'var(--space-8)', textAlign: 'center' }}>
            <Spinner label="Loading the business page" />
          </div>
        )}

        {load.status === 'notfound' && (
          <div className="container" style={{ paddingBlock: 'var(--space-8)' }}>
            <Alert tone="warning" title="Business not found">
              No business was found at this address. Check the link you were
              given, or ask the business for its correct booking link.
            </Alert>
          </div>
        )}

        {load.status === 'error' && (
          <div className="container" style={{ paddingBlock: 'var(--space-8)' }}>
            <Alert tone="danger" title="Could not load this page">
              We could not load this business page right now. Please try again.
            </Alert>
          </div>
        )}

        {load.status === 'ready' && (
          <>
            <BusinessHero business={load.page.business} />
            <div className="container">
              {load.page.business.pause ? (
                <ServicesReadOnly
                  business={load.page.business}
                  services={load.page.services}
                />
              ) : (
                <BookingWizard
                  business={load.page.business}
                  services={load.page.services}
                />
              )}
            </div>
          </>
        )}
      </main>

      <footer className="page-footer">
        <div className="container">
          Werefa — preview build. The business profile, schedule and service
          catalog are real, and booking requests are stored by the real backing
          service when you submit them.
        </div>
      </footer>
    </div>
  )
}