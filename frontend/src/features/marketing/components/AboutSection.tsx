import { Reveal } from './Reveal'
import { SectionHeading } from './SectionHeading'
import { CheckCircleIcon } from './icons'

const PRINCIPLES = [
  { title: 'Simplicity', body: 'A booking flow both you and your customers can understand at a glance.' },
  { title: 'Accessible booking', body: 'Customers book from a link, with no account to create.' },
  { title: 'Business control', body: 'You set the services, prices, hours and whether prepayment is required.' },
  { title: 'Organised scheduling', body: 'Requests, proofs and confirmations kept in one dashboard.' },
] as const

/**
 * About section. Describes the product mission only — no founding year, names,
 * headcount, location, funding or customer counts, none of which exist in
 * authoritative project material.
 */
export function AboutSection() {
  return (
    <section className="mkt-section mkt-section--tint" id="about" aria-labelledby="mkt-about-title">
      <div className="mkt-container">
        <Reveal>
          <SectionHeading
            id="mkt-about-title"
            eyebrow="About Werefa"
            title="Built to make scheduling simpler"
            lead="Werefa is built to make scheduling simpler for service businesses and easier for their customers."
          />
        </Reveal>

        <ul className="mkt-about__grid">
          {PRINCIPLES.map((principle, index) => (
            <Reveal as="li" className="mkt-about__item" key={principle.title} delay={index * 60}>
              <CheckCircleIcon className="mkt-about__icon" />
              <h3 className="mkt-about__title">{principle.title}</h3>
              <p className="mkt-about__body">{principle.body}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  )
}
