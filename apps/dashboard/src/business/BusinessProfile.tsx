import { useEffect, useState } from 'react';
import { businessApi, adminBusinessApi, type BusinessProfileInput } from '../lib/business-api';
import { ApiError, type BusinessDetail } from '../lib/api';
import { ServicesManager } from './ServicesManager';
import { BookingsManager } from './BookingsManager';
import { SchedulingManager } from './SchedulingManager';
import { SubscriptionPanel } from './SubscriptionPanel';

function message(err: unknown): string {
  if (err instanceof ApiError) {
    return err.fields && err.fields.length > 0
      ? `${err.message}: ${err.fields.map((f) => f.message).join('; ')}`
      : err.message;
  }
  return err instanceof Error ? err.message : 'Request failed.';
}

function EditFormShell(props: {
  business: BusinessDetail;
  onUpdated: (b: BusinessDetail) => void;
  save: (input: BusinessProfileInput) => Promise<BusinessDetail>;
  back: () => void;
}) {
  const { business, onUpdated, save, back } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const input: BusinessProfileInput = {
      name: String(d.get('name') ?? '').trim(),
      publicSlug: String(d.get('publicSlug') ?? '').trim() || undefined,
      category: String(d.get('category') ?? 'Other'),
      description: String(d.get('description') ?? '').trim() || undefined,
      phone: String(d.get('phone') ?? '').trim() || undefined,
      contactEmail: String(d.get('contactEmail') ?? '').trim() || undefined,
      address: String(d.get('address') ?? '').trim() || undefined,
      latitude: parseNum(String(d.get('latitude'))),
      longitude: parseNum(String(d.get('longitude'))),
      googleMapsLink: String(d.get('googleMapsLink') ?? '').trim() || undefined,
      openStreetMapLink: String(d.get('openStreetMapLink') ?? '').trim() || undefined,
    };
    if (!input.name) return;
    setBusy(true);
    setError(null);
    try {
      onUpdated(await save(input));
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)}>
      <div className="row field-grid">
        <label>
          Business name
          <input name="name" defaultValue={business.name} required minLength={2} maxLength={120} />
        </label>
        <label>
          Public slug
          <input name="publicSlug" defaultValue={business.publicSlug} required maxLength={80} />
        </label>
        <label>
          Category
          <select name="category" defaultValue={business.category ?? 'Other'}>
            <option value="Salon & Barber">Salon &amp; Barber</option>
            <option value="Other">Other</option>
          </select>
        </label>
        <label>
          Email (public contact)
          <input name="contactEmail" type="email" defaultValue={business.contactEmail ?? ''} />
        </label>
        <label>
          Phone
          <input name="phone" defaultValue={business.phone ?? ''} />
        </label>
        <label>
          Address
          <input name="address" defaultValue={business.address ?? ''} />
        </label>
        <label>
          Latitude
          <input name="latitude" type="number" step="any" defaultValue={business.latitude ?? ''} />
        </label>
        <label>
          Longitude
          <input
            name="longitude"
            type="number"
            step="any"
            defaultValue={business.longitude ?? ''}
          />
        </label>
        <label>
          Google Maps link
          <input name="googleMapsLink" defaultValue={business.googleMapsLink ?? ''} />
        </label>
        <label>
          OpenStreetMap link
          <input name="openStreetMapLink" defaultValue={business.openStreetMapLink ?? ''} />
        </label>
        <label className="span-2">
          Description
          <textarea name="description" rows={3} defaultValue={business.description ?? ''} />
        </label>
      </div>
      {error ? <p className="alert">{error}</p> : null}
      <div className="row">
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className="secondary" onClick={() => back()}>
          Back
        </button>
      </div>
    </form>
  );
}

function toLocalDateTime(value: string | null | undefined): string {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 16);
}

