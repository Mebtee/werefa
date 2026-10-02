import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { Wordmark } from './Wordmark'

const NAV_LINKS = [
  { href: '#product', label: 'Product' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#faq', label: 'FAQ' },
] as const

/**
 * Sticky public site header.
 *
 * The CTAs point at the real, existing account routes (`/owner/register`,
 * `/owner/login`); no second auth surface is introduced. The mobile menu is a
 * labelled disclosure that closes after a link is chosen and is fully keyboard
 * operable.
 */
export function MarketingHeader() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={cn('mkt-header', scrolled && 'mkt-header--scrolled')}>
      <div className="mkt-container mkt-header__inner">
        <a className="mkt-header__brand" href="#top" aria-label="Werefa home">
          <Wordmark />
        </a>

        <nav className="mkt-nav" aria-label="Primary">
          <ul className="mkt-nav__list">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a className="mkt-nav__link" href={link.href}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mkt-header__actions">
          <Link className="mkt-btn mkt-btn--ghost mkt-header__signin" to="/owner/login">
            Sign in
          </Link>
          <Link className="mkt-btn mkt-btn--primary" to="/owner/register">
            Get started
          </Link>
        </div>

        <button
          type="button"
          className="mkt-menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="mkt-mobile-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="mkt-menu-toggle__bars" aria-hidden="true" />
          <span className="sr-only">{menuOpen ? 'Close menu' : 'Open menu'}</span>
        </button>
      </div>

      <div
        id="mkt-mobile-nav"
        className={cn('mkt-mobile-nav', menuOpen && 'mkt-mobile-nav--open')}
        hidden={!menuOpen}
      >
        <nav aria-label="Mobile">
          <ul className="mkt-mobile-nav__list">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  className="mkt-mobile-nav__link"
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="mkt-mobile-nav__actions">
            <Link
              className="mkt-btn mkt-btn--outline mkt-btn--block"
              to="/owner/login"
              onClick={() => setMenuOpen(false)}
            >
              Sign in
            </Link>
            <Link
              className="mkt-btn mkt-btn--primary mkt-btn--block"
              to="/owner/register"
              onClick={() => setMenuOpen(false)}
            >
              Get started
            </Link>
          </div>
        </nav>
      </div>
    </header>
  )
}
