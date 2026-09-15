import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import type {
  BusinessPage,
  CustomerBookingStatus,
  CustomerTelegramNotificationView,
} from '@/types/models'
import { mockApi } from '@/mock/api'
import { PRIMARY_BUSINESS_SLUG } from '@/mock/data'
import { isValidPhone } from '@/lib/validation'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import { BookingStatusCard } from '@/features/customer-status/BookingStatusCard'
import { TelegramNotificationsSection } from '@/features/customer-status/TelegramNotificationsSection'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; page: BusinessPage }
  | { status: 'notfound' }

type LookupState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'results'; bookings: readonly CustomerBookingStatus[] }

/** Chronological order of customer-safe Telegram notification events. */
function chronological(
  notices: readonly CustomerTelegramNotificationView[],
): CustomerTelegramNotificationView[] {
  return [...notices].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

export function BookingStatusPage() {
  const { slug } = useParams<{ slug: string }>()
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [phone, setPhone] = useState('')
  const [searchedPhone, setSearchedPhone] = useState('')
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [lookup, setLookup] = useState<LookupState>({ phase: 'idle' })
  const resultsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoad({ status: 'loading' })
    setLookup({ phase: 'idle' })
    setPhone('')
    setPhoneError(null)
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
      document.title = `${load.page.business.name} — Check my booking — Werefa`
    } else {
      document.title = 'Werefa'
    }
    return () => {
      document.title = 'Werefa'
    }
  }, [load])

  useEffect(() => {
    if (lookup.phase === 'results' && lookup.bookings.length > 0) {
      resultsRef.current?.focus()
    }
  }, [lookup])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = phone.trim()
    if (!trimmed || !isValidPhone(trimmed)) {
      setPhoneError('Please enter a valid phone number.')
      return
    }
    setPhoneError(null)
    setSearchedPhone(trimmed)
    setLookup({ phase: 'loading' })
    const results = await mockApi.lookupBookingsByPhone(slug ?? '', trimmed)
    setLookup({ phase: 'results', bookings: results })
  }

  const handleTelegramToggle = async (target: boolean) => {
    if (!searchedPhone) return
    await mockApi.setCustomerTelegramConnected(slug ?? '', searchedPhone, target)
    const results = await mockApi.lookupBookingsByPhone(slug ?? '', searchedPhone)
    setLookup({ phase: 'results', bookings: results })
  }

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
            <Spinner label="Loading" />
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
          <div className="container" style={{ paddingBlock: 'var(--space-6)' }}>
            <div className="status-page__header">
              <nav aria-label="Breadcrumb" className="booking-breadcrumb">
                <Link to={`/p/${load.page.business.slug}`}>{load.page.business.name}</Link>
                <span aria-hidden="true">/</span>
                <span>Check my booking</span>
              </nav>
              <h1 className="page-title">Check my booking</h1>
              <p className="page-subtitle">
                Enter the phone number you used when you booked to see your
                booking status.
              </p>
            </div>

            <form
              onSubmit={(event) => void handleSubmit(event)}
              noValidate
              className="status-page__form card card--padded"
              aria-label="Booking status lookup"
            >
              <Field
                label="Phone number"
                hint="The phone number you provided during booking."
                error={phoneError ?? undefined}
                children={({ id, ariaDescribedBy }) => (
                  <input
                    id={id}
                    className="input"
                    type="tel"
                    autoComplete="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(event) => {
                      setPhone(event.target.value)
                      if (phoneError) setPhoneError(null)
                    }}
                    aria-invalid={phoneError ? true : undefined}
                    aria-describedby={ariaDescribedBy}
                    placeholder="e.g. +251 911 223 344"
                  />
                )}
              />
              <Button
                type="submit"
                variant="primary"
                block
                loading={lookup.phase === 'loading'}
                disabled={lookup.phase === 'loading'}
              >
                Check my booking
              </Button>
            </form>

            {lookup.phase === 'loading' && (
              <div style={{ paddingBlock: 'var(--space-6)', textAlign: 'center' }}>
                <Spinner label="Looking up your bookings" />
              </div>
            )}

            {lookup.phase === 'results' && lookup.bookings.length === 0 && (
              <div style={{ paddingBlock: 'var(--space-5)' }}>
                <Alert tone="info" title="No booking found">
                  No booking found for this phone number.
                </Alert>
              </div>
            )}

            {lookup.phase === 'results' && lookup.bookings.length > 0 && (
              <div
                ref={resultsRef}
                tabIndex={-1}
                aria-label="Booking status results"
                className="status-page__results"
              >
                <div className="sr-only" aria-live="polite">
                  {lookup.bookings.length} booking{lookup.bookings.length === 1 ? '' : 's'} found.
                </div>
                {lookup.bookings.map((booking) => (
                  <BookingStatusCard
                    key={`${booking.date}:${booking.time}`}
                    booking={booking}
                  />
                ))}
                <TelegramNotificationsSection
                  connected={lookup.bookings[0].telegramConnected}
                  notifications={chronological(
                    lookup.bookings.flatMap(
                      (booking) => booking.telegramNotifications,
                    ),
                  )}
                  onToggle={(target) => handleTelegramToggle(target)}
                />
              </div>
            )}
          </div>
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
