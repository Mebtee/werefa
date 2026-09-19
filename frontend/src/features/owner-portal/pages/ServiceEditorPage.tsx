import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useOwnedBusiness } from '@/features/owner-portal/state/useOwnedBusiness'
import { LoadState } from '@/features/owner-portal/components/LoadState'
import {
  createOwnerService,
  createServiceAddOn,
  createServiceVariation,
  updateOwnerService,
} from '@/api/catalog'
import { toFieldErrors, toUserMessage } from '@/api/errors'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'

/**
 * Create/edit a service against the real catalog API (Prompt 46).
 *
 * The backend exposes no update/delete for variations and add-ons, so existing
 * ones are shown read-only; new rows are created with their own POST after the
 * service itself is saved. Validation mirrors the backend (name 1-160, price
 * >= 0 minor, duration >= 1, deltas >= 0) and server VALIDATION_ERROR fields
 * are mapped back onto the form (REQ-071 AC1).
 */

interface VariantRow {
  /** Stable key (variation real id when persisted, local id when new). */
  key: string
  /** Real backend id; null while the row still needs to be created. */
  id: string | null
  name: string
  priceDeltaBirr: string
  durationDeltaMinutes: string
}

interface EditorForm {
  name: string
  basePriceBirr: string
  baseDurationMinutes: string
}

interface EditorErrors {
  name?: string
  basePrice?: string
  baseDuration?: string
}

function localId(): string {
  return `local-${Math.random().toString(36).slice(2, 8)}`
}

