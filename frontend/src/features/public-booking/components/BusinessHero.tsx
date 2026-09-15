import type { BusinessDetails } from '@/types/models'
import { Link } from 'react-router-dom'
import { Alert } from '@/components/ui/Alert'
import { imageSrc, mapUrl } from '@/lib/format'

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

export function BusinessHero({ business }: { business: BusinessDetails }) {
  const logoSrc = imageSrc(business.logo)
  const coverSrc = imageSrc(business.coverPhoto)

  return (
    <header className="hero">
      {coverSrc && (
        <img
          className="hero__cover"
          src={coverSrc}
          alt={business.coverPhoto?.alt ?? `${business.name} cover`}
        />
      )}

      <div className="container">
        <div className="hero__top">
          <div className="hero__logo" aria-hidden="true">
            {logoSrc ? (
              <img
                className="hero__logo-img"
                src={logoSrc}
                alt={business.logo?.alt ?? business.name}
              />
            ) : (
              initialsOf(business.name)
            )}
          </div>
          <div>
            <span className="badge">{CATEGORY_LABEL[business.category]}</span>
            <h1 className="hero__name">{business.name}</h1>
            <p className="hero__tagline">{business.tagline}</p>
          </div>
        </div>

        <div className="hero__body">
          <p className="hero__desc">{business.description}</p>

          <dl className="hero__facts">
            <div className="hero__fact">
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
            <div className="hero__fact">
              <dt>Phone</dt>
              <dd>
                <a href={`tel:${business.phone.replace(/\s/g, '')}`}>
                  {business.phone}
                </a>
              </dd>
            </div>
          </dl>
        </div>

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
          <Link className="btn btn--outline" to={`/p/${business.slug}/status`}>
            Check my booking status
          </Link>
        </div>
      </div>
    </header>
  )
}