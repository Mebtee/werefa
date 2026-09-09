import { useEffect, useRef, useState } from 'react';
import { apiPost, ApiError } from './lib/api';

interface ConnectResult {
  connected: boolean;
  token?: string;
  botUsername?: string;
  expiresAt?: string;
  message: string;
}

interface StatusResult {
  connected: boolean;
}

/**
 * Optional Telegram updates (REQ-056: bookable-without; doc 12 §4). After a
 * booking is created the customer can bind a chat by opening a one-time
 * t.me deep link. State is polled so the page reflects the webhook binding.
 */
export function TelegramConnectCard({
  slug,
  bookingId,
  phone,
}: {
  slug: string;
  bookingId: string;
  phone: string;
}) {
  const [state, setState] = useState<'idle' | 'connecting' | 'linked'>('idle');
  const [link, setLink] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollTimers = useRef<number[]>([]);

  useEffect(() => {
    let alive = true;
    apiPost<StatusResult>(
      `/api/v1/public/businesses/${slug}/bookings/${bookingId}/telegram/status`,
      {
        phone,
      },
    )
      .then((res) => {
        if (alive) setState(res.connected ? 'linked' : 'idle');
      })
      .catch(() => {
        if (alive) setState('idle');
      });
    return () => {
      alive = false;
    };
  }, [slug, bookingId, phone]);

  useEffect(() => () => pollTimers.current.forEach((t) => window.clearTimeout(t)), []);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<ConnectResult>(
        `/api/v1/public/businesses/${slug}/bookings/${bookingId}/telegram/connect`,
        { phone },
      );
      if (res.connected) {
        setState('linked');
        setMessage('This booking is already connected to Telegram.');
      } else if (res.token) {
        const base = res.botUsername ? `https://t.me/${res.botUsername}?start=${res.token}` : null;
        setLink(base);
        setMessage(res.message);
        pollUntilConnected();
      } else {
        setMessage(res.message);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the connection.');
    } finally {
      setBusy(false);
    }
  }

  function pollUntilConnected() {
    let tries = 0;
    const poll = () => {
      tries += 1;
      if (tries > 25) return; // ~2.5 min of waiting, then the user refreshes
      const t = window.setTimeout(() => {
        apiPost<StatusResult>(
          `/api/v1/public/businesses/${slug}/bookings/${bookingId}/telegram/status`,
          { phone },
        )
          .then((res) => {
            if (res.connected) {
              setState('linked');
              setLink(null);
            } else {
              poll();
            }
          })
          .catch(() => poll());
      }, 6000);
      pollTimers.current.push(t);
    };
    poll();
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await apiPost<{ message: string }>(
        `/api/v1/public/businesses/${slug}/bookings/${bookingId}/telegram/disconnect`,
        { phone },
      );
      setState('idle');
      setLink(null);
      setMessage(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not disconnect.');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'linked') {
    return (
      <div className="telegram-card">
        <p className="muted small">
          <strong>Telegram updates: on.</strong> You will receive booking updates in your chat.
        </p>
        <button className="button secondary" type="button" disabled={busy} onClick={disconnect}>
          {busy ? 'Disconnecting…' : 'Turn off Telegram updates'}
        </button>
        {error ? <p className="alert small">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="telegram-card">
      <p className="muted small">
        Optional: get booking updates in Telegram (payment confirmed, reminders, changes).
      </p>
      <div className="row">
        <button
          className="button secondary"
          type="button"
          disabled={busy}
          onClick={state === 'connecting' ? () => undefined : connect}
        >
          {busy ? 'Connecting…' : 'Connect Telegram'}
        </button>
      </div>
      {link ? (
        <p className="notice small">
          Open in Telegram:{' '}
          <a href={link} target="_blank" rel="noreferrer">
            {link}
          </a>
          <br />
          <span className="muted">This link expires in about 30 minutes.</span>
        </p>
      ) : null}
      {message ? <p className="muted small">{message}</p> : null}
      {error ? <p className="alert small">{error}</p> : null}
    </div>
  );
}
