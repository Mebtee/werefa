import { describe, expect, it } from 'vitest';
import { IntlGlobalClock } from '../time/global-clock';
import { buildTablePdf } from './pdf-document';
import { renderBookingHistoryPdf, renderScheduleHistoryPdf } from './report-pdf';
import {
  BOOKING_HISTORY_PDF_HEADERS,
  BookingHistoryRow,
  compareBookingHistory,
  sortBookingHistory,
} from './booking-history.report';
import { SCHEDULE_HISTORY_PDF_HEADERS } from './schedule-history.report';

const FIXED_NOW = new Date('2026-09-25T09:30:00.000Z');
const clock = new IntlGlobalClock('UTC', () => FIXED_NOW);

function row(overrides: Partial<BookingHistoryRow>): BookingHistoryRow {
  return {
    occurredAt: new Date('2026-09-20T10:00:00.000Z'),
    bookingId: 10,
    customerName: 'Liya Tesfaye',
    businessName: 'Happy Salons 1',
    fromStatus: 'PAYMENT_PENDING',
    toStatus: 'CONFIRMED',
    actorType: 'OWNER',
    ...overrides,
  };
}

describe('pdf-document', () => {
  it('emits a well-formed PDF 1.4 document', () => {
    const pdf = buildTablePdf({ title: 'T', headers: ['A', 'B'], rows: [['1', '2']] });
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Type /Page');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('xref');
  });

  it('is byte-deterministic for the same input', () => {
    const spec = { title: 'Report', subtitle: 'All businesses', headers: ['A'], rows: [['x'], ['y']] };
    expect(buildTablePdf(spec).equals(buildTablePdf(spec))).toBe(true);
  });

  it('paginates large tables and never truncates rows', () => {
    const rows = Array.from({ length: 300 }, (_, i) => [`row-${i}`]);
    const pdf = buildTablePdf({ title: 'Big', headers: ['Row'], rows });
    const text = pdf.toString('latin1');
    const pageCount = Number(/\/Count (\d+)/.exec(text)?.[1]);
    expect(pageCount).toBeGreaterThan(1);
    expect(text).toContain('row-0');
    expect(text).toContain('row-299');
  });
});

describe('booking history report', () => {
  it('renders the six canonical columns and never a reason/note (REQ-182/183)', () => {
    const pdf = renderBookingHistoryPdf([row({})], clock, {
      scopeLabel: 'All businesses',
      from: new Date('2026-08-26T00:00:00Z'),
      to: FIXED_NOW,
    });
    const text = pdf.toString('latin1');
    for (const header of BOOKING_HISTORY_PDF_HEADERS) expect(text).toContain(header);
    expect(text).toContain('PAYMENT_PENDING -> CONFIRMED');
    expect(text).toContain('Liya Tesfaye');
    expect(text).toContain('Happy Salons 1');
    // Excluded content/headers (REQ-183).
    expect(text.toLowerCase()).not.toContain('reason');
    expect(text.toLowerCase()).not.toContain('note');
  });

  it('sorts newest-first by default and by exact timestamp (REQ-187/189)', () => {
    const older = row({ bookingId: 1, occurredAt: new Date('2026-09-01T00:00:00Z') });
    const newer = row({ bookingId: 2, occurredAt: new Date('2026-09-02T00:00:00Z') });
    expect(sortBookingHistory([older, newer], 'date', 'desc').map((r) => r.bookingId)).toEqual([2, 1]);

    // Same calendar day, different exact time: the exact time breaks the tie.
    const morning = row({ bookingId: 3, occurredAt: new Date('2026-09-05T08:00:00Z') });
    const evening = row({ bookingId: 4, occurredAt: new Date('2026-09-05T18:00:00Z') });
    expect(sortBookingHistory([evening, morning], 'date', 'desc').map((r) => r.bookingId)).toEqual([4, 3]);
  });

  it('sorts Booking ID numerically and breaks ties deterministically by date then actor (REQ-190)', () => {
    const a = row({ bookingId: 9, occurredAt: new Date('2026-09-05T00:00:00Z'), actorType: 'OWNER' });
    const b = row({ bookingId: 10, occurredAt: new Date('2026-09-05T00:00:00Z'), actorType: 'OWNER' });
    expect(sortBookingHistory([b, a], 'bookingId', 'asc').map((r) => r.bookingId)).toEqual([9, 10]);
    // 10 must not sort before 9 (numeric, not lexicographic).
    expect(compareBookingHistory(a, b, 'bookingId', 'asc')).toBeLessThan(0);

    const actorOwner = row({ bookingId: 5, occurredAt: new Date('2026-09-05T00:00:00Z'), actorType: 'OWNER' });
    const actorSystem = row({ bookingId: 5, occurredAt: new Date('2026-09-05T00:00:00Z'), actorType: 'SYSTEM' });
    expect(sortBookingHistory([actorSystem, actorOwner], 'bookingId', 'asc').map((r) => r.actorType)).toEqual([
      'OWNER',
      'SYSTEM',
    ]);
  });

  it('applies sort direction to the primary key only, keeping the tie-break chain stable', () => {
    const a = row({ bookingId: 1, customerName: 'Beta', occurredAt: new Date('2026-09-01T00:00:00Z') });
    const b = row({ bookingId: 2, customerName: 'Alpha', occurredAt: new Date('2026-09-02T00:00:00Z') });
    expect(sortBookingHistory([a, b], 'customer', 'asc').map((r) => r.bookingId)).toEqual([2, 1]);
    expect(sortBookingHistory([a, b], 'customer', 'desc').map((r) => r.bookingId)).toEqual([1, 2]);
  });
});

describe('schedule history report', () => {
  it('renders versions and dates/times only, omitting actor/change/reason (REQ-172)', () => {
    const pdf = renderScheduleHistoryPdf(
      [{ versionNo: 3, createdAt: new Date('2026-09-01T07:00:00Z'), appliedAt: new Date('2026-09-01T07:05:00Z'), replacedAt: null }],
      clock,
      { scopeLabel: 'Own business', from: new Date('2026-08-26T00:00:00Z'), to: FIXED_NOW },
    );
    const text = pdf.toString('latin1');
    for (const header of SCHEDULE_HISTORY_PDF_HEADERS) expect(text).toContain(header);
    expect(text).toContain('v3');
    expect(text).toContain('2026-09-01 07:05');
    expect(text.toLowerCase()).not.toContain('reason');
    expect(text.toLowerCase()).not.toContain('applied by');
  });
});
