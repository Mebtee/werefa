import { Link } from 'react-router-dom'
import { Reveal } from './Reveal'
import { ArrowRightIcon } from './icons'

/** Closing call to action, reusing the real registration and login routes. */
export function FinalCta() {
  return (
    <section className="mkt-section mkt-cta" aria-labelledby="mkt-cta-title">
      <div className="mkt-container">
        <Reveal className="mkt-cta__card">
          <h2 className="mkt-cta__title" id="mkt-cta-title">
            Ready to make booking simpler?
          </h2>
          <p className="mkt-cta__lead">
            Set up your Werefa business and start your 30-day free trial.
          </p>
          <div className="mkt-cta__actions">
            <Link className="mkt-btn mkt-btn--primary mkt-btn--lg" to="/owner/register">
              Get started
              <ArrowRightIcon className="mkt-btn__icon" />
            </Link>
            <Link className="mkt-btn mkt-btn--outline mkt-btn--lg" to="/owner/login">
              Sign in
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
