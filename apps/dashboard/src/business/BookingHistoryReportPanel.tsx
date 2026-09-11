import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import {
  BOOKING_REPORT_ACTOR_TYPES,
  BOOKING_REPORT_STATUSES,
  superAdminBookingReportApi,
  type BookingHistoryPage,
  type BookingReportActorType,
  type BookingReportSortBy,
  type BookingReportStatus,
} from '../lib/booking-report-api';

const PAGE_SIZE = 25;

/** System-wide fixed timezone (doc 10 §2): Africa/Addis_Ababa is UTC+3. */
const ADDIS_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * Convert a calendar day (YYYY-MM-DD) to the inclusive boundary instants of
 * that day in the fixed system timezone (REQ 15/19: never browser-local, never
 * user-configurable). Notional: the API stores instants in UTC; the day window
 * is the Africa/Addis_Ababa day.
 */
function addisDayBoundaries(day: string): { start: Date; end: Date } {
  const parts = day.split('-');
  const y = Number.parseInt(parts[0] ?? '0', 10);
  const m = Number.parseInt(parts[1] ?? '1', 10);
  const d = Number.parseInt(parts[2] ?? '1', 10);
  const utcMidnight = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  return {
    start: new Date(utcMidnight - ADDIS_OFFSET_MS),
    end: new Date(utcMidnight + 86_400_000 - ADDIS_OFFSET_MS - 1),
  };
}

