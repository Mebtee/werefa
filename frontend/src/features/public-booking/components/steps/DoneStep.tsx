import type { CustomerDetails, SubmitResult } from '@/types/models'
import { Link } from 'react-router-dom'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { TelegramConnectCard } from '@/features/public-booking/components/steps/TelegramConnectCard'
import { CheckCircleIcon } from '@/components/ui/icons'

interface DoneStepProps {
  result: SubmitResult | null
  submitting: boolean
  customer: CustomerDetails
  businessSlug: string
  onChooseAnotherTime: () => void
  onChangeServices: () => void
  onRestart: () => void
  onRetry: () => void
}

/**
 * Terminal step of the wizard.
 *
 * The only thing rendered here is what the real submission returned: there is no
 * booking id, code or reference in the response, so none is shown — the customer
 * is told, truthfully, that their phone number identifies the booking. A failed
 * submission stays a failure with a retry, and a slot lost mid-booking says so
 * instead of implying a reservation.
 */
export function DoneStep({
  result,
  submitting,
  customer,
  businessSlug,
  onChooseAnotherTime,
  onChangeServices,
  onRestart,
  onRetry,
}: DoneStepProps) {
  if (submitting || result === null) {
    return (
      <div className="loading-state loading-state--inline">
        <Spinner label="Sending your booking request" />
        <p className="loading-state__label">Sending your booking request…</p>
      </div>
    )
  }

  if (result.status === 'created') {
    const pendingPayment = result.disposition === 'payment-pending'
    const phone = customer.phone.trim()
    return (
      <>
        <h2 className="step-title">Request sent</h2>
        <div className="success-panel">
          <span className="success-panel__icon">
            <CheckCircleIcon size={26} />
          </span>
          <Alert tone="success" title="Booking request received">
            {pendingPayment ? (
              <p>
                We have your booking request and your payment proof. Your booking
                will be confirmed once the business reviews the payment.
              </p>
            ) : (
              <p>
                Your booking request has been received. The business will confirm
                it with you shortly.
              </p>
            )}
            <p style={{ marginTop: 'var(--space-2)' }}>
              Bookings are identified by your phone number: <strong>{phone}</strong>.
            </p>
          </Alert>
        </div>

        <TelegramConnectCard businessSlug={businessSlug} phone={customer.phone} />

        <nav className="wizard__nav" aria-label="Booking sent actions">
          <Button variant="outline" onClick={onRestart}>
            Book another appointment
          </Button>
          <Link className="btn btn--primary" to={`/p/${businessSlug}/status`}>
            Check my booking status
          </Link>
        </nav>
      </>
    )
  }

  if (result.status === 'unavailable') {
    return (
      <>
        <h2 className="step-title">That time just got taken</h2>
        <Alert tone="warning" title="Not this time">
          While you were booking, another customer requested the same time.
          Nothing was reserved for you.
        </Alert>
        <nav className="wizard__nav" aria-label="Unavailable actions">
          <Button variant="outline" onClick={onChangeServices}>
            Change services
          </Button>
          <Button variant="primary" onClick={onChooseAnotherTime}>
            Choose another time
          </Button>
        </nav>
      </>
    )
  }

  return (
    <>
      <h2 className="step-title">Something went wrong</h2>
      <Alert tone="danger" title="Booking not sent">
        {result.message}
      </Alert>
      <nav className="wizard__nav" aria-label="Error actions">
        <Button variant="primary" onClick={onRetry}>
          Try again
        </Button>
      </nav>
    </>
  )
}