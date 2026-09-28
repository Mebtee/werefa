import { useCallback, useEffect, useRef, useState } from 'react'
import type { TimeOfDay } from '@/types/models'
import { useSelectedOwnedBusiness } from '@/features/owner-portal/state/useSelectedOwnedBusiness'
import { LoadState } from '@/features/owner-portal/components/LoadState'
import { ScheduleConflicts } from '@/features/owner-portal/components/ScheduleConflicts'
import { ScheduleHistory } from '@/features/owner-portal/components/ScheduleHistory'
import { toUserMessage } from '@/api/errors'
import { isNotFoundError } from '@/api/business'
import { downloadScheduleHistoryPdf } from '@/api/reports'
import { saveBlob } from '@/lib/download'
import {
  getOwnerSchedule,
  listOwnerScheduleConflicts,
  listOwnerScheduleVersions,
  saveOwnerSchedule,
  updateOwnerScheduleInterval,
} from '@/api/schedule'
import type {
  BlockedPeriodRow,
  PeriodRow,
  ScheduleConflictItem,
  ScheduleForm,
  SpecialDayEntry,
} from '@/api/schedule.mapper'
import {
  conflictsFromApi,
  emptyScheduleForm,
  scheduleFormFromApi,
  toSchedulePayload,
  versionHistoryEntry,
} from '@/api/schedule.mapper'

import type { OwnerScheduleView } from '@/api/types'
import type { ScheduleVersionHistoryEntry } from '@/types/models'
import { WEEKDAY_NAMES } from '@/features/owner-portal/lib/labels'
import { firstOverlap } from '@/lib/periods'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'

interface HourErrors {
  periods: (string | null)[]
  interval?: string
  special?: string
  blocks?: string
}

const INTERVAL_OPTIONS = [15, 20, 30, 45, 60]

const ALL_DAY_LABEL = 'Every day'

function dayLabel(day: number | null): string {
  return day == null ? ALL_DAY_LABEL : WEEKDAY_NAMES[day]
}

const EMPTY_SPECIAL: SpecialDayEntry = { date: '', kind: 'custom', start: null, end: null }

