import type { BusinessDetails, Service } from '@/types/models'
import { formatMoney } from '@/lib/format'

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
        Services & prices
      </h2>
      <ul className="services" style={{ listStyle: 'none', padding: 0 }}>
        {services.map((service) => (
          <li key={service.id}>
            <article className="card service-card">
              <div className="service-card__head">
                <h3 className="service-card__name">{service.name}</h3>
                <span className="service-card__priceblock">
                  <span className="service-card__price">
                    {formatMoney(service.basePriceMinor, business.currency)}
                  </span>
                  <span className="service-card__meta">
                    {service.baseDurationMinutes} min
                  </span>
                </span>
              </div>
              {(service.variations.length > 0 || service.addOns.length > 0) && (
                <div className="service-card__options">
                  {service.variations.length > 0 && (
                    <p className="option-group__title">
                      Options:{' '}
                      {service.variations
                        .map((v) => v.name)
                        .join(', ')}
                    </p>
                  )}
                  {service.addOns.length > 0 && (
                    <p className="option-group__title">
                      Add-ons:{' '}
                      {service.addOns
                        .map(
                          (a) =>
                            `${a.name} (+${formatMoney(a.priceDeltaMinor, business.currency)})`,
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