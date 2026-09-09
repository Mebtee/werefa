import { useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import {
  majorFromMinor,
  minorFromMajor,
  serviceApi,
  type ServiceChild,
  type ServiceDetail,
} from '../lib/service-api';

function message(err: unknown): string {
  if (err instanceof ApiError) {
    return err.fields && err.fields.length > 0
      ? `${err.message}: ${err.fields.map((f) => f.message).join('; ')}`
      : err.message;
  }
  return err instanceof Error ? err.message : 'Request failed.';
}

function minutes(m: number): string {
  return `${m} min`;
}

/**
 * Prompt 10 — owner service catalog management (REQ-071..081). The endpoint set
 * is Owner-only, so this panel is embedded only in the owner business view.
 * Lifecycle uses the same boolean is_active model as businesses: deactivate
 * hides from the public catalog (REQ-079) while retaining the row.
 */
export function ServicesManager({ businessId, back }: { businessId: string; back: () => void }) {
  const [services, setServices] = useState<ServiceDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const reload = async () => {
    try {
      setServices(await serviceApi.list(businessId));
    } catch (err) {
      setError(message(err));
    }
  };

  useEffect(() => {
    void reload();
  }, [businessId]);

  const open = openId ? (services?.find((s) => s.id === openId) ?? null) : null;

  if (!services) {
    return (
      <section>
        <h2>Services</h2>
        <p className="muted">Loading services…</p>
      </section>
    );
  }

  if (open) {
    return (
      <ServiceDetailPanel
        businessId={businessId}
        service={open}
        onChanged={reload}
        back={() => setOpenId(null)}
        onDeleted={() => {
          void reload();
          setOpenId(null);
        }}
      />
    );
  }

  return (
    <section>
      <div className="row">
        <h2>Services</h2>
        <span className="muted">{services.length} in catalog</span>
      </div>
      {error ? <p className="alert">{error}</p> : null}
      <ServiceCreateForm businessId={businessId} onCreated={() => void reload()} />
      <ul className="business-list">
        {services.map((s) => (
          <li key={s.id} className="card business-card">
            <div>
              <strong>{s.name}</strong>
              <span className="muted">
                {majorFromMinor(s.basePriceMinor)} · {minutes(s.baseDurationMinutes)}
              </span>
              <span className="badges">
                {s.isActive ? (
                  <span className="pill info">Active</span>
                ) : (
                  <span className="pill warn">Deactivated</span>
                )}
                {s.variations.length > 0 ? (
                  <span className="pill">{s.variations.length} variation(s)</span>
                ) : null}
                {s.addOns.length > 0 ? (
                  <span className="pill">{s.addOns.length} add-on(s)</span>
                ) : null}
              </span>
            </div>
            <div className="row">
              <button type="button" onClick={() => setOpenId(s.id)}>
                Manage
              </button>
              {s.isActive ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    void serviceApi
                      .deactivate(businessId, s.id)
                      .then(() => reload())
                      .catch((err) => setError(message(err)));
                  }}
                >
                  Deactivate
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    void serviceApi
                      .reactivate(businessId, s.id)
                      .then(() => reload())
                      .catch((err) => setError(message(err)));
                  }}
                >
                  Reactivate
                </button>
              )}
              <button
                type="button"
                className="danger-button"
                onClick={() => {
                  if (window.confirm(`Permanently delete "${s.name}"? This cannot be undone.`)) {
                    void serviceApi
                      .remove(businessId, s.id)
                      .then(() => reload())
                      .catch((err) => setError(message(err)));
                  }
                }}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="secondary" onClick={() => back()}>
        Back
      </button>
    </section>
  );
}

function ServiceCreateForm({
  businessId,
  onCreated,
}: {
  businessId: string;
  onCreated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const name = String(d.get('name') ?? '').trim();
    const price = minorFromMajor(String(d.get('price') ?? ''));
    const duration = Number(d.get('duration'));
    if (!name || price === null || !Number.isInteger(duration)) return;
    setBusy(true);
    setError(null);
    try {
      await serviceApi.create(businessId, {
        name,
        basePriceMinor: price,
        baseDurationMinutes: duration,
      });
      e.currentTarget.reset();
      onCreated();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="service-create" onSubmit={(e) => void submit(e)}>
      <label>
        Name
        <input name="name" required minLength={1} maxLength={120} />
      </label>
      <label>
        Price (currency units, e.g. 45.50)
        <input name="price" type="number" step="0.01" min="0" required />
      </label>
      <label>
        Duration (minutes)
        <input name="duration" type="number" step="1" min="1" required />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? 'Adding…' : 'Add service'}
      </button>
      {error ? <p className="alert">{error}</p> : null}
    </form>
  );
}

function ServiceDetailPanel({
  businessId,
  service,
  onChanged,
  back,
  onDeleted,
}: {
  businessId: string;
  service: ServiceDetail;
  onChanged: () => void;
  back: () => void;
  onDeleted: () => void;
}) {
  return (
    <section>
      <div className="row">
        <h2>{service.name}</h2>
        {service.isActive ? (
          <span className="pill info">Active</span>
        ) : (
          <span className="pill warn">Deactivated</span>
        )}
        <button type="button" className="secondary" onClick={() => back()}>
          Back to services
        </button>
      </div>
      <ServiceEditForm
        businessId={businessId}
        service={service}
        onSaved={onChanged}
        onDeleted={onDeleted}
      />
      <ChildTable
        businessId={businessId}
        service={service}
        onChanged={onChanged}
        kind="variations"
      />
      <ChildTable businessId={businessId} service={service} onChanged={onChanged} kind="addOns" />
    </section>
  );
}

