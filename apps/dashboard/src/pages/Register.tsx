import { useState } from 'react';
import { api, ApiError } from '../lib/api';

function statusMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Registration failed. Try again.';
}

export function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResent(false);
    try {
      await api.post<{ message: string }>('/api/v1/auth/register', { email, password });
      setSentEmail(email);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERIFICATION_REQUIRED') {
        setSentEmail(email);
      } else {
        setError(statusMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!email) return;
    setBusy(true);
    setError(null);
    try {
      await api.post<{ message: string }>('/api/v1/auth/verify-email/request', { email });
      setResent(true);
    } catch (err) {
      setError(statusMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (sentEmail) {
    return (
      <main className="card">
        <h1>Check your inbox</h1>
        <p className="muted">
          A one-time verification link (valid 30 minutes) was sent to <strong>{sentEmail}</strong>.
          Open it to activate your account, then sign in to create your business.
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
      <h1>Create your Werefa account</h1>
      <p className="muted">
        Register to manage your business. You’ll verify your email first, then create your business
        after signing in.
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
        <label>
          Password
          <input
            type="password"
            value={password}
            autoComplete="new-password"
            minLength={12}
            required
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? <p className="alert">{error}</p> : null}
        <button type="submit" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <footer className="muted links">
        Already have an account?{' '}
        <a
          href="#login?"
          onClick={(e) => {
            e.preventDefault();
            window.location.hash = '';
          }}
        >
          Sign in
        </a>
      </footer>
    </main>
  );
}
