import { useEffect, useState } from 'react';
import { businessApi } from '../lib/business-api';
import { ApiError, type BusinessDetail } from '../lib/api';

function message(err: unknown): string {
  if (err instanceof ApiError) {
    return err.fields && err.fields.length > 0
      ? `${err.message}: ${err.fields.map((f) => f.message).join('; ')}`
      : err.message;
  }
  return err instanceof Error ? err.message : 'Request failed.';
}

function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Owner "my businesses" hub (REQ-016/017/018/019/021): lists the owner's
 * businesses, offers the Create Business flow when none exist, and lets the
 * owner select the active business context.
 */
export function OwnerBusinessHub({
  actorId,
  activeBusinessId,
  onSelect,
  onOpen,
}: {
  actorId: string;
  activeBusinessId?: string;
  onSelect: (businessId: string) => Promise<void>;
  onOpen: (business: BusinessDetail) => void;
}) {
  const [businesses, setBusinesses] = useState<BusinessDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    try {
      setBusinesses(await businessApi.listMine());
    } catch (err) {
      setError(message(err));
    }
  };

  useEffect(() => {
    void reload();
  }, [actorId]);

  useEffect(() => {
    // REQ-017: exactly one business → open it directly (auto-select context).
    if (businesses && businesses.length === 1) {
      const only = businesses[0];
      if (only && activeBusinessId === only.id) {
        onOpen(only);
      } else if (only) {
        void onSelect(only.id).then(() => onOpen(only));
      }
    }
  }, [businesses, activeBusinessId, onOpen, onSelect]);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const biz = await businessApi.create({
        name,
        category: String(data.get('category') ?? 'Other'),
        publicSlug: String(data.get('publicSlug') ?? '').trim() || undefined,
      });
      setCreating(false);
      await onSelect(biz.id);
      onOpen(biz);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  if (!businesses) {
    return <p className="muted">Loading businesses…</p>;
  }

  if (businesses.length === 0 && !creating) {
    return (
      <section>
        <h2>Create Business</h2>
        <p className="muted">You do not have a business yet (REQ-018). Create one to continue.</p>
        <button type="button" onClick={() => setCreating(true)}>
          Create your first business
        </button>
      </section>
    );
  }

  if (creating || businesses.length === 0) {
    return (
      <section>
        <h2>Create Business</h2>
        {error ? <p className="alert">{error}</p> : null}
        <form onSubmit={(e) => void create(e)}>
          <label>
            Business name
            <input
              name="name"
              required
              minLength={2}
              maxLength={120}
              onChange={(e) => {
                const slug = document.querySelector<HTMLInputElement>('input[name="publicSlug"]');
                if (slug && !slug.value) slug.value = slugFromName(e.target.value);
              }}
            />
          </label>
          <label>
            Public slug
            <small className="muted">Optional URL slug (lowercase letters, digits, hyphens).</small>
            <input name="publicSlug" maxLength={80} placeholder="auto-generated" />
          </label>
          <label>
            Category
            <small className="muted">Exactly two categories (REQ-215).</small>
            <select name="category">
              <option value="Salon & Barber">Salon &amp; Barber</option>
              <option value="Other">Other</option>
            </select>
          </label>
          {error && businesses.length > 0 ? <p className="alert">{error}</p> : null}
          <div className="row">
            <button type="submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create business'}
            </button>
            {businesses.length > 0 ? (
              <button type="button" className="secondary" onClick={() => setCreating(false)}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </section>
    );
  }

  return (
    <section>
      <div className="row">
        <h2>My businesses</h2>
        <button type="button" className="secondary" onClick={() => setCreating(true)}>
          + New business
        </button>
      </div>
      {error ? <p className="alert">{error}</p> : null}
      <ul className="business-list">
        {businesses.map((b) => (
          <li key={b.id} className="card business-card">
            <div>
              <strong>{b.name}</strong>
              <span className="muted">/{b.publicSlug}</span>
              <span className="pill">{b.category ?? 'Other'}</span>
              <StatusBadges business={b} />
            </div>
            <div className="row">
              {activeBusinessId !== b.id ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void onSelect(b.id)
                      .then(() => onOpen(b))
                      .finally(() => setBusy(false));
                  }}
                >
                  Manage
                </button>
              ) : (
                <button type="button" onClick={() => onOpen(b)}>
                  Manage
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatusBadges({ business }: { business: BusinessDetail }) {
  return (
    <span className="badges">
      {business.deactivatedAt ? <span className="pill danger">Deactivated</span> : null}
      {!business.deactivatedAt && business.isPaused ? (
        <span className="pill warn">Paused</span>
      ) : null}
      {business.trialEndsAt && new Date(business.trialEndsAt).getTime() > Date.now() ? (
        <span className="pill info">Trial</span>
      ) : null}
    </span>
  );
}
