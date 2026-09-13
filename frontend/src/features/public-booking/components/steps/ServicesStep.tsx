import type {
  Service,
  BusinessDetails,
  ServiceSelection,
} from '@/types/models'
import { formatMoney } from '@/lib/format'
import { Button } from '@/components/ui/Button'

interface ServicesStepProps {
  business: BusinessDetails
  services: readonly Service[]
  selections: readonly ServiceSelection[]
  toggleService: (serviceId: string) => void
  setVariation: (serviceId: string, variationId: string | null) => void
  toggleAddOn: (serviceId: string, addOnId: string) => void
  onNext: () => void
}

export function ServicesStep({
  business,
  services,
  selections,
  toggleService,
  setVariation,
  toggleAddOn,
  onNext,
}: ServicesStepProps) {

  return (
    <>
      <h2 className="step-title">Choose your services</h2>
      <p className="step-subtitle">
        You can book several services in one visit. Prices and durations below
        update as you add options.
      </p>

      <ul
        className="services"
        style={{ listStyle: 'none', padding: 0 }}
      >
        {services.map((service) => {
          const selection = selections.find((s) => s.serviceId === service.id)
          const isSelected = Boolean(selection)

          return (
            <li key={service.id}>
              <article className="card service-card">
                <div className="service-card__head">
                  <h3 className="service-card__name">{service.name}</h3>
                  <span className="service-card__price">
                    {formatMoney(service.basePrice, business.currency)}
                  </span>
                </div>
                <p className="service-card__meta">
                  {service.baseDurationMinutes} minutes
                </p>
                {service.description && (
                  <p className="service-card__desc">{service.description}</p>
                )}

                {service.variations.length > 0 && (
                  <div className="service-card__options">
                    <fieldset className="option-group">
                      <legend className="option-group__title">
                        {service.name} — option
                        {isSelected ? '' : ' (add the service first)'}
                      </legend>
                      <div className="option-group__list">
                        {service.variations.map((variation) => {
                          const active =
                            isSelected &&
                            selection?.variationId === variation.id
                          const delta =
                            variation.priceDelta > 0
                              ? ` +${formatMoney(variation.priceDelta, business.currency)}`
                              : ''
                          return (
                            <li key={variation.id}>
                              <button
                                type="button"
                                className="chip"
                                aria-pressed={active}
                                disabled={!isSelected}
                                onClick={() =>
                                  setVariation(service.id, active ? null : variation.id)
                                }
                              >
                                {variation.name}
                                {delta}
                              </button>
                            </li>
                          )
                        })}
                      </div>
                    </fieldset>

                    {service.addOns.length > 0 && (
                      <fieldset className="option-group">
                        <legend className="option-group__title">
                          {service.name} — add-ons
                        </legend>
                        <div className="option-group__list">
                          {service.addOns.map((addOn) => {
                            const active =
                              isSelected &&
                              selection?.addOnIds.includes(addOn.id)
                            return (
                              <li key={addOn.id}>
                                <button
                                  type="button"
                                  className="chip"
                                  aria-pressed={active}
                                  disabled={!isSelected}
                                  onClick={() => toggleAddOn(service.id, addOn.id)}
                                >
                                  {addOn.name}
                                  {' · '}
                                  {formatMoney(addOn.price, business.currency)}
                                  {' · '}
                                  {addOn.durationMinutes} min
                                </button>
                              </li>
                            )
                          })}
                        </div>
                      </fieldset>
                    )}
                  </div>
                )}

                {service.variations.length === 0 && service.addOns.length === 0 && (
                  <div className="service-card__options">
                    <p className="option-group__title">No options</p>
                  </div>
                )}

                <div className="service-card__toggle">
                  <Button
                    variant={isSelected ? 'outline' : 'primary'}
                    block
                    aria-pressed={isSelected}
                    onClick={() => toggleService(service.id)}
                  >
                    {isSelected ? 'Remove from booking' : 'Add to booking'}
                  </Button>
                </div>
              </article>
            </li>
          )
        })}
      </ul>

      <nav
        className="wizard__nav"
        aria-label="Services step actions"
      >
        <Button
          variant="primary"
          block={true}
          disabled={selections.length === 0}
          onClick={onNext}
        >
          {selections.length === 0
            ? 'Choose at least one service'
            : `Continue — ${selections.length} selected`}
        </Button>
      </nav>
    </>
  )
}