import { useCallback, useState } from 'react';
import { api, type Actor, type BusinessDetail } from '../lib/api';
import { AdminPanel } from '../business/AdminPanel';
import { BusinessProfile } from '../business/BusinessProfile';
import { OwnerBusinessHub } from '../business/OwnerBusiness';

type OwnerView = { kind: 'hub' } | { kind: 'business'; id: string };

function statusMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Request failed. Try again.';
}

export function Dashboard({ actor, onSignOut }: { actor: Actor; onSignOut: () => void }) {
  const isOwner = actor.role === 'Owner';
  const isStaff = actor.role === 'Admin' || actor.role === 'SuperAdmin';

  const [ownerView, setOwnerView] = useState<OwnerView>({ kind: 'hub' });
  const [adminOpen, setAdminOpen] = useState(isStaff);
  const [selected, setSelected] = useState<string | null>(actor.businessId ?? null);
  const [bizName, setBizName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectBusiness = useCallback(async (businessId: string) => {
    setError(null);
    try {
      const res = await api.post<{ activeBusinessId: string }>(
        `/api/v1/businesses/${businessId}/select`,
      );
      setSelected(res.activeBusinessId);
      return res.activeBusinessId;
    } catch (err) {
      setError(statusMessage(err));
      throw err;
    }
  }, []);

  const openBusiness = useCallback((b: BusinessDetail) => {
    setBizName(b.name);
    setOwnerView({ kind: 'business', id: b.id });
  }, []);

  const onBusinessIdentity = useCallback((b: BusinessDetail) => {
    setBizName(b.name);
  }, []);

  return (
    <main className="card wide">
      <header className="dash-header">
        <div>
          <h1>Werefa Dashboard</h1>
          <p className="muted">
            {isOwner ? (
              <>
                Business context: <strong>{bizName ?? '—'}</strong>
                {' · '}
                <a
                  href="about:blank"
                  onClick={(e) => {
                    e.preventDefault();
                    setOwnerView({ kind: 'hub' });
                  }}
                >
                  switch business
                </a>
              </>
            ) : (
              <>Platform console</>
            )}
          </p>
        </div>
        <nav className="row">
          {isStaff ? (
            <button
              type="button"
              className={adminOpen ? 'active-tab' : 'secondary'}
              onClick={() => {
                setAdminOpen(true);
                setOwnerView({ kind: 'hub' });
              }}
            >
              Businesses
            </button>
          ) : null}
          <button type="button" className="secondary" onClick={() => void onSignOut()}>
            Sign out
          </button>
        </nav>
      </header>

      {error ? <p className="alert">{error}</p> : null}

      {isOwner && !adminOpen ? (
        ownerView.kind === 'hub' ? (
          <OwnerBusinessHub
            actorId={actor.userId}
            activeBusinessId={selected ?? actor.businessId}
            onSelect={async (id) => {
              await selectBusiness(id);
            }}
            onOpen={openBusiness}
          />
        ) : (
          <BusinessProfile
            businessId={ownerView.id}
            isAdmin={false}
            back={() => setOwnerView({ kind: 'hub' })}
            onBusinessChange={onBusinessIdentity}
          />
        )
      ) : null}

      {isStaff && adminOpen ? (
        <AdminPanel
          role={actor.role === 'SuperAdmin' ? 'SuperAdmin' : 'Admin'}
          goBack={() => setAdminOpen(false)}
        />
      ) : null}
    </main>
  );
}
