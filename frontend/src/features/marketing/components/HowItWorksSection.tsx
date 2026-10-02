import { Reveal } from './Reveal'
import { SectionHeading } from './SectionHeading'

const STEPS = [
  {
    number: '01',
    title: 'Create your business',
    body: 'Set up your business profile, services, prices and working hours.',
  },
  {
    number: '02',
    title: 'Share your booking link',
    body: 'Give customers one simple link or a QR code pointing at your public page.',
  },
  {
    number: '03',
    title: 'Customers choose a time',
    body: 'Customers see your available services and the times your schedule offers.',
  },
  {
    number: '04',
    title: 'Review bookings',
    body: 'Manage booking requests and payment proofs from your dashboard.',
  },
  {
    number: '05',
    title: 'Stay connected',
    body: 'Use Telegram notifications when the Telegram channel is configured and connected.',
  },
] as const

/** Five-step explanation of how the product is used. */
export function HowItWorksSection() {
  return (
    <section
      className="mkt-section mkt-section--tint"
      id="how-it-works"
      aria-labelledby="mkt-how-title"
    >
      <div className="mkt-container">
        <Reveal>
          <SectionHeading
            id="mkt-how-title"
            eyebrow="How Werefa works"
            title="Up and running in five simple steps"
            lead="No hardware, no complicated setup — just your services, your hours and one shared link."
          />
        </Reveal>

        <ol className="mkt-steps">
          {STEPS.map((step, index) => (
            <Reveal
              as="li"
              className="mkt-steps__item"
              key={step.number}
              delay={Math.min(index * 70, 280)}
            >
              <span className="mkt-steps__number" aria-hidden="true">
                {step.number}
              </span>
              <h3 className="mkt-steps__title">{step.title}</h3>
              <p className="mkt-steps__body">{step.body}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  )
}
