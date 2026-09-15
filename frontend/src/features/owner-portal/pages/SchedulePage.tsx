import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ScheduleConflict,
  ScheduleSnapshot,
  ScheduleVersion,
  SpecialDay,
  TimeOfDay,
} from '@/types/models'
import { useOwnedBusiness } from '@/features/owner-portal/state/useOwnedBusiness'
import { LoadState } from '@/features/owner-portal/components/LoadState'
import { ScheduleConflicts } from '@/features/owner-portal/components/ScheduleConflicts'
import { ScheduleHistory } from '@/features/owner-portal/components/ScheduleHistory'
import { mockOwnerApi } from '@/mock/ownerApi'
import { WEEKDAY_NAMES } from '@/features/owner-portal/lib/labels'
import { firstOverlap } from '@/lib/periods'
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
  periods: PeriodRow[]
}

interface BlockedPeriodRow {
  key: string
  date: string
  start: TimeOfDay
  end: TimeOfDay
}

interface ScheduleForm {
  hours: PeriodRow[][]
  interval: string
  specialDays: SpecialDayEntry[]
  blockedDays: string[]
  blockedPeriods: BlockedPeriodRow[]
  reason: string
}

interface HourErrors {
  periods: (string | null)[]
  interval?: string
  special?: string
  blocks?: string
}

const INTERVAL_OPTIONS = [15, 20, 30, 45, 60]

function fromBusiness(business: {
  workingHours: readonly (readonly { start: TimeOfDay; end: TimeOfDay }[])[]
  bookingIntervalMinutes: number
  specialDays: Readonly<Record<string, SpecialDay>>
  blockedDays: readonly string[]
  blockedPeriods: readonly { date: string; start: TimeOfDay; end: TimeOfDay }[]
}): ScheduleForm {
  return {
    hours: business.workingHours.map((day) =>
      day.map((period) => ({ start: period.start, end: period.end })),
    ),
    interval: String(business.bookingIntervalMinutes),
    specialDays: Object.entries(business.specialDays).map(([date, special]) =>
      special.kind === 'closed'
        ? { date, kind: 'closed', periods: [] }
        : {
            date,
            kind: 'hours',
            periods: special.periods.map((period) => ({
              start: period.start,
              end: period.end,
            })),
          },
    ),
    blockedDays: [...business.blockedDays],
    blockedPeriods: business.blockedPeriods.map((period) => ({
      key: `${period.date}-${period.start}-${period.end}`,
      date: period.date,
      start: period.start,
      end: period.end,
    })),
    reason: '',
  }
}

