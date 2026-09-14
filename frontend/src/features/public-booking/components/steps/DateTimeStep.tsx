import { useEffect, useState } from 'react'
import type { BusinessDetails, DateString, TimeOfDay } from '@/types/models'
import { weekdayLabel } from '@/lib/time'
import { mockApi } from '@/mock/api'
import type { BookingDate } from '@/mock/availability'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'

interface DateTimeStepProps {
  business: BusinessDetails
  durationMinutes: number
  date: DateString | null
  time: TimeOfDay | null
  selectDate: (date: DateString) => void
  selectTime: (time: TimeOfDay | null) => void
  onBack: () => void
  onNext: () => void
}

interface DateTimeState {
  dates: readonly BookingDate[] | null
  slots: readonly TimeOfDay[] | null
  datesError: boolean
  slotsError: boolean
  retryToken: number
  clearedReason: boolean
}

export function DateTimeStep({
  business,
  durationMinutes,
  date,
  time,
  selectDate,
  selectTime,
  onBack,
  onNext,
}: DateTimeStepProps) {
  const [state, setState] = useState<DateTimeState>({
    dates: null,
    slots: null,
    datesError: false,
    slotsError: false,
    retryToken: 0,
    clearedReason: false,
  })

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, dates: null, datesError: false }))
    mockApi
      .getBookingDates(business, durationMinutes)
      .then((dates) => {
        if (!cancelled) setState((s) => ({ ...s, dates, datesError: false }))
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ ...s, datesError: true }))
      })
    return () => {
      cancelled = true
    }
  }, [business, durationMinutes, state.retryToken])

  useEffect(() => {
    if (!date) {
      setState((s) => ({ ...s, slots: null, slotsError: false, clearedReason: false }))
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, slots: null, slotsError: false }))
    mockApi
      .getSlotTimes(business, date, durationMinutes)
      .then((slots) => {
        if (!cancelled) setState((s) => ({ ...s, slots, slotsError: false }))
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ ...s, slotsError: true }))
      })
    return () => {
      cancelled = true
    }
  }, [business, date, durationMinutes, state.retryToken])

  // If the previously picked time no longer fits the new selection (e.g. after
  // going back and changing services), clear it instead of letting the user
  // continue with an invalid time.
  useEffect(() => {
    if (state.slots && time && !state.slots.includes(time)) {
      setState((s) => ({ ...s, clearedReason: true }))
      selectTime(null)
    }
  }, [state.slots, time, selectTime])

  const retry = () => setState((s) => ({ ...s, retryToken: s.retryToken + 1 }))

  const timeValid =
    date !== null && time !== null && state.slots !== null && state.slots.includes(time)

  return (
    <>
      <h2 className="step-title">Pick a date and time</h2>
      <p className="step-subtitle">
        Your booking needs {durationMinutes} minutes in total.
      </p>

      <Alert tone="info">
        Times shown may already be taken by other customers. Nothing is reserved
        until the business confirms your booking.
      </Alert>

      <h3 className="option-group__title" style={{ marginTop: 'var(--space-4)' }}>
        Date
      </h3>
      {state.datesError ? (
        <Alert tone="danger" title="Could not load the date list">
          <Button variant="outline" onClick={retry}>
            Try again
          </Button>
        </Alert>
      ) : state.dates === null ? (
        <Spinner label="Loading available dates" />
      ) : (
        <div className="date-strip" role="list">
          {state.dates.map((entry) => {
            const isSelected = entry.date === date
            return (
              <button
                key={entry.date}
                type="button"
                className="chip date-chip"
                role="listitem"
                aria-pressed={isSelected}
                disabled={!entry.hasTimes}
                onClick={() => selectDate(entry.date)}
              >
                <span className="date-chip__weekday">
                  {weekdayLabel(entry.date)}
                </span>
                <span className="date-chip__date">{entry.date}</span>
              </button>
            )
          })}
        </div>
      )}

      {state.clearedReason && (
        <Alert tone="warning">
          Your previously chosen time is no longer available for this selection.
          Please pick again.
        </Alert>
      )}

      {date && (
        <>
          <h3 className="option-group__title" style={{ marginTop: 'var(--space-4)' }}>
            Available times on {date}
          </h3>
          {state.slotsError ? (
            <Alert tone="danger" title="Could not load the times">
              <Button variant="outline" onClick={retry}>
                Try again
              </Button>
            </Alert>
          ) : state.slots === null ? (
            <Spinner label="Loading available times" />
          ) : state.slots.length === 0 ? (
            <Alert tone="info">
              No available times on this date for your current selection. Try
              another date.
            </Alert>
          ) : (
            <>
              <ul className="time-grid">
                {state.slots.map((slot) => (
                  <li key={slot} className="time-grid__item">
                    <button
                      type="button"
                      className="chip"
                      aria-pressed={slot === time}
                      onClick={() => selectTime(slot)}
                    >
                      {slot}
                    </button>
                  </li>
                ))}
              </ul>
              <Alert tone="info">
                Times are shown in 24-hour format. If a time fits your total
                duration it is included above; anything else is already booked
                or blocked.
              </Alert>
            </>
          )}
        </>
      )}

      {!timeValid && (
        <p className="field__hint" style={{ marginTop: 'var(--space-4)' }}>
          Pick an available date and time to continue.
        </p>
      )}

      <nav className="wizard__nav" aria-label="Date and time step actions">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" disabled={!timeValid} onClick={onNext}>
          Continue
        </Button>
      </nav>
    </>
  )
}