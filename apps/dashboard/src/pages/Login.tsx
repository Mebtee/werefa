import { useState } from 'react';
import { api, ApiError, type Actor } from '../lib/api';

function statusMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Sign-in failed. Try again.';
}

export function Login({
  bootstrapError,
  onSignedIn,
}: {
  bootstrapError: string | null;
  onSignedIn: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResent(false);
    try {
      await api.post<{ user: Actor; session: { expiresAt: string } }>('/api/v1/auth/login', {
        email,
        password,
      });
      onSignedIn();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERIFICATION_REQUIRED') {
        // Authentication succeeded but the account is unverified (REQ-027).
        setVerifyEmail(email);
      } else {
        setError(statusMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!verifyEmail) return;
    setBusy(true);
    setError(null);
    try {
      await api.post<{ message: string }>('/api/v1/auth/verify-email/request', {
        email: verifyEmail,
      });
      setResent(true);
    } catch (err) {
      setError(statusMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (verifyEmail) {
    return (
      <main className="card">
        <h1>Verify your email</h1>
        <p className="muted">
          You signed in successfully, but <strong>{verifyEmail}</strong> is not yet verified. Check
          your inbox for the one-time verification link before using the dashboard.
        </p>
        {resent ? <p className="muted">A fresh verification link was sent.</p> : null}
        {error ? <p className="alert">{error}</p> : null}
        <button type="button" disabled={busy} onClick={() => void resend()}>
          {busy ? 'Sending…' : 'Resend verification link'}
        </button>
        <footer className="muted links">
          <a
            href="#login?"
            onClick={(e) => {
              e.preventDefault();
              setVerifyEmail(null);
              window.location.hash = '';
            }}
          >
            Back to sign in
          </a>
        </footer>
      </main>
    );
  }

  return (
    <main className="card">
      <h1>Werefa</h1>
      <p className="muted">Sign in to manage your business.</p>
      {bootstrapError ? <p className="alert">{bootstrapError}</p> : null}
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
        <label>
          Password
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            required
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? <p className="alert">{error}</p> : null}
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <footer className="muted links">
        <a href="#/reset">Forgot password?</a>
        <a href="#/recovery">Super Admin recovery</a>
        <a href="#/register">Create account</a>
      </footer>
    </main>
  );
}
