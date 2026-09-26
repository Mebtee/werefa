/**
 * Booking status-history report projection (Prompt 59; REQ-177 … REQ-190).
 *
 * Pure and side-effect free: the row type, the filter/sort contract and the
 * deterministic comparator are shared by the JSON view, the PDF export and the
 * tests, so the dashboard, the API and the PDF can never drift. The typed row
 * carries ONLY the canonical fields (REQ-182: Booking ID, customer, business,
 * status change, date/time, actor) — reasons/notes are structurally impossible
 * to include (REQ-183).
 *
 * Sort rules (REQ-187 … REQ-190 + CONF-001):
 *  - default: newest first (exact date/time desc);
 *  - date/time sorts on the exact timestamp (REQ-189);
 *  - Booking ID sorts numeric/chronological;
 *  - textual columns (customer/business/status/actor) sort alphabetically;
 *  - the final, direction-independent tie-break chain is Booking ID → date/time
 *    → Actor A–Z, guaranteeing a total, reproducible order.
 */

export type BookingHistorySortBy = 'date' | 'bookingId' | 'customer' | 'business' | 'status' | 'actor';
export type SortDirection = 'asc' | 'desc';

export const BOOKING_HISTORY_SORT_KEYS: readonly BookingHistorySortBy[] = [
  'date',
  'bookingId',
  'customer',
  'business',
  'status',
  'actor',
];

export interface BookingHistoryRow {
  occurredAt: Date;
  bookingId: number;
  customerName: string;
  businessName: string;
  fromStatus: string | null;
  toStatus: string;
  actorType: string;
}

export interface BookingHistoryQuery {
  /** OR within the category; a row matches when either side of the change is in the set. */
  statuses?: string[];
  actorTypes?: string[];
  actorUserId?: string;
  /** All businesses when absent; exactly one otherwise (no multi-select, REQ-180/181). */
  businessId?: string;
  /** Inclusive lower/upper bounds on the transition time. */
  from?: Date;
  to?: Date;
  sortBy?: BookingHistorySortBy;
  sortDirection?: SortDirection;
  offset?: number;
  limit?: number;
}

/** The six canonical PDF columns (REQ-182). */
export const BOOKING_HISTORY_PDF_HEADERS = ['Date & Time', 'Booking ID', 'Customer', 'Business', 'Status change', 'Actor'] as const;

function cmpString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function primaryCompare(a: BookingHistoryRow, b: BookingHistoryRow, sortBy: BookingHistorySortBy): number {
  switch (sortBy) {
    case 'date':
      return a.occurredAt.getTime() - b.occurredAt.getTime();
    case 'bookingId':
      return a.bookingId - b.bookingId;
    case 'customer':
      return cmpString(a.customerName, b.customerName);
    case 'business':
      return cmpString(a.businessName, b.businessName);
    case 'status':
      return cmpString(a.toStatus, b.toStatus);
    case 'actor':
      return cmpString(a.actorType, b.actorType);
  }
}

/** Total, deterministic comparator. Direction applies to the primary key only. */
export function compareBookingHistory(
  a: BookingHistoryRow,
  b: BookingHistoryRow,
  sortBy: BookingHistorySortBy,
  direction: SortDirection,
): number {
  const primary = primaryCompare(a, b, sortBy);
  if (primary !== 0) return direction === 'asc' ? primary : -primary;
  if (a.bookingId !== b.bookingId) return a.bookingId - b.bookingId;
  const time = a.occurredAt.getTime() - b.occurredAt.getTime();
  if (time !== 0) return time;
  return cmpString(a.actorType, b.actorType);
}

export function sortBookingHistory(
  rows: BookingHistoryRow[],
  sortBy: BookingHistorySortBy,
  direction: SortDirection,
): BookingHistoryRow[] {
  return [...rows].sort((a, b) => compareBookingHistory(a, b, sortBy, direction));
}

/** Status change label used by the report/PDF (never a raw reason/note). */
export function bookingStatusChange(row: BookingHistoryRow): string {
  return `${row.fromStatus ?? '—'} -> ${row.toStatus}`;
}
