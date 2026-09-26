import type {
  BusinessDetails,
  CustomerDetails,
  DateString,
  Money,
  Service,
  ServiceSelection,
  TimeOfDay,
} from '@/types/models'
import { formatMoney } from '@/lib/format'
import { BookingSummary } from '@/features/public-booking/components/BookingSummary'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { STEP_CUSTOMER, STEP_DATE_TIME, STEP_PAYMENT, STEP_SERVICES } from '@/features/public-booking/state/useBookingFlow'

interface ReviewStepProps {
  business: BusinessDetails
  services: readonly Service[]
  selections: readonly ServiceSelection[]
  date: DateString | null
  time: TimeOfDay | null
  customer: CustomerDetails
  /** Deposit due (minor), from the backend availability view (REQ-110/111). */
  depositMinor: Money
  goTo: (step: number) => void
  submit: () => void
  submitting: boolean
}

export function ReviewStep({
  business,
  services,
  selections,
  date,
  time,
  customer,
  depositMinor,
  goTo,
  submit,
  submitting,
}: ReviewStepProps) {
  const deposit = depositMinor > 0 ? depositMinor : null

  return (
    <>
      <h2 className="step-title">Review your booking</h2>
      <p className="step-subtitle">Check everything before you confirm.</p>

      <BookingSummary
        business={business}
        services={services}
        selections={selections}
        date={date}
        time={time}
        customer={customer}
        onEdit={{
          services: () => goTo(STEP_SERVICES),
          dateTime: () => goTo(STEP_DATE_TIME),
          customer: () => goTo(STEP_CUSTOMER),
        }}
      />

      {deposit !== null && (
        <Alert tone="info" title="Deposit required">
          This business asks for a deposit of{' '}
          <strong>{formatMoney(deposit, business.currency)}</strong> before it
          can confirm the booking. You will pay it in the next step.
        </Alert>
      )}

      <nav className="wizard__nav" aria-label="Review step actions">
        <Button variant="outline" onClick={() => goTo(STEP_CUSTOMER)}>
          Back
        </Button>
        {deposit === null ? (
          <Button variant="primary" onClick={submit} loading={submitting} disabled={submitting}>
            Confirm booking
          </Button>
        ) : (
          <Button variant="primary" onClick={() => goTo(STEP_PAYMENT)}>
            Continue to payment
          </Button>
        )}
      </nav>
    </>
  )
}