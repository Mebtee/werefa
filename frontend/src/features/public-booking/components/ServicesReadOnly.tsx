import type { BusinessDetails, Service } from '@/types/models'
import { formatMoney } from '@/lib/format'
import { ClockIcon } from '@/components/ui/icons'

/**
 * Read-only service catalogue for a business that is NOT taking bookings
 * (paused, REQ-146/147/148).
 *
 * The page stays visible and the real prices, durations and configured options
 * are still shown — only the booking wizard is withheld. Nothing here is
 * invented: every value comes from the published catalogue projection.
 */
export function ServicesReadOnly({
  business,
  services,
}: {
  business: BusinessDetails
  services: readonly Service[]
}) {
  return (
    <section className="section-block" aria-labelledby="services-title">
      <h2 className="section-title" id="services-title">
        Services &amp; prices
      </h2>
      <p className="section-lede">
        This is what {business.name} offers. Booking is paused right now, so new
        appointments cannot be requested on this page yet.
      </p>
      <ul className="services">
        {services.map((service) => (
          <li key={service.id}>
            <article className="card service-card">
              <div className="service-card__head">
                <div className="service-card__headings">
                  <h3 className="service-card__name">{service.name}</h3>
                  <span className="service-card__meta">
                    <ClockIcon size={15} style={{ display: 'inline', verticalAlign: '-2px' }} />{' '}
                    {service.baseDurationMinutes} min
                  </span>
                </div>
                <span className="service-card__priceblock">
                  <span className="service-card__price">
                    {formatMoney(service.basePriceMinor, business.currency)}
                  </span>
                </span>
              </div>
              {(service.variations.length > 0 || service.addOns.length > 0) && (
                <div className="service-card__options">
                  {service.variations.length > 0 && (
                    <p className="service-card__options-text">
                      <strong>Options:</strong>{' '}
                      {service.variations
                        .map(
                          (v) =>
                            `${v.name}${
                              v.priceDeltaMinor > 0
                                ? ` (+${formatMoney(v.priceDeltaMinor, business.currency)})`
                                : ''
                            }`,
                        )
                        .join(', ')}
                    </p>
                  )}
                  {service.addOns.length > 0 && (
                    <p className="service-card__options-text">
                      <strong>Add-ons:</strong>{' '}
                      {service.addOns
                        .map(
                          (a) =>
                            `${a.name} (+${formatMoney(a.priceDeltaMinor, business.currency)}, +${a.durationDeltaMinutes} min)`,
                        )
                        .join(', ')}
                    </p>
                  )}
                </div>
              )}
            </article>
          </li>
        ))}
      </ul>
    </section>
  )
}
