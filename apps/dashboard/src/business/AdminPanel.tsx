import { useEffect, useState } from 'react';
import { adminBusinessApi } from '../lib/business-api';
import { ApiError, type BusinessDetail } from '../lib/api';
import { BusinessProfile } from './BusinessProfile';
import { SubscriptionReviewPanel } from './SubscriptionReviewPanel';
import { SecurityHistoryPanel } from './SecurityHistoryPanel';
import { BookingHistoryReportPanel } from './BookingHistoryReportPanel';
import { AdminAccountsPanel } from './AdminAccountsPanel';

function message(err: unknown): string {
  if (err instanceof ApiError) {
    return err.fields && err.fields.length > 0
      ? `${err.message}: ${err.fields.map((f) => f.message).join('; ')}`
      : err.message;
  }
  return err instanceof Error ? err.message : 'Request failed.';
}

function StatusBar({ business }: { business: BusinessDetail }) {
  return (
    <span className="badges">
      {business.deactivatedAt ? <span className="pill danger">Deactivated</span> : null}
      {!business.deactivatedAt && business.isPaused ? (
        <span className="pill warn">Paused</span>
      ) : null}
      {business.trialEndsAt ? (
        <span className="pill info">
          Trial until {new Date(business.trialEndsAt).toISOString().slice(0, 10)}
        </span>
      ) : null}
      <span className="pill">{business.category ?? 'Other'}</span>
    </span>
  );
}

/**
 * Platform business management (REQ-045..053 admin + REQ-143..158 super admin
 * lifecycle). Listing is available to Admin and SuperAdmin; write actions are
 * enforced server-side to SuperAdmin only.
 */
export function AdminPanel({ role, goBack }: { role: 'Admin' | 'SuperAdmin'; goBack: () => void }) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<BusinessDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [viewingSecurity, setViewingSecurity] = useState(false);
  const [viewingBookingReport, setViewingBookingReport] = useState(false);
  const [viewingAdminAccounts, setViewingAdminAccounts] = useState(false);
  const showLifecycle = role === 'SuperAdmin';

  const reload = (q?: string) => {
    setRows(null);
    adminBusinessApi
      .list(q)
      .then(setRows)
      .catch((err) => setError(message(err)));
  };

  useEffect(() => {
    reload(query);
  }, [query]);

  if (reviewing) {
    return (
      <SubscriptionReviewPanel
        role={role}
        back={() => {
          setReviewing(false);
          reload();
        }}
      />
    );
  }

  if (viewingSecurity) {
    return (
      <SecurityHistoryPanel
        scope={role === 'SuperAdmin' ? 'superadmin' : 'admin'}
        back={() => setViewingSecurity(false)}
      />
    );
  }

  if (viewingBookingReport) {
    // REQ-177/178: the booking status-history report + PDF export is Super
    // Admin only; Admin is 403'd server-side and never sees this button.
    return <BookingHistoryReportPanel back={() => setViewingBookingReport(false)} />;
  }

  if (viewingAdminAccounts) {
    // REQ-217..221: platform Admin account lifecycle is Super Admin only.
    return <AdminAccountsPanel back={() => setViewingAdminAccounts(false)} />;
  }

  if (openId) {
    return (
      <section>
        <BusinessProfile
          businessId={openId}
          isAdmin
          back={() => {
            setOpenId(null);
            reload();
          }}
        />
      </section>
    );
  }

  return (
    <section>
      <div className="row">
        <h2>Platform businesses</h2>
        <button type="button" className="secondary" onClick={() => setReviewing(true)}>
          Review subscription payments
        </button>
        <button type="button" className="secondary" onClick={() => setViewingSecurity(true)}>
          Security history
        </button>
        {showLifecycle ? (
          <>
            <button
              type="button"
              className="secondary"
              onClick={() => setViewingBookingReport(true)}
            >
              Booking history report
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setViewingAdminAccounts(true)}
            >
              Admin accounts
            </button>
          </>
        ) : null}
        <button type="button" className="secondary" onClick={() => goBack()}>
          Back
        </button>
      </div>
      <label>
        Search (name, slug, owner email)
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" />
      </label>
      {error ? <p className="alert">{error}</p> : null}
      {!rows ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No businesses found.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Business</th>
              <th>Slug</th>
              <th>Owner</th>
              <th>Status</th>
              {showLifecycle ? <th></th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setOpenId(b.id);
                    }}
                  >
                    {b.name}
                  </a>
                </td>
                <td>/{b.publicSlug}</td>
                <td className="muted">{b.owner?.email ?? '—'}</td>
                <td>
                  <StatusBar business={b} />
                </td>
                {showLifecycle ? (
                  <td>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setOpenId(b.id);
                      }}
                    >
                      Manage
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
