/**
 * Deterministic notification message rendering (Prompt 51; spec §19).
 *
 * Renders the exact text a connected customer receives on Telegram for N01–N08
 * (and the owner receives for N09). Rendering is pure: it takes the persisted
 * notification kind + booking/business snapshots and returns stable text, so the
 * customer status projection and the Telegram delivery worker always agree. The
 * sentences are the canonical strings already approved by the customer-visible
 * UI mock; the business/appointment context required by the notification
 * matrix is prepended.
 */

import { BookingWithRelations } from '../repositories/booking.repository.port';

export interface AppointmentContext {
  businessName: string;
  serviceSummary: string;
}

export interface RenderInput {
  /** Raw persisted Notification.type (an event type string). */
  type: string;
  booking: BookingWithRelations;
  businessName: string;
  /** Latest rejection reason when the notification is a PAYMENT_REJECTED. */
  rejectionReason?: string | null;
}

export interface RenderedMessage {
  /** Full Telegram-ready message text. */
  text: string;
  /** Appointment date (yyyy-mm-dd, global tz) for the customer projection. */
  date: string | null;
  /** Appointment time (HH:mm) for the customer projection. */
  time: string | null;
}

export class NotificationMessageRenderer {
  /** Concise service summary from the booking component snapshots (REQ-076). */
  serviceSummary(booking: BookingWithRelations): string {
    const names = booking.components.map((c) => c.nameSnapshot);
    if (names.length === 0) return 'appointment';
    if (names.length === 1) return names[0];
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }

  dateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  timeKey(date: Date): string {
    const d = new Date(date);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  render(input: RenderInput): RenderedMessage {
    const { type, booking, businessName } = input;
    const summary = this.serviceSummary(booking);
    const date = this.dateKey(booking.startAt);
    const time = this.timeKey(booking.startAt);
    const ctx = `${businessName} — ${summary} on ${date} at ${time}`;
    const reason =
      input.rejectionReason && input.rejectionReason.trim() ? input.rejectionReason.trim() : undefined;

    switch (type) {
      case 'PAYMENT_PROOF_RECEIVED':
        return { text: `${ctx}\nYour payment proof has been received and is awaiting review.`, date, time };
      case 'BOOKING_CONFIRMED':
        return { text: `${ctx}\nYour booking is confirmed.`, date, time };
      case 'PAYMENT_REJECTED':
        return {
          text: `${ctx}\nYour payment proof was rejected${reason ? `: ${reason}` : '.'}`,
          date,
          time,
        };
      case 'REMINDER_24H':
        return { text: `${ctx}\nReminder: your appointment is tomorrow.`, date, time };
      case 'REMINDER_1H':
        return { text: `${ctx}\nReminder: your appointment is in 1 hour.`, date, time };
      case 'NO_SHOW':
        return { text: `${ctx}\nYour booking was marked as No Show.`, date, time };
      case 'BOOKING_CANCELLED':
        return { text: `${ctx}\nYour booking was cancelled.`, date, time };
      case 'BOOKING_RESCHEDULED':
        return { text: `${ctx}\nYour booking has been rescheduled.`, date, time };
      default:
        return { text: ctx, date, time };
    }
  }

  /** Owner N09 — new payment proof notification (REQ-065/066). */
  renderOwnerProofReceived(input: { booking: BookingWithRelations; businessName: string }): string {
    const { booking, businessName } = input;
    const summary = this.serviceSummary(booking);
    const date = this.dateKey(booking.startAt);
    const time = this.timeKey(booking.startAt);
    return (
      `${businessName} — new payment proof for ${summary} on ${date} at ${time}.\n` +
      `Review it, then tap “Accept” or “Reject” below.`
    );
  }

  /**
   * Owner/business N15 — subscription proof rejection reason (REQ-138), sent to
   * the business Telegram. The reason is mandatory (validated at review time).
   */
  renderSubscriptionProofRejected(input: {
    businessName: string;
    rejectionReason: string | null | undefined;
  }): string {
    const { businessName, rejectionReason } = input;
    const reason = rejectionReason && rejectionReason.trim() ? rejectionReason.trim() : 'no reason was given';
    return `${businessName} — your subscription payment proof was rejected.\nReason: ${reason}`;
  }
}