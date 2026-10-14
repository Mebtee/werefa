import type { CustomerDetails, SubmitResult } from '@/types/models'
import { Link } from 'react-router-dom'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { TelegramConnectCard } from '@/features/public-booking/components/steps/TelegramConnectCard'
import { CheckCircleIcon } from '@/components/ui/icons'
import { QuickCheckInQr } from '@/features/public-booking/components/QuickCheckInQr'
import { BookingReceiptDownload } from '@/features/public-booking/components/BookingReceiptDownload'

interface DoneStepProps {
  result: SubmitResult | null
  submitting: boolean
  customer: CustomerDetails
  businessSlug: string
  serviceName?: string
  date?: string | null
  time?: string | null
  priceText?: string
  businessName?: string
  businessPhone?: string
  onChooseAnotherTime: () => void
  onChangeServices: () => void
  onRestart: () => void
  onRetry: () => void
}

/**
 * Terminal step of the wizard.
 *
 * Renders the confirmed receipt with in-person quick check-in QR code,
 * provider & contact details, and one-click Telegram notification link.
 */
export function DoneStep({
  result,
  submitting,
  customer,
  businessSlug,
  serviceName,
  date,
  time,
  priceText,
  businessName,
  businessPhone,
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
    const checkInUrl = `https://werefa.app/p/${businessSlug}/status?phone=${encodeURIComponent(phone)}`

    return (
      <>
        <h2 className="step-title">Booking Confirmed!</h2>
        <p className="step-subtitle">
          Your appointment request with {businessName || businessSlug} is set.
        </p>

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

        <div className="booking-receipt-grid">
          <div className="receipt-card">
            <div className="receipt-card__header">Appointment Summary</div>
            <div className="receipt-card__row">
              <span className="receipt-card__label">Customer Phone:</span>
              <span className="receipt-card__value"><code>{phone}</code></span>
            </div>
            {serviceName && (
              <div className="receipt-card__row">
                <span className="receipt-card__label">Service:</span>
                <span className="receipt-card__value">{serviceName}</span>
              </div>
            )}
            {date && (
              <div className="receipt-card__row">
                <span className="receipt-card__label">Date:</span>
                <span className="receipt-card__value">{date}</span>
              </div>
            )}
            {time && (
              <div className="receipt-card__row">
                <span className="receipt-card__label">Time:</span>
                <span className="receipt-card__value">{time}</span>
              </div>
            )}
            {priceText && (
              <div className="receipt-card__row">
                <span className="receipt-card__label">Price:</span>
                <span className="receipt-card__value">{priceText}</span>
              </div>
            )}
            <div className="receipt-card__row">
              <span className="receipt-card__label">Status:</span>
              <span className="receipt-card__value">
                <span className="receipt-card__status receipt-card__status--pending">
                  {pendingPayment ? 'PENDING' : 'CONFIRMED'}
                </span>
              </span>
            </div>
            <div className="receipt-card__row">
              <span className="receipt-card__label">Payment Status:</span>
              <span className="receipt-card__value">
                <span className="receipt-card__status receipt-card__status--pending">
                  {pendingPayment ? 'PENDING VERIFICATION' : 'PAID'}
                </span>
              </span>
            </div>
          </div>

          <div className="receipt-card">
            <div className="receipt-card__header">Contact Information</div>
            <div className="receipt-card__row">
              <span className="receipt-card__label">Client:</span>
              <span className="receipt-card__value">{customer.name || 'Client'}</span>
            </div>
            <div className="receipt-card__row">
              <span className="receipt-card__label">Phone:</span>
              <span className="receipt-card__value">{phone}</span>
            </div>
            <div className="receipt-card__row">
              <span className="receipt-card__label">Provider:</span>
              <span className="receipt-card__value">{businessName || businessSlug}</span>
            </div>
            {businessPhone && (
              <div className="receipt-card__row">
                <span className="receipt-card__label">Provider Phone:</span>
                <span className="receipt-card__value">{businessPhone}</span>
              </div>
            )}
          </div>
        </div>

        <QuickCheckInQr
          checkInUrl={checkInUrl}
          bookingReference={phone}
        />

        <BookingReceiptDownload
          businessName={businessName || ''}
          businessSlug={businessSlug}
          businessPhone={businessPhone}
          customerName={customer.name}
          customerPhone={phone}
          serviceName={serviceName}
          date={date ?? undefined}
          time={time ?? undefined}
          priceText={priceText}
          pendingPayment={pendingPayment}
          checkInUrl={checkInUrl}
        />

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