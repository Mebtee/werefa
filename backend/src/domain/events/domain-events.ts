/**
 * Notification/domain event boundary (Prompt 41 §20; Prompt 43 auth events).
 *
 * Telegram itself is NOT implemented in this prompt (spec §17, architecture
 * doc 12). Services publish typed domain events AFTER the owning transaction
 * commits; a later phase plugs a real outbox/Telegram sender in behind the same
 * port. Events exist for the canonical notification set only; booking validity
 * never depends on delivery (REQ-056). Auth events (lockout, recovery code,
 * force logout) are emitted as typed events for a future email outbox; no real
 * email is ever sent by this phase.
 */
export type BookingNotificationEventType =
  | 'PAYMENT_PROOF_RECEIVED'
  | 'BOOKING_CONFIRMED'
  | 'PAYMENT_REJECTED'
  | 'REMINDER_24H'
  | 'REMINDER_1H'
  | 'NO_SHOW'
  | 'BOOKING_CANCELLED'
  | 'BOOKING_RESCHEDULED';

export interface BookingNotificationEvent {
  type: BookingNotificationEventType;
  businessId: string;
  bookingId: number;
  customerPhone: string;
  occurredAt: Date;
  /** Optional typed context (e.g. rescheduled datetime, rejection reason). Never contains secrets. */
  payload?: Record<string, unknown>;
}

export type AuthEmailEventType = 'LOCKOUT_EMAIL' | 'RECOVERY_CODE_EMAIL' | 'FORCED_LOGOUT_EMAIL';

export interface AuthEmailEvent {
  type: AuthEmailEventType;
  userId: string;
  email: string;
  occurredAt: Date;
}

export type DomainEvent = BookingNotificationEvent | AuthEmailEvent;

export interface DomainEventBus {
  publish(events: DomainEvent[]): Promise<void>;
}

export const DOMAIN_EVENT_BUS = Symbol('DOMAIN_EVENT_BUS');

/**
 * In-memory (unit/integration) event bus. The real adapter (outbox + Telegram)
 * arrives with the notification workflow; services only depend on the port.
 */
export class InMemoryEventBus implements DomainEventBus {
  private readonly stored: DomainEvent[] = [];

  async publish(events: DomainEvent[]): Promise<void> {
    this.stored.push(...events);
  }

  drain(): DomainEvent[] {
    const all = [...this.stored];
    this.stored.length = 0;
    return all;
  }

  forBooking(bookingId: number): BookingNotificationEvent[] {
    return this.stored.filter((e) => e.type === e.type && 'bookingId' in e && e.bookingId === bookingId) as BookingNotificationEvent[];
  }

  /** Drain auth email events (Prompt 43). */
  authEvents(): AuthEmailEvent[] {
    return this.stored.filter((e) => e.type === 'LOCKOUT_EMAIL' || e.type === 'RECOVERY_CODE_EMAIL' || e.type === 'FORCED_LOGOUT_EMAIL') as AuthEmailEvent[];
  }
}