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
          <h3 className="summary__heading">Services</h3>
          <EditLink onClick={onEdit?.services}>services</EditLink>
        </div>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {lineItems.map((item) => (
            <li key={`${item.selection.serviceId}-${item.selection.variationId ?? 'none'}`} className="line-item">
              <div>
                <div>{item.name}</div>
                <div className="line-item__meta">
                  {item.durationMinutes} min
                </div>
              </div>
              <span>{formatMoney(item.unitPrice, business.currency)}</span>
            </li>
          ))}
        </ul>
        <div className="total-row">
          <span>Total</span>
          <span>{formatMoney(total, business.currency)}</span>
        </div>
        <div className="total-row" style={{ fontWeight: 500, color: 'var(--color-text-muted)' }}>
          <span>Duration</span>
          <span>{duration} min</span>
        </div>
      </section>

      <section className="summary__section">
        <div className="summary__heading-row">
          <h3 className="summary__heading">Date & time</h3>
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
          <h3 className="summary__heading">Your details</h3>
          <EditLink onClick={onEdit?.customer}>details</EditLink>
        </div>
        <p>
          {customer.name || '—'}
          <br />
          {customer.phone || '—'}
        </p>
        {customer.note && <p className="line-item__meta">{customer.note}</p>}
      </section>
    </div>
  )
}