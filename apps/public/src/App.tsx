import { useEffect, useState } from 'react';
import { apiGet } from './lib/api';
import { type PublicBusiness, type PublicCatalogEntry, money, minutes } from './lib/catalog';
import { BookingPanel } from './BookingPanel';

export type { PublicBusiness, PublicCatalogEntry };

function parseHash(): { slug: string | null } {
  const m = /^#\/b\/([a-z0-9-]+)\/?/.exec(window.location.hash);
  return { slug: m?.[1] ?? null };
}

export function App() {
  const [slug, setSlug] = useState<string | null>(parseHash().slug);

  useEffect(() => {
    const onHash = () => setSlug(parseHash().slug);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const firstPath = window.location.pathname.split('/').filter(Boolean)[0];

  return (
    <>
      <header className="site-header">
        <a href="#/" className="brand">
          Werefa
        </a>
        <a href="http://localhost:5173/" target="_blank" rel="noreferrer" className="ghost">
          Open Dashboard
        </a>
      </header>
      <main className="container">{slug ? <BusinessPage slug={slug} /> : <HomeHint />}</main>
      <footer className="site-footer muted">
        {firstPath === 'b' || slug ? 'Business directory' : 'Public site'}
      </footer>
    </>
  );
}

function HomeHint() {
  return (
    <section className="card">
      <h1>Werefa</h1>
      <p className="muted">
        Business directory is live. Open a business by slug, e.g. <code>#/b/dawn-salon</code>
      </p>
      <div className="row">
        <a href="#/b/dawn-salon" className="button">
          Visit example — /b/dawn-salon
        </a>
      </div>
    </section>
  );
}

function BusinessPage({ slug }: { slug: string }) {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'ok'; b: PublicBusiness } | { status: 'err'; name: string }
  >({ status: 'loading' });

  useEffect(() => {
    setState({ status: 'loading' });
    apiGet<{ business: PublicBusiness }>(`/api/v1/public/businesses/${slug}`)
      .then((r) => setState({ status: 'ok', b: r.business }))
      .catch((err) =>
        setState({ status: 'err', name: err instanceof Error ? err.message : 'Not found' }),
      );
  }, [slug]);

  if (state.status === 'loading') return <p className="muted">Loading…</p>;
  if (state.status === 'err') {
    return (
      <section className="card">
        <h1>Business not available</h1>
        <p className="muted">
          /{slug} — {state.name}
        </p>
        <a href="#/" className="button">
          Back home
        </a>
      </section>
    );
  }

  const b = state.b;

  return (
    <section className="card business-page">
      {b.coverUrl ? <img src={b.coverUrl} alt="Cover" className="cover" /> : null}
      <div className="business-head">
        {b.logoUrl ? (
          <img src={b.logoUrl} alt="Logo" className="logo" />
        ) : (
          <div className="logo placeholder">No logo</div>
        )}
        <div>
          <div className="row">
            <h1>{b.name}</h1>
            <span className="pill">{b.category ?? 'Other'}</span>
            {b.isPaused ? <span className="pill warn">Temporarily paused</span> : null}
          </div>
          <p className="muted">
            <a href={b.publicUrl} target="_blank" rel="noreferrer">
              werefa.example/b/{b.publicSlug}
            </a>
            {b.latitude != null && b.longitude != null ? (
              <>
                {' · '}
                <a href={locationLink(b)} target="_blank" rel="noreferrer">
                  View on map
                </a>
              </>
            ) : null}
          </p>
        </div>
      </div>

      {b.pauseMessage ? <p className="notice">{b.pauseMessage}</p> : null}
      {b.description ? <p>{b.description}</p> : null}

      <dl className="contact">
        {b.phone ? (
          <>
            <dt>Phone</dt>
            <dd>{b.phone}</dd>
          </>
        ) : null}
        {b.contactEmail ? (
          <>
            <dt>Email</dt>
            <dd>{b.contactEmail}</dd>
          </>
        ) : null}
        {b.address ? (
          <>
            <dt>Address</dt>
            <dd>{b.address}</dd>
          </>
        ) : null}
      </dl>

      <ServiceCatalog slug={slug} />

      <BookingPanel slug={slug} />

      <div className="row">
        <a href={b.qrUrl} target="_blank" rel="noreferrer" className="button secondary">
          Save QR code
        </a>
      </div>
    </section>
  );
}

function locationLink(biz: PublicBusiness): string {
  if (biz.googleMapsLink) return biz.googleMapsLink;
  if (biz.openStreetMapLink) return biz.openStreetMapLink;
  return `https://www.openstreetmap.org/?mlat=${biz.latitude}&mlon=${biz.longitude}#map=15/${biz.latitude}/${biz.longitude}`;
}

/**
 * Public service catalog (Prompt 10, REQ-214). Fetches only the ACTIVE services
 * (with active variations/add-ons) of the resolved business; the shared payload
 * carries name/price/duration — no internal or sensitive fields.
 */
function ServiceCatalog({ slug }: { slug: string }) {
  const [items, setItems] = useState<PublicCatalogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setItems(null);
    setError(null);
    apiGet<{ services: PublicCatalogEntry[] }>(`/api/v1/public/businesses/${slug}/services`)
      .then((r) => setItems(r.services))
      .catch((err) => setError(err instanceof Error ? err.message : 'Catalog unavailable'));
  }, [slug]);

  if (error) return null;
  if (!items) return null;

  if (items.length === 0) return null;

  return (
    <section className="catalog">
      <h2>Services</h2>
      <ul className="list">
        {items.map((s) => (
          <li key={s.id} className="card">
            <div className="row">
              <strong>{s.name}</strong>
              <span className="muted">
                {money(s.basePriceMinor)} · {minutes(s.baseDurationMinutes)}
              </span>
            </div>
            {s.variations.length > 0 ? (
              <ul className="list children">
                {s.variations.map((v) => (
                  <li key={v.id} className="row">
                    <span>{v.name}</span>
                    <span className="muted">
                      {money(s.basePriceMinor + v.priceDeltaMinor)} ·{' '}
                      {minutes(s.baseDurationMinutes + v.durationDeltaMinutes)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {s.addOns.length > 0 ? (
              <div className="addons muted">
                <span className="small">Add-ons:</span>{' '}
                {s.addOns
                  .map(
                    (a) =>
                      `${a.name} (+${money(a.priceDeltaMinor)}, +${minutes(a.durationDeltaMinutes)})`,
                  )
                  .join(', ')}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
