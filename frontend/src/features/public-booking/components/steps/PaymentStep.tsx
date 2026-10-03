import { useState } from 'react'
import type {
  BusinessDetails,
  Money,
  PaymentMethodId,
  ProofFile,
} from '@/types/models'
import { formatMoney } from '@/lib/format'
import {
  PAYMENT_METHOD_IDS as PUBLISHABLE_METHOD_IDS,
  PAYMENT_METHOD_LABEL,
} from '@/lib/paymentMethods'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { ProofPicker } from '@/components/proof/ProofPicker'
import { cn } from '@/lib/cn'
import { InfoIcon, ShieldIcon } from '@/components/ui/icons'

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
  const [touched, setTouched] = useState(false)

  // The public business API (PublicBusinessView) carries no owner-published
  // payment instructions — there is no such field to read. So nothing is
  // invented here: the deposit AMOUNT is the backend-computed value from the
  // availability view, and the only choices offered are the two method codes the
  // booking API actually accepts. The customer is told plainly that the
  // destination account is not published online, instead of being shown
  // fabricated transfer details.
  const methods = PUBLISHABLE_METHOD_IDS.map((id) => ({ id, label: PAYMENT_METHOD_LABEL[id] }))

  const ready = paymentMethod !== null && proof !== null

  const handleSubmit = () => {
    setTouched(true)
    if (!ready) return
    onSubmit()
  }

  return (
    <>
      <h2 className="step-title">Payment &amp; confirmation</h2>
      <p className="step-subtitle">
        Send the deposit, then attach your proof. The business confirms once the
        payment has been reviewed.
      </p>

      <div className="deposit-banner">
        <span className="deposit-banner__label">Deposit to pay</span>
        <span className="deposit-banner__amount">
          {formatMoney(deposit, business.currency)}
        </span>
        <span className="deposit-banner__note">
          This amount comes from {business.name} and is the same figure the
          booking request is checked against.
        </span>
      </div>

      <section className="step-section" aria-labelledby="payment-method-title">
        <h3 className="option-group__title" id="payment-method-title">
          Payment method
        </h3>
        <Alert tone="warning" title="Payment details are not published online">
          This business requires a deposit, but its booking page does not publish
          a destination to send it to. Ask the business where to send the deposit,
          then choose how you paid and attach your proof.
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
                  <span className="payment-option__hint">
                    <InfoIcon size={14} />
                    Choose the method you actually used
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      </section>

      <section className="step-section" aria-labelledby="proof-title">
        <h3 className="option-group__title" id="proof-title">
          Attach payment proof
        </h3>
        <ProofPicker
          inputId="proof-upload"
          proof={proof}
          onChange={setProof}
          busy={submitting}
          hint="Screenshot of your transfer, or the PDF receipt. Max 5 MB. Only the business you are booking with can see it."
        />
        <p className="step-note">
          <ShieldIcon size={15} />
          Your proof is sent to {business.name} alone and is never published on
          this page.
        </p>
      </section>

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
          Confirm &amp; send booking request
        </Button>
      </nav>
    </>
  )
}