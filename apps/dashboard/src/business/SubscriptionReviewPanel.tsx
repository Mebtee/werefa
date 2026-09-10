import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import {
  adminSubscriptionApi,
  majorFromMinorString,
  superAdminSubscriptionApi,
  type AdminPaymentRow,
  type HistoryRow,
  type PaymentStatus,
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

/**
 * Admin review queue for subscription payments (Prompt 14, REQ-137/138).
 * Admin (and Super Admin, rank-inclusive) can list, inspect and approve/reject
 * pending payments; Super Admin additionally sees the full audit trail.
 */
export function SubscriptionReviewPanel({
  role,
  back,
}: {
  role: 'Admin' | 'SuperAdmin';
  back: () => void;
}) {
  const [filter, setFilter] = useState<PaymentStatus | undefined>(undefined);
  const [payments, setPayments] = useState<AdminPaymentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const reload = useCallback(() => {
    setPayments(null);
    adminSubscriptionApi
      .list(filter)
      .then(setPayments)
      .catch((err) => setError(message(err)));
  }, [filter]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (openId) {
    return (
      <ReviewDetail
        paymentId={openId}
        role={role}
        back={() => {
          setOpenId(null);
          reload();
        }}
      />
    );
  }

  return (
    <section>
      <div className="row">
        <h2>Subscription payment reviews</h2>
        <button type="button" className="secondary" onClick={() => back()}>
          Back
        </button>
      </div>
      <label>
        Status
        <select
          value={filter ?? ''}
          onChange={(e) => setFilter((e.target.value || undefined) as PaymentStatus | undefined)}
        >
          <option value="">All</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </label>
      {error ? <p className="alert">{error}</p> : null}
      {!payments ? (
        <p className="muted">Loading…</p>
      ) : payments.length === 0 ? (
        <p className="muted">No payments found.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Business</th>
              <th>Owner</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Submitted</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.businessName} <span className="muted">/{p.businessSlug}</span>
                </td>
                <td className="muted">{p.ownerEmail ?? '—'}</td>
                <td>ETB {majorFromMinorString(p.amountMinor)}</td>
                <td>
                  <span className={`pill ${p.status === 'PENDING' ? 'warn' : ''}`}>{p.status}</span>
                </td>
                <td>{new Date(p.submittedAt).toLocaleString()}</td>
                <td>
                  <button
                    type="button"
                    className={p.status === 'PENDING' ? '' : 'secondary'}
                    onClick={() => setOpenId(p.id)}
                  >
                    Review
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ReviewDetail({
  paymentId,
  role,
  back,
}: {
  paymentId: string;
  role: 'Admin' | 'SuperAdmin';
  back: () => void;
}) {
  const [payment, setPayment] = useState<AdminPaymentRow | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionView | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<false | 'approve' | 'reject'>(false);

  const load = useCallback(async () => {
    const isAudit = role === 'SuperAdmin';
    const detail = isAudit
      ? await superAdminSubscriptionApi.audit(paymentId)
      : { payment: await adminSubscriptionApi.detail(paymentId), subscription: null, history: [] };
    setPayment(detail.payment);
    setSubscription(isAudit ? detail.subscription : null);
    setHistory(isAudit ? detail.history : []);
  }, [paymentId, role]);

  useEffect(() => {
    load().catch((err) => setError(message(err)));
  }, [load]);

  if (!payment) {
    return (
      <section>
        <h2>Review payment</h2>
        {error ? <p className="alert">{error}</p> : null}
        <p className="muted">Loading…</p>
      </section>
    );
  }

  async function act(kind: 'approve' | 'reject') {
    if (kind === 'reject' && reason.trim().length < 5) {
      setError('A reason of at least 5 characters is required to reject.');
      return;
    }
    setBusy(kind);
    setError(null);
    setInfo(null);
    try {
      if (kind === 'approve') {
        const res = await adminSubscriptionApi.approve(paymentId);
        setPayment(res.payment);
        if (res.subscription) setSubscription(res.subscription);
        setInfo(`Approved. Paid period now ends ${dateLabel(res.subscription?.paidEndsAt)}.`);
      } else {
        const updated = await adminSubscriptionApi.reject(paymentId, reason.trim());
        setPayment(updated);
        setInfo('Rejected. The owner will be notified with the reason.');
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="row">
        <h2>Review payment</h2>
        <button type="button" className="secondary" onClick={() => back()}>
          Back
        </button>
      </div>
      <dl className="kv">
        <dt>Business</dt>
        <dd>
          {payment.businessName} <span className="muted">/{payment.businessSlug}</span>
        </dd>
        <dt>Owner email</dt>
        <dd>{payment.ownerEmail ?? '—'}</dd>
        <dt>Amount</dt>
        <dd>ETB {majorFromMinorString(payment.amountMinor)}</dd>
        <dt>Submitted</dt>
        <dd>{new Date(payment.submittedAt).toLocaleString()}</dd>
        <dt>Status</dt>
        <dd>
          <span className={`pill ${payment.status === 'PENDING' ? 'warn' : ''}`}>
            {payment.status}
          </span>
        </dd>
        <dt>Note</dt>
        <dd>{payment.note ?? '—'}</dd>
        {payment.rejectionReason ? (
          <>
            <dt>Reject reason</dt>
            <dd>{payment.rejectionReason}</dd>
          </>
        ) : null}
      </dl>
      {subscription ? (
        <dl className="kv">
          <dt>Subscription status</dt>
          <dd>
            {subscription.status}
            {subscription.paidEndsAt ? ` · paid until ${dateLabel(subscription.paidEndsAt)}` : ''}
          </dd>
        </dl>
      ) : null}
      {payment.proofUrl ? (
        <p>
          <a href={payment.proofUrl} target="_blank" rel="noreferrer">
            View proof of payment
          </a>{' '}
          <span className="muted">
            ({payment.mime}, {Math.round(payment.sizeBytes / 1024)} KB)
          </span>
        </p>
      ) : null}
      {payment.status === 'PENDING' ? (
        <div className="lifecycle">
          {error ? <p className="alert">{error}</p> : null}
          <label>
            Rejection reason (required to reject)
            <textarea
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="row">
            <button type="button" disabled={busy !== false} onClick={() => void act('approve')}>
              {busy === 'approve' ? 'Approving…' : 'Approve payment'}
            </button>
            <button
              type="button"
              className="danger-button"
              disabled={busy !== false}
              onClick={() => void act('reject')}
            >
              {busy === 'reject' ? 'Rejecting…' : 'Reject payment'}
            </button>
          </div>
        </div>
      ) : null}
      {info ? <p className="info">{info}</p> : null}
      {error && payment.status !== 'PENDING' ? <p className="alert">{error}</p> : null}
      {history.length > 0 ? (
        <div>
          <h3>Audit trail</h3>
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
      ) : null}
    </section>
  );
}

function dateLabel(v: string | null | undefined): string {
  if (!v) return '—';
  return new Date(v).toLocaleDateString();
}
