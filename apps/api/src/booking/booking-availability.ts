import { Injectable } from '@nestjs/common';
import { ErrorCodes } from '@werefa/shared';
import { ConflictException } from '../common/http/app-error';
import type { TenantTransaction } from '../database/tenant-executor';
import type { BookingStatus, SlotLockStatus } from '@prisma/client';

const ACTIVE_BOOKING_STATUSES: readonly BookingStatus[] = ['PAYMENT_PENDING', 'CONFIRMED'];
const ACTIVE_SLOT_LOCK_STATUSES: readonly SlotLockStatus[] = ['LOCKED', 'ALLOCATED'];

/**
 * Slot availability semantics (architecture doc 08 §2): a slot is a temporal
 * window `[start_at, end_at)` on a business's schedule. It is unavailable if
 * any ACTIVE booking (PAYMENT_PENDING, CONFIRMED) or ACTIVE slot lock (LOCKED,
 * ALLOCATED) overlaps `[start_at, end_at)`.
 *
 * Availability is ALWAYS re-checked inside the per-business advisory-lock
 * transaction (doc 08 §3.1 step 4) — this service is called there, never as a
 * standalone "check then insert".
 */
@Injectable()
export class BookingAvailabilityService {
  /**
   * True when nothing active overlaps the window. `excludeBookingId` lets a
   * reschedule (or resubmission) ignore the subject booking's own rows.
   */
  async isSlotAvailable(
    tx: TenantTransaction,
    args: {
      businessId: string;
      startAt: Date;
      endAt: Date;
      excludeBookingId?: string;
    },
  ): Promise<boolean> {
    const bookingConflicts = await tx.booking.count({
      where: {
        businessId: args.businessId,
        status: { in: [...ACTIVE_BOOKING_STATUSES] },
        startAt: { lt: args.endAt },
        endAt: { gt: args.startAt },
        ...(args.excludeBookingId ? { id: { not: args.excludeBookingId } } : {}),
      },
    });
    const lockConflicts = await tx.slotLock.count({
      where: {
        businessId: args.businessId,
        status: { in: [...ACTIVE_SLOT_LOCK_STATUSES] },
        startAt: { lt: args.endAt },
        endAt: { gt: args.startAt },
        ...(args.excludeBookingId
          ? { OR: [{ bookingId: null }, { bookingId: { not: args.excludeBookingId } }] }
          : {}),
      },
    });
    return bookingConflicts === 0 && lockConflicts === 0;
  }

  /** Assert availability, throwing SLOT_UNAVAILABLE (REQ-053) when taken. */
  async requireSlotAvailable(
    tx: TenantTransaction,
    args: {
      businessId: string;
      startAt: Date;
      endAt: Date;
      excludeBookingId?: string;
    },
  ): Promise<void> {
    const free = await this.isSlotAvailable(tx, args);
    if (!free) {
      throw new ConflictException(
        'This time slot is no longer available.',
        ErrorCodes.SLOT_UNAVAILABLE,
      );
    }
  }

  /**
   * Slot date in the single global timezone Africa/Addis_Ababa (REQ-222/223,
   * UTC+3, no DST). Used as the slot_lock identity `slot_date` and stored as a
   * UTC-midnight date.
   */
  static slotDateOf(startAt: Date): Date {
    const shifted = new Date(startAt.getTime() + 3 * 60 * 60 * 1000);
    return new Date(
      Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()),
    );
  }
}
