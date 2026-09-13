import type { BusinessDetails } from '@/types/models'
import { Alert } from '@/components/ui/Alert'

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

function mapUrl(business: BusinessDetails): string {
  const coords = `${business.lat},${business.lng}`
  return business.mapProvider === 'google'
    ? `https://www.google.com/maps/search/?api=1&query=${coords}`
    : `https://www.openstreetmap.org/?mlat=${business.lat}&mlon=${business.lng}#map=16/${business.lat}/${business.lng}`
}

export function BusinessHero({ business }: { business: BusinessDetails }) {
  return (
    <header className="hero">
      <div className="container">
        <div className="hero__top">
          <div className="hero__logo" aria-hidden="true">
            {initialsOf(business.name)}
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
                  href={mapUrl(business)}
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
      </div>
    </header>
  )
}