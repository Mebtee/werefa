import { useEffect, useRef, type ReactNode } from 'react'
import type { BusinessDetails, Service } from '@/types/models'
import { buildLineItems, formatMoney, prepaymentAmount, totalDurationMinutes, totalPrice } from '@/lib/format'
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

export function BookingWizard({ business, services }: BookingWizardProps) {
  const flow = useBookingFlow(business, services)
  const lineItems = buildLineItems(services, flow.selections)
  const total = totalPrice(lineItems)
  const duration = totalDurationMinutes(lineItems)
  const deposit = prepaymentAmount(business.prepayment, total)

  const mainRef = useRef<HTMLDivElement | null>(null)
  const prevStep = useRef<number | null>(null)
  const prevSubmitting = useRef(false)

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
          date={flow.date}
          time={flow.time}
          selectDate={flow.selectDate}
          selectTime={flow.selectTime}
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
          goTo={jumpTo}
          submit={() => void flow.submit(duration)}
          submitting={flow.submitting}
        />
      )
      break
    case STEP_PAYMENT:
      content = (
        <PaymentStep
          business={business}
          deposit={deposit ?? 0}
          paymentMethod={flow.paymentMethod}
          setPayment={flow.setPayment}
          proof={flow.proof}
          setProof={flow.setProofFile}
          onBack={() => jumpTo(STEP_REVIEW)}
          onSubmit={() => void flow.submit(duration)}
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
          onChooseAnotherTime={() => {
            flow.selectTime(null)
            jumpTo(STEP_DATE_TIME)
          }}
          onChangeServices={() => jumpTo(STEP_SERVICES)}
          onRestart={flow.reset}
          onRetry={() => void flow.submit(duration)}
        />
      )
  }

  const showStepper = flow.step !== STEP_DONE

  return (
    <section className="section-block" id="book" aria-labelledby="book-title">
      <h2 className="section-title" id="book-title">
        Book now
      </h2>
      <div className="wizard card" style={{ padding: 'var(--space-4)' }}>
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
          {content}
        </div>
      </div>
    </section>
  )
}