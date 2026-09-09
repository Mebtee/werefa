import { useEffect, useState } from 'react';
import { api } from '../lib/api';

function statusMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Request failed. Try again.';
}

function extractToken(hash: string): string | null {
  const match = hash.match(/^#\/reset\/([A-Za-z0-9_-]+)$/);
  return match?.[1] ?? null;
}

export function ResetPassword() {
  const tokenFromUrl = extractToken(window.location.hash);
  const [tokenDone, setTokenDone] = useState<string | null>(null);

  useEffect(() => {
    if (tokenFromUrl) setTokenDone(tokenFromUrl);
  }, [tokenFromUrl]);

  if (tokenDone) {
    return <CompleteReset token={tokenDone} onStartOver={() => setTokenDone(null)} />;
  }
  return <RequestReset />;
}

function RequestReset() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post<{ message: string }>('/api/v1/auth/password/reset/request', { email });
      setSent(true);
    } catch (err) {
      setError(statusMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="card">
      <h1>Reset your password</h1>
      {sent ? (
        <>
          <p className="muted">
            If an account exists for that email, a one-time reset link was sent. Check your inbox.
          </p>
          <a href="#login?" onClick={() => (window.location.hash = '')}>
            Back to sign in
          </a>
        </>
      ) : (
        <>
          <p className="muted">
            Enter your account email. We’ll send a one-time reset link (valid 30 minutes).
          </p>
          <form onSubmit={(e) => void submit(e)}>
            <label>
              Email
              <input
                type="email"
                value={email}
                autoComplete="username"
                required
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {error ? <p className="alert">{error}</p> : null}
            <button type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
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
        </>
      )}
    </main>
  );
}

function CompleteReset({ token, onStartOver }: { token: string; onStartOver: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/v1/auth/password/reset/complete', {
        token,
        newPassword: password,
      });
      setDone(true);
    } catch (err) {
      setError(statusMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <main className="card">
        <h1>Password reset</h1>
        <p className="muted">
          Your password was updated and all sessions were signed out. Sign in with your new
          password.
        </p>
        <button type="button" onClick={() => (window.location.hash = '')}>
          Back to sign in
        </button>
      </main>
    );
  }

  return (
    <main className="card">
      <h1>Choose a new password</h1>
      <p className="muted">At least 12 characters. This link is one-time only.</p>
      <form onSubmit={(e) => void submit(e)}>
        <label>
          New password
          <input
            type="password"
            value={password}
            autoComplete="new-password"
            minLength={12}
            required
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            value={confirm}
            autoComplete="new-password"
            minLength={12}
            required
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {error ? <p className="alert">{error}</p> : null}
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Set new password'}
        </button>
      </form>
      <footer className="muted links">
        <a
          href="#login?"
          onClick={(e) => {
            e.preventDefault();
            onStartOver();
            window.location.hash = '';
          }}
        >
          Back
        </a>
      </footer>
    </main>
  );
}
