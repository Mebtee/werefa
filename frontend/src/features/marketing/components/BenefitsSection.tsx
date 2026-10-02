import { Reveal } from './Reveal'
import { SectionHeading } from './SectionHeading'
import { ArrowRightIcon } from './icons'

const BENEFITS = [
  'Give customers a simple, always-available way to book.',
  'Cut the back-and-forth of scheduling messages.',
  'Keep services, prices and working hours organised in one place.',
  'Keep every booking request in a single business dashboard.',
  'Make prepayment verification easier with clear proof review.',
  'Give customers a clear view of their booking status.',
  'Keep schedule changes and special dates tidy.',
] as const

/** Qualitative benefits. No unsupported quantitative claims. */
export function BenefitsSection() {
  return (
    <section
      className="mkt-section mkt-section--tint"
      id="benefits"
      aria-labelledby="mkt-benefits-title"
    >
      <div className="mkt-container mkt-benefits">
        <Reveal className="mkt-benefits__intro">
          <SectionHeading
            id="mkt-benefits-title"
            eyebrow="Why it helps"
            title="Less admin, clearer bookings"
            lead="Werefa keeps the day-to-day of taking bookings in one organised place, for you and your customers."
          />
        </Reveal>

        <ul className="mkt-benefits__list">
          {BENEFITS.map((benefit, index) => (
            <Reveal as="li" className="mkt-benefits__item" key={benefit} delay={index * 50}>
              <ArrowRightIcon className="mkt-benefits__icon" />
              <span>{benefit}</span>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  )
}
