import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { adminAccountsApi, type AdminAccountListItem } from '../lib/admin-accounts-api';

function message(err: unknown): string {
  if (err instanceof ApiError) {
    return err.fields && err.fields.length > 0
      ? `${err.message}: ${err.fields.map((f) => f.message).join('; ')}`
      : err.message;
  }
  return err instanceof Error ? err.message : 'Request failed.';
}

/**
 * Super Admin — Admin account lifecycle (REQ-217..221): list, create,
 * deactivate, reactivate, change password, force sign-out. Every action is
 * SuperAdmin-only and enforced server-side; the panel only renders for the
 * Super Admin role.
 */
export function AdminAccountsPanel({ back }: { back: () => void }) {
  const [rows, setRows] = useState<AdminAccountListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pwTarget, setPwTarget] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    adminAccountsApi
      .list()
      .then(setRows)
      .catch((err) => setError(message(err)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submitCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const email = String(d.get('email') ?? '').trim();
    const password = String(d.get('password') ?? '');
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await adminAccountsApi.create({ email, password });
      e.currentTarget.reset();
      setNotice(`Admin ${created.email} created; a welcome email was sent.`);
      load();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword(row: AdminAccountListItem, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const newPassword = String(d.get('newPassword') ?? '');
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await adminAccountsApi.changePassword(row.id, newPassword);
      e.currentTarget.reset();
      setPwTarget(null);
      setNotice(`Password updated for ${row.email}. Their sessions were signed out.`);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  function deactivate(row: AdminAccountListItem) {
    if (!window.confirm(`Deactivate "${row.email}"? They will be signed out immediately.`)) return;
    setError(null);
    setNotice(null);
    adminAccountsApi
      .deactivate(row.id)
      .then(() => {
        setNotice(`Deactivated ${row.email}.`);
        load();
      })
      .catch((err) => setError(message(err)));
  }

  function reactivate(row: AdminAccountListItem) {
    if (!window.confirm(`Reactivate "${row.email}"?`)) return;
    setError(null);
    setNotice(null);
    adminAccountsApi
      .reactivate(row.id)
      .then(() => {
        setNotice(`Reactivated ${row.email}.`);
        load();
      })
      .catch((err) => setError(message(err)));
  }

  function forceSignOut(row: AdminAccountListItem) {
    if (!window.confirm(`Sign ${row.email} out of all devices?`)) return;
    setError(null);
    setNotice(null);
    adminAccountsApi
      .forceSignOut(row.id)
      .then(() => setNotice(`Signed ${row.email} out of all devices.`))
      .catch((err) => setError(message(err)));
  }

  return (
    <section>
      <div className="row">
        <h2>Platform admin accounts</h2>
        <button type="button" className="secondary" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Cancel' : 'Add admin'}
        </button>
        <button type="button" className="secondary" onClick={() => back()}>
          Back
        </button>
      </div>

      {creating ? (
        <form className="card" onSubmit={submitCreate}>
          <h3>Create an Admin account</h3>
          <div className="field-grid">
            <label>
              Email
              <input name="email" type="email" maxLength={255} required autoComplete="off" />
            </label>
            <label>
              Temporary password
              <input
                name="password"
                type="password"
                minLength={12}
                required
                autoComplete="new-password"
              />
            </label>
          </div>
          <div className="row">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Creating…' : 'Create admin'}
            </button>
          </div>
          <p className="muted">
            Up to two active Admin accounts are allowed while the Super Admin account exists. The
            password will be shown only to this form; the welcome email never contains it.
          </p>
        </form>
      ) : null}

      {error ? <p className="alert">{error}</p> : null}
      {notice ? <p className="info">{notice}</p> : null}

      {!rows ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No Admin accounts.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Status</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.email}</td>
                <td>
                  {row.disabledAt ? (
                    <span className="pill danger">Deactivated</span>
                  ) : (
                    <span className="pill">Active</span>
                  )}
                </td>
                <td className="muted">{new Date(row.createdAt).toISOString().slice(0, 10)}</td>
                <td>
                  <div className="row">
                    {row.disabledAt ? (
                      <button type="button" className="secondary" onClick={() => reactivate(row)}>
                        Reactivate
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => setPwTarget((t) => (t === row.id ? null : row.id))}
                        >
                          Change password
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => forceSignOut(row)}
                        >
                          Sign out
                        </button>
                        <button
                          type="button"
                          className="danger-button"
                          onClick={() => deactivate(row)}
                        >
                          Deactivate
                        </button>
                      </>
                    )}
                  </div>
                  {pwTarget === row.id ? (
                    <form className="row" onSubmit={(e) => submitPassword(row, e)}>
                      <input
                        name="newPassword"
                        type="password"
                        minLength={12}
                        required
                        autoComplete="new-password"
                        placeholder="New password"
                      />
                      <button type="submit" className="primary" disabled={busy}>
                        {busy ? 'Saving…' : 'Save'}
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
