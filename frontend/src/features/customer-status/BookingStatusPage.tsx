import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import type {
  BusinessPage,
  CustomerBookingStatusEntry,
} from '@/types/models'
import { getPublicBusiness, isNotFoundError } from '@/api/business'
import { getCustomerBookingStatus } from '@/api/booking'
import {
  statusEntriesFromView,
  telegramConnectedFromView,
} from '@/api/booking.mapper'
import { hybridizePublicBusiness } from '@/api/business.mapper'
import { mockApi } from '@/mock/api'
import { PRIMARY_BUSINESS_SLUG } from '@/mock/data'
import { isValidPhone } from '@/lib/validation'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import { BookingStatusCard } from '@/features/customer-status/BookingStatusCard'
import { ResubmissionPanel } from '@/features/customer-status/ResubmissionPanel'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; page: BusinessPage }
  | { status: 'notfound' }
  | { status: 'error' }

type LookupState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | {
      phase: 'results'
      bookings: readonly CustomerBookingStatusEntry[]
      /** Live Telegram connection for this phone + business (REQ-056). */
      telegramConnected: boolean
    }
  | { phase: 'error' }

export function BookingStatusPage() {
  const { slug } = useParams<{ slug: string }>()
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [phone, setPhone] = useState('')
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [lookup, setLookup] = useState<LookupState>({ phase: 'idle' })
  const [resubmitting, setResubmitting] = useState(false)
  const [resubmitNotice, setResubmitNotice] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoad({ status: 'loading' })
    setLookup({ phase: 'idle' })
    setResubmitting(false)
    setResubmitNotice(null)
    setPhone('')
    setPhoneError(null)
    void (async () => {
      try {
        const [view, mockPage] = await Promise.all([
          getPublicBusiness(slug ?? ''),
          mockApi.getBusinessPage(slug ?? ''),
        ])
        if (cancelled) return
        setLoad({
          status: 'ready',
          page: {
            business: hybridizePublicBusiness(view, mockPage?.business),
            services: mockPage?.services ?? [],
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

  const performLookup = useCallback(
    async (value: string) => {
      setLookup({ phase: 'loading' })
      try {
        const view = await getCustomerBookingStatus(slug ?? '', value)
        setLookup({
          phase: 'results',
          bookings: statusEntriesFromView(view),
          telegramConnected: telegramConnectedFromView(view),
        })
      } catch {
        setLookup({ phase: 'error' })
      }
    },
    [slug],
  )

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = phone.trim()
    if (!trimmed || !isValidPhone(trimmed)) {
      setPhoneError('Please enter a valid phone number.')
      return
    }
    setPhoneError(null)
    setResubmitting(false)
    setResubmitNotice(null)
    await performLookup(trimmed)
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

        {load.status === 'error' && (
          <div className="container" style={{ paddingBlock: 'var(--space-8)' }}>
            <Alert tone="danger" title="Could not load this page">
              We could not load this business page right now. Please try again.
            </Alert>
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

            {lookup.phase === 'error' && (
              <div style={{ paddingBlock: 'var(--space-5)' }}>
                <Alert tone="danger" title="Could not check your booking">
                  We could not look up your booking right now. Please try again.
                </Alert>
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

                <p className="telegram-status" data-connected={lookup.telegramConnected ? 'true' : 'false'}>
                  {lookup.telegramConnected ? 'Telegram connected' : 'Not connected to Telegram'}
                </p>
                <p className="telegram-panel__note" style={{ marginTop: 'var(--space-2)' }}>
                  {lookup.telegramConnected
                    ? 'Updates about your bookings go to your Telegram for this business.'
                    : 'Link Telegram when you book so updates and reminders reach you there (REQ-056).'}
                </p>

                {resubmitNotice && (
                  <div style={{ marginBottom: 'var(--space-4)' }}>
                    <Alert tone="success" title="Proof resubmitted">
                      {resubmitNotice}
                    </Alert>
                  </div>
                )}

                {lookup.bookings.map((entry, index) => (
                  <BookingStatusCard
                    key={`${entry.startAt}:${index}`}
                    booking={entry}
                    onResubmit={() => {
                      setResubmitNotice(null)
                      setResubmitting(true)
                    }}
                  />
                ))}

                {resubmitting && (
                  <div style={{ marginTop: 'var(--space-4)' }}>
                    <ResubmissionPanel
                      businessSlug={slug ?? ''}
                      phone={phone.trim()}
                      onDone={() => {
                        setResubmitting(false)
                        setResubmitNotice(
                          'Your new payment proof was received. This booking is awaiting review again.',
                        )
                        void performLookup(phone.trim())
                      }}
                      onClose={() => setResubmitting(false)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="page-footer">
        <div className="container">
          Werefa — preview build. The business profile is real, and bookings are
          stored and reported by the real backing service.
        </div>
      </footer>
    </div>
  )
}