import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { createOwnedBusiness } from '@/api/business'
import { isApiError } from '@/api/errors'
import type { BusinessCategoryCode } from '@/api/types'
import { useOptionalOwnerBusinessContext } from '@/features/owner-portal/state/OwnerBusinessContext'

/** Unique slug prefix is optional; the whole slug is validated and normalized
 * by the backend. These are render-before-post field checks only. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

interface CreateBusinessFieldErrors {
  slug?: string
  name?: string
  categoryCode?: string
}

/**
 * Owner onboarding: create the first owned business (Prompt 54; REQ-061/063/
 * 064/066/068/069/013). Deliberately includes the business-type (category)
 * choice with the two allowlisted codes and a phone-public mapping; ownership
 * stays server-derived (REQ-066), the absence of an owned business routes the
 * owner here, and the frontend never sends an owner id or client-trusted
 * ownership.
 */
export function CreateBusinessPage() {
  const navigate = useNavigate()
  const businessContext = useOptionalOwnerBusinessContext()

  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [categoryCode, setCategoryCode] = useState<BusinessCategoryCode>('SALON_AND_BARBER')
  const [description, setDescription] = useState('')
  const [address, setAddress] = useState('')
  const [phonePublic, setPhonePublic] = useState('')
  const [bookingIntervalMinutes, setBookingIntervalMinutes] = useState('30')

  const [fieldErrors, setFieldErrors] = useState<CreateBusinessFieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const nextErrors: CreateBusinessFieldErrors = {}
    const trimmedSlug = slug.trim()
    const trimmedName = name.trim()
    if (!trimmedSlug) {
      nextErrors.slug = 'Enter a public slug (the scheduling link gets its URL from it).'
    } else if (!SLUG_PATTERN.test(trimmedSlug)) {
      nextErrors.slug = 'Use lowercase letters, digits, and hyphens only.'
    }
    if (!trimmedName) {
      nextErrors.name = 'Enter the business name.'
    }
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSubmitting(true)
    setFormError(null)
    const interval = Number(bookingIntervalMinutes)
    createOwnedBusiness({
      slug: trimmedSlug,
      name: trimmedName,
      categoryCode,
      description: description.trim() || undefined,
      address: address.trim() || undefined,
      phonePublic: phonePublic.trim() || undefined,
      bookingIntervalMinutes: Number.isFinite(interval) && interval > 0 ? interval : undefined,
    })
      .then((business) => {
        businessContext?.addBusiness(business)
        navigate('/owner', { replace: true })
      })
      .catch((error: unknown) => {
        setFormError(
          isApiError(error) ? error.message : 'Could not create the business. Try again.',
        )
        setSubmitting(false)
      })
  }

  return (
    <div className="auth-screen page-root">
      <div className="auth-screen__card card">
        <div className="auth-brand">
          <span className="auth-brand__mark" aria-hidden="true">
            W
          </span>
          <div>
            <div className="auth-brand__name">Werefa</div>
            <h1 className="auth-brand__sub">Set up your business</h1>
          </div>
        </div>

        {formError ? (
          <Alert tone="danger" title="Setup failed">
            {formError}
          </Alert>
        ) : null}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <Field label="Public slug" error={fieldErrors.slug}>
            {({ id, ariaDescribedBy }) => (
              <input
                id={id}
                className="input"
                name="slug"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                aria-describedby={ariaDescribedBy}
                aria-invalid={Boolean(fieldErrors.slug) || undefined}
                disabled={submitting}
                autoComplete="off"
              />
            )}
          </Field>

          <Field label="Business name" error={fieldErrors.name}>
            {({ id, ariaDescribedBy }) => (
              <input
                id={id}
                className="input"
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-describedby={ariaDescribedBy}
                aria-invalid={Boolean(fieldErrors.name) || undefined}
                disabled={submitting}
              />
            )}
          </Field>

          <fieldset className="field-group">
            <legend className="field-group__legend">Business type</legend>
            <p className="field-group__hint">
              This decides the customer-facing category on your profile
              (REQ-213). It never affects sign-in or ownership.
            </p>
            <label className="field-group__choice">
              <input
                type="radio"
                name="categoryCode"
                value="SALON_AND_BARBER"
                checked={categoryCode === 'SALON_AND_BARBER'}
                onChange={() => setCategoryCode('SALON_AND_BARBER')}
                disabled={submitting}
              />
              <span>
                <strong>Salon &amp; barber</strong>
                <small>Hair, beauty, and grooming services.</small>
              </span>
            </label>
            <label className="field-group__choice">
              <input
                type="radio"
                name="categoryCode"
                value="OTHER"
                checked={categoryCode === 'OTHER'}
                onChange={() => setCategoryCode('OTHER')}
                disabled={submitting}
              />
              <span>
                <strong>Other</strong>
                <small>Any other service category accepted by the platform.</small>
              </span>
            </label>
          </fieldset>

          <Field label="Description (optional)">
            {({ id, ariaDescribedBy }) => (
              <textarea
                id={id}
                className="input"
                name="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                aria-describedby={ariaDescribedBy}
                disabled={submitting}
                rows={3}
              />
            )}
          </Field>

          <Field label="Address (optional)">
            {({ id, ariaDescribedBy }) => (
              <input
                id={id}
                className="input"
                name="address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                aria-describedby={ariaDescribedBy}
                disabled={submitting}
              />
            )}
          </Field>

          <Field label="Public phone (optional)">
            {({ id, ariaDescribedBy }) => (
              <input
                id={id}
                className="input"
                name="phonePublic"
                type="tel"
                value={phonePublic}
                onChange={(event) => setPhonePublic(event.target.value)}
                aria-describedby={ariaDescribedBy}
                disabled={submitting}
              />
            )}
          </Field>

          <Field label="Booking slot length (minutes)">
            {({ id, ariaDescribedBy }) => (
              <select
                id={id}
                className="input"
                name="bookingIntervalMinutes"
                value={bookingIntervalMinutes}
                onChange={(event) => setBookingIntervalMinutes(event.target.value)}
                aria-describedby={ariaDescribedBy}
                disabled={submitting}
              >
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">60 minutes</option>
              </select>
            )}
          </Field>

          <Button type="submit" variant="primary" block loading={submitting}>
            {submitting ? 'Setting up…' : 'Create business'}
          </Button>
        </form>
      </div>
    </div>
  )
}