function ServiceEditForm({
  businessId,
  service,
  onSaved,
  onDeleted,
}: {
  businessId: string;
  service: ServiceDetail;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const name = String(d.get('name') ?? '').trim();
    const price = minorFromMajor(String(d.get('price') ?? ''));
    const duration = Number(d.get('duration'));
    if (!name || price === null || !Number.isInteger(duration)) return;
    setBusy(true);
    setError(null);
    try {
      await serviceApi.update(businessId, service.id, {
        name,
        basePriceMinor: price,
        baseDurationMinutes: duration,
      });
      onSaved();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="service-edit" onSubmit={(e) => void submit(e)}>
      <label>
        Name
        <input name="name" defaultValue={service.name} required minLength={1} maxLength={120} />
      </label>
      <label>
        Price (currency units)
        <input
          name="price"
          type="number"
          step="0.01"
          min="0"
          defaultValue={majorFromMinor(service.basePriceMinor)}
          required
        />
      </label>
      <label>
        Duration (minutes)
        <input
          name="duration"
          type="number"
          step="1"
          min="1"
          defaultValue={service.baseDurationMinutes}
          required
        />
      </label>
      <div className="row">
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        {service.isActive ? (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void serviceApi
                .deactivate(businessId, service.id)
                .then(onSaved)
                .catch((err) => setError(message(err)));
            }}
          >
            Deactivate
          </button>
        ) : (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void serviceApi
                .reactivate(businessId, service.id)
                .then(onSaved)
                .catch((err) => setError(message(err)));
            }}
          >
            Reactivate
          </button>
        )}
        <button type="button" className="danger-button" onClick={() => onDeleted()}>
          Delete
        </button>
      </div>
      {error ? <p className="alert">{error}</p> : null}
    </form>
  );
}

/**
 * Reusable variation (REQ-072) and add-on (REQ-073) editor. Variations use
 * signed deltas; add-ons non-negative; the effective-total invariant is
 * enforced server-side.
 */
function ChildTable({
  businessId,
  service,
  onChanged,
  kind,
}: {
  businessId: string;
  service: ServiceDetail;
  onChanged: () => void;
  kind: 'variations' | 'addOns';
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items: ServiceChild[] = service[kind == 'variations' ? 'variations' : 'addOns'];
  const isVariation = kind === 'variations';

  async function act(next: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await next();
      onChanged();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const name = String(d.get('name') ?? '').trim();
    const priceDelta = minorFromMajor(String(d.get('price') ?? ''));
    const durationDelta = Number(d.get('duration'));
    if (!name || priceDelta === null || !Number.isInteger(durationDelta)) return;
    const input = {
      name,
      priceDeltaMinor: isVariation ? priceDelta : Math.abs(priceDelta),
      durationDeltaMinutes: Math.abs(durationDelta),
    };
    const create = isVariation
      ? () => serviceApi.createVariation(businessId, service.id, input)
      : () => serviceApi.createAddOn(businessId, service.id, input);
    await act(create);
    e.currentTarget.reset();
  }

  async function toggle(item: ServiceChild) {
    await act(() =>
      (isVariation ? serviceApi.updateVariation : serviceApi.updateAddOn)(
        businessId,
        service.id,
        item.id,
        {
          isActive: !item.isActive,
        },
      ),
    );
  }

  async function remove(item: ServiceChild) {
    if (!window.confirm(`Delete "${item.name}"?`)) return;
    await act(() =>
      (isVariation ? serviceApi.deleteVariation : serviceApi.deleteAddOn)(
        businessId,
        service.id,
        item.id,
      ),
    );
  }

  return (
    <div className="child-panel">
      <h3>{isVariation ? 'Variations' : 'Add-ons'}</h3>
      <p className="muted small">
        {isVariation
          ? 'Signed price/duration adjustments relative to the base (must keep effective totals valid).'
          : 'Rounded price/duration additions to the base service.'}
      </p>
      {error ? <p className="alert">{error}</p> : null}
      <form className="service-create" onSubmit={(e) => void add(e)}>
        <input name="name" required minLength={1} maxLength={120} placeholder="Name" />
        <input
          name="price"
          type="number"
          step="0.01"
          required
          placeholder={isVariation ? 'Price delta (±)' : 'Price add (+)'}
        />
        <input name="duration" type="number" step="1" required placeholder="Minutes delta" />
        <button type="submit" disabled={busy}>
          {busy ? 'Adding…' : `Add ${isVariation ? 'variation' : 'add-on'}`}
        </button>
      </form>
      <ul className="business-list">
        {items.map((item) => (
          <li key={item.id} className="card business-card">
            <div>
              <strong>{item.name}</strong>
              <span className="muted">
                {isVariation ? (item.priceDeltaMinor >= 0 ? '+' : '') : '+'}
                {majorFromMinor(item.priceDeltaMinor)} · {item.durationDeltaMinutes >= 0 ? '+' : ''}
                {minutes(item.durationDeltaMinutes)}
              </span>
              {item.isActive ? (
                <span className="pill info">Active</span>
              ) : (
                <span className="pill warn">Hidden</span>
              )}
            </div>
            <div className="row">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void toggle(item)}
              >
                {item.isActive ? 'Hide' : 'Show'}
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={busy}
                onClick={() => void remove(item)}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
        {items.length === 0 ? <li className="muted">None yet</li> : null}
      </ul>
    </div>
  );
}
