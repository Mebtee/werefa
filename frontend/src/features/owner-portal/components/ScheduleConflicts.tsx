import { useState } from 'react'
import type { ScheduleConflictItem } from '@/api/schedule.mapper'
import { recordScheduleException } from '@/api/schedule'
import { cancelOwnerBooking } from '@/api/ownerBookings'
import { toUserMessage } from '@/api/errors'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { formatDateTime } from '@/lib/time'
import { RescheduleForm } from '@/features/owner-portal/components/RescheduleForm'

interface ScheduleConflictsProps {
  conflicts: readonly ScheduleConflictItem[]
  businessId: string
  /** The currently-active schedule version — target for Keep Booking exceptions (REQ-160). */
  versionId: string | null
  /** Reload business + conflicts after a quick action succeeds. */
  onChanged: () => Promise<void>
}

function totalDuration(conflict: ScheduleConflictItem): number {
  return conflict.services.reduce((sum, service) => sum + service.durationMinutes, 0)
}

/**
 * Affected-booking warning panel (REQ-092/093/099). The conflict list comes
 * straight from the real schedule API with the booking details embedded
 * (Prompt 47), so no booking lookup is needed to render a row. The quick
 * actions all go through the real owner endpoints: Keep Booking records a real
 * schedule exception, Cancel and Reschedule run the real lifecycle (Prompt 49/51).
 */
export function ScheduleConflicts({
  conflicts,
  businessId,
  versionId,
  onChanged,
}: ScheduleConflictsProps) {
  if (conflicts.length === 0) return null

  return (
    <section
      className="card card--padded conflict-panel"
      aria-labelledby="conflicts-title"
    >
      <h2 className="card__title" id="conflicts-title">
        Affected bookings
      </h2>
      <p className="card__subtitle">
        This schedule change conflicts with {conflicts.length}{' '}
        {conflicts.length === 1 ? 'existing booking' : 'existing bookings'}. They
        were not changed — decide how to handle each one.
      </p>

      <ul className="conflict-list">
        {conflicts.map((conflict) => (
          <li key={conflict.bookingId} className="conflict-row">
            <ConflictRow
              conflict={conflict}
              businessId={businessId}
              versionId={versionId}
              onChanged={onChanged}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

function ConflictRow({
  conflict,
  businessId,
  versionId,
  onChanged,
}: {
  conflict: ScheduleConflictItem
  businessId: string
  versionId: string | null
  onChanged: () => Promise<void>
}) {
  const [mode, setMode] = useState<'view' | 'reschedule' | 'cancel' | 'keep'>('view')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keepReason, setKeepReason] = useState('')

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
      setKeepReason('')
      reset('view')
      await onChanged()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const applyKeep = () =>
    void run(async () => {
      if (!versionId) {
        return { ok: false, error: 'No active schedule version to keep against.' }
      }
      await recordScheduleException(businessId, {
        bookingId: conflict.bookingId,
        versionId,
        ...(keepReason.trim() ? { reason: keepReason.trim() } : {}),
      })
      return { ok: true }
    })

  const applyCancel = () =>
    void run(async () => {
      await cancelOwnerBooking(businessId, conflict.bookingId)
      return { ok: true }
    })

  const serviceCount = conflict.services.length

  return (
    <>
      <div className="conflict-row__head">
        <strong>{conflict.customerName}</strong>
        <span className="booking-card__meta">{conflict.customerPhone}</span>
      </div>
      <p className="conflict-row__when">
        {formatDateTime(conflict.startAt)} · {totalDuration(conflict)} minutes ·{' '}
        {serviceCount} {serviceCount === 1 ? 'service' : 'services'}
      </p>
      <p className="conflict-row__reason">{conflict.reasonDetail}</p>

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
          booking={{
            id: conflict.bookingId,
            totalDurationMinutes: totalDuration(conflict),
          }}
          businessId={businessId}
          onDone={() => {
            setKeepReason('')
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
                className="textarea conflict-keep-reason"
                rows={2}
                aria-describedby={ariaDescribedBy}
                placeholder="e.g. Customer confirmed over the phone to keep the original time."
                value={keepReason}
                onChange={(event) => setKeepReason(event.target.value)}
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