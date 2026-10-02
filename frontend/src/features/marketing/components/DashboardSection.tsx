import { Reveal } from './Reveal'
import { SectionHeading } from './SectionHeading'
import {
  CalendarIcon,
  LayoutIcon,
  ListIcon,
  ReceiptIcon,
  ShieldIcon,
  SlidersIcon,
} from './icons'

const PANELS = [
  { icon: LayoutIcon, title: 'Business profile', body: 'Your name, category and public details.' },
  { icon: ListIcon, title: 'Services', body: 'Prices, durations and options.' },
  { icon: CalendarIcon, title: 'Schedule', body: 'Working hours, special dates and blocks.' },
  { icon: SlidersIcon, title: 'Bookings', body: 'Requests across their full lifecycle.' },
  { icon: ReceiptIcon, title: 'Payment proof', body: 'Review what customers submit.' },
  { icon: ShieldIcon, title: 'Subscription', body: 'Your plan and its current status.' },
] as const

/**
 * Dashboard showcase. The cards are illustrative representations of areas that
 * exist in the real owner portal — no screenshots, personal data, internal ids
 * or secrets, and nothing that could be mistaken for live business data.
 */
export function DashboardSection() {
  return (
    <section
      className="mkt-section mkt-section--dark"
      id="dashboard"
      aria-labelledby="mkt-dashboard-title"
    >
      <div className="mkt-container">
        <Reveal>
          <SectionHeading
            id="mkt-dashboard-title"
            eyebrow="Your dashboard"
            title="Everything in one organised workspace"
            lead="Run your business from a single owner dashboard — no separate tools to keep in sync."
          />
        </Reveal>

        <Reveal className="mkt-dashboard" delay={60}>
          <div className="mkt-dashboard__tag">Illustrative preview</div>
          <div className="mkt-dashboard__grid">
            {PANELS.map(({ icon: Icon, title, body }) => (
              <div className="mkt-dashboard__panel" key={title}>
                <span className="mkt-dashboard__panel-icon" aria-hidden="true">
                  <Icon />
                </span>
                <p className="mkt-dashboard__panel-title">{title}</p>
                <p className="mkt-dashboard__panel-body">{body}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}
