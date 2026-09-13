import { useState, type FormEvent } from 'react'
import type { CustomerDetails } from '@/types/models'
import { validateCustomerDetails, type ValidationResult } from '@/lib/validation'
import { Field } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'

interface CustomerStepProps {
  customer: CustomerDetails
  setCustomerField: (field: keyof CustomerDetails, value: string) => void
  onBack: () => void
  onNext: () => void
}

export function CustomerStep({
  customer,
  setCustomerField,
  onBack,
  onNext,
}: CustomerStepProps) {
  const [errors, setErrors] = useState<ValidationResult['errors']>({})

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const result = validateCustomerDetails(customer)
    setErrors(result.errors)
    if (result.valid) onNext()
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h2 className="step-title">Your details</h2>
      <p className="step-subtitle">
        No account needed. Your phone number is how we identify your booking.
      </p>

      <Field
        label="Your name"
        error={errors.name}
        children={({ id, ariaDescribedBy }) => (
          <input
            id={id}
            className="input"
            type="text"
            autoComplete="name"
            value={customer.name}
            onChange={(event) => setCustomerField('name', event.target.value)}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={ariaDescribedBy}
          />
        )}
      />

      <Field
        label="Phone number"
        hint="We will call or message you about this booking."
        error={errors.phone}
        children={({ id, ariaDescribedBy }) => (
          <input
            id={id}
            className="input"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={customer.phone}
            onChange={(event) => setCustomerField('phone', event.target.value)}
            aria-invalid={errors.phone ? true : undefined}
            aria-describedby={ariaDescribedBy}
          />
        )}
      />

      <Field
        label="Note (optional)"
        hint="Anything the business should know — allergies, preferences, parking."
        error={errors.note}
        children={({ id, ariaDescribedBy }) => (
          <textarea
            id={id}
            className="textarea"
            value={customer.note}
            onChange={(event) => setCustomerField('note', event.target.value)}
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={ariaDescribedBy}
          />
        )}
      />

      <nav className="wizard__nav" aria-label="Your details step actions">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" type="submit">
          Continue to review
        </Button>
      </nav>
    </form>
  )
}