import type {
  BusinessDetails,
  CustomerDetails,
  DateString,
  Service,
  ServiceSelection,
  TimeOfDay,
} from '@/types/models'
import { buildLineItems, formatMoney, totalDurationMinutes, totalPrice } from '@/lib/format'
import { weekdayLabel } from '@/lib/time'
import {
  CalendarIcon,
  ClockIcon,
  ScissorsIcon,
  UserIcon,
} from '@/components/ui/icons'

interface BookingSummaryProps {
  business: BusinessDetails
  services: readonly Service[]
  selections: readonly ServiceSelection[]
  date: DateString | null
  time: TimeOfDay | null
  customer: CustomerDetails
  onEdit?: {
    services?: () => void
    dateTime?: () => void
    customer?: () => void
  }
}

function EditLink({ onClick, children }: { onClick?: () => void; children: string }) {
  if (!onClick) return null
  return (
    <button type="button" className="edit-link" onClick={onClick}>
      Edit {children.toLowerCase()}
    </button>
  )
}

/**
 * Running summary of the customer's real choices.
 *
 * Every figure here is recomputed from the published catalogue and the
 * selections already made — it is the customer's own preview, not an
 * authoritative quote. The deposit shown on the review and payment steps is the
 * backend's figure. Rendered beside the steps on wide screens and inside the
 * collapsible disclosure on small ones.
 */
export function BookingSummary({
  business,
  services,
  selections,
  date,
  time,
  customer,
  onEdit,
}: BookingSummaryProps) {
  const lineItems = buildLineItems(services, selections)
  const total = totalPrice(lineItems)
  const duration = totalDurationMinutes(lineItems)

  return (
    <div className="summary">
      <section className="summary__section">
        <div className="summary__heading-row">
          <h3 className="summary__heading">
            <ScissorsIcon size={16} /> Services
          </h3>
          <EditLink onClick={onEdit?.services}>services</EditLink>
        </div>
        {lineItems.length === 0 ? (
          <p className="summary__placeholder">No services added yet.</p>
        ) : (
          <ul className="summary__list">
            {lineItems.map((item) => (
              <li
                key={`${item.selection.serviceId}-${item.selection.variationId ?? 'none'}`}
                className="line-item"
              >
                <div>
                  <div>{item.name}</div>
                  <div className="line-item__meta">{item.durationMinutes} min</div>
                </div>
                <span>{formatMoney(item.unitPrice, business.currency)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="total-row">
          <span>Total</span>
          <span>{formatMoney(total, business.currency)}</span>
        </div>
        <div className="total-row total-row--muted">
          <span>Duration</span>
          <span>{duration} min</span>
        </div>
      </section>

      <section className="summary__section">
        <div className="summary__heading-row">
          <h3 className="summary__heading">
            <CalendarIcon size={16} /> Date &amp; time
          </h3>
          <EditLink onClick={onEdit?.dateTime}>date & time</EditLink>
        </div>
        <p>
          {date && time
            ? `${date} (${weekdayLabel(date)}) at ${time}`
            : date
              ? `${date} — time not set`
              : 'Not chosen yet'}
        </p>
      </section>

      <section className="summary__section">
        <div className="summary__heading-row">
          <h3 className="summary__heading">
            <UserIcon size={16} /> Your details
          </h3>
          <EditLink onClick={onEdit?.customer}>details</EditLink>
        </div>
        <p>
          {customer.name || '—'}
          <br />
          {customer.phone || '—'}
        </p>
        {customer.note && <p className="line-item__meta">{customer.note}</p>}
      </section>

      <p className="summary__footnote">
        <ClockIcon size={15} />
        The business reviews every request; a booking is only confirmed once they
        accept it.
      </p>
    </div>
  )
}