function parseNum(v: string): number | undefined {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

export function BusinessProfile({
  businessId,
  isAdmin,
  back,
  onBusinessChange,
}: {
  businessId: string;
  isAdmin: boolean;
  back: () => void;
  onBusinessChange?: (b: BusinessDetail) => void;
}) {
  const [business, setBusiness] = useState<BusinessDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<
    'profile' | 'services' | 'bookings' | 'schedule' | 'subscription'
  >('profile');

  const api = isAdmin ? adminBusinessApi : businessApi;
  const load = (id: string) => (isAdmin ? adminBusinessApi.get(id) : businessApi.get(id));

  useEffect(() => {
    load(businessId)
      .then(setBusiness)
      .catch((err) => setError(message(err)));
  }, [businessId, isAdmin]);

  if (error) return <p className="alert">{error}</p>;
  if (!business) return <p className="muted">Loading business…</p>;

  if (section === 'services' && !isAdmin) {
    return <ServicesManager businessId={businessId} back={() => setSection('profile')} />;
  }

  if (section === 'bookings' && !isAdmin) {
    return <BookingsManager businessId={businessId} back={() => setSection('profile')} />;
  }

  if (section === 'schedule' && !isAdmin) {
    return <SchedulingManager businessId={businessId} back={() => setSection('profile')} />;
  }

  if (section === 'subscription' && !isAdmin) {
    return <SubscriptionPanel businessId={businessId} back={() => setSection('profile')} />;
  }

  return (
    <section>
      <div className="row">
        <h2>{business.name}</h2>
        <span className="pill">{business.category ?? 'Other'}</span>
        {!isAdmin ? (
          <>
            <button type="button" className="secondary" onClick={() => setSection('services')}>
              Manage services
            </button>
            <button type="button" className="secondary" onClick={() => setSection('bookings')}>
              Manage bookings
            </button>
            <button type="button" className="secondary" onClick={() => setSection('schedule')}>
              Manage schedule
            </button>
            <button type="button" className="secondary" onClick={() => setSection('subscription')}>
              Subscription &amp; billing
            </button>
          </>
        ) : null}
      </div>
      <p className="muted">
        Public page:{' '}
        <a href={business.publicUrl} target="_blank" rel="noreferrer">
          /{business.publicSlug}
        </a>
        {business.qrUrl ? (
          <>
            {' · '}
            <a href={business.qrUrl} target="_blank" rel="noreferrer">
              QR code
            </a>
          </>
        ) : null}
      </p>
      <MediaPanel
        business={business}
        api={
          isAdmin
            ? { uploadLogo: undefined, uploadCover: undefined }
            : { uploadLogo: businessApi.uploadLogo, uploadCover: businessApi.uploadCover }
        }
        isAdmin={isAdmin}
        onBusinessChange={onBusinessChange}
      />
      {business.isPaused ? (
        <p className="alert">
          This business is currently paused
          {business.pauseMessage ? ` — ${business.pauseMessage}` : ''}.
          {business.pausedUntil ? ` Resume on ${bisodate(business.pausedUntil)}.` : ''}
        </p>
      ) : null}
      {business.deactivatedAt ? (
        <p className="alert">Deactivated on {bisodate(business.deactivatedAt)}.</p>
      ) : null}
      <LifecyclePanel
        business={business}
        api={api}
        onBusinessChange={(b) => {
          setBusiness(b);
          onBusinessChange?.(b);
        }}
      />
      <EditFormShell
        business={business}
        save={(input) =>
          isAdmin
            ? adminBusinessApi.update(businessId, input)
            : businessApi.update(businessId, input)
        }
        onUpdated={setBusiness}
        back={back}
      />
      <button type="button" className="secondary" onClick={() => back()}>
        Back
      </button>
    </section>
  );

  function bisodate(v: string) {
    return new Date(v).toISOString().slice(0, 10);
  }
}

function MediaPanel({
  business,
  api,
  isAdmin,
  onBusinessChange,
}: {
  business: BusinessDetail;
  api: {
    uploadLogo?: (id: string, f: File) => Promise<BusinessDetail>;
    uploadCover?: (id: string, f: File) => Promise<BusinessDetail>;
  };
  isAdmin: boolean;
  onBusinessChange?: (b: BusinessDetail) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  async function upload(kind: 'logo' | 'cover', file: File | null) {
    if (file && !isAdmin) {
      setError(null);
      try {
        const up = kind === 'logo' ? api.uploadLogo : api.uploadCover;
        if (!up) {
          setError('Uploads are only available to the business owner.');
          return;
        }
        const next = await up(business.id, file);
        onBusinessChange?.(next);
      } catch (err) {
        setError(message(err));
      }
    }
  }

  return (
    <div className="media-grid">
      <figure>
        {business.logoUrl ? (
          <img src={business.logoUrl} alt="Logo" className="media-thumb" />
        ) : (
          <div className="media-thumb placeholder">No logo</div>
        )}
        <figcaption>
          <label className="file-label">
            {isAdmin ? 'Logo' : 'Upload logo'}
            {!isAdmin ? (
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => void upload('logo', e.target.files?.[0] ?? null)}
              />
            ) : null}
          </label>
        </figcaption>
      </figure>
      <figure>
        {business.coverUrl ? (
          <img src={business.coverUrl} alt="Cover" className="media-thumb" />
        ) : (
          <div className="media-thumb placeholder">No cover</div>
        )}
        <figcaption>
          <label className="file-label">
            {isAdmin ? 'Cover' : 'Upload cover'}
            {!isAdmin ? (
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => void upload('cover', e.target.files?.[0] ?? null)}
              />
            ) : null}
          </label>
        </figcaption>
      </figure>
      {error ? <p className="alert">{error}</p> : null}
    </div>
  );
}

