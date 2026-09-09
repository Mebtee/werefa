import { useState } from 'react';
import { api, type Actor } from '../lib/api';

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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post<{ user: Actor; session: { expiresAt: string } }>('/api/v1/auth/login', {
        email,
        password,
      });
      onSignedIn();
    } catch (err) {
      setError(statusMessage(err));
    } finally {
      setBusy(false);
    }
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
      </footer>
    </main>
  );
}
