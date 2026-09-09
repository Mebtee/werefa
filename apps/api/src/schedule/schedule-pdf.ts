/**
 * Minimal, dependency-free PDF writer for the schedule history export
 * (REQ-167/170, doc 21). The repo ships no PDF/report library and the prompt
 * disallows adding one, so this renders a small A4 document directly.
 *
 * Contract follows the STRICTER REQ-172 reading: the snapshot record carries
 * ONLY the neutral schedule state — versions, dates and times — and never the
 * owner, change reason, or other operational details. Rows that have nothing
 * to render still appear with an explicit "(none)" so the export is a faithful
 * record of what the schedule state was.
 *
 * The writer emits a classic single-font Type 1 PDF (Helvetica / Helvetica-Bold,
 * WinAnsi characters only; any non-WinAnsi codepoint degrades to '?'). All
 * times render in the global Africa/Addis_Ababa wall clock (UTC+3, doc 10 §2).
 */

export interface PdfVersionData {
  ordinal: number;
  status: string;
  createdAt: Date;
  workingPeriods: { dayOfWeek: number; startMinutes: number; endMinutes: number }[];
  specialDates: {
    calendarDate: Date;
    isClosed: boolean;
    periods: { startMinutes: number; endMinutes: number }[];
  }[];
  blockedPeriods: { startAt: Date; endAt: Date }[];
}

export interface SchedulePdfInput {
  businessName: string;
  range?: { from?: Date; to?: Date };
  versions: PdfVersionData[];
}

const SCHEDULE_TZ_OFFSET_MS = 3 * 60 * 60 * 1000;
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_START_Y = PAGE_HEIGHT - MARGIN; // 793.89 baseline
const LINE_HEIGHT = 12;
const MAX_LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LINE_HEIGHT); // 62

interface PdfLine {
  text: string;
  font: 'F1' | 'F2';
  size: number;
}

/** Addis wall-clock formatting of an instant (fixed +3h, no DST). */
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

function addisDate(instant: Date): string {
  const p = addisParts(instant);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

function addisDateTime(instant: Date): string {
  const p = addisParts(instant);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`;
}

function minutesClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${pad(h)}:${pad(m)}`;
}

/** Escape PDF literal-string characters and degrade non-WinAnsi codepoints. */
function escapePdf(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 92)
      out += '\\\\'; // backslash
    else if (code === 40)
      out += '\\('; // left paren
    else if (code === 41)
      out += '\\)'; // right paren
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
          // merge the tail with the previous line if space remains? keep simple
          current = slice;
        } else {
          lines.push(slice);
          current = '';
        }
      }
      continue;
    }
    current = candidate;
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

const FONT_SIZES = { h1: 15, h2: 11, normal: 9 } as const;

