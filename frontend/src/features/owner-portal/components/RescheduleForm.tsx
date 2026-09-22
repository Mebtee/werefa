import { useState } from 'react'
import type { Booking, DateString, TimeOfDay } from '@/types/models'
import { toUserMessage } from '@/api/errors'
import {
  getOwnerBookingAvailableTimes,
  rescheduleOwnerBooking,
} from '@/api/ownerBookings'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'

/**
 * Reschedule picker (REQ-105/106): a new date + a still-free time for a
 * Confirmed booking. Only free+fitting slots are offered (REQ-106 hard gate);
 * the target slot must be available for the booking to move. The booking keeps
 * its identity, payment state and proof; Confirmed stays Confirmed (T7).
 *
 * The dates/times are serialized as UTC instants back to the API so the
 * round-trip is independent of the machine timezone.
 */
export function RescheduleForm({
  booking,
  businessId,
  onDone,
  onBack,
}: {
  booking: Pick<Booking, 'id' | 'totalDurationMinutes'>
  businessId: string
  onDone: () => Promise<void>
  onBack: () => void
}) {
  const [date, setDate] = useState<DateString>('')
  const [time, setTime] = useState<TimeOfDay>('')
  const [times, setTimes] = useState<readonly TimeOfDay[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const today = new Date()
  const todayValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  const chooseDate = async (value: string) => {
    setDate(value)
    setTime('')
    setTimes([])
    setError(null)
    if (!value) return
    try {
      const availability = await getOwnerBookingAvailableTimes(
        businessId,
        booking.id,
        value,
      )
      setTimes(availability.slots.map((slot) => `${slot.startAt.slice(11, 16)}`))
    } catch (err) {
      setError(toUserMessage(err))
    }
  }

  const apply = async () => {
    if (!date || !time) {
      setError('Pick a date and a free time to move the booking to.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await rescheduleOwnerBooking(businessId, booking.id, `${date}T${time}:00.000Z`)
      await onDone()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="reschedule-form">
      <div className="reschedule-form__row">
        <Field label="New date">
          {({ id, ariaDescribedBy }) => (
            <input
              id={id}
              className="input"
              type="date"
              min={todayValue}
              aria-describedby={ariaDescribedBy}
              value={date}
              onChange={(event) => void chooseDate(event.target.value)}
            />
          )}
        </Field>
        <Field
          label="New time"
          hint={times.length === 0 ? 'Pick a date first.' : undefined}
        >
          {({ id, ariaDescribedBy }) => (
            <select
              id={id}
              className="select"
              aria-describedby={ariaDescribedBy}
              value={time}
              disabled={times.length === 0}
              onChange={(event) => setTime(event.target.value)}
            >
              <option value="">Select a time</option>
              {times.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {error && <p className="field__error">{error}</p>}
      <div className="conflict-actions">
        <Button
          variant="primary"
          loading={busy}
          onClick={() => void apply()}
          disabled={!date || !time}
        >
          Confirm reschedule
        </Button>
        <Button variant="outline" onClick={onBack} disabled={busy}>
          Back
        </Button>
      </div>
    </div>
  )
}