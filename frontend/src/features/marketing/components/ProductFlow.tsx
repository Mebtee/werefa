import { Reveal } from './Reveal'
import { SectionHeading } from './SectionHeading'

const STAGES = [
  { step: '01', label: 'Business sets up', detail: 'Services, prices, durations and working hours.' },
  { step: '02', label: 'Customer opens the link', detail: 'Via the public booking link or a scanned QR code.' },
  { step: '03', label: 'Customer selects a service', detail: 'With its price and duration shown up front.' },
  { step: '04', label: 'Customer chooses a time', detail: 'From the time slots your schedule offers.' },
  { step: '05', label: 'Booking request is sent', detail: 'The customer submits their details once.' },
  { step: '06', label: 'Payment proof if required', detail: 'When prepayment is configured for the business.' },
  { step: '07', label: 'Business reviews', detail: 'Approve or decline the request and its proof.' },
  { step: '08', label: 'Booking confirmed', detail: 'The customer finds the result via booking status.' },
] as const

/**
 * Product flow visualization. This is a static explanation of the real booking
 * lifecycle — it does not submit anything, and each stage corresponds to a
 * capability that actually exists in the product.
 */
export function ProductFlow() {
  return (
    <section className="mkt-section mkt-flow" id="product" aria-labelledby="mkt-flow-title">
      <div className="mkt-container">
        <Reveal>
          <SectionHeading
            id="mkt-flow-title"
            eyebrow="The booking journey"
            title="From setup to a confirmed booking"
            lead="A single, clear path for the customer — and a reviewable record for you."
          />
        </Reveal>

        <ol className="mkt-flow__list">
          {STAGES.map((stage, index) => (
            <Reveal
              as="li"
              className="mkt-flow__item"
              key={stage.step}
              delay={Math.min(index * 60, 300)}
            >
              <span className="mkt-flow__step" aria-hidden="true">
                {stage.step}
              </span>
              <span className="mkt-flow__connector" aria-hidden="true" />
              <span className="mkt-flow__label">{stage.label}</span>
              <span className="mkt-flow__detail">{stage.detail}</span>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  )
}
