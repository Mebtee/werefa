/**
 * PDF renderers for the canonical reports (Prompt 59).
 *
 * Pure: take an already-authorized, already-filtered, already-sorted, typed row
 * set plus the application clock and produce bytes through the minimal
 * {@link buildTablePdf} boundary. The renderers never receive reasons, notes,
 * payment data, credentials or raw database entities, so excluded content
 * (REQ-183, REQ-172) cannot leak.
 */

import { buildTablePdf } from './pdf-document';
import {
  BOOKING_HISTORY_PDF_HEADERS,
  BookingHistoryRow,
  bookingStatusChange,
} from './booking-history.report';
import {
  SCHEDULE_HISTORY_PDF_HEADERS,
  ScheduleHistoryRow,
  formatDate,
  formatDateTime,
} from './schedule-history.report';
import { GlobalClock } from '../time/global-clock';

export interface ReportMeta {
  /** e.g. "All businesses" or "Business: Happy Salons 1". */
  scopeLabel: string;
  from: Date;
  to: Date;
}

function subtitle(clock: GlobalClock, meta: ReportMeta): string {
  return `${meta.scopeLabel} · ${formatDate(clock, meta.from)} to ${formatDate(clock, meta.to)}`;
}

export function renderBookingHistoryPdf(rows: BookingHistoryRow[], clock: GlobalClock, meta: ReportMeta): Buffer {
  return buildTablePdf({
    title: 'Werefa - Booking status history',
    subtitle: subtitle(clock, meta),
    headers: [...BOOKING_HISTORY_PDF_HEADERS],
    rows: rows.map((row) => [
      formatDateTime(clock, row.occurredAt),
      String(row.bookingId),
      row.customerName,
      row.businessName,
      bookingStatusChange(row),
      row.actorType,
    ]),
  });
}

export function renderScheduleHistoryPdf(rows: ScheduleHistoryRow[], clock: GlobalClock, meta: ReportMeta): Buffer {
  return buildTablePdf({
    title: 'Werefa - Schedule history',
    subtitle: subtitle(clock, meta),
    headers: [...SCHEDULE_HISTORY_PDF_HEADERS],
    rows: rows.map((row) => [
      `v${row.versionNo}`,
      formatDateTime(clock, row.createdAt),
      formatDateTime(clock, row.appliedAt),
      formatDateTime(clock, row.replacedAt),
    ]),
  });
}
