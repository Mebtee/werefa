import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { Booking, ScheduleConflict } from '@/types/models'
import { mockOwnerApi } from '@/mock/ownerApi'
import { useOwnedBusiness } from '@/features/owner-portal/state/useOwnedBusiness'
import { LoadState } from '@/features/owner-portal/components/LoadState'
import { RescheduleForm } from '@/features/owner-portal/components/RescheduleForm'
import {
  BOOKING_STATE_CHIP,
  BOOKING_STATE_LABEL,
  PAYMENT_STATE_CHIP,
  PAYMENT_STATE_LABEL,
  TELEGRAM_NOTICE_LABEL,
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
  const { business, loading, error, reload } = useOwnedBusiness()
  const { bookingId } = useParams<{ bookingId: string }>()

  const [booking, setBooking] = useState<Booking | null>(null)
  const [missing, setMissing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<ConfirmMode>(null)
  const [busy, setBusy] = useState(false)
  const [rejection, setRejection] = useState('')
  const [rejectionError, setRejectionError] = useState<string | null>(null)
  const [openConflicts, setOpenConflicts] = useState<readonly ScheduleConflict[]>([])
  const [telegramConnected, setTelegramConnected] = useState<boolean | null>(null)

  const load = useCallback(async () => {
    if (!bookingId) return
    setMissing(false)
    setBooking(null)
    try {
      const loaded = await mockOwnerApi.getBooking(bookingId)
      setBooking(loaded)
      setOpenConflicts(await mockOwnerApi.getOpenConflictsForBooking(bookingId))
      setTelegramConnected(
        await mockOwnerApi.isCustomerTelegramConnected(loaded.customer.phone),
      )
    } catch {
      setMissing(true)
    }
  }, [bookingId])

  useEffect(() => {
    void load()
  }, [load])

  const onMutationSucceeded = async () => {
    setConfirming(null)
    setRejection('')
    await load()
  }

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true)
    setActionError(null)
    try {
      const result = await action()
      if (!result.ok) {
        setActionError(result.error ?? 'That could not be completed. Please try again.')
        return
      }
      await onMutationSucceeded()
    } catch {
      setActionError('Could not update this booking right now. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const toResult = (
    result: { ok: true; value: Booking } | { ok: false; error: string },
  ): { ok: boolean; error?: string } =>
    result.ok ? { ok: true } : { ok: false, error: result.error }

  const accept = () =>
    void run(async () => toResult(await mockOwnerApi.acceptBooking(booking!.id)))

  const reject = () => {
    if (!rejection.trim()) {
      setRejectionError('Please provide a reason for the rejection.')
      return
    }
    void run(async () => {
      const result = await mockOwnerApi.rejectBooking(booking!.id, rejection)
      return toResult(result)
    })
  }

  const cancelConfirmed = () =>
    void run(async () => toResult(await mockOwnerApi.cancelBooking(booking!.id)))

  const markNoShow = () =>
    void run(async () => toResult(await mockOwnerApi.markNoShowBooking(booking!.id)))

  const cancelPending = () =>
    void run(async () => toResult(await mockOwnerApi.cancelPaymentPendingBooking(booking!.id)))

  const releaseRejected = () =>
    void run(async () => toResult(await mockOwnerApi.releaseRejectedBooking(booking!.id)))

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

      {actionError && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert tone="danger">{actionError}</Alert>
        </div>
      )}

      <BookingActions
        booking={booking}
        busy={busy}
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
          <span
            className={`booking-chip ${PAYMENT_STATE_CHIP[booking.paymentState]}`}
          >
            {PAYMENT_STATE_LABEL[booking.paymentState]}
          </span>
        </p>
        <p className="card__subtitle">
          {booking.paymentState === 'pending' &&
            'Awaiting review of the submitted proof.'}
          {booking.paymentState === 'accepted' &&
            `Proof accepted — ${formatMoney(booking.deposit, business?.currency ?? 'ETB')} deposit locked in.`}
          {booking.paymentState === 'rejected' && 'Proof rejected by the owner.'}
        </p>
        <div className="proof-card">
          <div>
            <strong>{booking.proof.fileName}</strong>
            <span className="line-item__meta">
              {' '}
              ({formatBytes(booking.proof.sizeBytes)} · {booking.proof.mimeType})
            </span>
          </div>
          <span className="badge">Preview only — no download in this slice</span>
        </div>
        {booking.rejectionReason && (
          <div className="booking-rejection">
            <p className="booking-detail__label">Rejection reason</p>
            <p className="booking-value booking-rejection__text">
              {booking.rejectionReason}
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
            {openConflicts[0].reason}
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

      {booking.scheduleException && (
        <section
          className="card card--padded"
          aria-labelledby="exception-title"
        >
          <h2 className="card__title" id="exception-title">
            Schedule Exception
          </h2>
          <p className="card__subtitle">
            Approved by the owner when the schedule changed. The appointment
            stays as booked and the customer was not notified about the change.
          </p>
          <p className="booking-value">{booking.scheduleException.reason}</p>
          <p className="card__subtitle">
            Approved at {formatTimestamp(booking.scheduleException.at)}.
          </p>
        </section>
      )}

      <section className="card card--padded" aria-labelledby="telegram-title">
        <h2 className="card__title" id="telegram-title">
          Telegram
        </h2>
        <p className="booking-detail__row">
          <span className="booking-detail__label">Connection</span>
          <span
            className={
              telegramConnected
                ? 'telegram-state telegram-state--on'
                : 'telegram-state'
            }
          >
            {telegramConnected === null
              ? 'Checking…'
              : telegramConnected
                ? 'Connected'
                : 'Not connected'}
          </span>
        </p>
        {booking.telegramNotices.length > 0 ? (
          <ul className="telegram-notice-list">
            {booking.telegramNotices.map((notice) => (
              <li key={notice.id} className="telegram-notice">
                <strong>{TELEGRAM_NOTICE_LABEL[notice.type]}</strong>
                <span className="telegram-notice__meta">
                  {formatTimestamp(notice.createdAt)}
                </span>
                <span className="telegram-notice__message">{notice.message}</span>
                {notice.rejectionReason && (
                  <span className="telegram-notice__reason">
                    Reason: {notice.rejectionReason}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="card__subtitle">
            No Telegram notifications sent so far.
          </p>
        )}
      </section>

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
 */
function BookingActions({
  booking,
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
        {confirming === 'reschedule' && (
          <RescheduleForm
            booking={booking}
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