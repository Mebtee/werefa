/**
 * Notification/domain event boundary (Prompt 41 §20; Prompt 43 auth events;
 * Prompt 51 Telegram delivery).
 *
 * Services publish typed domain events AFTER the owning transaction commits.
 * Production wires the outbox adapter (NotificationOutboxEventBus), which
 * persists customer/owner notifications as Telegram deliveries (spec §18/§19)
 * and auth email events as suppressed email deliveries; a background worker
 * delivers them through the Telegram provider. Events exist for the canonical
 * notification set only; booking validity never depends on delivery (REQ-056).
 * No real email is ever sent by this phase.
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

/**
 * Subscription notifications (Prompt 52; spec §19 N15/N17).
 *
 *  - SUBSCRIPTION_PROOF_SUBMITTED  → N17: exactly the two Admin accounts are
 *    notified by email when the owner uploads a subscription payment proof
 *    (REQ-140). No owner/customer Telegram delivery is defined for submission.
 *  - SUBSCRIPTION_PROOF_REJECTED   → N15: the rejection reason is sent to the
 *    owner by email AND to the business Telegram (REQ-138). An approval
 *    notification to the owner is NOT part of the approved catalog.
 *
 * N16 reminders are time-driven by a lead-time that is still unresolved
 * (§46 item 3); the scheduling seam is preserved but nothing is scheduled yet.
 */
export type SubscriptionNotificationEventType =
  | 'SUBSCRIPTION_PROOF_SUBMITTED'
  | 'SUBSCRIPTION_PROOF_REJECTED';

export interface SubscriptionNotificationEvent {
  type: SubscriptionNotificationEventType;
  businessId: string;
  /** SubscriptionProof id — rendered/emailed context for the delivery worker. */
  proofId: string;
  occurredAt: Date;
  payload?: Record<string, unknown>;
}

export type DomainEvent = BookingNotificationEvent | AuthEmailEvent | SubscriptionNotificationEvent;

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