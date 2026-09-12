import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, apiUpload, ApiError } from './lib/api';
import { type PublicCatalogEntry, PHONE_PATTERN, money, minutes } from './lib/catalog';
import { TelegramConnectCard } from './TelegramConnectCard';

const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'TELEBIRR_MOBILE_MONEY', label: 'Telebirr / mobile money' },
];

const MAX_FILE_MB = 10;

interface ServiceLine {
  serviceId: string;
  variationId?: string;
  addOnIds: string[];
}

interface AvailabilityResult {
  available: boolean;
  startAt: string;
  endAt: string;
  totalPriceMinor: number;
  totalDurationMinutes: number;
  prepaidMinor: number;
}

interface BookingCreated {
  id: string;
  status: string;
  customerName: string;
  startAt: string;
  endAt: string;
  totalPriceMinor: number;
  totalDurationMinutes: number;
  paymentStatus: string;
  paymentMethod: string | null;
  prepaidMinor: number;
  services: {
    id: string;
    serviceId: string | null;
    name: string;
    unitPriceMinor: number;
    durationMinutes: number;
  }[];
}

type View =
  | { kind: 'loading' }
  | { kind: 'form'; items: PublicCatalogEntry[] }
  | { kind: 'success'; booking: BookingCreated; replayed: boolean };

function selectedTotal(
  items: PublicCatalogEntry[],
  lines: Record<string, ServiceLine>,
): { price: number; duration: number } {
  let price = 0;
  let duration = 0;
  for (const s of items) {
    const line = lines[s.id];
    if (!line) continue;
    const variation = s.variations.find((v) => v.id === line.variationId);
    const dv = variation?.priceDeltaMinor ?? 0;
    const dd = variation?.durationDeltaMinutes ?? 0;
    price += s.basePriceMinor + dv;
    duration += s.baseDurationMinutes + dd;
    for (const a of s.addOns) {
      if (line.addOnIds.includes(a.id)) {
        price += a.priceDeltaMinor;
        duration += a.durationDeltaMinutes;
      }
    }
  }
  return { price, duration };
}

