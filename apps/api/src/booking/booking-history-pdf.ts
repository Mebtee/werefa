/**
 * Minimal, dependency-free PDF writer for the booking status history export
 * (REQ-178/182/183, doc 21). Follows the same conventions as schedule-pdf.ts:
 * single-font Type 1 PDF (Helvetica / Helvetica-Bold), WinAnsi only, no
 * external PDF library.
 *
 * Columns (REQ-182): Date & Time | Booking ID | Customer | Business | Status | Actor.
 * Excluded (REQ-183): reason, notes, metadata, credentials.
 * Timezone: Africa/Addis_Ababa (UTC+3, doc 10 §2).
 */

const SCHEDULE_TZ_OFFSET_MS = 3 * 60 * 60 * 1000;
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_START_Y = PAGE_HEIGHT - MARGIN;
const LINE_HEIGHT = 12;
const MAX_LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LINE_HEIGHT); // 62

interface PdfLine {
  text: string;
  font: 'F1' | 'F2';
  size: number;
}

export interface BookingHistoryRow {
  occurredAt: Date;
  bookingId: string;
  customerName: string;
  businessName: string;
  fromStatus: string;
  toStatus: string;
  actorType: string;
  actorUserId: string | null;
}

export interface BookingHistoryPdfInput {
  rows: BookingHistoryRow[];
  range?: { from?: Date; to?: Date };
}

