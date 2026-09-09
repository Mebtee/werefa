import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { TenantTransaction } from '../database/tenant-executor';

/**
 * Notification outbox (doc 13 §4/§6): rows are written inside the same tenant
 * transaction as the booking mutation so delivery can never be lost by a
 * mid-transaction failure. Delivery itself is deferred.
 *
 * The public/owner flows rely on RLS: public inserts use the bookingPublic
 * marker scoped to the booking's business; owner flows run under the owner
 * scope. Types follow doc 13 §9 (notifications going through the future
 * delivery pipeline).
 */
export const BOOKING_NOTIFICATION_TYPE = {
  proofReceived: 'BOOKING_PROOF_RECEIVED', // to customer on proof submission
  newProofOwner: 'BOOKING_NEW_PROOF_OWNER', // to owner for each new proof
  confirmed: 'BOOKING_CONFIRMED',
  rejected: 'BOOKING_REJECTED', // payload: reason
  reminder24h: 'BOOKING_REMINDER_24H',
  reminder1h: 'BOOKING_REMINDER_1H',
  noShow: 'BOOKING_NO_SHOW',
  cancelled: 'BOOKING_CANCELLED',
  rescheduled: 'BOOKING_RESCHEDULED',
} as const;

export type NotificationOutboxPayload = Prisma.InputJsonObject;

export interface NotificationInput {
  businessId: string;
  bookingId: string;
  type: string;
  payload: Prisma.InputJsonObject;
}

@Injectable()
export class BookingNotificationService {
  enqueue(tx: TenantTransaction, notification: NotificationInput): Promise<unknown> {
    return tx.notification.create({
      data: {
        businessId: notification.businessId,
        bookingId: notification.bookingId,
        type: notification.type,
        payload: notification.payload,
      },
    });
  }
}