function toWholeMinuteIso(local: string): string {
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function message(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.fields && err.fields.length > 0) {
      return `${err.message}: ${err.fields.map((f) => f.message).join('; ')}`;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : 'Request failed.';
}

export function BookingPanel({ slug }: { slug: string }) {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [lines, setLines] = useState<Record<string, ServiceLine>>({});
  const [startAt, setStartAt] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('BANK_TRANSFER');
  const [submissionKey] = useState(() => crypto.randomUUID());
  const [checked, setChecked] = useState<AvailabilityResult | null>(null);
  const [checkBusy, setCheckBusy] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [customerPhone, setCustomerPhone] = useState('');

  useEffect(() => {
    let alive = true;
    apiGet<{ services: PublicCatalogEntry[] }>(`/api/v1/public/businesses/${slug}/services`)
      .then((r) => {
        if (alive) setView({ kind: 'form', items: r.services });
      })
      .catch((err) => {
        if (alive) setView({ kind: 'form', items: [] });
        setError(message(err));
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  const items = view.kind === 'form' ? view.items : [];
  const totals = useMemo(() => selectedTotal(items, lines), [items, lines]);
  const selectedCount = items.filter((s) => lines[s.id]).length;

  function toggleService(s: PublicCatalogEntry) {
    setChecked(null);
    setLines((prev) => {
      const next = { ...prev };
      if (next[s.id]) {
        delete next[s.id];
      } else {
        next[s.id] = { serviceId: s.id, addOnIds: [] };
      }
      return next;
    });
  }

  function setLine(
    serviceId: string,
    patch: Partial<ServiceLine> | ((current: ServiceLine) => ServiceLine),
  ) {
    setChecked(null);
    setLines((prev) => {
      const existing = prev[serviceId] ?? { serviceId, addOnIds: [] };
      const next =
        typeof patch === 'function' ? patch(existing) : ({ ...existing, ...patch } as ServiceLine);
      return { ...prev, [serviceId]: next };
    });
  }

  function setVariation(serviceId: string, variationId: string) {
    setLine(serviceId, { variationId });
  }

  function toggleAddOn(serviceId: string, addOnId: string) {
    setLine(serviceId, (next) => {
      const has = next.addOnIds.includes(addOnId);
      return {
        ...next,
        addOnIds: has ? next.addOnIds.filter((id) => id !== addOnId) : [...next.addOnIds, addOnId],
      };
    });
  }

  async function checkAvailability() {
    setError(null);
    setChecked(null);
    setCheckBusy(true);
    try {
      const res = await apiPost<{ availability: AvailabilityResult }>(
        `/api/v1/public/businesses/${slug}/bookings/availability`,
        { startAt: toWholeMinuteIso(startAt), services: Object.values(lines) },
      );
      setChecked(res.availability);
    } catch (err) {
      setError(message(err));
    } finally {
      setCheckBusy(false);
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!checked || !checked.available) return;
    setError(null);
    setSubmitBusy(true);
    try {
      const fd = new FormData();
      fd.append(
        'customerName',
        (e.currentTarget.elements.namedItem('customerName') as HTMLInputElement).value,
      );
      const phoneValue = (e.currentTarget.elements.namedItem('customerPhone') as HTMLInputElement)
        .value;
      setCustomerPhone(phoneValue);
      fd.append('customerPhone', phoneValue);
      const note = (e.currentTarget.elements.namedItem('note') as HTMLInputElement).value.trim();
      if (note) fd.append('note', note);
      fd.append('startAt', checked.startAt);
      fd.append('paymentMethod', paymentMethod);
      fd.append('submissionKey', submissionKey);
      fd.append('services', JSON.stringify(Object.values(lines)));
      const fileEl = file;
      if (fileEl) fd.append('file', fileEl);

      const res = await apiUpload<{ created: boolean; booking: BookingCreated }>(
        `/api/v1/public/businesses/${slug}/bookings`,
        fd,
      );
      setView({ kind: 'success', booking: res.booking, replayed: !res.created });
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'SLOT_UNAVAILABLE'
          ? 'That time is no longer available — pick a different slot and re-check.'
          : message(err),
      );
    } finally {
      setSubmitBusy(false);
    }
  }

  if (view.kind === 'loading') {
    return (
      <section className="card booking">
        <h2>Book an appointment</h2>
        <p className="muted small">Loading services…</p>
      </section>
    );
  }

  if (view.kind === 'success') {
    const b = view.booking;
    return (
      <section className="card booking success">
        <h2>Booking {view.replayed ? 'received' : 'created'}</h2>
        {view.replayed ? (
          <p className="notice">
            This request was already submitted and booked. No duplicate was created.
          </p>
        ) : null}
        <dl className="contact booking-summary">
          <dt>Reference</dt>
          <dd>{b.id}</dd>
          <dt>Status</dt>
          <dd>{b.status}</dd>
          <dt>Starts</dt>
          <dd>{new Date(b.startAt).toLocaleString()}</dd>
          <dt>Ends</dt>
          <dd>{new Date(b.endAt).toLocaleString()}</dd>
          <dt>Duration</dt>
          <dd>{minutes(b.totalDurationMinutes)}</dd>
          <dt>Total</dt>
          <dd>{money(b.totalPriceMinor)}</dd>
          <dt>Payment</dt>
          <dd>{b.paymentStatus === 'PAID' ? 'Paid' : 'Pending'}</dd>
          {b.prepaidMinor > 0 ? (
            <>
              <dt>Deposit required</dt>
              <dd>{money(b.prepaidMinor)}</dd>
            </>
          ) : null}
          <dt>Method</dt>
          <dd>
            {PAYMENT_METHODS.find((m) => m.value === b.paymentMethod)?.label ??
              b.paymentMethod ??
              '—'}
          </dd>
        </dl>
        <p className="muted small">
          {b.paymentStatus === 'PENDING'
            ? b.prepaidMinor > 0
              ? `Please complete your ${money(b.prepaidMinor)} deposit (out of a total of ${money(
                  b.totalPriceMinor,
                )}) using the method selected. Keep the reference above — the business will confirm your appointment once the deposit is verified.`
              : `Please complete payment of ${money(
                  b.totalPriceMinor,
                )} using the method selected. Keep the reference above — the business will confirm your appointment once payment is verified.`
            : 'Your appointment is confirmed. Show this page (or the QR) when you arrive.'}
        </p>
        <TelegramConnectCard slug={slug} bookingId={b.id} phone={customerPhone} />
        <div className="row">
          <button
            className="button secondary"
            type="button"
            onClick={() => window.location.reload()}
          >
            Book another
          </button>
        </div>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="card booking">
        <h2>Book an appointment</h2>
        <p className="muted">No bookable services are published yet.</p>
      </section>
    );
  }

  return (
    <section className="card booking">
      <h2>Book an appointment</h2>

      {items.map((s) => {
        const line = lines[s.id];
        const active = Boolean(line);
        return (
          <div key={s.id} className={`catalog-item${active ? ' selected' : ''}`}>
            <label className="service-toggle">
              <input type="checkbox" checked={active} onChange={() => toggleService(s)} />
              <span>
                <strong>{s.name}</strong>{' '}
                <span className="muted">
                  {money(s.basePriceMinor)} · {minutes(s.baseDurationMinutes)}
                </span>
              </span>
            </label>
            {active && line ? (
              <label className="variation">
                Variation
                <select
                  value={line.variationId ?? ''}
                  onChange={(ev) => setVariation(s.id, ev.target.value)}
                >
                  <option value="">Standard</option>
                  {s.variations.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({money(s.basePriceMinor + v.priceDeltaMinor)} ·{' '}
                      {minutes(s.baseDurationMinutes + v.durationDeltaMinutes)})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {active && line ? (
              <div className="addons">
                <span className="small muted">Add-ons:</span>
                {s.addOns.map((a) => (
                  <label key={a.id} className="addon">
                    <input
                      type="checkbox"
                      checked={line.addOnIds.includes(a.id)}
                      onChange={() => toggleAddOn(s.id, a.id)}
                    />
                    {a.name} (+{money(a.priceDeltaMinor)}, +{minutes(a.durationDeltaMinutes)})
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      {selectedCount > 0 ? (
        <p className="muted small booking-totals">
          {selectedCount} service{selectedCount > 1 ? 's' : ''} · {money(totals.price)} ·{' '}
          {minutes(totals.duration)}
        </p>
      ) : null}

      <form onSubmit={submit}>
        <div className="field-grid">
          <label>
            Date &amp; time
            <input
              name="startAt"
              type="datetime-local"
              required
              value={startAt}
              onChange={(ev) => {
                setStartAt(ev.target.value);
                setChecked(null);
              }}
            />
          </label>
          <label>
            Payment method
            <select
              value={paymentMethod}
              onChange={(ev) => {
                setPaymentMethod(ev.target.value);
                setChecked(null);
              }}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Your name
            <input name="customerName" required maxLength={120} autoComplete="name" />
          </label>
          <label>
            Your phone
            <input
              name="customerPhone"
              required
              maxLength={20}
              autoComplete="tel"
              pattern={PHONE_PATTERN.source}
              title="Phone number, 7–20 digits, optionally starting with +"
              onChange={(ev) => setCustomerPhone(ev.target.value)}
            />
          </label>
          <label className="span-2">
            Note (optional)
            <textarea name="note" maxLength={1000} rows={2} />
          </label>
          <label className="span-2">
            Payment proof (PNG, JPEG or PDF, max {MAX_FILE_MB} MB)
            <input
              type="file"
              accept="image/png,image/jpeg,application/pdf"
              onChange={(ev) => setFile(ev.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        <div className="row">
          <button
            className="button"
            type="button"
            disabled={checkBusy || selectedCount === 0 || !startAt}
            onClick={checkAvailability}
          >
            {checkBusy ? 'Checking…' : 'Check availability'}
          </button>
        </div>

        {checked ? (
          checked.available ? (
            <p className="notice ok small">
              Free at {new Date(checked.startAt).toLocaleString()} →{' '}
              {new Date(checked.endAt).toLocaleTimeString()} · {money(checked.totalPriceMinor)} ·{' '}
              {minutes(checked.totalDurationMinutes)}
              {checked.prepaidMinor > 0
                ? ` · Deposit required: ${money(checked.prepaidMinor)}`
                : ''}
            </p>
          ) : (
            <p className="notice small">That time is not available — pick a different slot.</p>
          )
        ) : null}

        {error ? <p className="alert small">{error}</p> : null}

        <button className="button" type="submit" disabled={submitBusy || !checked?.available}>
          {submitBusy ? 'Booking…' : selectedCount > 0 ? `Book for ${money(totals.price)}` : 'Book'}
        </button>
        {checked?.available && checked.prepaidMinor > 0 ? (
          <p className="muted small">
            A deposit of {money(checked.prepaidMinor)} is required with your proof of payment.
          </p>
        ) : null}
      </form>
    </section>
  );
}