function addisParts(instant: Date): { y: number; mo: number; d: number; h: number; mi: number } {
  const s = new Date(instant.getTime() + SCHEDULE_TZ_OFFSET_MS);
  return {
    y: s.getUTCFullYear(),
    mo: s.getUTCMonth() + 1,
    d: s.getUTCDate(),
    h: s.getUTCHours(),
    mi: s.getUTCMinutes(),
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function addisDate(instant: Date): string {
  const p = addisParts(instant);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

export function addisDateTime(instant: Date): string {
  const p = addisParts(instant);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`;
}

/** Escape PDF literal-string characters and degrade non-WinAnsi codepoints. */
function escapePdf(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 92) out += '\\\\';
    else if (code === 40) out += '\\(';
    else if (code === 41) out += '\\)';
    else if (code === 13) out += '\\r';
    else if (code === 9) out += '\\t';
    else if (code > 126) out += '?';
    else out += ch;
  }
  return out;
}

function wrap(text: string, font: 'F1' | 'F2', size: number, maxWidth: number): string[] {
  const maxChars = Math.floor(maxWidth / (size * 0.62));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars) {
      if (current) lines.push(current);
      for (let i = 0; i < word.length; i += maxChars) {
        const slice = word.slice(i, i + maxChars);
        if (i + maxChars < word.length) lines.push(slice);
        else if (current) {
          current = slice;
        } else {
          lines.push(slice);
          current = '';
        }
      }
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function actorLabel(actorType: string, actorUserId: string | null): string {
  const typeLabel =
    actorType === 'SUPER_ADMIN'
      ? 'Super Admin'
      : actorType === 'ADMIN'
        ? 'Admin'
        : actorType === 'OWNER'
          ? 'Owner'
          : actorType === 'SYSTEM'
            ? 'System'
            : actorType;
  if (!actorUserId) return typeLabel;
  const short = actorUserId.replace(/-/g, '').slice(0, 8).toUpperCase();
  return `${typeLabel} (${short})`;
}

function statusLabel(fromStatus: string, toStatus: string): string {
  return `${fromStatus}->${toStatus}`;
}

export function historyRowLine(row: BookingHistoryRow): string {
  return [
    addisDateTime(row.occurredAt),
    row.bookingId,
    row.customerName,
    row.businessName,
    statusLabel(row.fromStatus, row.toStatus),
    actorLabel(row.actorType, row.actorUserId),
  ].join(' | ');
}

function buildLines(input: BookingHistoryPdfInput, maxWidth: number): PdfLine[] {
  const lines: PdfLine[] = [];
  const now = new Date();
  let subtitle = `Booking Status History - exported ${addisDateTime(now)} (Addis, UTC+3)`;
  if (input.range?.from || input.range?.to) {
    const fromStr = input.range.from ? addisDate(input.range.from) : 'clear';
    const toStr = input.range.to ? addisDate(input.range.to) : 'clear';
    subtitle += ` / range ${fromStr} to ${toStr}`;
  }
  lines.push({ text: subtitle, font: 'F1', size: 9 });
  lines.push({ text: '', font: 'F1', size: 9 });

  const header = 'Date & Time | Booking ID | Customer | Business | Status | Actor';
  for (const line of wrap(header, 'F2', 9, maxWidth)) {
    lines.push({ text: line, font: 'F2', size: 9 });
  }
  lines.push({ text: '', font: 'F1', size: 9 });

  for (const row of input.rows) {
    for (const line of wrap(historyRowLine(row), 'F1', 9, maxWidth)) {
      lines.push({ text: line, font: 'F1', size: 9 });
    }
  }

  return lines;
}

function buildBookingHistoryPdf(input: BookingHistoryPdfInput): Buffer {
  const maxWidth = PAGE_WIDTH - MARGIN * 2;
  const allLines = buildLines(input, maxWidth);
  const pageCount = Math.max(1, Math.ceil(allLines.length / MAX_LINES_PER_PAGE));

  // Object numbering: 1 font F1, 2 font F2, 3 pages, 4 catalog, then
  // one Page + one Content object per page (5 + 2i, 6 + 2i).
  const chunks: string[] = [];
  const offsets: number[] = [];
  const pageObjects = Array.from({ length: pageCount }, (_, i) => ({
    page: 5 + 2 * i,
    content: 6 + 2 * i,
  }));

  function pushObject(body: string): void {
    offsets.push(chunks.reduce((sum, c) => sum + Buffer.byteLength(c, 'utf8'), 0));
    chunks.push(body);
  }

  pushObject('1 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
  pushObject('2 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n');

  const kids = pageObjects.map((p) => `${p.page} 0 R`).join(' ');
  pushObject(`3 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\nendobj\n`);
  pushObject('4 0 obj\n<< /Type /Catalog /Pages 3 0 R >>\nendobj\n');

  const linesPerPage = MAX_LINES_PER_PAGE;
  for (let p = 0; p < pageCount; p += 1) {
    const pageObj = pageObjects[p]!;
    const slice = allLines.slice(p * linesPerPage, (p + 1) * linesPerPage);
    const streamLines = slice.map((line) => {
      const text = line.text.length > 0 ? `(${escapePdf(line.text)}) Tj` : '';
      return `/${line.font} ${line.size} Tf 0 -${LINE_HEIGHT} Td ${text}`;
    });
    const stream = `BT\n${MARGIN} ${CONTENT_START_Y} Td\n${streamLines.join('\n')}\nET`;

    pushObject(
      `${pageObj.content} 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream\nendobj\n`,
    );
    pushObject(
      `${pageObj.page} 0 obj\n<< /Type /Page /Parent 3 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 1 0 R /F2 2 0 R >> >> /Contents ${pageObj.content} 0 R >>\nendobj\n`,
    );
  }

  const totalObjects = 4 + pageCount * 2;
  if (totalObjects !== chunks.length) {
    throw new Error('pdf object count mismatch');
  }

  const header = '%PDF-1.4\n';
  const body = chunks.join('');
  const xrefOffset = Buffer.byteLength(header, 'utf8') + Buffer.byteLength(body, 'utf8');

  const xrefLines: string[] = [`xref`, `0 ${chunks.length + 1}`, `0000000000 65535 f `];
  let running = Buffer.byteLength(header, 'utf8');
  for (const offset of offsets) {
    xrefLines.push(`${String(offset).padStart(10, '0')} 00000 n `);
    void running;
  }
  void running;

  const trailer = `trailer\n<< /Size ${chunks.length + 1} /Root 4 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.concat([
    Buffer.from(header, 'utf8'),
    Buffer.from(body, 'utf8'),
    Buffer.from(xrefLines.join('\n') + '\n', 'utf8'),
    Buffer.from(trailer, 'utf8'),
  ]);
}

export function buildBookingHistoryPdfExport(input: BookingHistoryPdfInput): Buffer {
  return buildBookingHistoryPdf(input);
}

export function bookingHistoryPdf(input: BookingHistoryPdfInput): {
  buffer: Buffer;
  contentType: string;
  filename: string;
} {
  const filename = `booking-history-${addisDate(new Date())}.pdf`;
  return { buffer: buildBookingHistoryPdf(input), contentType: 'application/pdf', filename };
}
