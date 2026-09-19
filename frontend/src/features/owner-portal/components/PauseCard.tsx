import { useState } from 'react'
import type { BusinessDetails, DateString, PauseState } from '@/types/models'
import { pauseOwnedBusiness, resumeOwnedBusiness } from '@/api/business'
import { toUserMessage } from '@/api/errors'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'

interface PauseCardProps {
  /** The real backend id of the owned business (tenant-scoped). */
  businessId: string
  business: BusinessDetails
  onChanged: () => Promise<void>
}

function todayString(): DateString {
  const now = new Date()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

/**
 * Pause / resume control (REQ-143…REQ-148).
 *
 * Pausing immediately stops new bookings on the public page (which stays
 * visible and carries the optional pause message). Pausing can be indefinite
 * or scheduled to automatically reopen on a chosen date.
 */
export function PauseCard({ businessId, business, onChanged }: PauseCardProps) {
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm'>('view')
  const [kind, setKind] = useState<'indefinite' | 'until'>('indefinite')
  const [reopenDate, setReopenDate] = useState<string>('')
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState<{ reopenDate?: string }>({})
  const [saving, setSaving] = useState(false)
  const [flashError, setFlashError] = useState<string | null>(null)
  const [flashSuccess, setFlashSuccess] = useState<string | null>(null)

  const paused = business.pause !== null

  const openEditor = () => {
    const current = business.pause
    setKind(current?.kind === 'until' ? 'until' : 'indefinite')
    setReopenDate(current?.kind === 'until' ? current.reopenDate : '')
    setMessage(current?.message ?? '')
    setErrors({})
    setFlashError(null)
    setMode('edit')
  }

  const applyPause = async (pause: PauseState) => {
    setSaving(true)
    setFlashError(null)
    try {
      if (pause === null) {
        await resumeOwnedBusiness(businessId)
      } else {
        await pauseOwnedBusiness(businessId, {
          pauseMessage: pause.message,
          reopenAt:
            pause.kind === 'until' ? `${pause.reopenDate}T00:00:00.000Z` : undefined,
        })
      }
      setFlashSuccess(
        pause === null
          ? 'Bookings are open again on your public page.'
          : 'Bookings are paused on your public page.',
      )
      setMode('view')
      await onChanged()
    } catch (error) {
      setFlashError(
        toUserMessage(error) === 'Something went wrong. Please try again.'
          ? 'Could not update the pause state. Please try again.'
          : toUserMessage(error),
      )
    } finally {
      setSaving(false)
    }
  }

  const requestSave = () => {
    const nextKind = kind
    if (nextKind === 'until') {
      if (!reopenDate || reopenDate <= todayString()) {
        setErrors({ reopenDate: 'Pick a date in the future for automatic reopening.' })
        return
      }
    }
    setErrors({})
    if (paused) {
      void applyPause(
        nextKind === 'until'
          ? { kind: 'until', reopenDate, message: message.trim() || undefined }
          : { kind: 'indefinite', message: message.trim() || undefined },
      )
    } else {
      setMode('confirm')
    }
  }

  const confirmPause = () => {
    void applyPause(
      kind === 'until'
        ? { kind: 'until', reopenDate, message: message.trim() || undefined }
        : { kind: 'indefinite', message: message.trim() || undefined },
    )
  }

  return (
    <section className="card card--padded" aria-labelledby="pause-title">
      <div className="card__header">
        <div>
          <h2 className="card__title" id="pause-title">
            Booking status
          </h2>
          <p className="card__subtitle">
            {paused
              ? business.pause?.kind === 'until'
                ? `Paused until ${business.pause?.reopenDate}`
                : 'Paused indefinitely'
              : 'Open for new bookings'}
          </p>
        </div>
      </div>

      {flashSuccess && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert tone="success" live="polite">
            {flashSuccess}
          </Alert>
        </div>
      )}
      {flashError && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert tone="danger">{flashError}</Alert>
        </div>
      )}

      {mode === 'view' && (
        <div className="pause-actions">
          {paused ? (
            <>
              <p className="pause-note">
                {business.pause?.message
                  ? `Message to customers: “${business.pause.message}”`
                  : 'No pause message is shown to customers.'}{' '}
                The public page stays visible but blocks new bookings.
              </p>
              <div className="pause-actions__row">
                <Button variant="primary" onClick={() => void applyPause(null)} loading={saving}>
                  Resume bookings now
                </Button>
                <Button variant="outline" onClick={openEditor}>
                  Edit pause
                </Button>
              </div>
            </>
          ) : (
            <Button variant="outline" onClick={openEditor}>
              Pause bookings
            </Button>
          )}
        </div>
      )}

      {mode === 'edit' || mode === 'confirm' ? (
        <form
          className="pause-form"
          onSubmit={(event) => {
            event.preventDefault()
            requestSave()
          }}
        >
          <fieldset className="pause-form__group">
            <legend className="pause-form__legend">Pause…</legend>
            <label className="pause-form__choice">
              <input
                type="radio"
                name="pause-kind"
                value="indefinite"
                checked={kind === 'indefinite'}
                onChange={() => setKind('indefinite')}
              />
              Indefinitely
            </label>
            <label className="pause-form__choice">
              <input
                type="radio"
                name="pause-kind"
                value="until"
                checked={kind === 'until'}
                onChange={() => setKind('until')}
              />
              Until a chosen date
            </label>
          </fieldset>

          {kind === 'until' && (
            <div className="pause-form__reopen">
              <Field label="Reopen date" hint="Bookings reopen automatically on this date." error={errors.reopenDate}>
                {({ id, ariaDescribedBy }) => (
                  <input
                    id={id}
                    className="input"
                    type="date"
                    value={reopenDate}
                    aria-describedby={ariaDescribedBy}
                    onChange={(event) => setReopenDate(event.target.value)}
                  />
                )}
              </Field>
            </div>
          )}

          <Field
            label="Message to customers (optional)"
            hint="Shown on your public page while paused."
          >
            {({ id, ariaDescribedBy }) => (
              <textarea
                id={id}
                className="textarea"
                rows={3}
                value={message}
                maxLength={300}
                aria-describedby={ariaDescribedBy}
                onChange={(event) => setMessage(event.target.value)}
              />
            )}
          </Field>

          {mode === 'confirm' && (
            <Alert tone="warning" title="Pause bookings now?">
              This immediately stops new bookings on your public page. Existing
              bookings are not affected, and you can resume at any time.
            </Alert>
          )}

          <div className="pause-actions__row">
            {mode === 'confirm' ? (
              <>
                <Button variant="primary" onClick={confirmPause} loading={saving}>
                  Yes, pause bookings
                </Button>
                <Button variant="outline" onClick={() => setMode('edit')}>
                  Keep editing
                </Button>
              </>
            ) : (
              <>
                <Button variant="primary" type="submit" loading={saving}>
                  Save pause
                </Button>
                <Button variant="outline" type="button" onClick={() => setMode('view')}>
                  Cancel
                </Button>
              </>
            )}
          </div>
        </form>
      ) : null}
    </section>
  )
}