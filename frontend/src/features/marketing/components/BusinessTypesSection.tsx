import { Reveal } from './Reveal'
import { SectionHeading } from './SectionHeading'
import { CalendarIcon } from './icons'

const TYPES = [
  { title: 'Salons & barbers', body: 'Appointments and queues for cut, colour and grooming services.' },
  { title: 'Spas & beauty businesses', body: 'Treatments and sessions booked against your working hours.' },
  { title: 'Appointment-based businesses', body: 'Any business that works from a schedule of available times.' },
  { title: 'Other service businesses', body: 'Is your business something else? Werefa is business-agnostic.' },
] as const

/**
 * Business types. These are examples of the businesses Werefa suits, not
 * additional official product categories: registration currently offers the
 * "Salon & Barber" and "Other" categories only.
 */
export function BusinessTypesSection() {
  return (
    <section className="mkt-section mkt-types" id="business-types" aria-labelledby="mkt-types-title">
      <div className="mkt-container">
        <Reveal>
          <SectionHeading
            id="mkt-types-title"
            eyebrow="Built for service businesses"
            title="One scheduling platform, many kinds of business"
            lead="Werefa is business-agnostic. If customers book your time, it can work for you."
          />
        </Reveal>

        <ul className="mkt-types__grid">
          {TYPES.map((type, index) => (
            <Reveal as="li" className="mkt-type" key={type.title} delay={index * 60}>
              <span className="mkt-type__icon" aria-hidden="true">
                <CalendarIcon />
              </span>
              <h3 className="mkt-type__title">{type.title}</h3>
              <p className="mkt-type__body">{type.body}</p>
            </Reveal>
          ))}
        </ul>

        <p className="mkt-types__footnote">
          Every business registers under one of the platform's categories —
          currently <strong>Salon &amp; Barber</strong> or <strong>Other</strong>.
        </p>
      </div>
    </section>
  )
}