function LifecyclePanel({
  business,
  api,
  onBusinessChange,
}: {
  business: BusinessDetail;
  api: {
    pause: (id: string, body: { until?: string; message?: string }) => Promise<BusinessDetail>;
    resume: (id: string) => Promise<BusinessDetail>;
    deactivate: (id: string) => Promise<BusinessDetail>;
    reactivate: (id: string) => Promise<BusinessDetail>;
  };
  onBusinessChange: (b: BusinessDetail) => void;
}) {
  const [until, setUntil] = useState('');
  const [messageText, setMessageText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(next: (b: BusinessDetail) => Promise<BusinessDetail>) {
    setBusy(true);
    setError(null);
    try {
      onBusinessChange(await next(business));
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function pause() {
    await act((b) =>
      api.pause(b.id, {
        until: until || toLocalDateTime(b.pausedUntil ?? ''),
        message: messageText,
      }),
    );
  }

  if (business.deactivatedAt) {
    return (
      <div className="lifecycle">
        <div className="row">
          <button
            type="button"
            disabled={busy}
            onClick={() => void act((b) => api.reactivate(b.id))}
          >
            {busy ? 'Working…' : 'Reactivate business'}
          </button>
        </div>
        {error ? <p className="alert">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="lifecycle">
      {business.isPaused ? (
        <div className="row">
          <button type="button" disabled={busy} onClick={() => void act((b) => api.resume(b.id))}>
            {busy ? 'Working…' : 'Resume business'}
          </button>
        </div>
      ) : (
        <>
          <label>
            Resume on (optional) — leave empty to pause indefinitely
            <input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
          </label>
          <label>
            Pause message (optional)
            <input
              value={messageText}
              maxLength={200}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="Message shown to customers"
            />
          </label>
          <div className="row">
            <button type="button" disabled={busy} onClick={() => void pause()}>
              {busy ? 'Working…' : 'Pause business'}
            </button>
            <button
              type="button"
              className="danger-button"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm('Deactivate this business? This is reversible via reactivation.')
                ) {
                  void act((b) => api.deactivate(b.id));
                }
              }}
            >
              Deactivate
            </button>
          </div>
        </>
      )}
      {error ? <p className="alert">{error}</p> : null}
    </div>
  );
}
