import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { Booking } from '@/types/models'
import type { OwnerScheduleConflictView } from '@/api/types'
import { toUserMessage } from '@/api/errors'
import {
  cancelOwnerBooking,
  getOwnerBookingDetail,
  markOwnerBookingNoShow,
  releaseOwnerBookingSlot,
} from '@/api/ownerBookings'
import { listOwnerScheduleConflicts } from '@/api/schedule'
import { ownerBookingFromWire } from '@/features/owner-portal/lib/ownerBooking'
import { useOwnedBusiness } from '@/features/owner-portal/state/useOwnedBusiness'
import { usePaymentReview } from '@/features/owner-portal/state/usePaymentReview'
import { LoadState } from '@/features/owner-portal/components/LoadState'
import { RescheduleForm } from '@/features/owner-portal/components/RescheduleForm'
import {
  BOOKING_STATE_CHIP,
  BOOKING_STATE_LABEL,
  PAYMENT_STATE_CHIP,
  PAYMENT_STATE_LABEL,
} from '@/features/owner-portal/lib/labels'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { formatDateLong, formatTimestamp } from '@/lib/time'
import { formatBytes, formatMoney, formatTime } from '@/lib/format'

type ConfirmMode =
  | 'cancel-confirmed'
  | 'no-show'
  | 'cancel-pending'
  | 'release'
  | 'reschedule'
  | null

