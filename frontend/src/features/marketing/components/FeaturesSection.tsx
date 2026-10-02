import { Reveal } from './Reveal'
import { SectionHeading } from './SectionHeading'
import {
  CalendarIcon,
  ChatIcon,
  ClockIcon,
  LinkIcon,
  ListIcon,
  PauseIcon,
  PhoneIcon,
  QrIcon,
  ReceiptIcon,
  SlidersIcon,
} from './icons'

const FEATURES = [
  {
    icon: CalendarIcon,
    title: 'Online booking',
    body: 'Customers book through your public business link, from any device.',
  },
  {
    icon: ListIcon,
    title: 'Service catalog',
    body: 'Configure each service with its own price and duration.',
  },
  {
    icon: ClockIcon,
    title: 'Working hours',
    body: 'Define the hours when your services are available each week.',
  },
  {
    icon: LinkIcon,
    title: 'One public link',
    body: 'Every business has one public booking page to share.',
  },
  {
    icon: QrIcon,
    title: 'QR code',
    body: 'Share your booking page with a QR code for in-store or printed use.',
  },
  {
    icon: ReceiptIcon,
    title: 'Payment proof',
    body: 'Require prepayment and review the proof customers submit.',
  },
  {
    icon: ChatIcon,
    title: 'Telegram',
    body: 'Customers and owners can connect Telegram for supported notifications.',
  },
  {
    icon: SlidersIcon,
    title: 'Booking management',
    body: 'Manage the booking lifecycle from request through to confirmation.',
  },
  {
    icon: CalendarIcon,
    title: 'Schedule controls',
    body: 'Manage working schedules, special dates and availability.',
  },
  {
    icon: PauseIcon,
    title: 'Business pause',
    body: 'Temporarily pause new bookings while you are away.',
  },
  {
    icon: PhoneIcon,
    title: 'Customer status lookup',
    body: 'Customers find their booking using the phone number they booked with.',
  },
] as const

/** Feature grid — every entry maps to a capability that exists today. */
export function FeaturesSection() {
  return (
    <section className="mkt-section" id="features" aria-labelledby="mkt-features-title">
      <div className="mkt-container">
        <Reveal>
          <SectionHeading
            id="mkt-features-title"
            eyebrow="Features"
            title="Everything you need to run bookings"
            lead="Practical, focused tools for taking, reviewing and managing customer bookings."
          />
        </Reveal>

        <ul className="mkt-feature-grid">
          {FEATURES.map(({ icon: Icon, title, body }, index) => (
            <Reveal
              as="li"
              className="mkt-feature"
              key={title}
              delay={Math.min((index % 3) * 60, 120)}
            >
              <span className="mkt-feature__icon" aria-hidden="true">
                <Icon />
              </span>
              <h3 className="mkt-feature__title">{title}</h3>
              <p className="mkt-feature__body">{body}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  )
}
