import { Reveal } from './Reveal'
import { SectionHeading } from './SectionHeading'
import { CheckCircleIcon, ReceiptIcon, ShieldIcon } from './icons'

const WORKFLOW = [
  'You decide whether prepayment is required, and how it is configured.',
  'The customer receives the required payment information during the booking flow.',
  'The customer submits their payment proof with the request.',
  'You review the proof from your dashboard.',
  'The booking is confirmed according to your existing workflow.',
] as const

const METHODS = ['Bank Transfer', 'Telebirr / mobile money'] as const

/**
 * Prepayment and payment-proof explanation. Only describes the implemented
 * workflow: the business configures prepayment, the customer submits proof and
 * the owner reviews it. No card gateway, no automatic refunds.
 */
export function PaymentSection() {
  return (
    <section className="mkt-section mkt-payment" id="payment" aria-labelledby="mkt-payment-title">
      <div className="mkt-container mkt-payment__inner">
        <Reveal className="mkt-payment__copy">
          <SectionHeading
            id="mkt-payment-title"
            eyebrow="Payments"
            title="Get paid before the appointment — when your business requires it"
            lead="When prepayment is configured, the booking flow collects a payment proof and your dashboard lets you review it before confirming."
          />

          <ol className="mkt-payment__steps">
            {WORKFLOW.map((step, index) => (
              <li className="mkt-payment__step" key={step}>
                <span className="mkt-payment__step-number" aria-hidden="true">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>

          <div className="mkt-payment__methods">
            <p className="mkt-payment__methods-title">Supported customer payment methods</p>
            <ul className="mkt-payment__method-list">
              {METHODS.map((method) => (
                <li className="mkt-payment__method" key={method}>
                  <ReceiptIcon className="mkt-payment__method-icon" />
                  {method}
                </li>
              ))}
            </ul>
            <p className="mkt-payment__note">
              Werefa does not process card payments automatically. Customers pay
              directly using the method you configure, and you confirm the booking
              after reviewing their proof.
            </p>
          </div>
        </Reveal>

        <Reveal className="mkt-payment__panel" delay={80}>
          <div className="mkt-payment__panel-tag">Illustrative preview</div>
          <div className="mkt-payment__panel-card">
            <div className="mkt-payment__panel-head">
              <ShieldIcon className="mkt-payment__panel-icon" />
              <span>Payment proof review</span>
            </div>
            <ul className="mkt-payment__panel-list">
              <li>
                <CheckCircleIcon className="mkt-mock__icon" />
                Proof submitted by customer
              </li>
              <li>
                <CheckCircleIcon className="mkt-mock__icon" />
                Method · Bank Transfer / mobile money
              </li>
              <li>
                <CheckCircleIcon className="mkt-mock__icon" />
                Owner reviews and confirms
              </li>
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
