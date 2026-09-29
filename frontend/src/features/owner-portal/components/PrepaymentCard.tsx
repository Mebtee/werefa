import { useState } from 'react'
import type { BusinessDetails, PrepaymentConfig, PrepaymentMode } from '@/types/models'
import { updateOwnerBusinessSettings } from '@/api/business'
import { prepaymentToSettings } from '@/api/business.mapper'
import { toUserMessage } from '@/api/errors'
import { formatMoney } from '@/lib/format'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'

interface PrepaymentCardProps {
  /** The real backend id of the owned business (tenant-scoped). */
  businessId: string
  business: BusinessDetails
  onChanged: () => Promise<void>
}

/** Backend `prepaymentPercent` bounds (UpdateBusinessSettingsPayload). */
const PERCENT_MIN = 1
const PERCENT_MAX = 100

const MODE_LABEL: Record<PrepaymentMode, string> = {
  none: 'No deposit',
  percentage: 'A percentage of the booking total',
  fixed: 'A fixed amount',
}

/**
 * Owner prepayment configuration (REQ-110 / REQ-111).
 *
 * The owner decides whether a deposit is required and, if so, whether it is a
 * percentage of the booking total or a fixed amount. There is no platform-wide
 * default: this card only ever writes what the owner picks, to the same
 * `PATCH /owner/businesses/:id/settings` route the backend already enforces.
 *
 * Turning a deposit on is what makes the customer flow ask for a receipt: the
 * backend derives `requiredPrepaidMinor` for every availability response from
 * this configuration, the booking wizard shows its payment step when that
 * amount is above zero, and `POST /customer/bookings` then refuses a
 * proof-less booking. Turning it off is the honest inverse — no deposit, no
 * forced receipt.
 */
export function PrepaymentCard({ businessId, business, onChanged }: PrepaymentCardProps) {
  const saved: PrepaymentConfig = business.prepayment
  const [mode, setMode] = useState<PrepaymentMode>(saved.mode)
  const [percent, setPercent] = useState(
    saved.mode === 'percentage' && saved.value !== undefined ? String(saved.value) : '',
  )
  const [amount, setAmount] = useState(
    saved.mode === 'fixed' && saved.value !== undefined
      ? (saved.value / 100).toFixed(2)
      : '',
  )
  const [errors, setErrors] = useState<{ percent?: string; amount?: string }>({})
  const [saving, setSaving] = useState(false)
  const [flashError, setFlashError] = useState<string | null>(null)
  const [flashSuccess, setFlashSuccess] = useState<string | null>(null)

  const draft: PrepaymentConfig =
    mode === 'percentage'
      ? { mode, value: percent.trim() === '' ? undefined : Number(percent) }
      : mode === 'fixed'
        ? { mode, value: amount.trim() === '' ? undefined : Math.round(Number(amount) * 100) }
        : { mode }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)

  const summary = (() => {
    if (saved.mode === 'percentage' && saved.value !== undefined) {
      return `Customers prepay ${saved.value}% of the booking total before you confirm.`
    }
    if (saved.mode === 'fixed' && saved.value !== undefined) {
      return `Customers prepay ${formatMoney(saved.value, business.currency)} before you confirm.`
    }
    return 'Customers do not prepay anything — they submit a booking request only.'
  })()

  const save = async () => {
    const nextErrors: { percent?: string; amount?: string } = {}
    if (mode === 'percentage') {
      const value = Number(percent)
      if (!percent.trim() || !Number.isInteger(value) || value < PERCENT_MIN || value > PERCENT_MAX) {
        nextErrors.percent = `Enter a whole number between ${PERCENT_MIN} and ${PERCENT_MAX}.`
      }
    }
    if (mode === 'fixed') {
      const value = Number(amount)
      if (!amount.trim() || !Number.isFinite(value) || value < 0) {
        nextErrors.amount = 'Enter an amount of 0 or more.'
      }
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSaving(true)
    setFlashError(null)
    setFlashSuccess(null)
    try {
      await updateOwnerBusinessSettings(businessId, prepaymentToSettings(draft))
      setFlashSuccess('Deposit settings saved.')
      await onChanged()
    } catch (error) {
      setFlashError(toUserMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card card--padded" aria-labelledby="prepayment-title">
      <div className="card__header">
        <div>
          <h2 className="card__title" id="prepayment-title">
            Deposit
          </h2>
          <p className="card__subtitle">{summary}</p>
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

      <form
        className="pause-form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <fieldset className="pause-form__group">
          <legend className="pause-form__legend">Require a deposit…</legend>
          {(['none', 'percentage', 'fixed'] as const).map((option) => (
            <label key={option} className="pause-form__choice">
              <input
                type="radio"
                name="prepayment-mode"
                value={option}
                checked={mode === option}
                onChange={() => {
                  setMode(option)
                  setErrors({})
                  setFlashSuccess(null)
                }}
              />
              {MODE_LABEL[option]}
            </label>
          ))}
        </fieldset>

        {mode === 'percentage' && (
          <Field
            label="Percentage of the booking total"
            hint={`Whole number from ${PERCENT_MIN} to ${PERCENT_MAX}. The customer sees the exact amount once they pick a time.`}
            error={errors.percent}
          >
            {({ id, ariaDescribedBy }) => (
              <input
                id={id}
                className="input"
                type="number"
                inputMode="numeric"
                min={PERCENT_MIN}
                max={PERCENT_MAX}
                step={1}
                value={percent}
                aria-describedby={ariaDescribedBy}
                onChange={(event) => setPercent(event.target.value)}
              />
            )}
          </Field>
        )}

        {mode === 'fixed' && (
          <Field
            label={`Fixed amount (${business.currency})`}
            hint="Charged as the same amount whatever the booking costs. An amount of 0 is accepted by the backend, but it requires no deposit and no receipt."
            error={errors.amount}
          >
            {({ id, ariaDescribedBy }) => (
              <input
                id={id}
                className="input"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={amount}
                aria-describedby={ariaDescribedBy}
                onChange={(event) => setAmount(event.target.value)}
              />
            )}
          </Field>
        )}

        {mode !== 'none' && (
          <Alert tone="info" title="What the customer sees">
            Choosing a payment method and attaching their receipt (an image or a
            PDF) becomes a required step of the booking form, and their booking
            stays in Payment Pending until you accept the proof.
          </Alert>
        )}

        <div className="form-actions">
          <Button variant="primary" type="submit" loading={saving} disabled={!dirty || saving}>
            Save deposit
          </Button>
          <Button
            variant="outline"
            type="button"
            disabled={!dirty || saving}
            onClick={() => {
              setMode(saved.mode)
              setPercent(
                saved.mode === 'percentage' && saved.value !== undefined
                  ? String(saved.value)
                  : '',
              )
              setAmount(
                saved.mode === 'fixed' && saved.value !== undefined
                  ? (saved.value / 100).toFixed(2)
                  : '',
              )
              setErrors({})
              setFlashSuccess(null)
            }}
          >
            Discard deposit changes
          </Button>
        </div>
      </form>
    </section>
  )
}
