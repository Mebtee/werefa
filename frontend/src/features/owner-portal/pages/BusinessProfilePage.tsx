import { useEffect, useRef, useState } from 'react'
import type { BusinessCategory, MapProvider } from '@/types/models'
import { useOwnedBusiness } from '@/features/owner-portal/state/useOwnedBusiness'
import { LoadState } from '@/features/owner-portal/components/LoadState'
import { CATEGORY_LABEL } from '@/features/owner-portal/lib/labels'
import { mockOwnerApi } from '@/mock/ownerApi'
import { validatePublicSlug } from '@/mock/store'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'

interface BusinessForm {
  name: string
  category: BusinessCategory
  tagline: string
  description: string
  accentColor: string
  phone: string
  address: string
  lat: string
  lng: string
  mapProvider: MapProvider
  bookingWindowDays: string
}

function fromBusiness(b: {
  name: string
  category: BusinessCategory
  tagline: string
  description: string
  accentColor: string
  phone: string
  address: string
  lat: number
  lng: number
  mapProvider: MapProvider
  bookingWindowDays: number
}): BusinessForm {
  return {
    name: b.name,
    category: b.category,
    tagline: b.tagline,
    description: b.description,
    accentColor: b.accentColor,
    phone: b.phone,
    address: b.address,
    lat: String(b.lat),
    lng: String(b.lng),
    mapProvider: b.mapProvider,
    bookingWindowDays: String(b.bookingWindowDays),
  }
}

