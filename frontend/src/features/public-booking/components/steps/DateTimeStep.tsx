import { useEffect, useMemo, useState } from 'react'
import type { BusinessDetails, DateString, ServiceSelection, TimeOfDay } from '@/types/models'
import { nextDateStrings, weekdayLabel } from '@/lib/time'
import { getPublicAvailability } from '@/api/availability'
import {
  bookingDatesFromViews,
  slotTimesFromView,
  type BookingDate,
} from '@/api/availability.mapper'
import type { PublicAvailabilityView } from '@/api/types'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { CalendarIcon, InfoIcon } from '@/components/ui/icons'

interface DateTimeStepProps {
  business: BusinessDetails
  durationMinutes: number
  selections: readonly ServiceSelection[]
  date: DateString | null
  time: TimeOfDay | null
  selectDate: (date: DateString) => void
  selectTime: (time: TimeOfDay | null) => void
  onBack: () => void
  onNext: () => void
  /** Reports the backend-computed deposit for the current selection (REQ-110/111). */
  onDeposit?: (depositMinor: number) => void
}

interface DateTimeState {
  dates: readonly BookingDate[] | null
  slots: readonly TimeOfDay[] | null
  datesError: boolean
  slotsError: boolean
  retryToken: number
  clearedReason: boolean
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

/**
 * Splits an already-resolved `YYYY-MM-DD` string for display only. Pure string
 * work — never `new Date(...)`, which would re-interpret the calendar date in
 * the browser's own timezone and can shift the day (REQ-165).
 */
function partsOf(date: DateString): { day: string; month: string } {
  return {
    day: date.slice(8, 10),
    month: MONTHS[Number(date.slice(5, 7)) - 1] ?? '',
  }
}

/**
 * Step 2 — date and time.
 *
 * Availability is whatever the real public availability endpoint returns: one
 * call per window date to build the date strip, one call for the chosen date to
 * list its slots, and the backend's own `requiredPrepaidMinor` reported upwards
 * for the deposit. Dates with no bookable time are rendered disabled rather than
 * hidden, times are listed in 24-hour form (REQ-224/225), and nothing is
 * presented as reserved — the copy says so explicitly.
 */
export function DateTimeStep({
  business,
  durationMinutes,
  selections,
  date,
  time,
  selectDate,
  selectTime,
  onBack,
  onNext,
  onDeposit,
}: DateTimeStepProps) {
  const [state, setState] = useState<DateTimeState>({
    dates: null,
    slots: null,
    datesError: false,
    slotsError: false,
    retryToken: 0,
    clearedReason: false,
  })

  // Wire selections match the backend body exactly (v1: no client duration —
  // the API computes the appointment's duration/price itself, REQ-074).
  const wireSelections = useMemo(
    () =>
      selections.map((s) => ({
        serviceId: s.serviceId,
        variationId: s.variationId ?? undefined,
        addOnIds: s.addOnIds.length > 0 ? [...s.addOnIds] : undefined,
      })),
    [selections],
  )

  // The date strip comes from one availability call per window date (parallel).
  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, dates: null, datesError: false }))
    const dates = nextDateStrings(business.bookingWindowDays ?? 14)
    Promise.allSettled(
      dates.map((date) =>
        getPublicAvailability(business.slug, { date, selections: wireSelections }),
      ),
    ).then((results) => {
      if (cancelled) return
      if (results.some((r) => r.status === 'rejected')) {
        setState((s) => ({ ...s, datesError: true }))
        return
      }
      const views = results.map(
        (r) => (r as PromiseFulfilledResult<PublicAvailabilityView>).value,
      )
      setState((s) => ({ ...s, dates: bookingDatesFromViews(views), datesError: false }))
      if (views.length > 0) onDeposit?.(views[0].requiredPrepaidMinor)
    })
    return () => {
      cancelled = true
    }
  }, [business, wireSelections, state.retryToken, onDeposit])

  useEffect(() => {
    if (!date) {
      setState((s) => ({ ...s, slots: null, slotsError: false, clearedReason: false }))
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, slots: null, slotsError: false }))
    getPublicAvailability(business.slug, { date, selections: wireSelections })
      .then((view) => {
        if (!cancelled) {
          setState((s) => ({ ...s, slots: [...slotTimesFromView(view)], slotsError: false }))
          onDeposit?.(view.requiredPrepaidMinor)
        }
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ ...s, slotsError: true }))
      })
    return () => {
      cancelled = true
    }
  }, [business, date, wireSelections, state.retryToken, onDeposit])

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
        Your booking needs {durationMinutes} minutes in total. Times are in
        24-hour format and nothing is reserved until the business confirms.
      </p>

      <section className="step-section" aria-labelledby="dates-title">
        <h3 className="option-group__title" id="dates-title">
          <CalendarIcon
            size={16}
            style={{ display: 'inline', verticalAlign: '-2px' }}
          />{' '}
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
              const { day, month } = partsOf(entry.date)
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
                  <span className="date-chip__day">{day}</span>
                  <span className="date-chip__month">{month}</span>
                  <span className="date-chip__date">{entry.date}</span>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {state.clearedReason && (
        <Alert tone="warning" title="Please choose a time again">
          Your previously chosen time is no longer available for this selection.
        </Alert>
      )}

      {date && (
        <section className="step-section" aria-labelledby="times-title">
          <h3 className="option-group__title" id="times-title">
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
              <p className="field__hint">
                <InfoIcon
                  size={15}
                  style={{ display: 'inline', verticalAlign: '-2px' }}
                />{' '}
                Times that fit your total duration are listed here. Anything
                missing is already booked or blocked.
              </p>
            </>
          )}
        </section>
      )}

      {!timeValid && (
        <p className="field__hint" style={{ marginTop: 'var(--cs-5)' }}>
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