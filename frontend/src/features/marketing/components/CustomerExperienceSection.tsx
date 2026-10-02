import { Reveal } from './Reveal'
import { SectionHeading } from './SectionHeading'

const STEPS = [
  'Choose a service',
  'Choose a date and time',
  'Enter your details',
  'Submit the booking',
  'Upload payment proof if prepayment is required',
  'Receive updates',
] as const

/**
 * Customer experience. Customers never need a Werefa account — this is an
 * important product characteristic, stated explicitly and prominently.
 */
export function CustomerExperienceSection() {
  return (
    <section
      className="mkt-section"
      id="customer-experience"
      aria-labelledby="mkt-customer-title"
    >
      <div className="mkt-container mkt-customer">
        <Reveal className="mkt-customer__copy">
          <SectionHeading
            id="mkt-customer-title"
            eyebrow="For your customers"
            title="Booking that takes a minute, not a phone call"
            lead="Customers open your link, pick a service and a time, and send the request. No app to install."
          />
          <p className="mkt-customer__highlight">
            Customers do not need a Werefa account. Nobody has to sign up before
            booking with you.
          </p>
        </Reveal>

        <ol className="mkt-customer__flow">
          {STEPS.map((step, index) => (
            <Reveal as="li" className="mkt-customer__step" key={step} delay={index * 55}>
              <span className="mkt-customer__dot" aria-hidden="true">
                {index + 1}
              </span>
              <span className="mkt-customer__label">{step}</span>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  )
}
