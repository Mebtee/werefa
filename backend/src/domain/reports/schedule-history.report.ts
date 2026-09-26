/**
 * Schedule-history report projection (Prompt 59; REQ-170/171/172).
 *
 * Pure row contract for the schedule-history PDF. The canonical content is
 * "schedule versions and dates/times ONLY" (REQ-172): the typed row therefore
 * carries the version number and its lifecycle timestamps and NOTHING else —
 * actor (appliedBy), change details (working periods/blocks) and reason are
 * structurally impossible to include.
 *
 * A custom start/end date range (REQ-171) filters versions by their save time.
 */

import { GlobalClock } from '../time/global-clock';

export interface ScheduleHistoryRow {
  versionNo: number;
  /** When the version row was saved. */
  createdAt: Date;
  /** When the version became ACTIVE (null when still PENDING). */
  appliedAt: Date | null;
  /** When the version was superseded (null when never replaced). */
  replacedAt: Date | null;
}

/** Columns: versions and their date/times only (REQ-172). */
export const SCHEDULE_HISTORY_PDF_HEADERS = ['Version', 'Created', 'Applied', 'Replaced'] as const;

function two(n: number): string {
  return String(n).padStart(2, '0');
}

/** `YYYY-MM-DD HH:mm` in the fixed global timezone (never the server's local tz). */
export function formatDateTime(clock: GlobalClock, date: Date | null): string {
  if (!date) return '—';
  const p = clock.partsInTz(date);
  return `${p.year}-${two(p.month)}-${two(p.day)} ${two(p.hour)}:${two(p.minute)}`;
}

/** `YYYY-MM-DD` in the fixed global timezone (report window label). */
export function formatDate(clock: GlobalClock, date: Date): string {
  return clock.dateKey(date);
}