export function SchedulePage() {
  const { business, loading, error, reload } = useOwnedBusiness()
  const initialized = useRef(false)

  const [form, setForm] = useState<ScheduleForm | null>(null)
  const [saved, setSaved] = useState<ScheduleForm | null>(null)
  const [errors, setErrors] = useState<HourErrors>({ periods: [] })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [pausedPending, setPausedPending] = useState(false)

  const [versions, setVersions] = useState<readonly ScheduleVersion[]>([])
  const [openConflicts, setOpenConflicts] = useState<readonly ScheduleConflict[]>([])

  const [dayDraft, setDayDraft] = useState('')
  const [blockDraft, setBlockDraft] = useState<{ date: string; start: TimeOfDay; end: TimeOfDay }>({
    date: '',
    start: '12:00',
    end: '14:00',
  })

  const loadHistory = useCallback(async () => {
    try {
      setVersions(await mockOwnerApi.listScheduleHistory())
    } catch {
      // History is a nicety; the page still works without it.
    }
  }, [])

  const loadConflicts = useCallback(async () => {
    try {
      setOpenConflicts(await mockOwnerApi.getOpenConflicts())
    } catch {
      // Conflicts are a nicety; the page still works without them.
    }
  }, [])

  useEffect(() => {
    if (initialized.current || !business) return
    initialized.current = true
    const initial = fromBusiness(business)
    setForm(initial)
    setSaved(initial)
  }, [business])

  useEffect(() => {
    if (!business) return
    void loadHistory()
    void loadConflicts()
  }, [loadHistory, loadConflicts, business])

  if (!business || !form || !saved) {
    return (
      <LoadState loading={loading || form === null} error={error} onRetry={reload}>
        {null}
      </LoadState>
    )
  }

  const paused = business.pause !== null
  const dirty = JSON.stringify(form) !== JSON.stringify(saved)

  const update = (patch: Partial<ScheduleForm>) => {
    setSaveSuccess(false)
    setForm((current) => (current ? { ...current, ...patch } : current))
  }

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
    setSaveSuccess(false)
    setForm((current) => {
      if (!current) return current
      const hours = current.hours.map((day, di) =>
        di === dayIndex ? [...day, { start: '09:00', end: '12:00' } as PeriodRow] : day,
      )
      return { ...current, hours }
    })
  }

  const removePeriod = (dayIndex: number, periodIndex: number) => {
    setSaveSuccess(false)
    setForm((current) => {
      if (!current) return current
      const hours = current.hours.map((day, di) =>
        di === dayIndex ? day.filter((_, pi) => pi !== periodIndex) : day,
      )
      return { ...current, hours }
    })
  }

  const toggleDay = (dayIndex: number) => {
    setSaveSuccess(false)
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
    setSaveSuccess(false)
    setForm((current) => {
      if (!current) return current
      const specialDays = current.specialDays.map((entry, i) =>
        i === index ? { ...entry, ...patch } : entry,
      )
      return { ...current, specialDays }
    })
  }

  const setSpecialPeriod = (
    index: number,
    periodIndex: number,
    key: 'start' | 'end',
    value: TimeOfDay,
  ) => {
    setSaveSuccess(false)
    setForm((current) => {
      if (!current) return current
      const specialDays = current.specialDays.map((entry, i) =>
        i === index
          ? {
              ...entry,
              periods: entry.periods.map((period, pi) =>
                pi === periodIndex ? { ...period, [key]: value } : period,
              ),
            }
          : entry,
      )
      return { ...current, specialDays }
    })
  }

  const addSpecialPeriod = (index: number) => {
    setSaveSuccess(false)
    setForm((current) => {
      if (!current) return current
      const specialDays = current.specialDays.map((entry, i) =>
        i === index
          ? { ...entry, periods: [...entry.periods, { start: '13:00', end: '17:00' } as PeriodRow] }
          : entry,
      )
      return { ...current, specialDays }
    })
  }

  const removeSpecialPeriod = (index: number, periodIndex: number) => {
    setSaveSuccess(false)
    setForm((current) => {
      if (!current) return current
      const specialDays = current.specialDays.map((entry, i) =>
        i === index
          ? { ...entry, periods: entry.periods.filter((_, pi) => pi !== periodIndex) }
          : entry,
      )
      return { ...current, specialDays }
    })
  }

  const removeSpecial = (index: number) => {
    setSaveSuccess(false)
    setForm((current) => {
      if (!current) return current
      return {
        ...current,
        specialDays: current.specialDays.filter((_, i) => i !== index),
      }
    })
  }

  const addSpecial = () => {
    setSaveSuccess(false)
    if (!form.specialDays.some((entry) => entry.date === '')) {
      update({ specialDays: [...form.specialDays, { date: '', kind: 'hours', periods: [] }] })
    }
  }

  const addBlockedDay = () => {
    setSaveSuccess(false)
    if (!dayDraft) return
    if (form.blockedDays.includes(dayDraft)) {
      setDayDraft('')
      return
    }
    update({ blockedDays: [...form.blockedDays, dayDraft] })
    setDayDraft('')
  }

  const removeBlockedDay = (date: string) => {
    setSaveSuccess(false)
    update({ blockedDays: form.blockedDays.filter((d) => d !== date) })
  }

  const addBlockedPeriod = () => {
    setSaveSuccess(false)
    const { date, start, end } = blockDraft
    if (!date || !start || !end || end <= start) return
    const key = `${date}-${start}-${end}`
    if (form.blockedPeriods.some((row) => row.key === key)) return
    update({ blockedPeriods: [...form.blockedPeriods, { key, date, start, end }] })
    setBlockDraft({ date: '', start: '12:00', end: '14:00' })
  }

  const removeBlockedPeriodRow = (key: string) => {
    setSaveSuccess(false)
    update({ blockedPeriods: form.blockedPeriods.filter((row) => row.key !== key) })
  }

  const validate = (): HourErrors => {
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
      if (firstOverlap(day)) {
        return 'Working periods must not overlap.'
      }
      return null
    })
    if (!INTERVAL_OPTIONS.includes(Number(form.interval))) {
      next.interval = 'Pick a booking interval from the list.'
    }

    for (const entry of form.specialDays) {
      if (!entry.date) {
        next.special = 'Every special date needs a date.'
        break
      }
      if (entry.kind === 'hours') {
        if (entry.periods.length === 0) {
          next.special = 'Special hours need at least one period with a start and an end time.'
          break
        }
        let invalid = false
        for (const period of entry.periods) {
          if (!period.start || !period.end || period.end <= period.start) {
            next.special = 'Special opening hours need an end time after the start.'
            invalid = true
            break
          }
        }
        if (invalid) break
        if (firstOverlap(entry.periods)) {
          next.special = 'Special-day periods must not overlap.'
          break
        }
      }
    }

    for (const row of form.blockedPeriods) {
      if (!row.date) {
        next.blocks = 'Every blocked period needs a date.'
        break
      }
      if (!row.start || !row.end || row.end <= row.start) {
        next.blocks = 'Blocked periods need an end time after the start.'
        break
      }
    }
    return next
  }

  const save = async () => {
    const nextErrors = validate()
    setErrors(nextErrors)
    if (nextErrors.periods.some(Boolean) || nextErrors.interval || nextErrors.special || nextErrors.blocks) {
      return
    }
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)
    setPausedPending(false)
    try {
      const specialDays: Record<string, SpecialDay> = {}
      for (const entry of form.specialDays) {
        specialDays[entry.date] =
          entry.kind === 'closed'
            ? { kind: 'closed' }
            : { kind: 'hours', periods: entry.periods }
      }
      const snapshot: ScheduleSnapshot = {
        workingHours: form.hours,
        bookingIntervalMinutes: Number(form.interval),
        blockedDays: form.blockedDays,
        blockedPeriods: form.blockedPeriods.map(({ date, start, end }) => ({ date, start, end })),
        specialDays,
      }
      const result = await mockOwnerApi.saveSchedule(snapshot, { reason: form.reason })
      if (!result.ok) {
        setSaveError(result.error)
        return
      }
      const savedForm = { ...form, reason: '' }
      setSaved(savedForm)
      setForm(savedForm)
      setSaveSuccess(true)
      setPausedPending(result.value.version.status === 'pending')
      await reload()
      await loadConflicts()
      await loadHistory()
    } catch {
      setSaveError('Could not save the schedule. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleConflictsChanged = async () => {
    await loadConflicts()
    await loadHistory()
    await reload()
  }

  const discard = () => {
    if (saved) {
      setForm({ ...saved, specialDays: saved.specialDays.map((e) => ({ ...e })) })
    }
    setErrors({ periods: [] })
    setSaveError(null)
    setSaveSuccess(false)
  }

  return (
    <>
      <h1 className="page-title">Working hours</h1>
      <p className="page-subtitle">
        These hours decide which times customers can book. Closed days, blocked
        periods and special dates override the week.
      </p>

      {paused && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert tone="info" title="Bookings are paused">
            Changes you save here are recorded as a pending schedule and apply
            when you resume bookings.
          </Alert>
        </div>
      )}

      {saveError && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert tone="danger">{saveError}</Alert>
        </div>
      )}
      {saveSuccess && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert tone="success" live="polite">
            {pausedPending
              ? 'Schedule saved and recorded as pending. It will apply when you resume bookings.'
              : 'Schedule saved. Your public page now offers times from the new hours.'}
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
                onChange={(event) => update({ interval: event.target.value })}
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
                  <div className="special-day__periods">
                    {entry.periods.map((period, periodIndex) => (
                      <div key={`${index}-${periodIndex}`} className="hours-period">
                        <input
                          className="input hours-period__input"
                          type="time"
                          aria-label={`Special date ${index + 1} period ${periodIndex + 1} start`}
                          value={period.start}
                          onChange={(event) =>
                            setSpecialPeriod(index, periodIndex, 'start', event.target.value)
                          }
                        />
                        <span className="hours-period__to" aria-hidden="true">
                          to
                        </span>
                        <input
                          className="input hours-period__input"
                          type="time"
                          aria-label={`Special date ${index + 1} period ${periodIndex + 1} end`}
                          value={period.end}
                          onChange={(event) =>
                            setSpecialPeriod(index, periodIndex, 'end', event.target.value)
                          }
                        />
                        {entry.periods.length > 1 && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => removeSpecialPeriod(index, periodIndex)}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    ))}
                    <Button type="button" variant="outline" onClick={() => addSpecialPeriod(index)}>
                      Add period
                    </Button>
                  </div>
                )}
                <Button type="button" variant="outline" onClick={() => removeSpecial(index)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          {errors.special && <p className="field__error">{errors.special}</p>}
          <Button type="button" variant="outline" onClick={addSpecial}>
            Add special date
          </Button>
        </fieldset>

        <fieldset className="subsection">
          <legend className="subsection__legend">
            Blocked days & periods{' '}
            <span className="subsection__hint">temporarily close a day or a window</span>
          </legend>

          <div className="block-editor">
            <div className="block-editor__group">
              <h3 className="subsection__subtitle">Blocked days</h3>
              {form.blockedDays.length === 0 && (
                <p className="subsection__empty">No blocked days.</p>
              )}
              {form.blockedDays.map((date) => (
                <div key={date} className="block-row">
                  <span className="block-row__label">Closed all day — {date}</span>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => removeBlockedDay(date)}
                    aria-label={`Remove blocked day ${date}`}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <div className="block-add">
                <input
                  className="input block-add__date"
                  type="date"
                  aria-label="Blocked day date"
                  value={dayDraft}
                  onChange={(event) => setDayDraft(event.target.value)}
                />
                <Button type="button" variant="outline" onClick={addBlockedDay} disabled={!dayDraft}>
                  Add blocked day
                </Button>
              </div>
            </div>

            <div className="block-editor__group">
              <h3 className="subsection__subtitle">Blocked periods</h3>
              {form.blockedPeriods.length === 0 && (
                <p className="subsection__empty">No blocked periods.</p>
              )}
              {form.blockedPeriods.map((row) => (
                <div key={row.key} className="block-row">
                  <span className="block-row__label">
                    Blocked {row.start}–{row.end} on {row.date}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => removeBlockedPeriodRow(row.key)}
                    aria-label={`Remove blocked period on ${row.date}`}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <div className="block-add block-add--periods">
                <input
                  className="input block-add__date"
                  type="date"
                  aria-label="Blocked period date"
                  value={blockDraft.date}
                  onChange={(event) =>
                    setBlockDraft({ ...blockDraft, date: event.target.value })
                  }
                />
                <input
                  className="input"
                  type="time"
                  aria-label="Blocked period start"
                  value={blockDraft.start}
                  onChange={(event) =>
                    setBlockDraft({ ...blockDraft, start: event.target.value })
                  }
                />
                <span aria-hidden="true">to</span>
                <input
                  className="input"
                  type="time"
                  aria-label="Blocked period end"
                  value={blockDraft.end}
                  onChange={(event) => setBlockDraft({ ...blockDraft, end: event.target.value })}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={addBlockedPeriod}
                  disabled={!blockDraft.date || !blockDraft.start || !blockDraft.end}
                >
                  Add blocked period
                </Button>
              </div>
              {errors.blocks && <p className="field__error">{errors.blocks}</p>}
            </div>
          </div>
        </fieldset>

        <div className="subsection">
          <Field
            label="Reason (optional)"
            hint="Recorded in the schedule history so you can recall why this changed."
          >
            {({ id, ariaDescribedBy }) => (
              <textarea
                id={id}
                className="textarea schedule-reason"
                rows={2}
                maxLength={300}
                aria-describedby={ariaDescribedBy}
                value={form.reason}
                onChange={(event) => update({ reason: event.target.value })}
              />
            )}
          </Field>
        </div>

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

      <div style={{ marginTop: 'var(--space-4)' }}>
        <ScheduleConflicts conflicts={openConflicts} onChanged={handleConflictsChanged} />
      </div>

      <div style={{ marginTop: 'var(--space-4)' }}>
        <ScheduleHistory versions={versions} />
      </div>
    </>
  )
}