function message(err: unknown): string {
  if (err instanceof ApiError) {
    return err.fields && err.fields.length > 0
      ? `${err.message}: ${err.fields.map((f) => f.message).join('; ')}`
      : err.message;
  }
  return err instanceof Error ? err.message : 'Request failed.';
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function actorLabel(actorType: string, actorUserId: string | null): string {
  const label =
    actorType === 'SUPER_ADMIN'
      ? 'Super Admin'
      : actorType === 'ADMIN'
        ? 'Admin'
        : actorType === 'OWNER'
          ? 'Owner'
          : actorType === 'SYSTEM'
            ? 'System'
            : actorType;
  if (!actorUserId) return label;
  const short = actorUserId.replace(/-/g, '').slice(0, 8).toUpperCase();
  return `${label} (${short})`;
}

/**
 * Super Admin booking status-history report (REQ-177..190). Cross-business,
 * read-only, server-side filters/sort/pagination. The PDF export link carries
 * the current filters (REQ-179) and the API enforces authorization (§33).
 */
export function BookingHistoryReportPanel({ back }: { back: () => void }) {
  const [page, setPage] = useState(0);
  const [statuses, setStatuses] = useState<BookingReportStatus[]>([]);
  const [actorTypes, setActorTypes] = useState<BookingReportActorType[]>([]);
  const [actorUserId, setActorUserId] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sortBy, setSortBy] = useState<BookingReportSortBy>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [data, setData] = useState<BookingHistoryPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const range = useCallback(() => {
    const range: { from?: Date; to?: Date } = {};
    if (from) range.from = addisDayBoundaries(from).start;
    if (to) range.to = addisDayBoundaries(to).end;
    return range;
  }, [from, to]);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { from: f, to: t } = range();
      const res = await superAdminBookingReportApi.history({
        statuses,
        actorTypes,
        actorUserId: actorUserId || undefined,
        businessId: businessId || undefined,
        from: f ? f.toISOString() : undefined,
        to: t ? t.toISOString() : undefined,
        sortBy,
        sortDirection,
        page,
        pageSize: PAGE_SIZE,
      });
      setData(res);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }, [statuses, actorTypes, actorUserId, businessId, range, sortBy, sortDirection, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const applyFilters = (nextPage = 0) => {
    setPage(nextPage);
    void load();
  };

  const resetFilters = () => {
    setStatuses([]);
    setActorTypes([]);
    setActorUserId('');
    setBusinessId('');
    setFrom('');
    setTo('');
    setSortBy('date');
    setSortDirection('desc');
    setPage(0);
    void load();
  };

  const exportUrl = superAdminBookingReportApi.pdfUrl({
    statuses,
    actorTypes,
    actorUserId: actorUserId || undefined,
    businessId: businessId || undefined,
    from: range().from?.toISOString(),
    to: range().to?.toISOString(),
    sortBy,
    sortDirection,
    page,
    pageSize: PAGE_SIZE,
  });

  return (
    <section>
      <div className="row">
        <h2>
          Booking status history
          <span className="muted"> · platform report (current status + full history)</span>
        </h2>
        <button type="button" className="secondary" onClick={back}>
          Back
        </button>
      </div>

      <p className="muted">
        Super Admin only · booked dates open a 30-day window when no range is chosen · filters reset
        to the default window.
      </p>

      <form
        className="row filters"
        onSubmit={(e) => {
          e.preventDefault();
          applyFilters();
        }}
      >
        <label>
          Status
          <small className="muted">ctrl/⌘-click for several (OR)</small>
          <select
            multiple
            size={6}
            value={statuses}
            onChange={(e) =>
              setStatuses(
                Array.from(e.target.selectedOptions, (o) => o.value as BookingReportStatus),
              )
            }
          >
            {BOOKING_REPORT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Actor type
          <small className="muted">ctrl/⌘-click for several (OR)</small>
          <select
            multiple
            size={4}
            value={actorTypes}
            onChange={(e) =>
              setActorTypes(
                Array.from(e.target.selectedOptions, (o) => o.value as BookingReportActorType),
              )
            }
          >
            {BOOKING_REPORT_ACTOR_TYPES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label>
          Actor user ID
          <input
            value={actorUserId}
            onChange={(e) => setActorUserId(e.target.value)}
            placeholder="uuid"
          />
        </label>
        <label>
          Business ID
          <input
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
            placeholder="uuid"
          />
        </label>
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          Sort by
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as BookingReportSortBy)}>
            <option value="date">Date / time</option>
            <option value="bookingId">Booking ID</option>
            <option value="customer">Customer</option>
            <option value="business">Business</option>
            <option value="status">Status</option>
            <option value="actor">Actor</option>
          </select>
        </label>
        <label>
          Direction
          <select
            value={sortDirection}
            onChange={(e) => setSortDirection(e.target.value as 'asc' | 'desc')}
          >
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        </label>
        <div className="row">
          <button type="submit" disabled={busy}>
            Filter
          </button>
          <button type="button" className="secondary" onClick={resetFilters}>
            Reset
          </button>
          <a className="button-link" href={exportUrl} target="_blank" rel="noreferrer">
            Export PDF
          </a>
        </div>
      </form>

      {error ? <p className="alert">{error}</p> : null}
      {!data ? (
        <p className="muted">Loading…</p>
      ) : data.history.length === 0 ? (
        <p className="muted">No booking status history found for the selected filters.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Date &amp; time</th>
              <th>Booking ID</th>
              <th>Customer</th>
              <th>Business</th>
              <th>Status change</th>
              <th>Actor</th>
            </tr>
          </thead>
          <tbody>
            {data.history.map((row) => (
              <tr key={row.id}>
                <td className="muted">{formatWhen(row.occurredAt)}</td>
                <td>{row.bookingId}</td>
                <td>{row.customerName}</td>
                <td>{row.businessName}</td>
                <td>
                  <span className="pill">{row.fromStatus}</span>
                  {' → '}
                  <span className="pill">{row.toStatus}</span>
                </td>
                <td>{actorLabel(row.actorType, row.actorUserId)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data ? (
        <div className="row">
          <button
            type="button"
            className="secondary"
            disabled={page <= 0 || busy}
            onClick={() => setPage((p) => p - 1)}
          >
            Prev
          </button>
          <span className="muted">
            Page {page + 1} of {totalPages} ({data.total} changes)
          </span>
          <button
            type="button"
            className="secondary"
            disabled={page + 1 >= totalPages || busy}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      ) : null}
    </section>
  );
}
