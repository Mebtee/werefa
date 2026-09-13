import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { deepLink, ownerTelegramApi, type OwnerTelegramConnect } from '../lib/telegram-api';

function message(err: unknown): string {
  if (err instanceof ApiError) {
    return err.fields && err.fields.length > 0
      ? `${err.message}: ${err.fields.map((f) => f.message).join('; ')}`
      : err.message;
  }
  return err instanceof Error ? err.message : 'Request failed.';
}

/**
 * Owner Telegram payment-verification connection (REQ-066/120).
 *
 * The owner connects the business's Telegram chat, which is then the recipient
 * of new-payment-proof notifications carrying Accept/Reject controls. The chat
 * binding is server-authenticated (one-time expiring token consumed by the
 * shared bot webhook); this panel only surfaces the deep link and status.
 */
export function OwnerTelegramPanel({ businessId, back }: { businessId: string; back: () => void }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [pending, setPending] = useState<OwnerTelegramConnect | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const status = await ownerTelegramApi.status(businessId);
      setConnected(status.connected);
      if (status.connected) setPending(null);
      setError(null);
    } catch (err) {
      setError(message(err));
    }
  }, [businessId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function connect() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const result = await ownerTelegramApi.connect(businessId);
      if (result.connected) {
        setConnected(true);
        setInfo(result.message);
        return;
      }
      setPending(result);
      setInfo(result.message);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await ownerTelegramApi.disconnect(businessId);
      setPending(null);
      setConnected(false);
      setInfo('Telegram payment notifications disconnected.');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="row">
        <h2>Telegram payment notifications</h2>
        <span className={connected ? 'pill info' : 'pill warn'}>
          {connected === null ? 'Checking…' : connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      {error ? <p className="alert">{error}</p> : null}
      {info ? <p className="muted">{info}</p> : null}

      <p className="muted">
        Connect this business&apos;s Telegram chat to receive every new payment proof with{' '}
        <strong>Accept</strong> and <strong>Reject</strong> controls. The chat is verified by a
        one-time link; only the connected owner chat can act on this business.
      </p>

      {pending && pending.token && pending.botUsername ? (
        <p>
          <a href={deepLink(pending.botUsername, pending.token)} target="_blank" rel="noreferrer">
            Open Telegram to connect this business
          </a>
          {pending.expiresAt ? (
            <span className="muted small">
              {' '}
              · link expires {new Date(pending.expiresAt).toLocaleString()}
            </span>
          ) : null}
        </p>
      ) : null}

      <div className="row">
        <button type="button" disabled={busy} onClick={() => void connect()}>
          {busy ? 'Working…' : connected ? 'Reconnect Telegram' : 'Connect Telegram'}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={() => void reload()}>
          Refresh status
        </button>
        {connected ? (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void disconnect()}
          >
            Disconnect
          </button>
        ) : null}
      </div>

      <button type="button" className="secondary" onClick={() => back()}>
        Back
      </button>
    </section>
  );
}
