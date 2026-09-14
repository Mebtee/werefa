import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useOwnedBusiness } from '@/features/owner-portal/state/useOwnedBusiness'
import { LoadState } from '@/features/owner-portal/components/LoadState'
import { mockOwnerApi } from '@/mock/ownerApi'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'

interface VariationRow {
  id: string
  name: string
  priceDeltaBirr: string
  durationDeltaMinutes: string
}

interface AddOnRow {
  id: string
  name: string
  priceBirr: string
  durationMinutes: string
}

interface EditorForm {
  name: string
  description: string
  basePriceBirr: string
  baseDurationMinutes: string
}

interface EditorErrors {
  name?: string
  basePrice?: string
  baseDuration?: string
  variations: (string | null)[]
  addOns: (string | null)[]
}

function localId(): string {
  return Math.random().toString(36).slice(2, 8)
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
    description: '',
    basePriceBirr: '',
    baseDurationMinutes: '',
  }
}

function emptyErrors(): EditorErrors {
  return { variations: [], addOns: [] }
}

export function ServiceEditorPage() {
  const { serviceId } = useParams<{ serviceId: string }>()
  const navigate = useNavigate()
  const { business, services, loading, error, reload } = useOwnedBusiness()

  const isNew = serviceId === undefined || serviceId === 'new'
  const existing = services.find((s) => s.id === serviceId) ?? null

  const [form, setForm] = useState<EditorForm>(emptyForm)
  const [variations, setVariations] = useState<VariationRow[]>([])
  const [addOns, setAddOns] = useState<AddOnRow[]>([])
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
        description: existing.description ?? '',
        basePriceBirr: minorToBirr(existing.basePrice),
        baseDurationMinutes: String(existing.baseDurationMinutes),
      })
      setVariations(
        existing.variations.map((v) => ({
          id: v.id,
          name: v.name,
          priceDeltaBirr: minorToBirr(v.priceDelta),
          durationDeltaMinutes: String(v.durationDeltaMinutes),
        })),
      )
      setAddOns(
        existing.addOns.map((a) => ({
          id: a.id,
          name: a.name,
          priceBirr: minorToBirr(a.price),
          durationMinutes: String(a.durationMinutes),
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

  const updateVariation = (id: string, patch: Partial<VariationRow>) => {
    setVariations((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const updateAddOn = (id: string, patch: Partial<AddOnRow>) => {
    setAddOns((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const validate = (): EditorErrors => {
    const next: EditorErrors = { variations: [], addOns: [] }
    if (!form.name.trim()) next.name = 'Please enter a service name.'
    const price = parseBirr(form.basePriceBirr)
    if (price === null || price < 0) {
      next.basePrice = 'Enter a valid price (Birr).'
    }
    const duration = Number(form.baseDurationMinutes)
    if (!Number.isInteger(duration) || duration < 1) {
      next.baseDuration = 'Enter a whole number of minutes, at least 1.'
    }

    next.variations = variations.map((row) => {
      if (!row.name.trim()) return 'Enter a variation name.'
      const delta = parseBirr(row.priceDeltaBirr)
      if (delta === null || delta < 0) return 'Enter a valid price change.'
      const dur = Number(row.durationDeltaMinutes)
      if (!Number.isInteger(dur) || dur < 0) return 'Enter whole minutes (0 or more).'
      return null
    })

    next.addOns = addOns.map((row) => {
      if (!row.name.trim()) return 'Enter an add-on name.'
      const price2 = parseBirr(row.priceBirr)
      if (price2 === null || price2 < 0) return 'Enter a valid price.'
      const dur = Number(row.durationMinutes)
      if (!Number.isInteger(dur) || dur < 0) return 'Enter whole minutes (0 or more).'
      return null
    })

    return next
  }

  const save = async () => {
    const nextErrors = validate()
    setErrors(nextErrors)
    if (
      nextErrors.name ||
      nextErrors.basePrice ||
      nextErrors.baseDuration ||
      nextErrors.variations.some(Boolean) ||
      nextErrors.addOns.some(Boolean)
    ) {
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const draft = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        basePrice: birrToMinor(parseBirr(form.basePriceBirr) as number),
        baseDurationMinutes: Number(form.baseDurationMinutes),
        variations: variations.map((row) => ({
          id: row.id,
          name: row.name.trim(),
          priceDelta: birrToMinor(parseBirr(row.priceDeltaBirr) as number),
          durationDeltaMinutes: Number(row.durationDeltaMinutes),
        })),
        addOns: addOns.map((row) => ({
          id: row.id,
          name: row.name.trim(),
          price: birrToMinor(parseBirr(row.priceBirr) as number),
          durationMinutes: Number(row.durationMinutes),
        })),
      }
      const result = isNew
        ? await mockOwnerApi.createService(draft)
        : await mockOwnerApi.updateService(existing!.id, draft)
      if (!result.ok) {
        setSaveError(result.error)
        return
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
    } catch {
      setSaveError('Could not save the service. Please try again.')
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

          <Field label="Description (optional)" hint="Shown on your public page.">
            {({ id, ariaDescribedBy }) => (
              <textarea
                id={id}
                className="textarea"
                rows={3}
                value={form.description}
                aria-describedby={ariaDescribedBy}
                onChange={(event) => setFormField('description', event.target.value)}
              />
            )}
          </Field>
        </div>

        <fieldset className="subsection">
          <legend className="subsection__legend">
            Variations <span className="subsection__hint">adds price and/or time to a booking</span>
          </legend>
          {variations.length === 0 && (
            <p className="subsection__empty">No variations.</p>
          )}
          <ul className="option-rows">
            {variations.map((row, index) => (
              <li key={row.id} className="option-row">
                <Field label={`Variation ${index + 1}`} error={errors.variations[index] ?? undefined}>
                  {({ id, ariaDescribedBy }) => (
                    <input
                      id={id}
                      className="input"
                      value={row.name}
                      aria-describedby={ariaDescribedBy}
                      onChange={(event) => updateVariation(row.id, { name: event.target.value })}
                    />
                  )}
                </Field>
                <Field label={`Change to price (Birr) ${index + 1}`}>
                  {({ id }) => (
                    <input
                      id={id}
                      className="input"
                      type="number"
                      step="0.01"
                      min={0}
                      value={row.priceDeltaBirr}
                      onChange={(event) =>
                        updateVariation(row.id, { priceDeltaBirr: event.target.value })
                      }
                    />
                  )}
                </Field>
                <Field label={`Extra minutes ${index + 1}`}>
                  {({ id }) => (
                    <input
                      id={id}
                      className="input"
                      type="number"
                      step={1}
                      min={0}
                      value={row.durationDeltaMinutes}
                      onChange={(event) =>
                        updateVariation(row.id, {
                          durationDeltaMinutes: event.target.value,
                        })
                      }
                    />
                  )}
                </Field>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setVariations((rows) => rows.filter((r) => r.id !== row.id))}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setVariations((rows) => [
                ...rows,
                { id: localId(), name: '', priceDeltaBirr: '0', durationDeltaMinutes: '0' },
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
            {addOns.map((row, index) => (
              <li key={row.id} className="option-row">
                <Field label={`Add-on ${index + 1}`} error={errors.addOns[index] ?? undefined}>
                  {({ id, ariaDescribedBy }) => (
                    <input
                      id={id}
                      className="input"
                      value={row.name}
                      aria-describedby={ariaDescribedBy}
                      onChange={(event) => updateAddOn(row.id, { name: event.target.value })}
                    />
                  )}
                </Field>
                <Field label={`Price (Birr) ${index + 1}`}>
                  {({ id }) => (
                    <input
                      id={id}
                      className="input"
                      type="number"
                      step="0.01"
                      min={0}
                      value={row.priceBirr}
                      onChange={(event) => updateAddOn(row.id, { priceBirr: event.target.value })}
                    />
                  )}
                </Field>
                <Field label={`Minutes ${index + 1}`}>
                  {({ id }) => (
                    <input
                      id={id}
                      className="input"
                      type="number"
                      step={1}
                      min={0}
                      value={row.durationMinutes}
                      onChange={(event) =>
                        updateAddOn(row.id, { durationMinutes: event.target.value })
                      }
                    />
                  )}
                </Field>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAddOns((rows) => rows.filter((r) => r.id !== row.id))}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setAddOns((rows) => [
                ...rows,
                { id: localId(), name: '', priceBirr: '0', durationMinutes: '0' },
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