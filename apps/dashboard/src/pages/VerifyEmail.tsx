import { useEffect, useState } from 'react';
import { api } from '../lib/api';

function statusMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Verification failed. Try again.';
}

function extractToken(hash: string): string | null {
  const match = hash.match(/^#\/verify\/([A-Za-z0-9_-]+)$/);
  return match?.[1] ?? null;
}

export function VerifyEmail() {
  const token = extractToken(window.location.hash);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setBusy(true);
    api
      .post<void>('/api/v1/auth/verify-email/complete', { token })
      .then(() => {
        if (!cancelled) setDone(true);
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = statusMessage(err);
          if (err && (err as { code?: string }).code === 'TOKEN_USED' && !done) {
            setError('This link has already been used. Sign in to confirm your account.');
            return;
          }
          setError(msg);
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!token) {
    return (
      <main className="card">
        <h1>Confirm your email</h1>
        <p className="alert">This verification link is invalid.</p>
        <footer className="muted links">
          <a
            href="#login?"
            onClick={(e) => {
              e.preventDefault();
              window.location.hash = '';
            }}
          >
            Go to sign in
          </a>
        </footer>
      </main>
    );
  }

  if (done) {
    return (
      <main className="card">
        <h1>Email verified</h1>
        <p className="muted">
          Your email is confirmed. Sign in to create and manage your business.
        </p>
        <button type="button" onClick={() => (window.location.hash = '')}>
          Sign in
        </button>
      </main>
    );
  }

  return (
    <main className="card">
      <h1>Confirm your email</h1>
      {busy ? <p className="muted">Verifying your email…</p> : null}
      {error ? (
        <>
          <p className="alert">{error}</p>
          <footer className="muted links">
            <a
              href="#login?"
              onClick={(e) => {
                e.preventDefault();
                window.location.hash = '';
              }}
            >
              Go to sign in
            </a>
          </footer>
        </>
      ) : null}
    </main>
  );
}
