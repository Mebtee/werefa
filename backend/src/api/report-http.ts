import type { Response } from 'express';
import { GlobalClock } from '../domain/time/global-clock';

/**
 * Parse an ISO date or date-time report bound. A date-only value is interpreted
 * in the fixed global timezone (never the server's local timezone): `start` is
 * the beginning of that day, `end` is the last millisecond of that day.
 */
export function parseBound(value: string | undefined, clock: GlobalClock, edge: 'start' | 'end'): Date | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const day = clock.dateKeyAsSlotDate(value);
    return edge === 'start' ? clock.atTimeOn(day, 0, 0) : new Date(clock.atTimeOn(day, 23, 59).getTime() + 59_999);
  }
  return new Date(value);
}

/** Binary PDF response with safe disposition headers (never HTML-sniffed). */
export function sendPdf(res: Response, bytes: Buffer, fileName: string): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Length', bytes.length.toString());
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(bytes);
}