export function BookingDetailPage() {
  const { business, businessId, loading, error, reload } = useOwnedBusiness()
  const { bookingId } = useParams<{ bookingId: string }>()

  const paymentReview = usePaymentReview(businessId, bookingId)

  const [booking, setBooking] = useState<Booking | null>(null)
  const [missing, setMissing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<ConfirmMode>(null)
  const [busy, setBusy] = useState(false)
  const [rejection, setRejection] = useState('')
  const [rejectionError, setRejectionError] = useState<string | null>(null)
  const [openConflicts, setOpenConflicts] = useState<readonly OwnerScheduleConflictView[]>([])

  const load = useCallback(async () => {
    if (!businessId || !bookingId) return
    setMissing(false)
    setBooking(null)
    try {
      const detail = await getOwnerBookingDetail(businessId, bookingId)
      setBooking(ownerBookingFromWire(detail))
      // The Schedule card is driven only by the real open conflicts (REQ-092/093).
      const allConflicts = await listOwnerScheduleConflicts(businessId)
      setOpenConflicts(allConflicts.filter((conflict) => String(conflict.bookingId) === bookingId))
    } catch {
      setMissing(true)
    }
  }, [businessId, bookingId])

  useEffect(() => {
    void load()
  }, [load])

  const onMutationSucceeded = async () => {
    setConfirming(null)
    setRejection('')
    await Promise.all([load(), paymentReview.reload()])
  }

  /**
   * Runs a real lifecycle mutation; any thrown ApiError is surfaced through the
   * safe user message and the detail is re-fetched after success (the UI never
   * assumes the new state locally).
   */
  const run = async (action: () => Promise<unknown>) => {
    if (!booking) return
    setBusy(true)
    setActionError(null)
    try {
      await action()
      await onMutationSucceeded()
    } catch (err) {
      setActionError(toUserMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const accept = () => {
    if (busy || paymentReview.reviewing) return
    void (async () => {
      const ok = await paymentReview.accept()
      if (ok) await onMutationSucceeded()
    })()
  }

  const reject = () => {
    if (busy || paymentReview.reviewing) return
    if (!rejection.trim()) {
      setRejectionError('Please provide a reason for the rejection.')
      return
    }
    void (async () => {
      const ok = await paymentReview.reject(rejection)
      if (ok) await onMutationSucceeded()
    })()
  }

  const cancelConfirmed = () => {
    if (!businessId) return
    void run(() => cancelOwnerBooking(businessId, booking!.id))
  }

  const markNoShow = () => {
    if (!businessId) return
    void run(() => markOwnerBookingNoShow(businessId, booking!.id))
  }

  const cancelPending = () => {
    if (!businessId) return
    void run(() => cancelOwnerBooking(businessId, booking!.id))
  }

  const releaseRejected = () => {
    if (!businessId) return
    void run(() => releaseOwnerBookingSlot(businessId, booking!.id))
  }

  if (!booking) {
    return (
      <LoadState
        loading={(loading && business === null) || (!missing && booking === null)}
        error={error && business === null}
        onRetry={reload}
      >
        {missing && (
          <Alert tone="danger" title="Booking not found">
            We could not find that booking for your business.
          </Alert>
        )}
        <p>
          <Link className="btn btn--outline" to="/owner/bookings">
            Back to bookings
          </Link>
        </p>
      </LoadState>
    )
  }

  const paymentLabel = business
    ? (business.paymentInstructions.methods.find(
        (method) => method.id === booking.paymentMethod,
      )?.label ?? booking.paymentMethod)
    : booking.paymentMethod

  const reviewPaymentStatus = paymentReview.review?.paymentStatus ?? null

  return (
    <>
      <nav aria-label="Breadcrumb" className="booking-breadcrumb">
        <Link to="/owner/bookings">Bookings</Link>
        <span aria-hidden="true">/</span>
        <span>{booking.id}</span>
      </nav>

      <header className="booking-detail__head">
        <div>
          <h1 className="page-title booking-detail__title">
            {booking.customer.name}
          </h1>
          <p className="page-subtitle">
            {booking.customer.phone}
            {booking.customer.note ? ` · "${booking.customer.note}"` : ''}
          </p>
        </div>
        <div className="booking-detail__status">
          <span className={`booking-chip ${BOOKING_STATE_CHIP[booking.state]}`}>
            {BOOKING_STATE_LABEL[booking.state]}
          </span>
          <span
            className={`booking-chip ${PAYMENT_STATE_CHIP[booking.paymentState]}`}
          >
            Payment {PAYMENT_STATE_LABEL[booking.paymentState]}
          </span>
        </div>
      </header>

      {(actionError || paymentReview.actionError) && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert tone="danger">{actionError ?? paymentReview.actionError}</Alert>
        </div>
      )}

      <BookingActions
        booking={booking}
        businessId={businessId}
        busy={busy || paymentReview.reviewing}
        confirming={confirming}
        setConfirming={setConfirming}
        rejection={rejection}
        onRejectionChange={(value) => {
          setRejection(value)
          setRejectionError(null)
        }}
        rejectionError={rejectionError}
        onAccept={accept}
        onReject={reject}
        onCancelConfirmed={cancelConfirmed}
        onNoShow={markNoShow}
        onCancelPending={cancelPending}
        onRelease={releaseRejected}
        onRescheduleDone={onMutationSucceeded}
      />

      <div className="booking-grid">
        <section className="card card--padded" aria-labelledby="customer-title">
          <h2 className="card__title" id="customer-title">
            Customer
          </h2>
          <p className="booking-value">{booking.customer.name}</p>
          <p className="card__subtitle">{booking.customer.phone}</p>
          {booking.customer.note && (
            <p className="booking-value booking-note">"{booking.customer.note}"</p>
          )}
        </section>

        <section className="card card--padded" aria-labelledby="appointment-title">
          <h2 className="card__title" id="appointment-title">
            Appointment
          </h2>
          <p className="booking-value">
            {formatDateLong(booking.date)} at {formatTime(booking.time)}
          </p>
          <p className="card__subtitle">
            Total time {booking.totalDurationMinutes} minutes ·{' '}
            {booking.lineItems.length}{' '}
            {booking.lineItems.length === 1 ? 'service' : 'services'}
          </p>
          <ul className="booking-line-items">
            {booking.lineItems.map((item, index) => (
              <li key={index}>
                <span>{item.name}</span>
                <span className="booking-line-items__meta">
                  {item.durationMinutes} min
                </span>
                <span>
                  {business && formatMoney(item.unitPrice, business.currency)}
                </span>
              </li>
            ))}
          </ul>
          <p className="booking-totals">
            <span>Total</span>
            <strong>
              {business && formatMoney(booking.total, business.currency)}
            </strong>
          </p>
        </section>
      </div>

      <section className="card card--padded" aria-labelledby="payment-title">
        <h2 className="card__title" id="payment-title">
          Payment
        </h2>
        <p className="booking-detail__row">
          <span className="booking-detail__label">Method</span>
          <span>{paymentLabel}</span>
        </p>
        <p className="booking-detail__row">
          <span className="booking-detail__label">Status</span>
          {reviewPaymentStatus ? (
            <span
              className={`booking-chip ${PAYMENT_STATE_CHIP[reviewPaymentStatus]}`}
            >
              {PAYMENT_STATE_LABEL[reviewPaymentStatus]}
            </span>
          ) : (
            <span className="card__subtitle">
              {paymentReview.loading ? 'Loading…' : 'Unavailable'}
            </span>
          )}
        </p>
        <p className="card__subtitle">
          {reviewPaymentStatus === 'pending' &&
            'Awaiting review of the submitted proof.'}
          {reviewPaymentStatus === 'accepted' &&
            `Proof accepted — ${formatMoney(booking.deposit, business?.currency ?? 'ETB')} deposit locked in.`}
          {reviewPaymentStatus === 'rejected' && 'Proof rejected by the owner.'}
          {reviewPaymentStatus === null && paymentReview.loading && 'Loading payment status…'}
        </p>
        {paymentReview.error ? (
          <Alert tone="danger" title="Could not load the payment proof">
            {paymentReview.error}
          </Alert>
        ) : (
          <ul className="proof-timeline">
            {paymentReview.review && paymentReview.review.proofs.length > 0 ? (
              paymentReview.review.proofs.map((proof) => (
                <li key={proof.proofId} className="proof-card">
                  <div>
                    <strong>{proof.fileName}</strong>
                    <span className="line-item__meta">
                      {' '}
                      ({formatBytes(proof.sizeBytes)} · {proof.mimeType})
                    </span>
                    {proof.replaced && <span className="badge">Replaced</span>}
                  </div>
                  <Button
                    variant="outline"
                    disabled={paymentReview.reviewing}
                    onClick={() => void paymentReview.download(proof)}
                  >
                    Download proof
                  </Button>
                </li>
              ))
            ) : (
              <li className="card__subtitle">
                {paymentReview.loading
                  ? 'Loading the payment proof…'
                  : 'No payment proof was submitted.'}
              </li>
            )}
          </ul>
        )}
        {paymentReview.review?.rejectionReason && (
          <div className="booking-rejection">
            <p className="booking-detail__label">Rejection reason</p>
            <p className="booking-value booking-rejection__text">
              {paymentReview.review.rejectionReason}
            </p>
          </div>
        )}
      </section>

      <section className="card card--padded" aria-labelledby="state-title">
        <h2 className="card__title" id="state-title">
          Booking state
        </h2>
        <p className="booking-detail__row">
          <span className="booking-detail__label">Status</span>
          <span className={`booking-chip ${BOOKING_STATE_CHIP[booking.state]}`}>
            {BOOKING_STATE_LABEL[booking.state]}
          </span>
        </p>
        <ol className="booking-history">
          {[...booking.history].reverse().map((entry, index, list) => (
            <li key={`${entry.state}-${index}`}>
              <span className="booking-history__state">
                {BOOKING_STATE_LABEL[entry.state]}
              </span>
              <span className="booking-history__meta">
                {entry.previous ? `from ${BOOKING_STATE_LABEL[entry.previous]} · ` : ''}
                {entry.actor} · {formatTimestamp(entry.at)}
                {index === list.length - 1 ? ' · (current)' : ''}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {openConflicts.length > 0 && (
        <section className="card card--padded" aria-labelledby="schedule-title">
          <h2 className="card__title" id="schedule-title">
            Schedule
          </h2>
          <Alert tone="warning" title="Affected by a schedule change">
            This booking no longer fits the current schedule:{' '}
            {openConflicts[0].reasonDetail}
          </Alert>
          <p className="card__subtitle">
            Resolve it from the schedule page with Reschedule, Cancel or Keep
            Booking.
          </p>
          <p>
            <Link className="btn btn--outline" to="/owner/schedule">
              Open schedule
            </Link>
          </p>
        </section>
      )}

      <p>
        <Link className="btn btn--outline" to="/owner/bookings">
          Back to bookings
        </Link>
      </p>
    </>
  )
}

/**
 * State-aware owner actions (REQ-058, §21 authorization matrix):
 * Payment Pending → accept / reject / cancel (SM-08);
 * Confirmed → reschedule / No Show / cancel;
 * Rejected → release (T9); terminal states have no lifecycle actions.
 * All actions go through the real owner booking endpoints; a single cancel
 * route covers the state-aware confirmations.
 */
function BookingActions({
  booking,
  businessId,
  busy,
  confirming,
  setConfirming,
  rejection,
  onRejectionChange,
  rejectionError,
  onAccept,
  onReject,
  onCancelConfirmed,
  onNoShow,
  onCancelPending,
  onRelease,
  onRescheduleDone,
}: {
  booking: Booking
  businessId: string | null
  busy: boolean
  confirming: ConfirmMode
  setConfirming: (mode: ConfirmMode) => void
  rejection: string
  onRejectionChange: (value: string) => void
  rejectionError: string | null
  onAccept: () => void
  onReject: () => void
  onCancelConfirmed: () => void
  onNoShow: () => void
  onCancelPending: () => void
  onRelease: () => void
  onRescheduleDone: () => Promise<void>
}) {
  const bookingForPicker = booking as Pick<Booking, 'id' | 'totalDurationMinutes'>

  if (booking.state === 'payment-pending') {
    return (
      <section className="card card--padded" aria-labelledby="actions-title">
        <h2 className="card__title" id="actions-title">
          Review decision
        </h2>
        <p className="card__subtitle">
          Confirming locks in this slot for the customer. If you reject, the
          slot stays blocked until you release it or the customer resubmits
          proof.
        </p>
        {confirming === 'cancel-pending' ? (
          <ConfirmInline
            note="Cancel this booking? The slot stays blocked until you release it, and the customer is not notified."
            confirmLabel="Confirm cancellation"
            busy={busy}
            onConfirm={onCancelPending}
            onBack={() => setConfirming(null)}
          />
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              onReject()
            }}
          >
            <Field
              label="Rejection reason"
              hint="Required if you reject — the customer sees it."
              error={rejectionError ?? undefined}
            >
              {({ id, ariaDescribedBy }) => (
                <textarea
                  id={id}
                  className="input booking-reason"
                  rows={3}
                  aria-describedby={ariaDescribedBy}
                  value={rejection}
                  onChange={(event) => onRejectionChange(event.target.value)}
                  placeholder="e.g. The transfer reference is missing."
                />
              )}
            </Field>
            <div className="booking-actions">
              <Button
                type="submit"
                variant="outline"
                className="btn--danger"
                loading={busy}
                disabled={busy}
              >
                Reject booking
              </Button>
              <Button
                type="button"
                variant="primary"
                loading={busy}
                disabled={busy}
                onClick={onAccept}
              >
                Accept booking
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setConfirming('cancel-pending')}
              >
                Cancel booking
              </Button>
            </div>
          </form>
        )}
      </section>
    )
  }

  if (booking.state === 'confirmed') {
    return (
      <section className="card card--padded" aria-labelledby="actions-title">
        <h2 className="card__title" id="actions-title">
          Manage booking
        </h2>
        {confirming === 'reschedule' && businessId && (
          <RescheduleForm
            booking={bookingForPicker}
            businessId={businessId}
            onDone={onRescheduleDone}
            onBack={() => setConfirming(null)}
          />
        )}
        {confirming === 'cancel-confirmed' && (
          <ConfirmInline
            note="Cancel this booking? The slot is released and the customer is notified."
            confirmLabel="Confirm cancellation"
            busy={busy}
            onConfirm={onCancelConfirmed}
            onBack={() => setConfirming(null)}
          />
        )}
        {confirming === 'no-show' && (
          <ConfirmInline
            note="Mark this appointment as No Show? The slot is released and the customer is notified."
            confirmLabel="Confirm No Show"
            busy={busy}
            onConfirm={onNoShow}
            onBack={() => setConfirming(null)}
          />
        )}
        {confirming === null && (
          <>
            <p className="card__subtitle">
              Reschedule to a free slot, or mark the appointment as missed.
            </p>
            <div className="booking-actions">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setConfirming('reschedule')}
              >
                Reschedule / Modify
              </Button>
              <Button
                variant="outline"
                className="btn--danger"
                disabled={busy}
                onClick={() => setConfirming('no-show')}
              >
                Mark as No Show
              </Button>
              <Button
                variant="outline"
                className="btn--danger"
                disabled={busy}
                onClick={() => setConfirming('cancel-confirmed')}
              >
                Cancel booking
              </Button>
            </div>
          </>
        )}
      </section>
    )
  }

  if (booking.state === 'rejected') {
    return (
      <section className="card card--padded" aria-labelledby="actions-title">
        <h2 className="card__title" id="actions-title">
          Rejected booking
        </h2>
        <p className="card__subtitle">
          The customer may resubmit valid proof to return to Payment Pending.
          Until then the slot stays blocked.
        </p>
        <ConfirmInline
          note="Release this booking? It is marked Cancelled and the slot becomes available to new customers."
          confirmLabel="Release booking"
          busy={busy}
          onConfirm={onRelease}
        />
      </section>
    )
  }

  return null
}

function ConfirmInline({
  note,
  confirmLabel,
  busy,
  onConfirm,
  onBack,
}: {
  note: string
  confirmLabel: string
  busy: boolean
  onConfirm: () => void
  onBack?: () => void
}) {
  return (
    <div className="conflict-inline">
      <p className="conflict-inline__note">{note}</p>
      <div className="conflict-actions">
        <Button
          variant="outline"
          className="btn--danger"
          loading={busy}
          disabled={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
        {onBack && (
          <Button variant="outline" onClick={onBack} disabled={busy}>
            Back
          </Button>
        )}
      </div>
    </div>
  )
}