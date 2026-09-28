import { useState, type ChangeEvent } from 'react'
import type {
  BusinessDetails,
  Money,
  PaymentMethodId,
  ProofFile,
} from '@/types/models'
import { formatBytes, formatMoney } from '@/lib/format'
import { validateProofFile } from '@/lib/validation'
import {
  PAYMENT_METHOD_IDS as PUBLISHABLE_METHOD_IDS,
  PAYMENT_METHOD_LABEL,
} from '@/lib/paymentMethods'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

interface PaymentStepProps {
  business: BusinessDetails
  deposit: Money
  paymentMethod: PaymentMethodId | null
  setPayment: (method: PaymentMethodId) => void
  proof: ProofFile | null
  setProof: (proof: ProofFile | null) => void
  onBack: () => void
  onSubmit: () => void
  submitting: boolean
}

export function PaymentStep({
  business,
  deposit,
  paymentMethod,
  setPayment,
  proof,
  setProof,
  onBack,
  onSubmit,
  submitting,
}: PaymentStepProps) {
  const [proofError, setProofError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  // The public business API (PublicBusinessView) carries no owner-published
  // payment instructions — there is no such field to read. So nothing is
  // invented here: the deposit AMOUNT is the backend-computed value from the
  // availability view, and the only choices offered are the two method codes the
  // booking API actually accepts. The customer is told plainly that the
  // destination account is not published online, instead of being shown
  // fabricated bank or mobile-money details.
  const methods = PUBLISHABLE_METHOD_IDS.map((id) => ({ id, label: PAYMENT_METHOD_LABEL[id] }))

  const handleProofChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    if (!file) {
      setProof(null)
      return
    }
    const result = validateProofFile(file)
    if (result.ok) {
      setProof(result.proof)
      setProofError(null)
    } else {
      setProof(null)
      setProofError(result.error.message)
      // Allow picking the same file again after an invalid choice.
      event.target.value = ''
    }
  }

  const ready = paymentMethod !== null && proof !== null

  const handleSubmit = () => {
    setTouched(true)
    if (!ready) return
    onSubmit()
  }

  return (
    <>
      <h2 className="step-title">Payment & confirmation</h2>
      <p className="step-subtitle">
        Send the deposit, then attach your proof. The business confirms once
        the payment is reviewed.
      </p>

      <Alert tone="info" title="Deposit to pay">
        Please pay{' '}
        <strong>{formatMoney(deposit, business.currency)}</strong> using one of
        the methods below, then attach the proof.
      </Alert>

      <h3 className="option-group__title">Payment method</h3>
      <Alert tone="warning" title="Payment details are not published online">
        This business requires a deposit, but its booking page does not publish
        a bank account or mobile-money number. Ask the business where to send the
        deposit, then choose how you paid and attach your proof.
      </Alert>
      <div className="payment-methods" role="radiogroup" aria-label="Payment method">
        {methods.map((method) => {
          const active = method.id === paymentMethod
          return (
            <label
              key={method.id}
              className={cn('payment-option', active && 'payment-option--active')}
            >
              <input
                type="radio"
                name="payment-method"
                value={method.id}
                checked={active}
                onChange={() => setPayment(method.id)}
              />
              <span>
                <span className="payment-option__label">{method.label}</span>
              </span>
            </label>
          )
        })}
      </div>

      <h3 className="option-group__title">Attach payment proof</h3>
      {proof ? (
        <div className="proof-preview">
          <span>
            <strong>{proof.fileName}</strong>{' '}
            <span className="line-item__meta">
              ({formatBytes(proof.sizeBytes)} · {proof.mimeType})
            </span>
          </span>
          <Button variant="outline" onClick={() => setProof(null)}>
            Replace
          </Button>
        </div>
      ) : (
        <div className="upload-zone">
          <label className="upload-zone__label" htmlFor="proof-upload">
            Choose image or PDF
          </label>
          <input
            id="proof-upload"
            className="sr-only"
            type="file"
            accept="image/bmp,image/gif,image/jpeg,image/png,image/webp,application/pdf,.pdf"
            onChange={handleProofChange}
          />
          <p className="line-item__meta">
            Screenshot of your bank/Telebirr transfer, or the PDF receipt. Max
            5 MB. Only the business you are booking with can see it.
          </p>
        </div>
      )}

      {proofError && (
        <Alert tone="danger" title="Could not use that proof">
          {proofError}
        </Alert>
      )}

      {touched && !ready && (
        <Alert tone="warning" title="Almost there">
          {!paymentMethod && 'Choose a payment method. '}
          {!proof && 'Attach your payment proof.'}
        </Alert>
      )}

      <nav className="wizard__nav" aria-label="Payment step actions">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmit}
          loading={submitting}
          disabled={submitting}
        >
          Confirm & send booking request
        </Button>
      </nav>
    </>
  )
}