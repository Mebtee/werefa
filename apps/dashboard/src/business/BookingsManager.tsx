import { useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import {
  bookingApi,
  STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  ACTOR_LABELS,
  statusPillClass,
  majorFromMinor,
  minutes as minutesLabel,
  toLocalDateTime,
  type BookingOwnerDetail,
  type BookingOwnerListRow,
  type BookingSort,
} from '../lib/booking-api';

function message(err: unknown): string {
  if (err instanceof ApiError) {
    return err.fields && err.fields.length > 0
      ? `${err.message}: ${err.fields.map((f) => f.message).join('; ')}`
      : err.message;
  }
  return err instanceof Error ? err.message : 'Request failed.';
}

const FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'PAYMENT_PENDING', label: 'Payment pending' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'NO_SHOW', label: 'No-show' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export function BookingsManager({ businessId, back }: { businessId: string; back: () => void }) {
  const [rows, setRows] = useState<BookingOwnerListRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<BookingSort>('RECENT');
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pageSize = 25;

  const reload = async () => {
    try {
      const r = await bookingApi.list(businessId, {
        status: status || undefined,
        sort,
        page,
        pageSize,
      });
      setRows(r.bookings);
      setTotal(r.total);
    } catch (err) {
      setError(message(err));
    }
  };

  useEffect(() => {
    void reload();
  }, [businessId, status, sort, page]);

  if (openId) {
    return (
      <BookingDetail
        businessId={businessId}
        bookingId={openId}
        back={() => {
          setOpenId(null);
          void reload();
        }}
      />
    );
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section>
      <div className="row">
        <h2>Bookings</h2>
        <span className="muted small">{total} total</span>
      </div>

      <div className="row field-grid bookings-filters">
        <label>
          Status
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
          >
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as BookingSort);
              setPage(0);
            }}
          >
            <option value="RECENT">Most recent</option>
            <option value="UPCOMING">Upcoming first</option>
          </select>
        </label>
      </div>

      {error ? <p className="alert">{error}</p> : null}

      {!rows ? (
        <p className="muted">Loading bookings…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No bookings found.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Starts</th>
              <th>Services</th>
              <th>Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="booking-row" onClick={() => setOpenId(r.id)}>
                <td>
                  <strong>{r.customerName}</strong>
                  <div className="muted small">{r.customerPhone}</div>
                </td>
                <td>{new Date(r.startAt).toLocaleString()}</td>
                <td className="muted small">{r.services.map((s) => s.name).join(', ')}</td>
                <td>{majorFromMinor(r.totalPriceMinor)}</td>
                <td>
                  <span className={`${statusPillClass(r.status)}`}>
                    {STATUS_LABELS[r.status] ?? r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pageCount > 1 ? (
        <div className="row bookings-pager">
          <button
            type="button"
            className="secondary"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <span className="muted small">
            Page {page + 1} of {pageCount}
          </span>
          <button
            type="button"
            className="secondary"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      ) : null}

      <button type="button" className="secondary" onClick={() => back()}>
        Back
      </button>
    </section>
  );
}

