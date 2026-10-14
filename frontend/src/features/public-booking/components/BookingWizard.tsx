import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { BusinessDetails, Service } from '@/types/models'
import { buildLineItems, formatMoney, totalDurationMinutes, totalPrice } from '@/lib/format'
import { Stepper } from '@/components/ui/Stepper'
import { BookingSummary } from '@/features/public-booking/components/BookingSummary'
import {
  useBookingFlow,
  BOOKING_STEP_LABELS,
  STEP_CUSTOMER,
  STEP_DATE_TIME,
  STEP_DONE,
  STEP_PAYMENT,
  STEP_REVIEW,
  STEP_SERVICES,
} from '@/features/public-booking/state/useBookingFlow'
import { useCustomerLocale } from '@/features/public-booking/locale/customerLocale'
import { ServicesStep } from '@/features/public-booking/components/steps/ServicesStep'
import { DateTimeStep } from '@/features/public-booking/components/steps/DateTimeStep'
import { CustomerStep } from '@/features/public-booking/components/steps/CustomerStep'
import { ReviewStep } from '@/features/public-booking/components/steps/ReviewStep'
import { PaymentStep } from '@/features/public-booking/components/steps/PaymentStep'
import { DoneStep } from '@/features/public-booking/components/steps/DoneStep'

interface BookingWizardProps {
  business: BusinessDetails
  services: readonly Service[]
}

/**
 * The booking wizard for `/p/:slug`.
 *
 * All state, validation, availability, deposit and submission behaviour comes
 * from `useBookingFlow` unchanged — this component only decides layout:
 * a persistent summary beside the steps from 860px up, and a collapsed summary
 * above the steps below that so the mobile page stays compact. The step order,
 * the "Book now" heading and the `#book` anchor target are stable.
 */
