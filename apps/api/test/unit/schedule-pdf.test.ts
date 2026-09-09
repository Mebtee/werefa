import { describe, expect, it } from 'vitest';
import {
  buildScheduleHistoryPdf,
  scheduleHistoryPdf,
  type SchedulePdfInput,
} from '../../apps/api/src/schedule/schedule-pdf';

/**
 * Prompt 12 — schedule history PDF export (REQ-166/167/172, doc 21). The
 * writer is dependency-free (no PDF library in the repo) and the contract is
 * the STRICTER REQ-172 reading: ONLY the neutral schedule state renders — no
 * owner, operator, or operational detail, and never the change reason.
 */

const T = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 7, h, m, 0, 0));

function input(overrides: Partial<SchedulePdfInput> = {}): SchedulePdfInput {
  return {
    businessName: "Dawn's Barber & Salon",
    versions: [
      {
        ordinal: 1,
        status: 'ACTIVE',
        createdAt: T(6),
        workingPeriods: [{ dayOfWeek: 1, startMinutes: 540, endMinutes: 1080 }],
        specialDates: [],
        blockedPeriods: [],
      },
    ],
    ...overrides,
  };
}

describe('buildScheduleHistoryPdf', () => {
  it('emits a self-contained, linear PDF 1.4 document', () => {
    const buf = buildScheduleHistoryPdf(input());
    const text = buf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/MediaBox [0 0 595.28 841.89]');
    // One page → objects 1..6 (2 fonts, pages, catalog, content, page).
    expect(text).toContain('/Count 1 >>');
  });

  it('renders window times in the Addis wall clock and weekday names', () => {
    const text = buildScheduleHistoryPdf(input()).toString('latin1');
    expect(text).toContain('Mon 09:00-18:00');
    expect(text).toContain('Version 1 - ACTIVE');
  });

  it('renders "(none)" rows when a version has no schedule content', () => {
    const text = buildScheduleHistoryPdf(
      input({
        versions: [
          {
            ordinal: 2,
            status: 'PENDING',
            createdAt: T(7),
            workingPeriods: [],
            specialDates: [],
            blockedPeriods: [],
          },
        ],
      }),
    ).toString('latin1');
    // PDF text streams escape parens.
    expect(text).toContain('\\(none\\)');
  });

  it('renders closed special dates and blocked periods', () => {
    const text = buildScheduleHistoryPdf(
      input({
        versions: [
          {
            ordinal: 3,
            status: 'ACTIVE',
            createdAt: T(8),
            workingPeriods: [],
            specialDates: [
              { calendarDate: new Date(Date.UTC(2026, 8, 20)), isClosed: true, periods: [] },
            ],
            blockedPeriods: [{ startAt: T(9), endAt: T(11) }],
          },
        ],
      }),
    ).toString('latin1');
    expect(text).toContain('2026-09-20 closed');
    expect(text).toContain('Blocked periods:');
  });

  it('does NOT leak the change reason (strict REQ-172)', () => {
    const buf = buildScheduleHistoryPdf(input());
    const text = buf.toString('latin1');
    // Reasons are never placed in the PDF input, and low-level strings like
    // actor ids / reasons must not appear anywhere in the output.
    expect(text).not.toMatch(/reason/i);
  });

  it('escapes PDF special characters in text streams', () => {
    const text = buildScheduleHistoryPdf(
      input({
        versions: [
          {
            ordinal: 4,
            status: 'ACTIVE',
            createdAt: T(6),
            workingPeriods: [{ dayOfWeek: 1, startMinutes: 540, endMinutes: 660 }],
            specialDates: [],
            blockedPeriods: [],
          },
        ],
      }),
    ).toString('latin1');
    expect(text).toContain('\\(');
  });

  it('paginates beyond one page when many versions render', () => {
    const versions = Array.from({ length: 40 }, (_, i) => ({
      ordinal: i + 1,
      status: 'SUPERSEDED',
      createdAt: new Date(Date.UTC(2026, 0, 1 + i, 6)),
      workingPeriods: [
        { dayOfWeek: 1, startMinutes: 540, endMinutes: 1080 },
        { dayOfWeek: 5, startMinutes: 540, endMinutes: 1440 },
      ],
      specialDates: [],
      blockedPeriods: [],
    }));
    const text = buildScheduleHistoryPdf(input({ versions })).toString('latin1');
    const count = /\/Count (\d+) >>/.exec(text)?.[1];
    expect(count).toBeDefined();
    expect(Number(count)).toBeGreaterThan(1);
  });
});

describe('scheduleHistoryPdf', () => {
  it('returns the download contract with a dated filename', () => {
    const result = scheduleHistoryPdf(input());
    expect(result.contentType).toBe('application/pdf');
    expect(result.filename).toMatch(/^schedule-history-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.buffer.toString('latin1')).toContain('%PDF-1.4');
  });
});
