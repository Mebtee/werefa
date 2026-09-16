import {
  ActorType,
  Booking,
  BookingComponent,
  BookingComponentType,
  BookingState,
  PaymentMethod,
  PaymentState,
  Prisma,
  SlotLock,
  SlotLockState,
} from '@prisma/client';

/**
 * Booking domain repository — lifecycle persistence foundation (REQ-100/101/107/
 * 109/121/173). `createBooking` persists the full aggregate in ONE transaction:
 * booking row + immutable component snapshots (REQ-076) + initial status history
 * (REQ-173) + payment (separate status, REQ-100) + payment proof (idempotent
 * submission_key, REQ-121) + active slot lock claim (REQ-121).
 *
 * The Prompt 41 additions make the repository a complete persistence boundary
 * for booking creation, the authoritative overlap re-check (doc 08 §4), guarded
 * status transitions (doc 09 §2), slot-lock lifecycle (SM-08/09, ALLOCATED) and
 * the customer status lookup.
 */
export interface BookingComponentInput {
  serviceId: string | null;
  componentType: BookingComponentType;
  nameSnapshot: string;
  unitPriceMinor: bigint;
  durationMinutes: number;
}

export interface CreateBookingArgs {
  businessId: string;
  customerName: string;
  customerPhone: string;
  note?: string | null;
  startAt: Date;
  endAt: Date;
  /** Global-tz date-only key of the slot calendar day (defaults to UTC date of startAt). */
  slotDate?: Date;
  createdByUserId?: string | null;
  paymentMethod: PaymentMethod;
  prepaidMinor: bigint;
  submissionKey: string;
  components: BookingComponentInput[];
}

export interface BookingWithRelations extends Booking {
  components: BookingComponent[];
  payment: {
    id: string;
    status: PaymentState;
    method: PaymentMethod;
    prepaidMinor: bigint;
  } | null;
}

export interface OverlapCheck {
  businessId: string;
  startAt: Date;
  endAt: Date;
  /** Ignore this booking (used when rescheduling keeps the same booking row). */
  excludeBookingId?: number;
}

export interface UserActor {
  actorType: ActorType;
  actorUserId?: string | null;
}

export interface BookingStatusHistoryInput extends UserActor {
  bookingId: number;
  businessId: string;
  fromStatus: BookingState | null;
  toStatus: BookingState;
  reason?: string | null;
}

export interface StatusTransitionInput {
  bookingId: number;
  businessId: string;
  from: BookingState;
  to: BookingState;
  actorType: ActorType;
  actorUserId?: string | null;
  reason?: string | null;
}

export interface BookingRepository {
  createBooking(tx: Prisma.TransactionClient, args: CreateBookingArgs): Promise<Booking>;
  findById(businessId: string, id: number): Promise<BookingWithRelations | null>;
  findByPhone(
    businessId: string,
    phone: string,
    opts?: { statusIn?: BookingState[]; limit?: number },
  ): Promise<BookingWithRelations[]>;
  listByBusiness(
    businessId: string,
    opts?: { statusIn?: BookingState[]; after?: Date; before?: Date; limit?: number },
  ): Promise<BookingWithRelations[]>;
  listDueForCompletion(businessId: string, upTo: Date, limit?: number): Promise<Booking[]>;
  hasServiceFutureBookings(businessId: string, serviceId: string): Promise<boolean>;
  hasActiveOverlap(tx: Prisma.TransactionClient, check: OverlapCheck): Promise<boolean>;
  /** Guarded status transition; false when the row is not in `from` state. */
  transitionStatus(tx: Prisma.TransactionClient, args: StatusTransitionInput): Promise<boolean>;
  changeTimes(
    tx: Prisma.TransactionClient,
    args: { businessId: string; bookingId: number; startAt: Date; endAt: Date },
  ): Promise<boolean>;
  createSlotLock(
    tx: Prisma.TransactionClient,
    args: { businessId: string; bookingId: number; slotDate: Date; startAt: Date; endAt: Date; state: SlotLockState },
  ): Promise<SlotLock>;
  /** Releases the active (LOCKED/ALLOCATED) lock of a booking. */
  releaseSlotLock(
    tx: Prisma.TransactionClient,
    args: { businessId: string; bookingId: number; releasedBy: string | null },
  ): Promise<boolean>;
  /** LOCKED -> ALLOCATED for every active lock of the booking (T2). */
  allocateSlotLocks(tx: Prisma.TransactionClient, args: { businessId: string; bookingId: number }): Promise<number>;
  appendStatusHistory(tx: Prisma.TransactionClient, args: BookingStatusHistoryInput): Promise<void>;
}