function buildLines(input: SchedulePdfInput, maxWidth: number): PdfLine[] {
  const lines: PdfLine[] = [];
  lines.push({ text: 'Werefa - Schedule History', font: 'F2', size: FONT_SIZES.h1 });
  lines.push({ text: input.businessName, font: 'F1', size: FONT_SIZES.normal });
  if (input.range?.from || input.range?.to) {
    const from = input.range.from ? addisDate(input.range.from) : '(all)';
    const to = input.range.to ? addisDate(input.range.to) : '(all)';
    lines.push({ text: `Period: ${from} to ${to}`, font: 'F1', size: FONT_SIZES.normal });
  }
  lines.push({ text: '', font: 'F1', size: FONT_SIZES.normal });

  if (input.versions.length === 0) {
    lines.push({
      text: 'No schedule versions in the selected period.',
      font: 'F1',
      size: FONT_SIZES.normal,
    });
    return lines;
  }

  for (const version of input.versions) {
    lines.push({
      text: `Version ${version.ordinal} - ${version.status} - created ${addisDateTime(version.createdAt)}`,
      font: 'F2',
      size: FONT_SIZES.h2,
    });

    const hours = version.workingPeriods
      .slice()
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinutes - b.startMinutes);
    if (hours.length === 0) {
      lines.push({ text: 'Working hours: (none)', font: 'F1', size: FONT_SIZES.normal });
    } else {
      const rendered = hours
        .map(
          (p) =>
            `${WEEKDAY_SHORT[p.dayOfWeek ?? 0]} ${minutesClock(p.startMinutes)}-${minutesClock(p.endMinutes)}`,
        )
        .join('; ');
      for (const line of wrap(`Working hours: ${rendered}`, 'F1', FONT_SIZES.normal, maxWidth)) {
        lines.push({ text: line, font: 'F1', size: FONT_SIZES.normal });
      }
    }

    const specials = version.specialDates
      .slice()
      .sort((a, b) => a.calendarDate.getTime() - b.calendarDate.getTime());
    if (specials.length === 0) {
      lines.push({ text: 'Special dates: (none)', font: 'F1', size: FONT_SIZES.normal });
    } else {
      const rendered = specials
        .map((s) => {
          if (s.isClosed) return `${addisDate(s.calendarDate)} closed`;
          const periods = s.periods
            .slice()
            .sort((a, b) => a.startMinutes - b.startMinutes)
            .map((p) => `${minutesClock(p.startMinutes)}-${minutesClock(p.endMinutes)}`)
            .join(', ');
          return `${addisDate(s.calendarDate)} ${periods}`;
        })
        .join('; ');
      for (const line of wrap(`Special dates: ${rendered}`, 'F1', FONT_SIZES.normal, maxWidth)) {
        lines.push({ text: line, font: 'F1', size: FONT_SIZES.normal });
      }
    }

    const blocked = version.blockedPeriods
      .slice()
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    if (blocked.length === 0) {
      lines.push({ text: 'Blocked periods: (none)', font: 'F1', size: FONT_SIZES.normal });
    } else {
      const rendered = blocked
        .map((b) => `${addisDateTime(b.startAt)} to ${addisDateTime(b.endAt)}`)
        .join('; ');
      for (const line of wrap(`Blocked periods: ${rendered}`, 'F1', FONT_SIZES.normal, maxWidth)) {
        lines.push({ text: line, font: 'F1', size: FONT_SIZES.normal });
      }
    }
    lines.push({ text: '', font: 'F1', size: FONT_SIZES.normal });
  }
  return lines;
}

/**
 * Build the PDF bytes. Pages are computed from the wrapped lines; every page
 * carries its own content stream. The result is a self-contained, linear
 * (non-compressed) PDF 1.4 document.
 */
export function buildScheduleHistoryPdf(input: SchedulePdfInput): Buffer {
  const maxWidth = PAGE_WIDTH - MARGIN * 2;
  const allLines = buildLines(input, maxWidth);
  const pageCount = Math.max(1, Math.ceil(allLines.length / MAX_LINES_PER_PAGE));

  // Object numbering:
  //   1 font F1 (Helvetica), 2 font F2 (Helvetica-Bold), 3 pages, 4 catalog,
  //   then one Page + one Content object per page (5 + 2i, 6 + 2i).
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
    const pageObj = pageObjects[p];
    if (!pageObj) continue;
    const slice = allLines.slice(p * linesPerPage, (p + 1) * linesPerPage);
    const streamLines = slice.map((line) => {
      const text = line.text.length > 0 ? `(${escapePdf(line.text)}) Tj` : '';
      return `/${line.font} ${line.size} Tf 0 -${LINE_HEIGHT} Td ${text}`;
    });
    const stream = `BT\n50 ${CONTENT_START_Y} Td\n${streamLines.join('\n')}\nET`;
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

export function scheduleHistoryPdf(input: SchedulePdfInput): {
  buffer: Buffer;
  contentType: string;
  filename: string;
} {
  const filename = `schedule-history-${addisDate(new Date())}.pdf`;
  return { buffer: buildScheduleHistoryPdf(input), contentType: 'application/pdf', filename };
}
