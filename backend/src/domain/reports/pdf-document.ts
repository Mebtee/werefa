/**
 * Minimal deterministic PDF writer (Prompt 59; arch doc 21 reporting pipeline).
 *
 * A dependency-free Type-1 PDF 1.4 writer with a single fixed layout: title +
 * optional subtitle + a text table. It deliberately knows nothing about Prisma,
 * HTTP, authentication, domain services or the system clock — callers pass a
 * fully-formed, already-authorized, already-sorted document model. Output is
 * byte-deterministic for the same input (no random ids, no environment paths, no
 * wall-clock metadata), which makes structural and semantic assertions testable.
 *
 * A4 portrait, Helvetica; text is WinAnsi-escaped. Long rows wrap; overflowing
 * pages paginate. This is intentionally the smallest boundary the reporting
 * requirements need — not a general reporting framework.
 */

/** A4 portrait in PDF points. */
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const FOOTER_Y = 28;
const LINE_GAP = 1.35;

export const PDF_PAGE = { width: PAGE_WIDTH, height: PAGE_HEIGHT } as const;

export interface PdfTableSpec {
  title: string;
  /** Optional context line under the title (e.g. scope + date range). */
  subtitle?: string;
  headers: string[];
  rows: string[][];
  footer?: string;
}

interface LayoutLine {
  text: string;
  font: 'F1' | 'F2';
  size: number;
  x: number;
}

interface PositionedLine extends LayoutLine {
  y: number;
}

function escapeText(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '\\') out += '\\\\';
    else if (ch === '(') out += '\\(';
    else if (ch === ')') out += '\\)';
    else if (code === 10 || code === 13 || code === 9) out += ' ';
    else if (code >= 32 && code <= 126) out += ch;
    else if (code >= 160 && code <= 255) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += '?';
  }
  return out;
}

/** Greedy word wrap using a conservative average glyph width per font. */
function wrap(text: string, size: number, bold: boolean): string[] {
  const perChar = size * (bold ? 0.56 : 0.5);
  const maxChars = Math.max(8, Math.floor((PAGE_WIDTH - MARGIN * 2) / perChar));
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current !== '') lines.push(current);
    current = word;
    while (current.length > maxChars) {
      lines.push(current.slice(0, maxChars));
      current = current.slice(maxChars);
    }
  }
  if (current !== '') lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function buildLayout(spec: PdfTableSpec): LayoutLine[] {
  const lines: LayoutLine[] = [];
  const push = (text: string, font: 'F1' | 'F2', size: number): void => {
    lines.push({ text, font, size, x: MARGIN });
  };

  for (const line of wrap(spec.title, 16, true)) push(line, 'F2', 16);
  if (spec.subtitle) {
    for (const line of wrap(spec.subtitle, 10, false)) push(line, 'F1', 10);
  }
  push('', 'F1', 6); // spacer
  for (const line of wrap(spec.headers.join(' | '), 9, true)) push(line, 'F2', 9);
  push('---------------------------------------------', 'F1', 9);
  if (spec.rows.length === 0) {
    push('(no rows)', 'F1', 9);
  } else {
    for (const row of spec.rows) {
      for (const line of wrap(row.join(' | '), 9, false)) push(line, 'F1', 9);
    }
  }
  return lines;
}

function paginate(lines: LayoutLine[]): PositionedLine[][] {
  const pages: PositionedLine[][] = [];
  let current: PositionedLine[] = [];
  let y = PAGE_HEIGHT - MARGIN;
  for (const line of lines) {
    const step = line.size * LINE_GAP;
    if (y - step < MARGIN + 24) {
      pages.push(current);
      current = [];
      y = PAGE_HEIGHT - MARGIN;
    }
    y -= step;
    current.push({ ...line, y });
  }
  pages.push(current);
  return pages;
}

function renderContent(page: PositionedLine[], footer: string, pageNo: number, pageCount: number): string {
  const parts: string[] = [];
  for (const line of page) {
    parts.push(
      `BT /${line.font} ${line.size} Tf ${line.x.toFixed(2)} ${line.y.toFixed(2)} Td (${escapeText(line.text)}) Tj ET`,
    );
  }
  const label = `${footer} · Page ${pageNo} / ${pageCount}`;
  parts.push(`BT /F1 8 Tf ${MARGIN.toFixed(2)} ${FOOTER_Y.toFixed(2)} Td (${escapeText(label)}) Tj ET`);
  return parts.join('\n');
}

function serialize(streams: string[]): Buffer {
  const firstPageObj = 5;
  const objectCount = 4 + streams.length * 2;
  const objects = new Array<string>(objectCount + 1).fill('');
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${streams.map((_, i) => `${firstPageObj + i * 2} 0 R`).join(' ')}] /Count ${streams.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  for (let i = 0; i < streams.length; i++) {
    const pageNo = firstPageObj + i * 2;
    const contentNo = pageNo + 1;
    const stream = streams[i];
    objects[pageNo] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNo} 0 R >>`;
    objects[contentNo] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }

  let out = '%PDF-1.4\n';
  const offsets = new Array<number>(objectCount + 1).fill(0);
  for (let i = 1; i <= objectCount; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objectCount; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export function buildTablePdf(spec: PdfTableSpec): Buffer {
  const pages = paginate(buildLayout(spec));
  const footer = spec.footer ?? 'Werefa';
  const streams = pages.map((page, index) => renderContent(page, footer, index + 1, pages.length));
  return serialize(streams);
}
