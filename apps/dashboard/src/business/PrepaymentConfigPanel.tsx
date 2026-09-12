import { useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { prepaymentApi, type PrepaymentConfig } from '../lib/prepayment-api';

function message(err: unknown): string {
  if (err instanceof ApiError) {
    return err.fields && err.fields.length > 0
      ? `${err.message}: ${err.fields.map((f) => f.message).join('; ')}`
      : err.message;
  }
  return err instanceof Error ? err.message : 'Request failed.';
}

/** Convert minor units to major (ETB) for display. */
function majorFromMinor(minor: number | null): string {
  if (minor === null || minor === undefined) return '';
  return (minor / 100).toFixed(2);
}

/** Convert major (ETB) input back to minor units. */
function minorFromMajor(text: string): number | null {
  const n = Number.parseFloat(text);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/**
 * Owner prepayment configuration panel (REQ-110/111): enables a booking
 * deposit as either a percentage of the total or a fixed amount. Exactly one
 * form is accepted — mixing is rejected by the API and blocked in the UI.
 */
export function PrepaymentConfigPanel({
  businessId,
  back,
}: {
  businessId: string;
  back: () => void;
}) {
  const [config, setConfig] = useState<PrepaymentConfig | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<'PERCENTAGE' | 'FIXED'>('PERCENTAGE');
  const [percent, setPercent] = useState('');
  const [fixedAmount, setFixedAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const syncFromConfig = (c: PrepaymentConfig) => {
    setEnabled(c.enabled);
    if (c.type === 'PERCENTAGE') {
      setMode('PERCENTAGE');
      setPercent(c.percentage !== null ? String(c.percentage) : '');
      setFixedAmount('');
    } else if (c.type === 'FIXED') {
      setMode('FIXED');
      setFixedAmount(majorFromMinor(c.fixedMinor));
      setPercent('');
    } else {
      setPercent('');
      setFixedAmount('');
    }
  };

  useEffect(() => {
    prepaymentApi
      .get(businessId)
      .then((c) => {
        setConfig(c);
        syncFromConfig(c);
      })
      .catch((err) => setError(message(err)));
  }, [businessId]);

  if (!config && !error) {
    return (
      <section>
        <h2>Prepayment configuration</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    setInfo(null);
    const input: Parameters<typeof prepaymentApi.update>[1] = { enabled };
    if (enabled) {
      if (mode === 'PERCENTAGE') {
        const p = Number.parseInt(percent, 10);
        if (!Number.isInteger(p) || p < 1 || p > 100) {
          setError('Percentage must be between 1 and 100.');
          setBusy(false);
          return;
        }
        input.type = 'PERCENTAGE';
        input.percentage = p;
      } else {
        const minor = minorFromMajor(fixedAmount);
        if (minor === null || minor <= 0) {
          setError('Fixed prepayment must be a positive amount.');
          setBusy(false);
          return;
        }
        input.type = 'FIXED';
        input.fixedMinor = minor;
      }
    }
    try {
      const updated = await prepaymentApi.update(businessId, input);
      setConfig(updated);
      syncFromConfig(updated);
      setInfo('Prepayment configuration saved.');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Prepayment configuration</h2>
      <p className="muted">
        Require a customer deposit before confirming a booking. Existing bookings are never changed;
        new bookings snapshot the current configuration.
      </p>
      {error ? <p className="alert">{error}</p> : null}
      {info ? <p className="info">{info}</p> : null}
      <label className="checkbox">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Require prepayment for new bookings
      </label>
      {enabled ? (
        <>
          <label>
            Type
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as 'PERCENTAGE' | 'FIXED')}
            >
              <option value="PERCENTAGE">Percentage of the total</option>
              <option value="FIXED">Fixed amount (ETB)</option>
            </select>
          </label>
          {mode === 'PERCENTAGE' ? (
            <label>
              Percentage (1 – 100%)
              <input
                type="number"
                min={1}
                max={100}
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                placeholder="e.g. 20"
              />
            </label>
          ) : (
            <label>
              Amount in ETB
              <input
                type="number"
                min={0}
                step="0.01"
                value={fixedAmount}
                onChange={(e) => setFixedAmount(e.target.value)}
                placeholder="e.g. 50.00"
              />
            </label>
          )}
        </>
      ) : null}
      <div className="row">
        <button type="button" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save configuration'}
        </button>
        <button type="button" className="secondary" onClick={() => back()}>
          Back
        </button>
      </div>
    </section>
  );
}
