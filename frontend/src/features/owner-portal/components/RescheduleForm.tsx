import { useState } from 'react'
import type { Booking, DateString, TimeOfDay } from '@/types/models'
import { mockOwnerApi } from '@/mock/ownerApi'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'

/**
 * Reschedule picker (REQ-105/106): a new date + a still-free time for a
 * Confirmed booking. Only free+fitting slots are offered (REQ-106 hard gate);
 * the target slot must be available for the booking to move. The booking keeps
 * its identity, payment state and proof; Confirmed stays Confirmed (T7).
 */
export function RescheduleForm({
  booking,
  onDone,
  onBack,
}: {
  booking: Pick<Booking, 'id' | 'totalDurationMinutes'>
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
    const result = await mockOwnerApi.listAvailableTimesFor(
      value,
      booking.totalDurationMinutes,
    )
    if (result.ok) setTimes(result.value)
    else setError(result.error)
  }

  const apply = async () => {
    if (!date || !time) {
      setError('Pick a date and a free time to move the booking to.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await mockOwnerApi.rescheduleBooking(booking.id, date, time)
      if (!result.ok) {
        setError(result.error)
        return
      }
      await onDone()
    } catch {
      setError('That could not be completed. Please try again.')
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