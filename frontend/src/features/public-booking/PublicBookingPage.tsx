import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { BusinessPage } from '@/types/models'
import { getPublicBusiness, isNotFoundError } from '@/api/business'
import { getPublicServices } from '@/api/catalog'
import { getPublicSchedule } from '@/api/schedule'
import { availabilityScheduleFromView } from '@/api/schedule.mapper'
import { hybridizePublicBusiness } from '@/api/business.mapper'
import { mockApi } from '@/mock/api'
import { PRIMARY_BUSINESS_SLUG } from '@/mock/data'
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

export function PublicBookingPage() {
  const { slug } = useParams<{ slug: string }>()
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setLoad({ status: 'loading' })
    void (async () => {
      // The backend is authoritative for existence, profile, pause state,
      // schedule and the active service catalog (REQ-079 hides deactivated
      // services). The availability fixture still reads the legacy
      // `BusinessDetails` schedule fields, so the real public schedule is
      // derived into them; the cosmetic profile fields the evolved backend
      // does not persist yet stay on the mock seam.
      try {
        const [view, servicesView, scheduleView, mockPage] = await Promise.all([
          getPublicBusiness(slug ?? ''),
          getPublicServices(slug ?? ''),
          getPublicSchedule(slug ?? ''),
          mockApi.getBusinessPage(slug ?? ''),
        ])
        if (cancelled) return
        const business = hybridizePublicBusiness(view, mockPage?.business)
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
            <div style={{ marginTop: 'var(--space-4)' }}>
              <Link className="btn btn--outline" to={`/p/${PRIMARY_BUSINESS_SLUG}`}>
                Go to the demo business
              </Link>
            </div>
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