export function BookingWizard({ business, services }: BookingWizardProps) {
  const flow = useBookingFlow(business)
  const lineItems = buildLineItems(services, flow.selections)
  const total = totalPrice(lineItems)
  const duration = totalDurationMinutes(lineItems)
  // Deposit comes from the backend availability view (authoritative, REQ-110/111).
  const deposit = flow.depositMinor ?? 0

  const mainRef = useRef<HTMLDivElement | null>(null)
  const prevStep = useRef<number | null>(null)
  const prevSubmitting = useRef(false)
  const [stickySummaryOpen, setStickySummaryOpen] = useState(false)
  const { t } = useCustomerLocale()

  // Move focus to the new step's heading on step change (or when the submit
  // spinner finishes), so keyboard and screen-reader users land somewhere
  // sensible instead of falling back to <body>.
  useEffect(() => {
    const stepChanged =
      prevStep.current !== null && prevStep.current !== flow.step
    const submitFinished = prevSubmitting.current && !flow.submitting
    prevStep.current = flow.step
    prevSubmitting.current = flow.submitting
    if (!stepChanged && !submitFinished) return
    const heading = mainRef.current?.querySelector<HTMLElement>('.step-title')
    if (heading) {
      heading.tabIndex = -1
      heading.focus()
    }
  }, [flow.step, flow.submitting])

  const jumpTo = (step: number) => flow.goTo(step)

  let content: ReactNode
  switch (flow.step) {
    case STEP_SERVICES:
      content = (
        <ServicesStep
          business={business}
          services={services}
          selections={flow.selections}
          toggleService={flow.toggleService}
          setVariation={flow.setVariation}
          toggleAddOn={flow.toggleAddOn}
          onNext={() => jumpTo(STEP_DATE_TIME)}
        />
      )
      break
    case STEP_DATE_TIME:
      content = (
        <DateTimeStep
          business={business}
          durationMinutes={duration}
          selections={flow.selections}
          date={flow.date}
          time={flow.time}
          selectDate={flow.selectDate}
          selectTime={flow.selectTime}
          onDeposit={flow.setDepositMinor}
          onBack={() => jumpTo(STEP_SERVICES)}
          onNext={() => jumpTo(STEP_CUSTOMER)}
        />
      )
      break
    case STEP_CUSTOMER:
      content = (
        <CustomerStep
          customer={flow.customer}
          setCustomerField={flow.setCustomerField}
          onBack={() => jumpTo(STEP_DATE_TIME)}
          onNext={() => jumpTo(STEP_REVIEW)}
        />
      )
      break
    case STEP_REVIEW:
      content = (
        <ReviewStep
          business={business}
          services={services}
          selections={flow.selections}
          date={flow.date}
          time={flow.time}
          customer={flow.customer}
          depositMinor={deposit}
          goTo={jumpTo}
          submit={() => void flow.submit()}
          submitting={flow.submitting}
        />
      )
      break
    case STEP_PAYMENT:
      content = (
        <PaymentStep
          business={business}
          deposit={deposit}
          paymentMethod={flow.paymentMethod}
          setPayment={flow.setPayment}
          proof={flow.proof}
          setProof={flow.setProofFile}
          onBack={() => jumpTo(STEP_REVIEW)}
          onSubmit={() => void flow.submit()}
          submitting={flow.submitting}
        />
      )
      break
    default:
      content = (
        <DoneStep
          result={flow.result}
          submitting={flow.submitting}
          customer={flow.customer}
          businessSlug={business.slug}
          serviceName={lineItems.map((i) => i.name).join(', ')}
          date={flow.date}
          time={flow.time}
          priceText={formatMoney(total, business.currency)}
          businessName={business.name}
          businessPhone={business.phone}
          onChooseAnotherTime={() => {
            flow.selectTime(null)
            jumpTo(STEP_DATE_TIME)
          }}
          onChangeServices={() => jumpTo(STEP_SERVICES)}
          onRestart={flow.reset}
          onRetry={() => void flow.submit()}
        />
      )
  }

  const showStepper = flow.step !== STEP_DONE

  return (
    <section className="section-block" id="book" aria-labelledby="book-title">
      <h2 className="section-title" id="book-title">
        {t.bookNow}
      </h2>
      <p className="section-lede">
        {t.bookSubtitle}
      </p>
      <div className="wizard card">
        <aside className="wizard__sidebar">
          <BookingSummary
            business={business}
            services={services}
            selections={flow.selections}
            date={flow.date}
            time={flow.time}
            customer={flow.customer}
          />
        </aside>
        <div className="wizard__main" ref={mainRef}>
          {lineItems.length > 0 && (
            <div className="wizard__mobile-summary">
              <details className="summary-disclosure">
                <summary>
                  <span>
                    {lineItems.length} service{lineItems.length === 1 ? '' : 's'}{' '}
                    · {formatMoney(total, business.currency)} · {duration} min
                  </span>
                  <span className="summary-disclosure__meta">View summary</span>
                </summary>
                <BookingSummary
                  business={business}
                  services={services}
                  selections={flow.selections}
                  date={flow.date}
                  time={flow.time}
                  customer={flow.customer}
                />
              </details>
            </div>
          )}
          {showStepper && <Stepper steps={BOOKING_STEP_LABELS} current={flow.step} />}
          {lineItems.length > 0 && flow.step !== STEP_SERVICES && flow.step !== STEP_DONE && (
            <div className="your-booking-pill">
              <div>
                <div className="your-booking-pill__label">Your Booking</div>
                <div className="your-booking-pill__title">
                  {lineItems.map((i) => i.name).join(', ')}
                </div>
                <div className="your-booking-pill__time">
                  {flow.date && flow.time ? `${flow.date} · ${flow.time}` : 'Selecting appointment time…'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 800, fontSize: '15px' }}>
                  {formatMoney(total, business.currency)}
                </div>
                <span className="your-booking-pill__tag">Pre-payment required</span>
              </div>
            </div>
          )}
          <div className="wizard__panel">{content}</div>
        </div>
      </div>
      {lineItems.length > 0 && flow.step !== STEP_DONE && (
        <div className="mobile-sticky-bar" aria-label="Mobile booking summary bar">
          <button
            type="button"
            className="mobile-sticky-bar__trigger"
            aria-expanded={stickySummaryOpen}
            onClick={() => setStickySummaryOpen((open) => !open)}
          >
            <div className="mobile-sticky-bar__content">
              <span className="mobile-sticky-bar__title">{t.bookingSummary}</span>
              <span className="mobile-sticky-bar__price">
                {formatMoney(total, business.currency)}
              </span>
              {flow.date && flow.time && (
                <span className="mobile-sticky-bar__slot">
                  · {flow.date} · {flow.time}
                </span>
              )}
            </div>
            <span className="mobile-sticky-bar__icon" aria-hidden="true">
              {stickySummaryOpen ? '✕' : '▲'}
            </span>
          </button>
          {stickySummaryOpen && (
            <div
              className="mobile-sticky-bar__drawer"
              role="dialog"
              aria-label="Expanded booking summary"
            >
              <div className="mobile-sticky-bar__drawer-header">
                <strong>{t.selectedBooking}</strong>
                <button
                  type="button"
                  className="mobile-sticky-bar__close"
                  onClick={() => setStickySummaryOpen(false)}
                  aria-label="Close summary sheet"
                >
                  ✕
                </button>
              </div>
              <BookingSummary
                business={business}
                services={services}
                selections={flow.selections}
                date={flow.date}
                time={flow.time}
                customer={flow.customer}
              />
            </div>
          )}
        </div>
      )}
    </section>
  )
}