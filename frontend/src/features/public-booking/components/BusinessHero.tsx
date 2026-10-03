import type { BusinessDetails } from '@/types/models'
import { Link } from 'react-router-dom'
import { Alert } from '@/components/ui/Alert'
import { imageSrc, mapUrl } from '@/lib/format'
import {
  ArrowRightIcon,
  InfoIcon,
  PhoneIcon,
  PinIcon,
} from '@/components/ui/icons'

const CATEGORY_LABEL: Record<BusinessDetails['category'], string> = {
  'salon-barber': 'Salon & Barber',
  other: 'Other',
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/)
  const chars = parts.length > 1
    ? `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`
    : parts[0]?.slice(0, 2) ?? ''
  return chars.toUpperCase()
}

/**
 * Public business header for `/p/:slug`.
 *
 * Every value rendered here comes from the real business projection: name,
 * category, tagline, description, address, coordinates, public phone and the
 * configured logo/cover. Nothing is invented — no ratings, testimonials,
 * discounts, popularity indicators or opening-hour claims the projection does
 * not carry. When the business has set its own accent colour the page inherits
 * it (see `styles/customer.css`), so this header frames that business's real
 * branding rather than substituting platform branding for it.
 */
export function BusinessHero({ business }: { business: BusinessDetails }) {
  const logoSrc = imageSrc(business.logo)
  const coverSrc = imageSrc(business.coverPhoto)
  const hasDescription = business.description.trim().length > 0
  const hasAddress = business.address.trim().length > 0
  const hasPhone = business.phone.trim().length > 0

  return (
    <header className="hero">
      <div className="hero__media">
        {coverSrc ? (
          <img
            className="hero__cover"
            src={coverSrc}
            alt={business.coverPhoto?.alt ?? `${business.name} cover photo`}
          />
        ) : (
          // No configured cover photo: a quiet brand-tinted band, never a
          // stand-in image that could be mistaken for the real premises.
          <span className="hero__banner" aria-hidden="true" />
        )}
      </div>

      <div className="container">
        <div className="hero__body">
          <div className="hero__top">
            <div className="hero__logo">
              {logoSrc ? (
                <img
                  className="hero__logo-img"
                  src={logoSrc}
                  alt={business.logo?.alt ?? `${business.name} logo`}
                />
              ) : (
                <span aria-hidden="true">{initialsOf(business.name)}</span>
              )}
            </div>
            <div className="hero__identity">
              <span className="badge">{CATEGORY_LABEL[business.category]}</span>
              <h1 className="hero__name">{business.name}</h1>
              {business.tagline.trim() ? (
                <p className="hero__tagline">{business.tagline}</p>
              ) : null}
            </div>
          </div>

          {hasDescription && (
            <div className="hero__summary">
              <p className="hero__desc">{business.description}</p>
            </div>
          )}

          {(hasAddress || hasPhone) && (
            <dl className="hero__facts">
              {hasAddress && (
                <div className="hero__fact">
                  <PinIcon className="hero__fact-icon" size={20} />
                  <div>
                    <dt>Address</dt>
                    <dd>
                      {business.address}
                      {' · '}
                      <a
                        href={mapUrl(business.lat, business.lng, business.mapProvider)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open in map
                      </a>
                    </dd>
                  </div>
                </div>
              )}
              {hasPhone && (
                <div className="hero__fact">
                  <PhoneIcon className="hero__fact-icon" size={20} />
                  <div>
                    <dt>Phone</dt>
                    <dd>
                      <a href={`tel:${business.phone.replace(/\s/g, '')}`}>
                        {business.phone}
                      </a>
                    </dd>
                  </div>
                </div>
              )}
            </dl>
          )}

          {business.pause && (
            <div className="notice">
              <Alert tone="warning" title="We are currently closed to new bookings">
                {business.pause.message}
                {business.pause.kind === 'until' && (
                  <> Bookings reopen on {business.pause.reopenDate}.</>
                )}
              </Alert>
            </div>
          )}

          <div className="hero__actions">
            {business.pause ? null : (
              // A real in-page anchor, so it works without scripting, is
              // keyboard reachable, and degrades to a plain link.
              <a className="btn btn--primary btn--lg" href="#book">
                Book an appointment
                <ArrowRightIcon size={18} />
              </a>
            )}
            <Link className="btn btn--outline btn--lg" to={`/p/${business.slug}/status`}>
              <InfoIcon size={18} />
              Check my booking status
            </Link>
          </div>
        </div>
      </div>
    </header>
  )
}