interface ParseErrors {
  name?: string
  lat?: string
  lng?: string
  bookingWindowDays?: string
  accentColor?: string
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export function BusinessProfilePage() {
  const { business, loading, error, reload } = useOwnedBusiness()
  const initialized = useRef(false)

  const [form, setForm] = useState<BusinessForm | null>(null)
  const [saved, setSaved] = useState<BusinessForm | null>(null)
  const [errors, setErrors] = useState<ParseErrors>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Slug editor
  const [slugInput, setSlugInput] = useState('')
  const [slugError, setSlugError] = useState<string | null>(null)
  const [slugSuccess, setSlugSuccess] = useState(false)
  const [savingSlug, setSavingSlug] = useState(false)

  useEffect(() => {
    if (initialized.current || !business) return
    initialized.current = true
    const initial = fromBusiness(business)
    setForm(initial)
    setSaved(initial)
    setSlugInput(business.slug)
  }, [business])

  // Keep the slug input in step with the saved value without interrupting
  // in-progress typing in the profile form.
  useEffect(() => {
    if (business) setSlugInput(business.slug)
  }, [business])

  if (!business || !form || !saved) {
    return (
      <LoadState loading={loading || form === null} error={error} onRetry={reload}>
        {null}
      </LoadState>
    )
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(saved)

  const setField = <K extends keyof BusinessForm>(key: K, value: BusinessForm[K]) => {
    setForm({ ...form, [key]: value })
    setSaveSuccess(false)
  }

  const validate = (): ParseErrors => {
    const next: ParseErrors = {}
    if (!form.name.trim()) next.name = 'Please enter your business name.'
    const lat = Number(form.lat)
    const lng = Number(form.lng)
    if (Number.isNaN(lat)) next.lat = 'Enter a valid latitude.'
    if (Number.isNaN(lng)) next.lng = 'Enter a valid longitude.'
    const days = Number(form.bookingWindowDays)
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      next.bookingWindowDays = 'Enter a whole number of days between 1 and 365.'
    }
    if (!HEX_COLOR.test(form.accentColor)) {
      next.accentColor = 'Enter a colour as a 6-digit hex code, e.g. #b4457f.'
    }
    return next
  }

  const save = async () => {
    const nextErrors = validate()
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)
    try {
      const result = await mockOwnerApi.saveProfile({
        name: form.name.trim(),
        category: form.category,
        tagline: form.tagline.trim(),
        description: form.description.trim(),
        accentColor: form.accentColor,
        phone: form.phone.trim(),
        address: form.address.trim(),
        lat: Number(form.lat),
        lng: Number(form.lng),
        mapProvider: form.mapProvider,
        bookingWindowDays: Math.trunc(Number(form.bookingWindowDays)),
      })
      if (!result.ok) {
        setSaveError(result.error)
        return
      }
      setSaved({ ...form })
      setSaveSuccess(true)
      await reload()
    } catch {
      setSaveError('Could not save your changes. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    if (saved) {
      setForm({ ...saved })
    }
    setErrors({})
    setSaveError(null)
    setSaveSuccess(false)
  }

  const saveSlug = async () => {
    const trimmed = slugInput.trim()
    const invalid = validatePublicSlug(trimmed)
    if (invalid) {
      setSlugError(invalid)
      return
    }
    if (trimmed === business.slug) {
      setSlugError(null)
      setSlugSuccess(false)
      return
    }
    setSavingSlug(true)
    setSlugError(null)
    setSlugSuccess(false)
    try {
      const result = await mockOwnerApi.changePublicSlug(trimmed)
      if (!result.ok) {
        setSlugError(result.error)
        return
      }
      setSlugSuccess(true)
      await reload()
    } catch {
      setSlugError('Could not update the public link. Please try again.')
    } finally {
      setSavingSlug(false)
    }
  }

  return (
    <>
      <h1 className="page-title">Business profile</h1>
      <p className="page-subtitle">
        These details are shown on your public page.
      </p>

      {saveError && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert tone="danger">{saveError}</Alert>
        </div>
      )}
      {saveSuccess && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert tone="success" live="polite">
            Profile saved. Your public page is up to date.
          </Alert>
        </div>
      )}
      {dirty && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert tone="warning" title="Unsaved changes">
            You have unsaved changes to this profile.
          </Alert>
        </div>
      )}

      <div className="card card--padded">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <div className="form-grid">
            <Field label="Business name" error={errors.name}>
              {({ id, ariaDescribedBy }) => (
                <input
                  id={id}
                  className="input"
                  value={form.name}
                  aria-describedby={ariaDescribedBy}
                  onChange={(event) => setField('name', event.target.value)}
                />
              )}
            </Field>

            <fieldset className="form-choices">
              <legend className="form-choices__legend">Category</legend>
              {(Object.keys(CATEGORY_LABEL) as BusinessCategory[]).map((key) => (
                <label key={key} className="form-choices__choice">
                  <input
                    type="radio"
                    name="category"
                    value={key}
                    checked={form.category === key}
                    onChange={() => setField('category', key)}
                  />
                  {CATEGORY_LABEL[key]}
                </label>
              ))}
            </fieldset>

            <Field label="Tagline" hint="A short line shown under your name.">
              {({ id, ariaDescribedBy }) => (
                <input
                  id={id}
                  className="input"
                  value={form.tagline}
                  maxLength={90}
                  aria-describedby={ariaDescribedBy}
                  onChange={(event) => setField('tagline', event.target.value)}
                />
              )}
            </Field>

            <Field
              label="Description"
              hint="A few sentences customers read before booking."
            >
              {({ id, ariaDescribedBy }) => (
                <textarea
                  id={id}
                  className="textarea"
                  rows={4}
                  value={form.description}
                  aria-describedby={ariaDescribedBy}
                  onChange={(event) => setField('description', event.target.value)}
                />
              )}
            </Field>

            <Field
              label="Public phone number"
              hint="Shown on your page; customers also use it to identify their booking."
            >
              {({ id, ariaDescribedBy }) => (
                <input
                  id={id}
                  className="input"
                  type="tel"
                  value={form.phone}
                  aria-describedby={ariaDescribedBy}
                  onChange={(event) => setField('phone', event.target.value)}
                />
              )}
            </Field>

            <Field label="Address">
              {({ id, ariaDescribedBy }) => (
                <input
                  id={id}
                  className="input"
                  value={form.address}
                  aria-describedby={ariaDescribedBy}
                  onChange={(event) => setField('address', event.target.value)}
                />
              )}
            </Field>

            <div className="form-grid__pair">
              <Field label="Latitude" error={errors.lat}>
                {({ id, ariaDescribedBy }) => (
                  <input
                    id={id}
                    className="input"
                    type="number"
                    step="any"
                    value={form.lat}
                    aria-describedby={ariaDescribedBy}
                    onChange={(event) => setField('lat', event.target.value)}
                  />
                )}
              </Field>
              <Field label="Longitude" error={errors.lng}>
                {({ id, ariaDescribedBy }) => (
                  <input
                    id={id}
                    className="input"
                    type="number"
                    step="any"
                    value={form.lng}
                    aria-describedby={ariaDescribedBy}
                    onChange={(event) => setField('lng', event.target.value)}
                  />
                )}
              </Field>
            </div>

            <Field label="Map provider">
              {({ id, ariaDescribedBy }) => (
                <select
                  id={id}
                  className="select"
                  value={form.mapProvider}
                  aria-describedby={ariaDescribedBy}
                  onChange={(event) =>
                    setField('mapProvider', event.target.value as MapProvider)
                  }
                >
                  <option value="osm">OpenStreetMap</option>
                  <option value="google">Google Maps</option>
                </select>
              )}
            </Field>

            <div className="form-grid__pair">
              <Field
                label="Accent colour"
                hint="Used for buttons on your public page."
                error={errors.accentColor}
              >
                {({ id, ariaDescribedBy }) => (
                  <>
                    <input
                      id={id}
                      className="input"
                      value={form.accentColor}
                      pattern="^#[0-9a-fA-F]{6}$"
                      aria-describedby={ariaDescribedBy}
                      onChange={(event) => setField('accentColor', event.target.value)}
                    />
                    <input
                      type="color"
                      aria-label="Pick accent colour"
                      value={form.accentColor}
                      onChange={(event) => setField('accentColor', event.target.value)}
                    />
                  </>
                )}
              </Field>
              <Field
                label="Booking window (days)"
                hint="How far ahead customers can book."
                error={errors.bookingWindowDays}
              >
                {({ id, ariaDescribedBy }) => (
                  <input
                    id={id}
                    className="input"
                    type="number"
                    min={1}
                    max={365}
                    value={form.bookingWindowDays}
                    aria-describedby={ariaDescribedBy}
                    onChange={(event) =>
                      setField('bookingWindowDays', event.target.value)
                    }
                  />
                )}
              </Field>
            </div>
          </div>

          <div className="form-actions">
            <Button variant="primary" type="submit" loading={saving}>
              Save changes
            </Button>
            <Button variant="outline" type="button" onClick={discard} disabled={!dirty || saving}>
              Discard changes
            </Button>
          </div>
        </form>
      </div>

      <section className="card card--padded" style={{ marginTop: 'var(--space-4)' }}>
        <div className="card__header">
          <div>
            <h2 className="card__title">Public booking link</h2>
            <p className="card__subtitle">
              Exactly one link per business (REQ-007). Customers book at{' '}
              werefa.app/p/&#123;link&#125;.
            </p>
          </div>
        </div>

        {slugError && (
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <Alert tone="danger">{slugError}</Alert>
          </div>
        )}
        {slugSuccess && (
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <Alert tone="success" live="polite">
              Public link updated.
            </Alert>
          </div>
        )}

        <div className="slug-editor">
          <span className="slug-editor__prefix" aria-hidden="true">
            werefa.app/p/
          </span>
          <input
            className="input"
            aria-label="Public booking link"
            value={slugInput}
            onChange={(event) => {
              setSlugInput(event.target.value)
              setSlugError(null)
              setSlugSuccess(false)
            }}
          />
          <Button
            variant="primary"
            onClick={() => void saveSlug()}
            loading={savingSlug}
            disabled={slugInput.trim() === business.slug}
          >
            Save link
          </Button>
        </div>
      </section>
    </>
  )
}