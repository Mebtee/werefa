import { useEffect, useRef, useState } from 'react'
import type { SpecialDay, TimeOfDay } from '@/types/models'
import { useOwnedBusiness } from '@/features/owner-portal/state/useOwnedBusiness'
import { LoadState } from '@/features/owner-portal/components/LoadState'
import { mockOwnerApi } from '@/mock/ownerApi'
import { WEEKDAY_NAMES } from '@/features/owner-portal/lib/labels'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'

interface PeriodRow {
  start: TimeOfDay
  end: TimeOfDay
}

interface SpecialDayEntry {
  date: string
  kind: 'closed' | 'hours'
  start: TimeOfDay
  end: TimeOfDay
}

interface ScheduleForm {
  hours: PeriodRow[][]
  interval: string
  specialDays: SpecialDayEntry[]
}

const INTERVAL_OPTIONS = [15, 20, 30, 45, 60]

function fromBusiness(business: {
  workingHours: readonly (readonly { start: TimeOfDay; end: TimeOfDay }[])[]
  bookingIntervalMinutes: number
  specialDays: Readonly<Record<string, SpecialDay>>
}): ScheduleForm {
  return {
    hours: business.workingHours.map((day) =>
      day.map((period) => ({ start: period.start, end: period.end })),
    ),
    interval: String(business.bookingIntervalMinutes),
    specialDays: Object.entries(business.specialDays).map(([date, special]) =>
      special.kind === 'closed'
        ? { date, kind: 'closed', start: '', end: '' }
        : {
            date,
            kind: 'hours',
            start: special.periods[0]?.start ?? '09:00',
            end: special.periods[0]?.end ?? '17:00',
          },
    ),
  }
}

interface HourErrors {
  periods: (string | null)[]
  interval?: string
}

