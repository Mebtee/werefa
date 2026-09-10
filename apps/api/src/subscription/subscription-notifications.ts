import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { TenantTransaction } from '../database/tenant-executor';

/**
 * Subscription notification outbox (doc 13 §4/§6, Prompt 14): rows are written
 * inside the same tenant transaction as the subscription mutation so delivery
 * can never be lost by a mid-transaction failure. Delivery is deferred to the
 * NotificationDispatcher (fan-out + retry), exactly like booking notifications.
 */
export const SUBSCRIPTION_NOTIFICATION_TYPE = {
  /** Fan-out EMAIL to the (exactly) two Admin accounts (REQ-140). */
  paymentSubmittedAdmin: 'SUBSCRIPTION_PAYMENT_SUBMITTED_ADMIN',
  /** EMAIL to the business contact when a payment is approved (REQ-137/138). */
  paymentApprovedOwner: 'SUBSCRIPTION_PAYMENT_APPROVED_OWNER',
  /** EMAIL to the business contact with the rejection reason (REQ-138). */
  paymentRejectedOwner: 'SUBSCRIPTION_PAYMENT_REJECTED_OWNER',
  /** Renewal reminders to the business contact (REQ-139/140); Telegram PARTIAL. */
  reminderPaidEnd: 'SUBSCRIPTION_REMINDER_PAID_END',
  reminderTrialEnd: 'SUBSCRIPTION_REMINDER_TRIAL_END',
  reminderPaidGrace: 'SUBSCRIPTION_REMINDER_PAID_GRACE',
  reminderTrialGrace: 'SUBSCRIPTION_REMINDER_TRIAL_GRACE',
} as const;

export type SubscriptionOutboxPayload = Prisma.InputJsonObject;

@Injectable()
export class SubscriptionNotificationService {
  enqueue(
    tx: TenantTransaction,
    input: { businessId: string; type: string; payload: Prisma.InputJsonObject },
  ): Promise<unknown> {
    return tx.notification.create({
      data: {
        businessId: input.businessId,
        tenantScope: 'SUBSCRIPTION',
        type: input.type,
        payload: input.payload,
      },
    });
  }
}