function BookingDetail({
  businessId,
  bookingId,
  back,
}: {
  businessId: string;
  bookingId: string;
  back: () => void;
}) {
  const [booking, setBooking] = useState<BookingOwnerDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rescheduleTo, setRescheduleTo] = useState('');

  const reload = async () => {
    try {
      setBooking(await bookingApi.detail(businessId, bookingId));
    } catch (err) {
      setError(message(err));
    }
  };

  useEffect(() => {
    void reload();
  }, [bookingId]);

  async function act(next: (b: BookingOwnerDetail) => Promise<BookingOwnerDetail>) {
    setBusy(true);
    setError(null);
    try {
      setBooking(await next(booking!));
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  if (!booking) {
    return (
      <section>
        <p className="muted">Loading booking…</p>
        {error ? <p className="alert">{error}</p> : null}
      </section>
    );
  }

  const slotLocked = booking.slotLock === 'LOCKED' || booking.slotLock === 'ALLOCATED';

  return (
    <section>
      <div className="row">
        <h2>Booking {booking.id.slice(0, 8)}</h2>
        <span className={statusPillClass(booking.status)}>
          {STATUS_LABELS[booking.status] ?? booking.status}
        </span>
        {booking.payment?.status ? (
          <span
            className={`${booking.payment.status === 'ACCEPTED' ? 'pill info' : booking.payment.status === 'REJECTED' ? 'pill danger' : 'pill warn'}`}
          >
            Payment {booking.payment.status.toLowerCase()}
          </span>
        ) : null}
        {booking.slotLock ? (
          <span className="pill">Slot {booking.slotLock.toLowerCase()}</span>
        ) : null}
      </div>

      {error ? <p className="alert">{error}</p> : null}

      <dl>
        <dt>Customer</dt>
        <dd>
          {booking.customerName} ({booking.customerPhone})
        </dd>
        <dt>Starts</dt>
        <dd>{new Date(booking.startAt).toLocaleString()}</dd>
        <dt>Ends</dt>
        <dd>{new Date(booking.endAt).toLocaleString()}</dd>
        <dt>Duration</dt>
        <dd>{minutesLabel(booking.totalDurationMinutes)}</dd>
        <dt>Total</dt>
        <dd>{majorFromMinor(booking.totalPriceMinor)}</dd>
        <dt>Created</dt>
        <dd>{new Date(booking.createdAt).toLocaleString()}</dd>
      </dl>

      {booking.note ? (
        <p className="muted small">
          <strong>Customer note:</strong> {booking.note}
        </p>
      ) : null}

      <h3>Services</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>Service</th>
            <th>Price</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          {booking.services.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{majorFromMinor(s.unitPriceMinor)}</td>
              <td>{minutesLabel(s.durationMinutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {booking.payment ? (
        <>
          <h3>Payment</h3>
          <dl>
            <dt>Method</dt>
            <dd>{PAYMENT_METHOD_LABELS[booking.payment.method] ?? booking.payment.method}</dd>
            <dt>Status</dt>
            <dd>{booking.payment.status}</dd>
            {booking.payment.rejectionReason ? (
              <>
                <dt>Rejection reason</dt>
                <dd>{booking.payment.rejectionReason}</dd>
              </>
            ) : null}
          </dl>
          {booking.proofs.length > 0 ? (
            <p className="muted small">
              <strong>{booking.proofs.length}</strong> payment proof submission
              {booking.proofs.length > 1 ? 's' : ''} recorded.
            </p>
          ) : null}
        </>
      ) : null}

      <div className="lifecycle">
        <div className="row booking-actions">
          {booking.status === 'PAYMENT_PENDING' ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void act((b) => bookingApi.accept(businessId, b.id))}
              >
                {busy ? 'Working…' : 'Accept & confirm'}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy || !rejectReason.trim()}
                onClick={() =>
                  void act((b) => bookingApi.reject(businessId, b.id, rejectReason.trim()))
                }
              >
                Reject
              </button>
            </>
          ) : null}

          {booking.status === 'CONFIRMED' ? (
            <>
              <div className="row">
                <label>
                  Reschedule to
                  <input
                    type="datetime-local"
                    value={rescheduleTo}
                    onChange={(e) => setRescheduleTo(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || !rescheduleTo}
                  onClick={() =>
                    void act((b) =>
                      bookingApi.reschedule(businessId, b.id, toLocalDateTime(rescheduleTo)),
                    )
                  }
                >
                  Reschedule
                </button>
              </div>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => {
                  if (window.confirm('Mark this booking as a no-show? This cannot be undone.')) {
                    void act((b) => bookingApi.noShow(businessId, b.id));
                  }
                }}
              >
                No-show
              </button>
            </>
          ) : null}

          {'PAYMENT_PENDING CONFIRMED REJECTED'.includes(booking.status) ? (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Cancel this booking?')) {
                  void act((b) => bookingApi.cancel(businessId, b.id));
                }
              }}
            >
              Cancel
            </button>
          ) : null}

          {'REJECTED COMPLETED NO_SHOW CANCELLED'.includes(booking.status) && slotLocked ? (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Free the slot associated with this booking?')) {
                  void act(async (b) => {
                    await bookingApi.releaseSlot(businessId, b.id);
                    return bookingApi.detail(businessId, b.id);
                  });
                }
              }}
            >
              Release slot
            </button>
          ) : null}
        </div>

        {booking.status === 'PAYMENT_PENDING' ? (
          <label>
            Rejection reason (required to reject)
            <input
              value={rejectReason}
              maxLength={500}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </label>
        ) : null}

        {error ? <p className="alert">{error}</p> : null}
      </div>

      {booking.statusHistory.length > 0 ? (
        <>
          <h3>Status history</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Actor</th>
                <th>When</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {booking.statusHistory.map((h) => (
                <tr key={h.id}>
                  <td>{h.fromStatus}</td>
                  <td>{h.toStatus}</td>
                  <td>{ACTOR_LABELS[h.actorType] ?? h.actorType}</td>
                  <td>{new Date(h.occurredAt).toLocaleString()}</td>
                  <td className="muted small">{h.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {booking.paymentStatusHistory.length > 0 ? (
        <>
          <h3>Payment history</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Actor</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {booking.paymentStatusHistory.map((h) => (
                <tr key={h.id}>
                  <td>{h.fromStatus}</td>
                  <td>{h.toStatus}</td>
                  <td>{ACTOR_LABELS[h.actorType] ?? h.actorType}</td>
                  <td>{new Date(h.occurredAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <button type="button" className="secondary" onClick={() => back()}>
        Back
      </button>
    </section>
  );
}