export function SchedulePage() {
  const { business, loading, error, reload } = useOwnedBusiness()
  const initialized = useRef(false)

  const [form, setForm] = useState<ScheduleForm | null>(null)
  const [saved, setSaved] = useState<ScheduleForm | null>(null)
  const [errors, setErrors] = useState<HourErrors>({ periods: [] })
  const [specialError, setSpecialError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    if (initialized.current || !business) return
    initialized.current = true
    const initial = fromBusiness(business)
    setForm(initial)
    setSaved(initial)
  }, [business])

  if (!business || !form || !saved) {
    return (
      <LoadState loading={loading || form === null} error={error} onRetry={reload}>
        {null}
      </LoadState>
    )
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(saved)

  const setPeriodField = (
    dayIndex: number,
    periodIndex: number,
    key: 'start' | 'end',
    value: TimeOfDay,
  ) => {
    setSaveSuccess(false)
    setForm((current) => {
      if (!current) return current
      const hours = current.hours.map((day, di) =>
        di === dayIndex
          ? day.map((period, pi) =>
              pi === periodIndex ? { ...period, [key]: value } : period,
            )
          : day,
      )
      return { ...current, hours }
    })
  }

  const addPeriod = (dayIndex: number) => {
    setForm((current) => {
      if (!current) return current
      const hours = current.hours.map((day, di) =>
        di === dayIndex ? [...day, { start: '09:00', end: '12:00' } as PeriodRow] : day,
      )
      return { ...current, hours }
    })
  }

  const removePeriod = (dayIndex: number, periodIndex: number) => {
    setForm((current) => {
      if (!current) return current
      const hours = current.hours.map((day, di) =>
        di === dayIndex ? day.filter((_, pi) => pi !== periodIndex) : day,
      )
      return { ...current, hours }
    })
  }

  const toggleDay = (dayIndex: number) => {
    setForm((current) => {
      if (!current) return current
      const isOpen = current.hours[dayIndex].length > 0
      const hours = current.hours.map((day, di) =>
        di === dayIndex ? (isOpen ? [] : [{ start: '09:00', end: '17:00' } as PeriodRow]) : day,
      )
      return { ...current, hours }
    })
  }

  const updateSpecial = (index: number, patch: Partial<SpecialDayEntry>) => {
    setSpecialError(null)
    setSaveSuccess(false)
    setForm((current) => {
      if (!current) return current
      const specialDays = current.specialDays.map((entry, i) =>
        i === index ? { ...entry, ...patch } : entry,
      )
      return { ...current, specialDays }
    })
  }

  const removeSpecial = (index: number) => {
    setForm((current) => {
      if (!current) return current
      return {
        ...current,
        specialDays: current.specialDays.filter((_, i) => i !== index),
      }
    })
  }

  const addSpecial = () => {
    if (!form.specialDays.some((entry) => entry.date === '')) {
      setForm({
        ...form,
        specialDays: [...form.specialDays, { date: '', kind: 'hours', start: '09:00', end: '17:00' }],
      })
    }
  }

  const validateHours = (): HourErrors => {
    const next: HourErrors = { periods: [] }
    next.periods = form.hours.map((day) => {
      for (const period of day) {
        if (!period.start || !period.end) {
          return 'Enter both a start and an end time.'
        }
        if (period.start >= period.end) {
          return 'The end time must be after the start time.'
        }
      }
      return null
    })
    if (!INTERVAL_OPTIONS.includes(Number(form.interval))) {
      next.interval = 'Pick a booking interval from the list.'
    }
    return next
  }

  const save = async () => {
    const nextErrors = validateHours()
    const specialProblem = (() => {
      for (const entry of form.specialDays) {
        if (!entry.date) return 'Every special day needs a date.'
        if (entry.kind === 'hours' && (!entry.start || entry.end <= entry.start)) {
          return 'Special opening hours need an end time after the start.'
        }
      }
      return null
    })()
    setErrors(nextErrors)
    setSpecialError(specialProblem)
    if (
      nextErrors.periods.some(Boolean) ||
      nextErrors.interval ||
      specialProblem
    ) {
      return
    }
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)
    try {
      const specialDays: Record<string, SpecialDay> = {}
      for (const entry of form.specialDays) {
        specialDays[entry.date] =
          entry.kind === 'closed'
            ? { kind: 'closed' }
            : { kind: 'hours', periods: [{ start: entry.start, end: entry.end }] }
      }
      const rows = await Promise.all([
        mockOwnerApi.saveWorkingHours(form.hours),
        mockOwnerApi.saveBookingInterval(Number(form.interval)),
        mockOwnerApi.saveSpecialDays(specialDays),
      ])
      const failed = rows.find((row) => !row.ok)
      if (failed && !failed.ok) {
        setSaveError(failed.error)
        return
      }
      setSaved({ ...form })
      setSaveSuccess(true)
      await reload()
    } catch {
      setSaveError('Could not save the schedule. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    if (saved) setForm({ ...saved, specialDays: saved.specialDays.map((e) => ({ ...e })) })
    setErrors({ periods: [] })
    setSpecialError(null)
    setSaveError(null)
    setSaveSuccess(false)
  }

  return (
    <>
      <h1 className="page-title">Working hours</h1>
      <p className="page-subtitle">
        These hours decide which times customers can book. Closed days and
        special dates override the week.
      </p>

      {saveError && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert tone="danger">{saveError}</Alert>
        </div>
      )}
      {saveSuccess && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert tone="success" live="polite">
            Schedule saved. Your public page now offers times from the new
            hours.
          </Alert>
        </div>
      )}
      {dirty && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert tone="warning" title="Unsaved changes">
            You have unsaved changes to your schedule.
          </Alert>
        </div>
      )}

      <form
        className="card card--padded"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="hours-editor">
          <h2 className="card__title">Weekly hours</h2>
          <ul className="hours-days">
            {form.hours.map((day, dayIndex) => {
              const isOpen = day.length > 0
              return (
                <li key={WEEKDAY_NAMES[dayIndex]} className="hours-day">
                  <div className="hours-day__head">
                    <strong className="hours-day__label">
                      {WEEKDAY_NAMES[dayIndex]}
                    </strong>
                    <Button
                      type="button"
                      variant="outline"
                      aria-pressed={isOpen}
                      onClick={() => toggleDay(dayIndex)}
                      className="hours-day__toggle"
                    >
                      {isOpen ? 'Open' : 'Closed'}
                    </Button>
                  </div>
                  {isOpen ? (
                    <div className="hours-day__periods">
                      {day.map((period, periodIndex) => (
                        <div key={`${dayIndex}-${periodIndex}`} className="hours-period">
                          <input
                            className="input hours-period__input"
                            type="time"
                            aria-label={`${WEEKDAY_NAMES[dayIndex]} period ${periodIndex + 1} start`}
                            value={period.start}
                            onChange={(event) =>
                              setPeriodField(dayIndex, periodIndex, 'start', event.target.value)
                            }
                          />
                          <span className="hours-period__to" aria-hidden="true">
                            to
                          </span>
                          <input
                            className="input hours-period__input"
                            type="time"
                            aria-label={`${WEEKDAY_NAMES[dayIndex]} period ${periodIndex + 1} end`}
                            value={period.end}
                            onChange={(event) =>
                              setPeriodField(dayIndex, periodIndex, 'end', event.target.value)
                            }
                          />
                          {day.length > 1 && (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => removePeriod(dayIndex, periodIndex)}
                            >
                              Remove
                            </Button>
                          )}
                        </div>
                      ))}
                      {errors.periods[dayIndex] && (
                        <p className="field__error">{errors.periods[dayIndex]}</p>
                      )}
                      <Button type="button" variant="outline" onClick={() => addPeriod(dayIndex)}>
                        Add period
                      </Button>
                    </div>
                  ) : (
                    <p className="hours-day__closed">Closed to bookings.</p>
                  )}
                </li>
              )
            })}
          </ul>
        </div>

        <div className="subsection">
          <Field
            label="Booking interval"
            hint="How often new slots start during opening hours."
            error={errors.interval}
          >
            {({ id, ariaDescribedBy }) => (
              <select
                id={id}
                className="select"
                value={form.interval}
                aria-describedby={ariaDescribedBy}
                onChange={(event) => {
                  setSaveSuccess(false)
                  setForm({ ...form, interval: event.target.value })
                }}
              >
                {INTERVAL_OPTIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    Every {minutes} minutes
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <fieldset className="subsection">
          <legend className="subsection__legend">
            Special dates{' '}
            <span className="subsection__hint">one-off closed or shortened days</span>
          </legend>
          {form.specialDays.length === 0 && (
            <p className="subsection__empty">No special dates set.</p>
          )}
          <ul className="special-day-list">
            {form.specialDays.map((entry, index) => (
              <li key={`${entry.date}-${index}`} className="special-day">
                <input
                  className="input special-day__date"
                  type="date"
                  aria-label={`Special date ${index + 1}`}
                  value={entry.date}
                  onChange={(event) => updateSpecial(index, { date: event.target.value })}
                />
                <label className="special-day__choice">
                  <input
                    type="radio"
                    name={`special-kind-${index}`}
                    value="closed"
                    checked={entry.kind === 'closed'}
                    onChange={() => updateSpecial(index, { kind: 'closed' })}
                  />
                  Closed
                </label>
                <label className="special-day__choice">
                  <input
                    type="radio"
                    name={`special-kind-${index}`}
                    value="hours"
                    checked={entry.kind === 'hours'}
                    onChange={() => updateSpecial(index, { kind: 'hours' })}
                  />
                  Special hours
                </label>
                {entry.kind === 'hours' && (
                  <>
                    <input
                      className="input special-day__time"
                      type="time"
                      aria-label={`Special date ${index + 1} start`}
                      value={entry.start}
                      onChange={(event) => updateSpecial(index, { start: event.target.value })}
                    />
                    <span aria-hidden="true">to</span>
                    <input
                      className="input special-day__time"
                      type="time"
                      aria-label={`Special date ${index + 1} end`}
                      value={entry.end}
                      onChange={(event) => updateSpecial(index, { end: event.target.value })}
                    />
                  </>
                )}
                <Button type="button" variant="outline" onClick={() => removeSpecial(index)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          {specialError && <p className="field__error">{specialError}</p>}
          <Button type="button" variant="outline" onClick={addSpecial}>
            Add special date
          </Button>
        </fieldset>

        <div className="form-actions">
          <Button variant="primary" type="submit" loading={saving}>
            Save schedule
          </Button>
          <Button
            variant="outline"
            type="button"
            onClick={discard}
            disabled={!dirty || saving}
          >
            Discard changes
          </Button>
        </div>
      </form>

      {(business.blockedDays.length > 0 || business.blockedPeriods.length > 0) && (
        <div className="card card--padded" style={{ marginTop: 'var(--space-4)' }}>
          <h2 className="card__title">Blocked dates</h2>
          <p className="card__subtitle">
            These blocks currently restrict availability. Managing them is part
            of a later slice; they are shown here for reference.
          </p>
          <ul className="readonly-blocked">
            {business.blockedDays.map((date) => (
              <li key={date}>Closed all day — {date}</li>
            ))}
            {business.blockedPeriods.map((period) => (
              <li key={`${period.date}-${period.start}`}>
                Blocked {period.start}–{period.end} on {period.date}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}