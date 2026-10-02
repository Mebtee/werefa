import { LinkIcon, PhoneIcon, ReceiptIcon } from './icons'

const POINTS = [
  {
    icon: LinkIcon,
    title: 'One public link',
    body: 'Every business gets a single public booking page to share with customers.',
  },
  {
    icon: PhoneIcon,
    title: 'No customer accounts',
    body: 'Customers book and check their booking status without signing up.',
  },
  {
    icon: ReceiptIcon,
    title: 'Payment proof, reviewed',
    body: 'Require prepayment and review the proof customers submit from your dashboard.',
  },
] as const

/**
 * Short value strip. Deliberately qualitative — no customer counts, revenue
 * figures or percentages, which the product has no verified source for.
 */
export function TrustStrip() {
  return (
    <section className="mkt-strip" aria-label="Why businesses choose Werefa">
      <div className="mkt-container mkt-strip__grid">
        {POINTS.map(({ icon: Icon, title, body }) => (
          <div className="mkt-strip__item" key={title}>
            <span className="mkt-strip__icon" aria-hidden="true">
              <Icon />
            </span>
            <div>
              <p className="mkt-strip__title">{title}</p>
              <p className="mkt-strip__body">{body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
