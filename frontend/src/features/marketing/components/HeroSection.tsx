import { Link } from 'react-router-dom'
import { ArrowRightIcon, CheckCircleIcon, ClockIcon, QrIcon } from './icons'

/**
 * Hero. Copy describes only capabilities the product actually has, and the
 * visual is an explicitly-labelled illustrative composition — it uses generic
 * product concepts (a service, an available time, a booking request), never a
 * fabricated business, customer, phone number, price or receipt.
 */
export function HeroSection() {
  return (
    <section className="mkt-hero" id="top" aria-labelledby="mkt-hero-title">
      <div className="mkt-hero__glow" aria-hidden="true" />
      <div className="mkt-container mkt-hero__inner">
        <div className="mkt-hero__copy">
          <p className="mkt-eyebrow">
            <span className="mkt-eyebrow__dot" aria-hidden="true" />
            Scheduling &amp; queue management for service businesses
          </p>
          <h1 className="mkt-hero__title" id="mkt-hero-title">
            Run your business.
            <br />
            <span className="mkt-hero__title-accent">Let Werefa handle the queue.</span>
          </h1>
          <p className="mkt-hero__lead">
            Werefa gives your business one public booking link. Customers see your
            services, check available times, and send a booking request — no app
            and no Werefa account needed on their side.
          </p>
          <div className="mkt-hero__actions">
            <Link className="mkt-btn mkt-btn--primary mkt-btn--lg" to="/owner/register">
              Get started
              <ArrowRightIcon className="mkt-btn__icon" />
            </Link>
            <Link className="mkt-btn mkt-btn--outline mkt-btn--lg" to="/owner/login">
              Sign in
            </Link>
          </div>
          <p className="mkt-hero__note">
            Start with a 30-day free trial. Manage everything from your business
            dashboard.
          </p>
        </div>

        <div className="mkt-hero__visual" aria-hidden="false">
          <p className="mkt-illustrative-tag">Illustrative preview</p>

          <div className="mkt-mock mkt-mock--booking">
            <div className="mkt-mock__head">
              <span className="mkt-mock__label">Book an appointment</span>
              <span className="mkt-mock__badge">Public link</span>
            </div>
            <div className="mkt-mock__row">
              <span className="mkt-mock__dot" aria-hidden="true" />
              <span className="mkt-mock__field">Service · price · duration</span>
            </div>
            <div className="mkt-mock__slots">
              <span className="mkt-mock__slot mkt-mock__slot--active">Available time</span>
              <span className="mkt-mock__slot">Available time</span>
              <span className="mkt-mock__slot">Available time</span>
            </div>
            <div className="mkt-mock__foot">
              <ClockIcon className="mkt-mock__icon" />
              <span>Pick a real slot from your working hours</span>
            </div>
          </div>

          <div className="mkt-mock mkt-mock--owner">
            <div className="mkt-mock__head">
              <span className="mkt-mock__label">Owner dashboard</span>
              <span className="mkt-mock__badge mkt-mock__badge--soft">This week</span>
            </div>
            <ul className="mkt-mock__list">
              <li className="mkt-mock__item">
                <CheckCircleIcon className="mkt-mock__icon" />
                <span>Booking request received</span>
                <span className="mkt-mock__state mkt-mock__state--info">New</span>
              </li>
              <li className="mkt-mock__item">
                <CheckCircleIcon className="mkt-mock__icon" />
                <span>Payment proof uploaded</span>
                <span className="mkt-mock__state mkt-mock__state--warn">Review</span>
              </li>
              <li className="mkt-mock__item">
                <CheckCircleIcon className="mkt-mock__icon" />
                <span>Booking confirmed</span>
                <span className="mkt-mock__state mkt-mock__state--ok">Done</span>
              </li>
            </ul>
          </div>

          <div className="mkt-mock mkt-mock--qr">
            <QrIcon className="mkt-mock__icon" />
            <span>Share with a link or a QR code</span>
          </div>
        </div>
      </div>
    </section>
  )
}