function parseBirr(text: string): number | null {
  if (text.trim() === '') return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

function birrToMinor(birr: number): number {
  return Math.round(birr * 100)
}

function minorToBirr(minor: number): string {
  return (minor / 100).toString()
}

function emptyForm(): EditorForm {
  return {
    name: '',
    basePriceBirr: '',
    baseDurationMinutes: '',
  }
}

function emptyErrors(): EditorErrors {
  return {}
}

export function ServiceEditorPage() {
  const { serviceId } = useParams<{ serviceId: string }>()
  const navigate = useNavigate()
  const { business, businessId, services, loading, error, reload } = useOwnedBusiness()

  const isNew = serviceId === undefined || serviceId === 'new'
  const existing = services.find((s) => s.id === serviceId) ?? null

  const [form, setForm] = useState<EditorForm>(emptyForm)
  const [variations, setVariations] = useState<VariantRow[]>([])
  const [addOns, setAddOns] = useState<VariantRow[]>([])
  const [initializedFor, setInitializedFor] = useState<string | null>(null)
  const [errors, setErrors] = useState<EditorErrors>(emptyErrors)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (initializedFor) return
    if (isNew) {
      setForm(emptyForm())
      setVariations([])
      setAddOns([])
      setInitializedFor('new')
      return
    }
    if (existing) {
      setForm({
        name: existing.name,
        basePriceBirr: minorToBirr(existing.basePriceMinor),
        baseDurationMinutes: String(existing.baseDurationMinutes),
      })
      setVariations(
        existing.variations.map((v) => ({
          key: v.id,
          id: v.id,
          name: v.name,
          priceDeltaBirr: minorToBirr(v.priceDeltaMinor),
          durationDeltaMinutes: String(v.durationDeltaMinutes),
        })),
      )
      setAddOns(
        existing.addOns.map((a) => ({
          key: a.id,
          id: a.id,
          name: a.name,
          priceDeltaBirr: minorToBirr(a.priceDeltaMinor),
          durationDeltaMinutes: String(a.durationDeltaMinutes),
        })),
      )
      setInitializedFor(existing.id)
    }
  }, [existing, isNew, initializedFor])

  if (!business) {
    return (
      <LoadState loading={loading} error={error} onRetry={reload}>
        {null}
      </LoadState>
    )
  }

  if (!isNew && !existing && !loading) {
    return (
      <Alert tone="warning" title="Service not found">
        <div style={{ marginTop: 'var(--space-3)' }}>
          <Link className="btn btn--outline" to="/owner/services">
            Back to services
          </Link>
        </div>
      </Alert>
    )
  }

  const setFormField = (key: keyof EditorForm, value: string) => {
    setForm({ ...form, [key]: value })
    setSaveError(null)
  }

  const updateRow = (
    rows: VariantRow[],
    setRows: (next: VariantRow[]) => void,
    key: string,
    patch: Partial<VariantRow>,
  ) => {
    setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  const validate = (): EditorErrors => {
    const next: EditorErrors = {}
    if (!form.name.trim()) next.name = 'Please enter a service name.'
    const price = parseBirr(form.basePriceBirr)
    if (price === null || price < 0) {
      next.basePrice = 'Enter a valid price (Birr).'
    }
    const duration = Number(form.baseDurationMinutes)
    if (!Number.isInteger(duration) || duration < 1) {
      next.baseDuration = 'Enter a whole number of minutes, at least 1.'
    }
    return next
  }

  const save = async () => {
    if (!businessId) return
    const nextErrors = validate()
    setErrors(nextErrors)
    if (nextErrors.name || nextErrors.basePrice || nextErrors.baseDuration) return
    setSaving(true)
    setSaveError(null)
    try {
      const baseInput = {
        name: form.name.trim(),
        basePriceMinor: birrToMinor(parseBirr(form.basePriceBirr) as number),
        baseDurationMinutes: Number(form.baseDurationMinutes),
      }
      let savedId: string
      if (isNew) {
        const created = await createOwnerService(businessId, baseInput)
        savedId = created.id
      } else {
        const updated = await updateOwnerService(businessId, existing!.id, baseInput)
        savedId = updated.id
      }

      const newVariations = variations.filter((row) => row.id === null)
      const newAddOns = addOns.filter((row) => row.id === null)
      for (const row of newVariations) {
        await createServiceVariation(businessId, savedId, {
          name: row.name.trim(),
          priceDeltaMinor: birrToMinor(parseBirr(row.priceDeltaBirr) as number),
          durationDeltaMinutes: Number(row.durationDeltaMinutes),
        })
      }
      for (const row of newAddOns) {
        await createServiceAddOn(businessId, savedId, {
          name: row.name.trim(),
          priceDeltaMinor: birrToMinor(parseBirr(row.priceDeltaBirr) as number),
          durationDeltaMinutes: Number(row.durationDeltaMinutes),
        })
      }

      navigate('/owner/services', {
        replace: true,
        state: {
          saved: true,
          message: isNew
            ? 'Service created. It is now live on your public page.'
            : 'Changes to this service are saved.',
        },
      })
    } catch (err) {
      const fields = toFieldErrors(err)
      if (Object.keys(fields).length > 0) {
        setErrors({
          name: fields.name,
          basePrice: fields.basePriceMinor ? fields.basePriceMinor : fields.basePrice,
          baseDuration: fields.baseDurationMinutes ? fields.baseDurationMinutes : undefined,
        })
        setSaveError(fields.serviceId ? toUserMessage(err) : null)
      } else {
        setSaveError(toUserMessage(err))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{isNew ? 'Add a service' : 'Edit service'}</h1>
          <p className="page-subtitle">
            A service needs a price and a duration to be saved (REQ-071).
          </p>
        </div>
        <Link className="btn btn--outline" to="/owner/services">
          Back to services
        </Link>
      </div>

      {saveError && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert tone="danger">{saveError}</Alert>
        </div>
      )}

      <form
        className="card card--padded"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="form-grid">
          <Field label="Service name" error={errors.name}>
            {({ id, ariaDescribedBy }) => (
              <input
                id={id}
                className="input"
                value={form.name}
                aria-describedby={ariaDescribedBy}
                onChange={(event) => setFormField('name', event.target.value)}
              />
            )}
          </Field>

          <div className="form-grid__pair">
            <Field
              label="Price (Birr)"
              hint="Entered in Birr, stored to the cent."
              error={errors.basePrice}
            >
              {({ id, ariaDescribedBy }) => (
                <input
                  id={id}
                  className="input"
                  type="number"
                  step="0.01"
                  min={0}
                  value={form.basePriceBirr}
                  aria-describedby={ariaDescribedBy}
                  onChange={(event) => setFormField('basePriceBirr', event.target.value)}
                />
              )}
            </Field>
            <Field label="Duration (minutes)" error={errors.baseDuration}>
              {({ id, ariaDescribedBy }) => (
                <input
                  id={id}
                  className="input"
                  type="number"
                  step={1}
                  min={1}
                  value={form.baseDurationMinutes}
                  aria-describedby={ariaDescribedBy}
                  onChange={(event) =>
                    setFormField('baseDurationMinutes', event.target.value)
                  }
                />
              )}
            </Field>
          </div>
        </div>

        <fieldset className="subsection">
          <legend className="subsection__legend">
            Variations <span className="subsection__hint">adds price and/or time to a booking</span>
          </legend>
          {variations.length === 0 && (
            <p className="subsection__empty">No variations.</p>
          )}
          <ul className="option-rows">
            {variations.map((row, index) => {
              const disabled = row.id !== null
              return (
                <li key={row.key} className="option-row">
                  <Field
                    label={`Variation ${index + 1}${disabled ? ' (saved)' : ''}`}
                    hint={disabled ? 'Already saved — shown on the public page.' : undefined}
                  >
                    {({ id }) => (
                      <input
                        id={id}
                        className="input"
                        value={row.name}
                        disabled={disabled}
                        onChange={(event) =>
                          updateRow(variations, setVariations, row.key, { name: event.target.value })
                        }
                      />
                    )}
                  </Field>
                  <Field label={`Variation ${index + 1} — change to price (Birr)`}>
                    {({ id }) => (
                      <input
                        id={id}
                        className="input"
                        type="number"
                        step="0.01"
                        min={0}
                        value={row.priceDeltaBirr}
                        disabled={disabled}
                        onChange={(event) =>
                          updateRow(variations, setVariations, row.key, {
                            priceDeltaBirr: event.target.value,
                          })
                        }
                      />
                    )}
                  </Field>
                  <Field label={`Variation ${index + 1} — extra minutes`}>
                    {({ id }) => (
                      <input
                        id={id}
                        className="input"
                        type="number"
                        step={1}
                        min={0}
                        value={row.durationDeltaMinutes}
                        disabled={disabled}
                        onChange={(event) =>
                          updateRow(variations, setVariations, row.key, {
                            durationDeltaMinutes: event.target.value,
                          })
                        }
                      />
                    )}
                  </Field>
                  {!disabled && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setVariations((rows) => rows.filter((r) => r.key !== row.key))
                      }
                    >
                      Remove
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setVariations((rows) => [
                ...rows,
                { key: localId(), id: null, name: '', priceDeltaBirr: '0', durationDeltaMinutes: '0' },
              ])
            }
          >
            Add variation
          </Button>
        </fieldset>

        <fieldset className="subsection">
          <legend className="subsection__legend">
            Add-ons <span className="subsection__hint">optional extras customers can add</span>
          </legend>
          {addOns.length === 0 && (
            <p className="subsection__empty">No add-ons.</p>
          )}
          <ul className="option-rows">
            {addOns.map((row, index) => {
              const disabled = row.id !== null
              return (
                <li key={row.key} className="option-row">
                  <Field
                    label={`Add-on ${index + 1}${disabled ? ' (saved)' : ''}`}
                    hint={disabled ? 'Already saved — shown on the public page.' : undefined}
                  >
                    {({ id }) => (
                      <input
                        id={id}
                        className="input"
                        value={row.name}
                        disabled={disabled}
                        onChange={(event) =>
                          updateRow(addOns, setAddOns, row.key, { name: event.target.value })
                        }
                      />
                    )}
                  </Field>
                  <Field label={`Add-on ${index + 1} — change to price (Birr)`}>
                    {({ id }) => (
                      <input
                        id={id}
                        className="input"
                        type="number"
                        step="0.01"
                        min={0}
                        value={row.priceDeltaBirr}
                        disabled={disabled}
                        onChange={(event) =>
                          updateRow(addOns, setAddOns, row.key, {
                            priceDeltaBirr: event.target.value,
                          })
                        }
                      />
                    )}
                  </Field>
                  <Field label={`Add-on ${index + 1} — extra minutes`}>
                    {({ id }) => (
                      <input
                        id={id}
                        className="input"
                        type="number"
                        step={1}
                        min={0}
                        value={row.durationDeltaMinutes}
                        disabled={disabled}
                        onChange={(event) =>
                          updateRow(addOns, setAddOns, row.key, {
                            durationDeltaMinutes: event.target.value,
                          })
                        }
                      />
                    )}
                  </Field>
                  {!disabled && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setAddOns((rows) => rows.filter((r) => r.key !== row.key))}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setAddOns((rows) => [
                ...rows,
                { key: localId(), id: null, name: '', priceDeltaBirr: '0', durationDeltaMinutes: '0' },
              ])
            }
          >
            Add add-on
          </Button>
        </fieldset>

        <div className="form-actions">
          <Button variant="primary" type="submit" loading={saving}>
            Save service
          </Button>
        </div>
      </form>
    </>
  )
}