export function SchedulePage() {
  // The working-hours editor needs only the business itself, so it deliberately
  // avoids `useOwnedBusiness`, whose `loading` also waits on the service catalog
  // and booking list that this page never reads.
  const { business, businessId, loading, error, reload } = useSelectedOwnedBusiness()
  const loadedBusinessId = useRef<string | null>(null)
  /**
   * True only while the schedule request is genuinely in flight. It must not be
   * derived from `form === null`, because `form` is also null when the request
   * failed: `LoadState` renders its spinner whenever `loading` is true, so
   * deriving it from `form` masked every schedule error behind an endless
   * spinner with no message and no retry.
   */
  const [scheduleLoading, setScheduleLoading] = useState(true)

  const [form, setForm] = useState<ScheduleForm | null>(null)
  const [saved, setSaved] = useState<ScheduleForm | null>(null)
  const [errors, setErrors] = useState<HourErrors>({ periods: [] })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [pausedPending, setPausedPending] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)

  const [versions, setVersions] = useState<readonly ScheduleVersionHistoryEntry[]>([])
  const [openConflicts, setOpenConflicts] = useState<readonly ScheduleConflictItem[]>([])
  const [currentSchedule, setCurrentSchedule] = useState<OwnerScheduleView | null>(null)

  const [blockDraft, setBlockDraft] = useState<{
    day: string
    start: TimeOfDay
    end: TimeOfDay
  }>({ day: '', start: '12:00', end: '14:00' })

  const loadHistory = useCallback(async (businessId: string) => {
    try {
      const views = await listOwnerScheduleVersions(businessId)
      setVersions(views.map(versionHistoryEntry))
    } catch {
      // History is a nicety; the page still works without it.
    }
  }, [])

  const loadConflicts = useCallback(async (businessId: string) => {
    try {
      const views = await listOwnerScheduleConflicts(businessId)
      setOpenConflicts(conflictsFromApi(views))
    } catch {
      // Conflicts are a nicety; the page still works without them.
    }
  }, [])

  useEffect(() => {
    if (!business || !businessId) return
    const id = businessId
    // Switching business needs that business's own schedule, so drop the
    // previous editor state before loading. Keyed off the id rather than a
    // one-shot `initialized` latch: a latch is set before the request resolves,
    // so under StrictMode's mount/cleanup/mount the first request is cancelled by
    // its own cleanup while the second run skips the work entirely. The only
    // request ever issued was then discarded by `cancelled` and `form` stayed
    // null, which pinned this page on "Loading your business" forever.
    if (loadedBusinessId.current !== id) {
      loadedBusinessId.current = id
      setForm(null)
      setSaved(null)
      setCurrentSchedule(null)
      setSaveError(null)
    }
    let cancelled = false
    setScheduleLoading(true)
    void (async () => {
      try {
        const current = await getOwnerSchedule(id)
        if (cancelled) return
        setCurrentSchedule(current)
        setForm((previous) =>
          previous === null ? scheduleFormFromApi(current, business.bookingIntervalMinutes) : previous,
        )
        setSaved((previous) =>
          previous === null ? scheduleFormFromApi(current, business.bookingIntervalMinutes) : previous,
        )
      } catch (err) {
        if (cancelled) return
        if (isNotFoundError(err)) {
          // No schedule version yet. This is the normal state of a brand-new
          // business, not a failure — start from a blank week so the owner can
          // define working hours and create the first version. Treating this as
          // a load error made the page unreachable, so a brand-new business could
          // never be given a schedule at all.
          const blank = emptyScheduleForm(business.bookingIntervalMinutes)
          setForm((previous) => previous ?? blank)
          setSaved((previous) => previous ?? blank)
        } else {
          setSaveError(toUserMessage(err))
        }
      } finally {
        // Every outcome — success, "no version yet", and failure alike — has to
        // end the request. `LoadState` shows its spinner while `loading` is
        // true, so a request that resolved into an error without clearing this
        // flag leaves the page spinning forever and hides the error and retry.
        if (!cancelled) setScheduleLoading(false)
      }
      void loadHistory(id)
      void loadConflicts(id)
    })()
    return () => {
      cancelled = true
    }
  }, [business, businessId, loadHistory, loadConflicts])

  if (!business || !businessId || !form || !saved) {
    return (
      <LoadState
        loading={loading || scheduleLoading}
        error={saveError !== null || error}
        onRetry={reload}
      >
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
        di === dayIndex
          ? [...day, { start: '09:00', end: '12:00' } as PeriodRow]
          : day,
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
        di === dayIndex
          ? isOpen
            ? []
            : [{ start: '09:00', end: '17:00' } as PeriodRow]
          : day,
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
      update({ specialDays: [...form.specialDays, EMPTY_SPECIAL] })
    }
  }

  const addBlockedPeriod = () => {
    setSaveSuccess(false)
    const { day, start, end } = blockDraft
    if (!start || !end || end <= start) return
    const dayValue = day === '' ? null : Number(day)
    const key = `${dayValue ?? 'all'}-${start}-${end}`
    if (form.blockedPeriods.some((row) => row.key === key)) return
    const row: BlockedPeriodRow = { key, day: dayValue, start, end }
    update({ blockedPeriods: [...form.blockedPeriods, row] })
    setBlockDraft({ day: '', start: '12:00', end: '14:00' })
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

    const seenDates = new Set<string>()
    for (const entry of form.specialDays) {
      if (!entry.date) {
        if (!next.special) next.special = 'Every special date needs a date.'
        break
      }
      if (seenDates.has(entry.date)) {
        if (!next.special) next.special = 'Special dates must not repeat.'
        break
      }
      seenDates.add(entry.date)
      if (entry.kind === 'custom') {
        if (!entry.start || !entry.end) {
          if (!next.special) next.special = 'Special hours need a start and an end time.'
        } else if (entry.end <= entry.start) {
          if (!next.special) next.special = 'Special hours need an end time after the start.'
        }
      }
    }

    for (const row of form.blockedPeriods) {
      if (!row.start || !row.end) {
        if (!next.blocks) next.blocks = 'Blocked periods need a start and an end time.'
      } else if (row.end <= row.start) {
        if (!next.blocks) next.blocks = 'Blocked period end time must be after its start.'
      }
    }
    return next
  }

  const save = async () => {
    const nextErrors = validate()
    setErrors(nextErrors)
    if (
      nextErrors.periods.some(Boolean) ||
      nextErrors.interval ||
      nextErrors.special ||
      nextErrors.blocks
    ) {
      return
    }
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)
    setPausedPending(false)
    try {
      const payload = toSchedulePayload(form)
      const interval = Number(form.interval)
      const result = await saveOwnerSchedule(businessId, payload)
      if (String(interval) !== saved.interval) {
        try {
          await updateOwnerScheduleInterval(businessId, { bookingIntervalMinutes: interval })
        } catch {
          // The schedule itself is saved; the interval mismatch surfaces on next load.
        }
      }
      setCurrentSchedule(result.version)
      const savedForm = { ...form, reason: '' }
      setSaved(savedForm)
      setForm(savedForm)
      setSaveSuccess(true)
      setPausedPending(result.activated === false)
      await Promise.all([loadConflicts(businessId), loadHistory(businessId)])
      void reload()
    } catch (err) {
      setSaveError(toUserMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const handleConflictsChanged = async () => {
    await Promise.all([loadConflicts(businessId), loadHistory(businessId)])
    await reload()
  }

  /** Real schedule-history PDF export of the owner's own business (REQ-170). */
  const handleExportSchedulePdf = async () => {
    if (!businessId || exportingPdf) return
    setExportingPdf(true)
    setPdfError(null)
    try {
      const { blob, fileName } = await downloadScheduleHistoryPdf(businessId, 'owner')
      saveBlob(blob, fileName ?? 'schedule-history.pdf')
    } catch (err) {
      setPdfError(toUserMessage(err))
    } finally {
      setExportingPdf(false)
    }
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
                    value="custom"
                    checked={entry.kind === 'custom'}
                    onChange={() => updateSpecial(index, { kind: 'custom' })}
                  />
                  Custom hours
                </label>
                {entry.kind === 'custom' && (
                  <div className="special-day__periods">
                    <div className="hours-period">
                      <input
                        className="input hours-period__input"
                        type="time"
                        aria-label={`Special date ${index + 1} period 1 start`}
                        value={entry.start ?? ''}
                        onChange={(event) => updateSpecial(index, { start: event.target.value })}
                      />
                      <span className="hours-period__to" aria-hidden="true">
                        to
                      </span>
                      <input
                        className="input hours-period__input"
                        type="time"
                        aria-label={`Special date ${index + 1} period 1 end`}
                        value={entry.end ?? ''}
                        onChange={(event) => updateSpecial(index, { end: event.target.value })}
                      />
                    </div>
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
            Blocked periods{' '}
            <span className="subsection__hint">
              weekly windows that reject bookings, overriding the week
            </span>
          </legend>
          {form.blockedPeriods.length === 0 && (
            <p className="subsection__empty">No blocked periods.</p>
          )}
          {form.blockedPeriods.map((row) => (
            <div key={row.key} className="block-row">
              <span className="block-row__label">
                Blocked {row.start}–{row.end} on {dayLabel(row.day)}
              </span>
              <Button
                type="button"
                variant="outline"
                onClick={() => removeBlockedPeriodRow(row.key)}
                aria-label={`Remove blocked period on ${dayLabel(row.day)}`}
              >
                Remove
              </Button>
            </div>
          ))}
          <div className="block-add">
            <label className="block-add__label">
              <span className="sr-only">Blocked period weekday</span>
              <select
                className="select block-add__day"
                value={blockDraft.day}
                onChange={(event) => setBlockDraft({ ...blockDraft, day: event.target.value })}
              >
                <option value="">Every day</option>
                {WEEKDAY_NAMES.map((name, index) => (
                  <option key={name} value={String(index)}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <input
              className="input"
              type="time"
              aria-label="Blocked period start"
              value={blockDraft.start}
              onChange={(event) => setBlockDraft({ ...blockDraft, start: event.target.value })}
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
              disabled={!blockDraft.start || !blockDraft.end}
            >
              Add blocked period
            </Button>
          </div>
          {errors.blocks && <p className="field__error">{errors.blocks}</p>}
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
        <ScheduleConflicts
          conflicts={openConflicts}
          businessId={businessId}
          versionId={
            currentSchedule && currentSchedule.status === 'ACTIVE'
              ? currentSchedule.versionId
              : null
          }
          onChanged={handleConflictsChanged}
        />
      </div>

      <div style={{ marginTop: 'var(--space-4)' }}>
        {pdfError && (
          <Alert tone="danger" title="The PDF export did not go through">
            {pdfError}
          </Alert>
        )}
        <ScheduleHistory
          versions={versions}
          onExportPdf={() => void handleExportSchedulePdf()}
          exportingPdf={exportingPdf}
        />
      </div>
    </>
  )
}