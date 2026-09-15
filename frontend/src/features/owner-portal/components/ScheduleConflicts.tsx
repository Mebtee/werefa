import { useEffect, useRef, useState } from 'react'
import type {
  Booking,
  ScheduleConflict,
} from '@/types/models'
import { mockOwnerApi } from '@/mock/ownerApi'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { formatDateLong } from '@/lib/time'
import { RescheduleForm } from '@/features/owner-portal/components/RescheduleForm'

interface ScheduleConflictsProps {
  conflicts: readonly ScheduleConflict[]
  /** Reload business + conflicts after a quick action succeeds. */
  onChanged: () => Promise<void>
}

/**
 * Affected-booking warning panel (REQ-092/093/099): each booking made
 * impossible by the current schedule is listed with its date/time and the
 * reason, and offers the quick actions Reschedule / Cancel / Keep Booking.
 */
export function ScheduleConflicts({ conflicts, onChanged }: ScheduleConflictsProps) {
  const [bookings, setBookings] = useState<Record<string, Booking>>({})

  useEffect(() => {
    let cancelled = false
    void Promise.all(
      conflicts.map((conflict) => mockOwnerApi.getBooking(conflict.bookingId)),
    )
      .then((list) => {
        if (cancelled) return
        setBookings(Object.fromEntries(list.map((booking) => [booking.id, booking])))
      })
      .catch(() => {
        // A booking that disappeared between save and render is simply skipped.
      })
    return () => {
      cancelled = true
    }
  }, [conflicts])

  const open = conflicts.filter((conflict) => conflict.status === 'open')

  if (open.length === 0) return null

  return (
    <section
      className="card card--padded conflict-panel"
      aria-labelledby="conflicts-title"
    >
      <h2 className="card__title" id="conflicts-title">
        Affected bookings
      </h2>
      <p className="card__subtitle">
        This schedule change conflicts with {open.length}{' '}
        {open.length === 1 ? 'existing booking' : 'existing bookings'}. They were
        not changed — decide how to handle each one.
      </p>

      <ul className="conflict-list">
        {open.map((conflict) => {
          const booking = bookings[conflict.bookingId]
          if (!booking) return null
          return (
            <li key={conflict.id} className="conflict-row">
              <ConflictRow booking={booking} conflict={conflict} onChanged={onChanged} />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function ConflictRow({
  booking,
  conflict,
  onChanged,
}: {
  booking: Booking
  conflict: ScheduleConflict
  onChanged: () => Promise<void>
}) {
  const [mode, setMode] = useState<'view' | 'reschedule' | 'cancel' | 'keep'>('view')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const keepRef = useRef<HTMLTextAreaElement>(null)

  const reset = (next: typeof mode) => {
    setError(null)
    setMode(next)
  }

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true)
    setError(null)
    try {
      const result = await action()
      if (!result.ok) {
        setError(result.error ?? 'That could not be completed. Please try again.')
        return
      }
      reset('view')
      await onChanged()
    } catch {
      setError('That could not be completed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const applyKeep = () =>
    void run(async () => {
      const reason = keepRef.current?.value ?? ''
      const result = await mockOwnerApi.keepBooking(booking.id, reason)
      return result.ok ? { ok: true } : { ok: false, error: result.error }
    })

  const applyCancel = () =>
    void run(async () => {
      const result = await mockOwnerApi.cancelBooking(booking.id)
      return result.ok ? { ok: true } : { ok: false, error: result.error }
    })

  return (
    <>
      <div className="conflict-row__head">
        <strong>{booking.customer.name}</strong>
        <span className="booking-card__meta">{booking.customer.phone}</span>
        {booking.scheduleException && (
          <span className="badge conflict-row__exception">Schedule Exception</span>
        )}
      </div>
      <p className="conflict-row__when">
        {formatDateLong(booking.date)} at {booking.time} ·{' '}
        {booking.totalDurationMinutes} minutes · {booking.lineItems.length}{' '}
        {booking.lineItems.length === 1 ? 'service' : 'services'}
      </p>
      <p className="conflict-row__reason">{conflict.reason}</p>

      {mode === 'view' && (
        <div className="conflict-actions">
          <Button
            variant="outline"
            onClick={() => reset('reschedule')}
            disabled={busy}
          >
            Reschedule
          </Button>
          <Button
            variant="outline"
            onClick={() => reset('cancel')}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button variant="outline" onClick={() => reset('keep')} disabled={busy}>
            Keep Booking
          </Button>
        </div>
      )}

      {mode === 'reschedule' && (
        <RescheduleForm
          booking={booking}
          onDone={() => {
            reset('view')
            return onChanged()
          }}
          onBack={() => reset('view')}
        />
      )}

      {mode === 'cancel' && (
        <div className="conflict-inline">
          <p className="conflict-inline__note">
            Cancel this booking? The slot is released and the customer is
            notified.
          </p>
          <div className="conflict-actions">
            <Button
              variant="outline"
              className="btn--danger"
              loading={busy}
              onClick={applyCancel}
            >
              Confirm cancellation
            </Button>
            <Button variant="outline" onClick={() => reset('view')} disabled={busy}>
              Back
            </Button>
          </div>
        </div>
      )}

      {mode === 'keep' && (
        <div className="conflict-inline">
          <Field
            label="Reason / details (optional)"
            hint="Shown as the Schedule Exception details on this booking."
          >
            {({ id, ariaDescribedBy }) => (
              <textarea
                id={id}
                ref={keepRef}
                className="textarea conflict-keep-reason"
                rows={2}
                aria-describedby={ariaDescribedBy}
                placeholder="e.g. Customer confirmed over the phone to keep the original time."
              />
            )}
          </Field>
          <div className="conflict-actions">
            <Button variant="primary" loading={busy} onClick={applyKeep}>
              Keep this booking
            </Button>
            <Button variant="outline" onClick={() => reset('view')} disabled={busy}>
              Back
            </Button>
          </div>
        </div>
      )}

      {error && <p className="field__error conflict-row__error">{error}</p>}
    </>
  )
}