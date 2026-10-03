import type {
  Service,
  BusinessDetails,
  ServiceSelection,
} from '@/types/models'
import { formatMoney } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { CheckIcon, ClockIcon } from '@/components/ui/icons'

interface ServicesStepProps {
  business: BusinessDetails
  services: readonly Service[]
  selections: readonly ServiceSelection[]
  toggleService: (serviceId: string) => void
  setVariation: (serviceId: string, variationId: string | null) => void
  toggleAddOn: (serviceId: string, addOnId: string) => void
  onNext: () => void
}

/**
 * Step 1 — service selection.
 *
 * Presentation only: `toggleService` / `setVariation` / `toggleAddOn` are the
 * flow hook's existing callbacks, so multi-service selection and the resulting
 * price/duration totals are computed exactly as before. Prices and durations
 * shown are the real published catalogue values; the total the customer will be
 * charged is still decided by the backend.
 */
export function ServicesStep({
  business,
  services,
  selections,
  toggleService,
  setVariation,
  toggleAddOn,
  onNext,
}: ServicesStepProps) {
  const selectedCount = selections.length

  return (
    <>
      <h2 className="step-title">Choose your services</h2>
      <p className="step-subtitle">
        You can book several services in one visit. Prices and durations below
        update as you add options.
      </p>

      <ul className="services">
        {services.map((service) => {
          const selection = selections.find((s) => s.serviceId === service.id)
          const isSelected = Boolean(selection)

          return (
            <li key={service.id}>
              <article className="card service-card">
                <div className="service-card__head">
                  <div className="service-card__headings">
                    <h3 className="service-card__name">{service.name}</h3>
                    <span className="service-card__meta">
                      <ClockIcon
                        size={15}
                        style={{ display: 'inline', verticalAlign: '-2px' }}
                      />{' '}
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
                      <fieldset className="option-group">
                        <legend className="option-group__title">
                          {isSelected ? 'Choose an option' : 'Add the service to choose an option'}
                        </legend>
                        <div className="option-group__list">
                          {service.variations.map((variation) => {
                            const active =
                              isSelected &&
                              selection?.variationId === variation.id
                            const delta =
                              variation.priceDeltaMinor > 0
                                ? ` +${formatMoney(variation.priceDeltaMinor, business.currency)}`
                                : ''
                            const durationDelta =
                              variation.durationDeltaMinutes !== 0
                                ? ` · ${variation.durationDeltaMinutes > 0 ? '+' : ''}${variation.durationDeltaMinutes} min`
                                : ''
                            return (
                              <button
                                key={variation.id}
                                type="button"
                                className="chip"
                                aria-pressed={active}
                                disabled={!isSelected}
                                onClick={() =>
                                  setVariation(service.id, active ? null : variation.id)
                                }
                              >
                                {active ? <CheckIcon size={15} /> : null}
                                {variation.name}
                                {delta}
                                {durationDelta}
                              </button>
                            )
                          })}
                        </div>
                      </fieldset>
                    )}

                    {service.addOns.length > 0 && (
                      <fieldset className="option-group">
                        <legend className="option-group__title">Add-ons</legend>
                        <div className="option-group__list">
                          {service.addOns.map((addOn) => {
                            const active =
                              isSelected &&
                              selection?.addOnIds.includes(addOn.id)
                            return (
                              <button
                                key={addOn.id}
                                type="button"
                                className="chip"
                                aria-pressed={active}
                                disabled={!isSelected}
                                onClick={() => toggleAddOn(service.id, addOn.id)}
                              >
                                {active ? <CheckIcon size={15} /> : null}
                                {addOn.name}
                                {' · '}
                                +{formatMoney(addOn.priceDeltaMinor, business.currency)}
                                {' · '}
                                +{addOn.durationDeltaMinutes} min
                              </button>
                            )
                          })}
                        </div>
                      </fieldset>
                    )}
                  </div>
                )}

                <div className="service-card__toggle">
                  <Button
                    variant={isSelected ? 'outline' : 'primary'}
                    aria-pressed={isSelected}
                    onClick={() => toggleService(service.id)}
                  >
                    {isSelected ? (
                      <>
                        <CheckIcon size={17} />
                        Remove from booking
                      </>
                    ) : (
                      'Add to booking'
                    )}
                  </Button>
                </div>
              </article>
            </li>
          )
        })}
      </ul>

      <nav className="wizard__nav" aria-label="Services step actions">
        <Button
          variant="primary"
          block={true}
          disabled={selectedCount === 0}
          onClick={onNext}
        >
          {selectedCount === 0
            ? 'Choose at least one service'
            : `Continue — ${selectedCount} selected`}
        </Button>
      </nav>
    </>
  )
}
