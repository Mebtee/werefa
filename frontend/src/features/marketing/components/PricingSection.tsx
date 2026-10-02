import { Link } from 'react-router-dom'
import { Reveal } from './Reveal'
import { ArrowRightIcon, CheckCircleIcon } from './icons'

const INCLUDED = [
  'One public booking link and QR code',
  'Service catalog with prices and durations',
  'Working hours and schedule controls',
  'Booking management and payment-proof review',
] as const

/**
 * Pricing / trial. The subscription price is an unresolved product decision, so
 * no amount is displayed. Only the confirmed 30-day free trial and the monthly
 * subscription model are stated.
 */
export function PricingSection() {
  return (
    <section className="mkt-section mkt-pricing" id="pricing" aria-labelledby="mkt-pricing-title">
      <div className="mkt-container">
        <Reveal className="mkt-pricing__card">
          <div className="mkt-pricing__copy">
            <p className="mkt-eyebrow">Pricing</p>
            <h2 className="mkt-pricing__title" id="mkt-pricing-title">
              Start with a 30-day free trial
            </h2>
            <p className="mkt-pricing__lead">
              Explore Werefa and set up your business before choosing your
              subscription. Werefa runs on a simple monthly subscription.
            </p>
            <ul className="mkt-pricing__list">
              {INCLUDED.map((item) => (
                <li key={item}>
                  <CheckCircleIcon className="mkt-pricing__check" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <Link className="mkt-btn mkt-btn--primary mkt-btn--lg" to="/owner/register">
              Start free trial
              <ArrowRightIcon className="mkt-btn__icon" />
            </Link>
            <p className="mkt-pricing__note">
              Subscription pricing is confirmed when you set up your business.
            </p>
          </div>

          <div className="mkt-pricing__badge" aria-hidden="true">
            <span className="mkt-pricing__badge-days">30</span>
            <span className="mkt-pricing__badge-label">days free</span>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
