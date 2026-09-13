import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { BusinessPage } from '@/types/models'
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

export function PublicBookingPage() {
  const { slug } = useParams<{ slug: string }>()
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setLoad({ status: 'loading' })
    mockApi.getBusinessPage(slug ?? '').then((page) => {
      if (cancelled) return
      setLoad(page ? { status: 'ready', page } : { status: 'notfound' })
    })
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
          Werefa — public preview build. Everything you see uses in-memory mock
          data; no bookings are stored.
        </div>
      </footer>
    </div>
  )
}