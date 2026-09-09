import { useState } from 'react';
import { api } from '../lib/api';

function statusMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Request failed. Try again.';
}

export function Recovery() {
  const [phase, setPhase] = useState<'request' | 'code' | 'done'>('request');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post<{ message: string }>('/api/v1/super-admin/recovery/request', {
        recoveryEmail,
      });
      setPhase('code');
    } catch (err) {
      setError(statusMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function completeCode(event: React.FormEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/v1/super-admin/recovery/complete', {
        code: String(data.get('code') ?? ''),
        newPassword: String(data.get('newPassword') ?? ''),
      });
      setPhase('done');
    } catch (err) {
      setError(statusMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'done') {
    return (
      <main className="card">
        <h1>Recovery complete</h1>
        <p className="muted">
          The Super Admin password was replaced and all sessions were signed out. Sign in with the
          new password.
        </p>
        <button type="button" onClick={() => (window.location.hash = '')}>
          Back to sign in
        </button>
      </main>
    );
  }

  return (
    <main className="card">
      <h1>Super Admin recovery</h1>
      {phase === 'request' ? (
        <form onSubmit={(e) => void requestCode(e)}>
          <p className="muted">
            Enter the emergency recovery email on file for the Super Admin account. A one-time code
            (valid 15 minutes) will be sent there.
          </p>
          <label>
            Recovery email
            <input
              type="email"
              value={recoveryEmail}
              autoComplete="email"
              required
              onChange={(e) => setRecoveryEmail(e.target.value)}
            />
          </label>
          {error ? <p className="alert">{error}</p> : null}
          <button type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send recovery code'}
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => void completeCode(e)}>
          <p className="muted">
            Enter the code you received, then choose a new Super Admin password.
          </p>
          <label>
            One-time code
            <input
              name="code"
              maxLength={10}
              pattern="[A-Za-z2-7]{10}"
              autoComplete="off"
              required
            />
          </label>
          <label>
            New password
            <input
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </label>
          {error ? <p className="alert">{error}</p> : null}
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Complete recovery'}
          </button>
        </form>
      )}
      <footer className="muted links">
        <a
          href="#login?"
          onClick={(e) => {
            e.preventDefault();
            window.location.hash = '';
          }}
        >
          Back to sign in
        </a>
      </footer>
    </main>
  );
}
