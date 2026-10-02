import { Link } from 'react-router-dom'
import { Wordmark } from './Wordmark'

const PRODUCT_LINKS = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#pricing', label: 'Pricing' },
] as const

const RESOURCE_LINKS = [
  { href: '#dashboard', label: 'Dashboard' },
  { href: '#faq', label: 'FAQ' },
  { href: '#about', label: 'About' },
] as const

/**
 * Site footer.
 *
 * Only links to destinations that actually exist. There are no committed
 * privacy/terms pages, social accounts or contact details, so none are linked
 * or invented here.
 */
export function MarketingFooter() {
  const year = new Date().getFullYear()
  return (
    <footer className="mkt-footer">
      <div className="mkt-container mkt-footer__inner">
        <div className="mkt-footer__brand">
          <Wordmark />
          <p className="mkt-footer__desc">
            Scheduling and queue management for service businesses. One public
            booking link, one dashboard.
          </p>
        </div>

        <nav className="mkt-footer__col" aria-label="Product">
          <h2 className="mkt-footer__heading">Product</h2>
          <ul className="mkt-footer__list">
            {PRODUCT_LINKS.map((link) => (
              <li key={link.href}>
                <a className="mkt-footer__link" href={link.href}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <nav className="mkt-footer__col" aria-label="Learn more">
          <h2 className="mkt-footer__heading">Learn more</h2>
          <ul className="mkt-footer__list">
            {RESOURCE_LINKS.map((link) => (
              <li key={link.href}>
                <a className="mkt-footer__link" href={link.href}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <nav className="mkt-footer__col" aria-label="Get started">
          <h2 className="mkt-footer__heading">Get started</h2>
          <ul className="mkt-footer__list">
            <li>
              <Link className="mkt-footer__link" to="/owner/register">
                Create an account
              </Link>
            </li>
            <li>
              <Link className="mkt-footer__link" to="/owner/login">
                Owner sign in
              </Link>
            </li>
          </ul>
        </nav>
      </div>

      <div className="mkt-container mkt-footer__meta">
        <p>© {year} Werefa. All rights reserved.</p>
      </div>
    </footer>
  )
}
