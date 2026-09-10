import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import {
  RESULT_OPTIONS,
  SECURITY_FILTER_TYPES,
  adminSecurityApi,
  ownerSecurityApi,
  superAdminSecurityApi,
  type SecurityEventRow,
  type SecurityHistoryPage,
  type SecurityHistoryScope,
} from '../lib/security-history-api';

const PAGE_SIZE = 25;

function message(err: unknown): string {
  if (err instanceof ApiError) {
    return err.fields && err.fields.length > 0
      ? `${err.message}: ${err.fields.map((f) => f.message).join('; ')}`
      : err.message;
  }
  return err instanceof Error ? err.message : 'Request failed.';
}

function eventLabel(type: string): string {
  return type.replace(/_/g, ' ').toLowerCase();
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * Security/activity history (REQ-201 Owner, REQ-202 Admin, REQ-203 + REQ-205/206
 * Super Admin). Server-side filters and pagination only; deletion is exposed
 * solely to the Super Admin scope with a client confirm step.
 */
export function SecurityHistoryPanel({
  scope,
  back,
}: {
  scope: SecurityHistoryScope;
  back: () => void;
}) {
  const isSuperAdmin = scope === 'superadmin';
  const api =
    scope === 'owner'
      ? ownerSecurityApi
      : scope === 'admin'
        ? adminSecurityApi
        : superAdminSecurityApi;

  const [page, setPage] = useState(0);
  const [type, setType] = useState('');
  const [result, setResult] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [role, setRole] = useState('');
  const [data, setData] = useState<SecurityHistoryPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.list({
        type: type || undefined,
        result: result || undefined,
        from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
        businessId: businessId || undefined,
        role: role || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setData(res);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }, [api, type, result, from, to, businessId, role, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const applyFilters = () => {
    setPage(0);
    void load();
  };

  const resetFilters = () => {
    setType('');
    setResult('');
    setFrom('');
    setTo('');
    setBusinessId('');
    setRole('');
    setPage(0);
  };

  const removeEvent = async (row: SecurityEventRow) => {
    if (!window.confirm(`Delete the "${eventLabel(row.type)}" event? This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await superAdminSecurityApi.del(row.id);
      const remaining = (data?.total ?? 1) - 1;
      if (page > 0 && remaining <= page * PAGE_SIZE) setPage(page - 1);
      else void load();
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="row">
        <h2>
          Security &amp; activity
          <span className="muted">
            {' '}
            ·{' '}
            {scope === 'owner'
              ? 'your activity'
              : scope === 'admin'
                ? 'your history'
                : 'platform history'}
          </span>
        </h2>
        <button type="button" className="secondary" onClick={back}>
          Back
        </button>
      </div>

      <form
        className="row filters"
        onSubmit={(e) => {
          e.preventDefault();
          applyFilters();
        }}
      >
        <label>
          Event
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Any</option>
            {SECURITY_FILTER_TYPES.map((t) => (
              <option key={t} value={t}>
                {eventLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Result
          <select value={result} onChange={(e) => setResult(e.target.value)}>
            <option value="">Any</option>
            {RESULT_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {isSuperAdmin ? (
          <>
            <label>
              Business ID
              <input
                value={businessId}
                onChange={(e) => setBusinessId(e.target.value)}
                placeholder="uuid"
              />
            </label>
            <label>
              Role
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="">Any</option>
                <option value="Owner">Owner</option>
                <option value="Admin">Admin</option>
                <option value="SuperAdmin">Super Admin</option>
              </select>
            </label>
          </>
        ) : null}
        <div className="row">
          <button type="submit" disabled={busy}>
            Filter
          </button>
          <button type="button" className="secondary" onClick={resetFilters}>
            Reset
          </button>
        </div>
      </form>

      {error ? <p className="alert">{error}</p> : null}
      {!data ? (
        <p className="muted">Loading…</p>
      ) : data.events.length === 0 ? (
        <p className="muted">No security events found.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Type</th>
              <th>Result</th>
              <th>Device</th>
              <th>Browser</th>
              <th>IP</th>
              {isSuperAdmin ? <th>User</th> : null}
              {isSuperAdmin ? <th></th> : null}
            </tr>
          </thead>
          <tbody>
            {data.events.map((row) => (
              <tr key={row.id}>
                <td className="muted">{formatWhen(row.createdAt)}</td>
                <td>{eventLabel(row.type)}</td>
                <td>{row.result ? <span className="pill">{row.result}</span> : '—'}</td>
                <td>{row.device ?? '—'}</td>
                <td>{row.browser ?? '—'}</td>
                <td>{row.ip ?? '—'}</td>
                {isSuperAdmin ? (
                  <td className="muted">{row.userEmail ?? row.userId ?? '—'}</td>
                ) : null}
                {isSuperAdmin ? (
                  <td>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => void removeEvent(row)}
                    >
                      Delete
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data ? (
        <div className="row">
          <button
            type="button"
            className="secondary"
            disabled={page <= 0 || busy}
            onClick={() => setPage((p) => p - 1)}
          >
            Prev
          </button>
          <span className="muted">
            Page {page + 1} of {totalPages} ({data.total} events)
          </span>
          <button
            type="button"
            className="secondary"
            disabled={page + 1 >= totalPages || busy}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      ) : null}
    </section>
  );
}
