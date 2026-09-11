import { describe, expect, it } from 'vitest';
import {
  bookingHistoryPdf,
  buildBookingHistoryPdfExport,
  type BookingHistoryRow,
} from '../../apps/api/src/booking/booking-history-pdf';

/**
 * Prompt 16 — booking status-history PDF export (REQ-178..183, doc 21).
 * Dependency-free writer (no PDF library in the repo), same conventions as the
 * schedule-history writer. Contract: six approved columns only (REQ-182) and
 * never reason/note/metadata text (REQ-183).
 */

const T = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 11, h, m, 0, 0));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function row(overrides: Partial<BookingHistoryRow> = {}): BookingHistoryRow {
  return {
    occurredAt: T(9, 30),
    bookingId: uuid(1),
    customerName: 'Kebede Ayele',
    businessName: "Dawn's Barber & Salon",
    fromStatus: 'PAYMENT_PENDING',
    toStatus: 'CONFIRMED',
    actorType: 'OWNER',
    actorUserId: null,
    ...overrides,
  };
}

describe('buildBookingHistoryPdf', () => {
  it('emits a self-contained, linear PDF 1.4 document', () => {
    const buf = buildBookingHistoryPdfExport({ rows: [row()] });
    const text = buf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/MediaBox [0 0 595.28 841.89]');
    expect(text).toContain('/Count 1 >>');
  });

  it('renders the six approved columns (REQ-182)', () => {
    const text = buildBookingHistoryPdfExport({ rows: [row()] }).toString('latin1');
    for (const header of ['Date & Time', 'Booking ID', 'Customer', 'Business', 'Status', 'Actor']) {
      expect(text).toContain(header);
    }
    // Status change is rendered as FROM->TO.
    expect(text).toContain('PAYMENT_PENDING->CONFIRMED');
    expect(text).toContain('Kebede Ayele');
    expect(text).toContain("Dawn's Barber");
  });

  it('renders times in the Addis wall clock (UTC+3)', () => {
    const text = buildBookingHistoryPdfExport({ rows: [row({ occurredAt: T(6) })] }).toString(
      'latin1',
    );
    // 06:00 UTC printed as 09:00 Addis.
    expect(text).toContain('2026-09-11 09:00');
  });

  it('does NOT leak reason / note / metadata text (REQ-183)', () => {
    const r = row({
      fromStatus: 'CONFIRMED',
      toStatus: 'REJECTED',
      actorType: 'SUPER_ADMIN',
      actorUserId: uuid(7),
    });
    const text = buildBookingHistoryPdfExport({ rows: [r] }).toString('latin1');
    expect(text).not.toMatch(/reason/i);
    expect(text).not.toMatch(/note/i);
    expect(text).not.toContain('metadata');
  });

  it('renders a multi-page document for a large history', () => {
    const rows = Array.from({ length: 70 }, (_, i) =>
      row({ occurredAt: T(6 + (i % 8)), bookingId: uuid(i + 1) }),
    );
    const text = buildBookingHistoryPdfExport({ rows }).toString('latin1');
    const count = /\/Count (\d+) >>/.exec(text)?.[1];
    expect(count).toBeDefined();
    expect(Number(count)).toBeGreaterThan(1);
  });
});

describe('bookingHistoryPdf', () => {
  it('returns the download contract with a dated filename', () => {
    const result = bookingHistoryPdf({ rows: [row()] });
    expect(result.contentType).toBe('application/pdf');
    expect(result.filename).toMatch(/^booking-history-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.buffer.toString('latin1')).toContain('%PDF-1.4');
  });
});
