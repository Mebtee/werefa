import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { isApiError, toUserMessage } from '@/api/errors'
import type { BusinessCategory } from '@/types/models'
import {
  changeOwnedBusinessSlug,
  updateOwnedBusinessProfile,
} from '@/api/business'
import { categoryToCode } from '@/api/business.mapper'
import { useOwnedBusiness } from '@/features/owner-portal/state/useOwnedBusiness'
import { LoadState } from '@/features/owner-portal/components/LoadState'
import { ImagePicker } from '@/features/owner-portal/components/ImagePicker'
import { MockQrCode } from '@/features/owner-portal/components/MockQrCode'
import { PauseCard } from '@/features/owner-portal/components/PauseCard'
import { CATEGORY_LABEL } from '@/features/owner-portal/lib/labels'
import { mockOwnerApi, type BrandingPatch } from '@/mock/ownerApi'
import { mapUrl } from '@/lib/format'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'

interface BusinessForm {
  name: string
  category: BusinessCategory
  description: string
  phone: string
  address: string
  lat: string
  lng: string
}

function fromBusiness(b: {
  name: string
  category: BusinessCategory
  description: string
  phone: string
  address: string
  lat: number | null
  lng: number | null
}): BusinessForm {
  return {
    name: b.name,
    category: b.category,
    description: b.description,
    phone: b.phone,
    address: b.address,
    lat: b.lat === null ? '' : String(b.lat),
    lng: b.lng === null ? '' : String(b.lng),
  }
}

interface ParseErrors {
  name?: string
  lat?: string
  lng?: string
}

/** Mirrors the backend ChangeSlugPayload rule (lowercase + single hyphens), 2–64 chars. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function BusinessProfilePage() {
  const { business, businessId, loading, error, reload } = useOwnedBusiness()
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

  // Branding (logo / cover photo) — still demo-only: the real business API has
  // no file storage yet, so uploads stay in the in-memory mock store.
  const [brandingBusy, setBrandingBusy] = useState(false)
  const [brandingError, setBrandingError] = useState<string | null>(null)
  const [brandingSuccess, setBrandingSuccess] = useState(false)

  const saveBranding = async (patch: BrandingPatch) => {
    setBrandingBusy(true)
    setBrandingError(null)
    setBrandingSuccess(false)
    try {
      const result = await mockOwnerApi.saveBranding(patch)
      if (!result.ok) {
        setBrandingError(result.error)
        return
      }
      setBrandingSuccess(true)
      await reload()
    } catch {
      setBrandingError('Could not save the image. Please try again.')
    } finally {
      setBrandingBusy(false)
    }
  }

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

  if (!business || !form || !saved || !businessId) {
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
    if (Number.isNaN(lat) || lat < -90 || lat > 90) {
      next.lat = 'Enter a valid latitude between -90 and 90.'
    }
    if (Number.isNaN(lng) || lng < -180 || lng > 180) {
      next.lng = 'Enter a valid longitude between -180 and 180.'
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
      await updateOwnedBusinessProfile(businessId, {
        name: form.name.trim(),
        categoryCode: categoryToCode(form.category),
        description: form.description.trim(),
        phonePublic: form.phone.trim(),
        address: form.address.trim(),
        latitude: form.lat.trim() === '' ? undefined : Number(form.lat),
        longitude: form.lng.trim() === '' ? undefined : Number(form.lng),
      })
      setSaved({ ...form })
      setSaveSuccess(true)
      await reload()
    } catch (saveThrown) {
      setSaveError(
        isApiError(saveThrown)
          ? toUserMessage(saveThrown)
          : 'Could not save your changes. Please try again.',
      )
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
    if (
      trimmed.length < 2 ||
      trimmed.length > 64 ||
      !SLUG_PATTERN.test(trimmed)
    ) {
      setSlugError(
        'Use 5–64 characters: lowercase letters, numbers and single hyphens, no leading or trailing dash.',
      )
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
      await changeOwnedBusinessSlug(businessId, trimmed)
      setSlugSuccess(true)
      await reload()
    } catch (slugThrown) {
      setSlugError(
        isApiError(slugThrown) && slugThrown.kind === 'conflict'
          ? 'That public link is already taken by another business.'
          : 'Could not update the public link. Please try again.',
      )
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
              <Field
                label="Latitude"
                hint="Used for the map link on your public page."
                error={errors.lat}
              >
                {({ id, ariaDescribedBy }) => (
                  <input
                    id={id}
                    className="input"
                    type="number"
                    step="any"
                    min={-90}
                    max={90}
                    value={form.lat}
                    aria-describedby={ariaDescribedBy}
                    onChange={(event) => setField('lat', event.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Longitude"
                hint="Used for the map link on your public page."
                error={errors.lng}
              >
                {({ id, ariaDescribedBy }) => (
                  <input
                    id={id}
                    className="input"
                    type="number"
                    step="any"
                    min={-180}
                    max={180}
                    value={form.lng}
                    aria-describedby={ariaDescribedBy}
                    onChange={(event) => setField('lng', event.target.value)}
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
            <h2 className="card__title">Branding</h2>
            <p className="card__subtitle">
              Your logo and one cover photo are shown on the public page.
            </p>
          </div>
        </div>

        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert tone="info" title="Demo-only previews">
            Real image hosting is not part of this phase, so uploads stay in the
            local demo store and are not sent to the backend.
          </Alert>
        </div>

        {brandingError && (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <Alert tone="danger">{brandingError}</Alert>
          </div>
        )}
        {brandingSuccess && (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <Alert tone="success" live="polite">
              Branding updated. Your public page is up to date.
            </Alert>
          </div>
        )}

        <div className="branding-section__pair">
          <ImagePicker
            current={business.logo}
            onSaved={(asset) => void saveBranding({ logo: asset })}
            label="Logo"
            busy={brandingBusy}
          />
          <ImagePicker
            current={business.coverPhoto}
            onSaved={(asset) => void saveBranding({ coverPhoto: asset })}
            label="Cover photo"
            busy={brandingBusy}
          />
        </div>
      </section>

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

        <div className="public-url-card" style={{ marginTop: 'var(--space-4)' }}>
          <div className="public-url-card__row">
            <span className="public-url-card__link" data-testid="public-page-link">
              werefa.app/p/{business.slug}
            </span>
            <Link
              className="btn btn--outline btn--sm"
              to={`/p/${business.slug}`}
              data-testid="open-public-page"
            >
              Open public page
            </Link>
          </div>

          <p className="map-link">
            Location link:{' '}
            <a
              href={mapUrl(business.lat, business.lng, business.mapProvider)}
              target="_blank"
              rel="noreferrer"
            >
              {business.mapProvider === 'google'
                ? 'Google Maps'
                : 'OpenStreetMap'}{' '}
              preview
            </a>
          </p>

          <div className="public-url-card__qr">
            <MockQrCode slug={business.slug} className="qr-svg" />
            <p className="public-url-card__qr-hint">
              QR code mock — encodes this real booking link and updates if the
              link changes. A real QR encoder is added at integration time.
            </p>
          </div>
        </div>
      </section>

      <div style={{ marginTop: 'var(--space-4)' }}>
        <PauseCard businessId={businessId} business={business} onChanged={reload} />
      </div>
    </>
  )
}