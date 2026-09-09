import { BOOKING_NOTIFICATION_TYPE } from '../booking/booking-notifications';
import type { AppConfig } from '../config/environment';
import {
  type DeliveryBookingContext,
  type ScheduleAffectedPayload,
  readPayloadString,
} from './notification-catalog';

/**
 * Message templates for the two delivery channels (doc 12 §6 / doc 13 §8).
 *
 * Security rules:
 *   - Telegram text never contains HTML, links that can be followed, or the
 *     connect token after it has been used.
 *   - Email HTML escapes every dynamic value (`escapeHtml`) — no injected
 *     markup from names/notes/services can survive into the owner's inbox.
 */

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format a banner title line used by both channels. */
export function formatBookingLine(startAt: Date): string {
  const date = intlDate(startAt);
  const time = intlTime(startAt);
  return `${date} at ${time}`;
}

const LOCAL_OFFSET_MS = 3 * 3600_000; // fixed global UTC+3 (doc 10 §2)

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function localView(d: Date): Date {
  return new Date(d.getTime() + LOCAL_OFFSET_MS);
}
function intlDate(d: Date): string {
  return DATE_FORMAT.format(localView(d));
}
function intlTime(d: Date): string {
  return TIME_FORMAT.format(localView(d));
}

export interface TelegramMessage {
  text: string;
}

/**
 * Render a customer Telegram message. Always derived from the AUTHORITATIVE
 * booking state at delivery time (not the queued payload), so a booking that
 * was rescheduled/cancelled after the outbox row was written cannot produce a
 * misleading message. `reason` / `newStartAt` come from the notification payload
 * (they were part of the triggering transition).
 */
export function renderCustomerTelegram(
  type: string,
  booking: DeliveryBookingContext,
  payload: Record<string, unknown>,
): TelegramMessage {
  const line = formatBookingLine(new Date(booking.startAt));
  const serviceNames = booking.services
    .map((s) => s.name)
    .filter((n) => n.length > 0)
    .join(', ');

  switch (type) {
    case BOOKING_NOTIFICATION_TYPE.proofReceived:
      return {
        text:
          `We received your payment proof for your booking at ${booking.businessName} ` +
          `(${line}). The owner will review it and confirm your booking shortly.`,
      };
    case BOOKING_NOTIFICATION_TYPE.confirmed:
      return {
        text:
          `Your booking at ${booking.businessName} is confirmed: ${line}.` +
          (serviceNames ? ` Services: ${serviceNames}.` : ''),
      };
    case BOOKING_NOTIFICATION_TYPE.rejected: {
      const reason = readPayloadString(payload, 'reason') ?? 'not specified';
      return {
        text:
          `Your booking at ${booking.businessName} (${line}) was rejected. ` +
          `Reason: ${reason}. You can use your booking page to check its status.`,
      };
    }
    case BOOKING_NOTIFICATION_TYPE.rescheduled: {
      const newStartAt = readPayloadString(payload, 'newStartAt');
      const when = newStartAt ? formatBookingLine(new Date(newStartAt)) : 'a new time';
      return {
        text: `Your booking at ${booking.businessName} was rescheduled to ${when}.`,
      };
    }
    case BOOKING_NOTIFICATION_TYPE.cancelled:
      return {
        text: `Your booking at ${booking.businessName} (${line}) was cancelled.`,
      };
    case BOOKING_NOTIFICATION_TYPE.noShow:
      return {
        text:
          `You missed your appointment at ${booking.businessName} (${line}). ` +
          `It was marked as a no-show. Contact the owner to book a new one.`,
      };
    case BOOKING_NOTIFICATION_TYPE.reminder24h:
      return {
        text: `Reminder: your appointment at ${booking.businessName} is tomorrow: ${line}.`,
      };
    case BOOKING_NOTIFICATION_TYPE.reminder1h:
      return {
        text: `Reminder: your appointment at ${booking.businessName} starts in about 1 hour (${intlTime(new Date(booking.startAt))}).`,
      };
    default:
      return { text: `Update about your booking at ${booking.businessName}: ${line}.` };
  }
}

export interface OwnerAffectedEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Owner email for a schedule change affecting existing bookings (REQ-093/094 +
 * doc 13 §8). Lists EVERY affected booking with name/phone/date/time/services,
 * states why it is affected, and offers the approved Reschedule / Cancel /
 * Keep Booking actions. The whole email is escaped HTML.
 */
export function renderOwnerAffectedEmail(
  payload: ScheduleAffectedPayload,
  businessName: string | undefined,
  config: Pick<AppConfig, 'publicBaseUrl'>,
): OwnerAffectedEmail {
  const entries = payload.entries ?? [];
  const countLabel = entries.length === 1 ? '1 booking' : `${entries.length} bookings`;

  const rows = entries
    .map((entry) => {
      const date = dayLabel(entry.startAt);
      const serviceNames = (entry.services ?? [])
        .map((s) => s.name)
        .filter((n) => typeof n === 'string' && n.length > 0)
        .join(', ');
      const row = [
        ['Customer', entry.customerName ?? '-'],
        ['Phone', entry.customerPhone ?? '-'],
        ['Date & time', date],
        ['Duration', entry.durationMinutes !== undefined ? `${entry.durationMinutes} min` : '-'],
        ['Services', serviceNames || '-'],
        ['Why affected', entry.reason ?? '-'],
      ];
      return `<tr>${row.map(([k, v]) => `<th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td>`).join('')}</tr>`;
    })
    .join('');

  const openBookingUrl = entries[0]?.managementUrl;
  const keepUrl = conjoinedKeepUrl(entries, config);
  const link = (href: string | undefined, label: string): string =>
    href ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>` : escapeHtml(label);

  const html =
    `<h2>Schedule change affecting ${escapeHtml(countLabel)}</h2>` +
    (businessName ? `<p>Business: <strong>${escapeHtml(businessName)}</strong></p>` : '') +
    `<p>A new schedule was saved and ${escapeHtml(countLabel)} on it are now ` +
    `outside the available working hours. Review each booking below and choose ` +
    `an action.</p>` +
    `<table border="1" cellpadding="6" cellspacing="0">${rows}</table>` +
    `<p>Actions: ${link(openBookingUrl, 'Reschedule / Cancel')} · ` +
    `${link(keepUrl, 'Keep Booking')}</p>`;
  const text = `Schedule change affecting ${countLabel} for ${businessName ?? 'your business'}.`;
  return {
    subject: `Schedule change affecting ${countLabel}`,
    text,
    html,
  };
}

/** A booking entry opens its booking page; Keep opens the schedule manager. */
function conjoinedKeepUrl(
  entries: ScheduleAffectedPayload['entries'],
  config: Pick<AppConfig, 'publicBaseUrl'>,
): string | undefined {
  const first = entries?.[0];
  if (!first?.managementUrl) return undefined;
  // Keep Booking is performed from the schedule panel (Prompt 12). No op_id
  // exists in the dashboard; the owner navigates to the scheduling manager.
  const m = first.managementUrl.match(/^\/manage\/#\/businesses\/([^/]+)\/bookings\//);
  const businessId = m?.[1];
  const base = config.publicBaseUrl.replace(/\/$/, '');
  return businessId ? `${base}/#/businesses/${businessId}/schedule` : undefined;
}

function dayLabel(iso: string | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return formatBookingLine(d);
}
