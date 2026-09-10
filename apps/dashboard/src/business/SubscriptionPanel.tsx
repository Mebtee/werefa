import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import {
  majorFromMinorString,
  subscriptionApi,
  type HistoryRow,
  type PaymentView,
  type SubscriptionView,
} from '../lib/subscription-api';

function message(err: unknown): string {
  if (err instanceof ApiError) {
    return err.fields && err.fields.length > 0
      ? `${err.message}: ${err.fields.map((f) => f.message).join('; ')}`
      : err.message;
  }
  return err instanceof Error ? err.message : 'Request failed.';
}

function dateLabel(v: string | null): string {
  if (!v) return '—';
  return new Date(v).toLocaleDateString();
}

function pill(status: SubscriptionView['status']): { label: string; cls: string } {
  switch (status) {
    case 'ACTIVE':
      return { label: 'Active', cls: 'pill' };
    case 'TRIAL':
      return { label: 'Trial', cls: 'pill info' };
    case 'GRACE':
      return { label: 'Grace period', cls: 'pill warn' };
    case 'EXPIRED':
      return { label: 'Expired', cls: 'pill danger' };
  }
}

function newSubmissionKey(businessId: string): string {
  const tail = businessId.replace(/-/g, '').slice(0, 8);
  return `sbx-${tail}-${Date.now()}`;
}

/**
 * Owner subscription & billing panel (Prompt 14, REQ-125..141): derived status,
 * payment history, and the manual payment request flow with proof upload.
 */
export function SubscriptionPanel({ businessId, back }: { businessId: string; back: () => void }) {
  const [subscription, setSubscription] = useState<SubscriptionView | null>(null);
  const [payments, setPayments] = useState<PaymentView[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [overview, hist] = await Promise.all([
        subscriptionApi.overview(businessId),
        subscriptionApi.history(businessId),
      ]);
      setSubscription(overview.subscription);
      setPayments(overview.payments);
      setHistory(hist.history);
      setError(null);
    } catch (err) {
      setError(message(err));
    }
  }, [businessId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!subscription) {
    return (
      <section>
        <h2>Subscription &amp; billing</h2>
        {error ? <p className="alert">{error}</p> : null}
        <p className="muted">Loading subscription…</p>
      </section>
    );
  }

  const badge = pill(subscription.status);

  return (
    <section>
      <h2>
        Subscription &amp; billing <span className={badge.cls}>{badge.label}</span>
      </h2>
      <p className="muted">
        {subscription.canAcceptBookings
          ? 'Your business can accept bookings.'
          : 'Bookings are currently blocked while the subscription is expired.'}
      </p>
      <dl className="kv">
        <dt>Plan price</dt>
        <dd>ETB {majorFromMinorString(subscription.priceMinor)} / month</dd>
        <dt>Trial period</dt>
        <dd>
          {dateLabel(subscription.trialStartedAt)} → {dateLabel(subscription.trialEndsAt)}
        </dd>
        {subscription.paidPeriodStartAt ? (
          <>
            <dt>Paid period</dt>
            <dd>
              {dateLabel(subscription.paidPeriodStartAt)} → {dateLabel(subscription.paidEndsAt)}
            </dd>
            <dt>Grace ends</dt>
            <dd>{dateLabel(subscription.paidGraceEndsAt)}</dd>
          </>
        ) : null}
      </dl>
      {error ? <p className="alert">{error}</p> : null}
      <PaymentRequest businessId={businessId} onSubmitted={() => void reload()} />
      <PaymentsTable businessId={businessId} payments={payments} />
      <HistoryTable history={history} />
      <button type="button" className="secondary" onClick={() => back()}>
        Back
      </button>
    </section>
  );
}

function PaymentRequest({
  businessId,
  onSubmitted,
}: {
  businessId: string;
  onSubmitted: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await subscriptionApi.submitPayment(
        businessId,
        file,
        newSubmissionKey(businessId),
        note.trim() || undefined,
      );
      setFile(null);
      e.currentTarget.reset();
      setInfo(
        res.created
          ? 'Payment request submitted. The platform will review your proof.'
          : 'Payment request already exists (idempotent replay).',
      );
      onSubmitted();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lifecycle">
      <h3>Submit a payment</h3>
      <form onSubmit={(e) => void submit(e)}>
        <label className="file-label">
          Proof of payment (image or PDF)
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            required
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          Note (optional)
          <input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="row">
          <button type="submit" disabled={busy || !file}>
            {busy ? 'Submitting…' : 'Submit payment request'}
          </button>
        </div>
      </form>
      {info ? <p className="info">{info}</p> : null}
      {error ? <p className="alert">{error}</p> : null}
    </div>
  );
}

function PaymentsTable({ businessId, payments }: { businessId: string; payments: PaymentView[] }) {
  const [proofError, setProofError] = useState<string | null>(null);

  async function openProof(paymentId: string) {
    setProofError(null);
    try {
      const proof = await subscriptionApi.getProof(businessId, paymentId);
      window.open(proof.url, '_blank', 'noopener');
    } catch (err) {
      setProofError(message(err));
    }
  }

  if (payments.length === 0) {
    return (
      <div>
        <h3>Payment requests</h3>
        <p className="muted">No payment requests yet.</p>
      </div>
    );
  }

  return (
    <div>
      <h3>Payment requests</h3>
      {proofError ? <p className="alert">{proofError}</p> : null}
      <table className="data-table">
        <thead>
          <tr>
            <th>Submitted</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Reviewed</th>
            <th>Reason</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id}>
              <td>{new Date(p.submittedAt).toLocaleString()}</td>
              <td>ETB {majorFromMinorString(p.amountMinor)}</td>
              <td>
                <span className={`pill ${p.status === 'PENDING' ? 'warn' : ''}`}>{p.status}</span>
              </td>
              <td>{p.reviewedAt ? new Date(p.reviewedAt).toLocaleString() : '—'}</td>
              <td className="muted">{p.rejectionReason ?? '—'}</td>
              <td>
                <button type="button" className="secondary" onClick={() => void openProof(p.id)}>
                  Proof
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryTable({ history }: { history: HistoryRow[] }) {
  if (history.length === 0) {
    return (
      <div>
        <h3>Status history</h3>
        <p className="muted">No transitions recorded yet.</p>
      </div>
    );
  }
  return (
    <div>
      <h3>Status history</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Transition</th>
            <th>Actor</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <tr key={h.id}>
              <td>{new Date(h.occurredAt).toLocaleString()}</td>
              <td>
                {h.fromStatus} → {h.toStatus}
              </td>
              <td>{h.actorType}</td>
              <td className="muted">{h.reason ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
