import { Injectable } from '@nestjs/common';
import type {
  Booking,
  BookingServiceItem,
  BookingStatusHistory,
  Notification as NotificationRow,
  Payment,
  PaymentProof,
  PaymentRejectionEvent,
  PaymentStatusHistory,
  ScheduleException,
  SlotLock,
} from '@prisma/client';

export interface BookingAggregate {
  booking: Booking & { serviceItems: BookingServiceItem[] };
  payment: (Payment & { proofs: PaymentProof[]; rejectionEvents: PaymentRejectionEvent[] }) | null;
  statusHistory: BookingStatusHistory[];
  paymentStatusHistory: PaymentStatusHistory[];
  slotLock: SlotLock | null;
  scheduleExceptions: ScheduleException[];
}

export interface BookingServiceItemDto {
  id: string;
  serviceId: string | null;
  name: string;
  unitPriceMinor: number;
  durationMinutes: number;
}

export interface PaymentProofDto {
  id: string;
  submittedAt: string;
}

export interface BookingHistoryDto {
  id: string;
  fromStatus: string;
  toStatus: string;
  actorType: string;
  occurredAt: string;
  reason: string | null;
}

export interface PaymentHistoryDto {
  id: string;
  fromStatus: string;
  toStatus: string;
  actorType: string;
  occurredAt: string;
}

export interface ScheduleExceptionDto {
  id: string;
  scheduleVersionId: string;
  reason: string | null;
  createdAt: string;
}

export interface BookingOwnerDetailDto {
  id: string;
  businessId: string;
  customerName: string;
  customerPhone: string;
  note: string | null;
  startAt: string;
  endAt: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  totalPriceMinor: number;
  totalDurationMinutes: number;
  services: BookingServiceItemDto[];
  payment: {
    id: string;
    status: string;
    method: string;
    prepaidMinor: number;
    rejectionReason: string | null;
  } | null;
  slotLock: string | null;
  statusHistory: BookingHistoryDto[];
  paymentStatusHistory: PaymentHistoryDto[];
  proofs: PaymentProofDto[];
  scheduleExceptions: ScheduleExceptionDto[];
}

export interface BookingOwnerListDto {
  id: string;
  customerName: string;
  customerPhone: string;
  startAt: string;
  endAt: string;
  status: string;
  totalPriceMinor: number;
  totalDurationMinutes: number;
  paymentStatus: string | null;
  services: BookingServiceItemDto[];
}

export interface BookingAdminStatusDto {
  id: string;
  businessId: string;
  customerName: string;
  customerPhone: string;
  startAt: string;
  endAt: string;
  status: string;
  paymentStatus: string | null;
  rejectionReason: string | null;
  totalPriceMinor: number;
  totalDurationMinutes: number;
  services: BookingServiceItemDto[];
}

export interface BookingPublicCreatedDto {
  id: string;
  status: string;
  customerName: string;
  startAt: string;
  endAt: string;
  totalPriceMinor: number;
  totalDurationMinutes: number;
  paymentStatus: string;
  paymentMethod: string | null;
  prepaidMinor: number;
  services: BookingServiceItemDto[];
}

export interface BookingSuperAdminDto extends BookingOwnerDetailDto {
  notifications: { id: string; type: string; createdAt: string }[];
}

export interface AvailabilityDto {
  available: boolean;
  startAt: string;
  endAt: string;
  totalPriceMinor: number;
  totalDurationMinutes: number;
  prepaidMinor: number;
}

function minor(value: bigint): number {
  return Number(value);
}

function iso(value: Date): string {
  return value.toISOString();
}

@Injectable()
export class BookingSerializer {
  ownerDetail(row: BookingAggregate): BookingOwnerDetailDto {
    return {
      id: row.booking.id,
      businessId: row.booking.businessId,
      customerName: row.booking.customerName,
      customerPhone: row.booking.customerPhone,
      note: row.booking.note,
      startAt: iso(row.booking.startAt),
      endAt: iso(row.booking.endAt),
      status: row.booking.status,
      createdAt: iso(row.booking.createdAt),
      updatedAt: iso(row.booking.updatedAt),
      totalPriceMinor: minor(this.totalPrice(row)),
      totalDurationMinutes: this.totalDuration(row),
      services: row.booking.serviceItems.map(serviceView),
      payment: row.payment
        ? {
            id: row.payment.id,
            status: row.payment.status,
            method: row.payment.method,
            prepaidMinor: minor(row.payment.prepaidMinor),
            rejectionReason:
              row.payment.rejectionEvents.length > 0
                ? (row.payment.rejectionEvents.at(0)?.reason ?? null)
                : null,
          }
        : null,
      slotLock: row.slotLock?.status ?? null,
      statusHistory: row.statusHistory.map((h) => ({
        id: h.id,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        actorType: h.actorType,
        occurredAt: iso(h.occurredAt),
        reason: h.reason,
      })),
      paymentStatusHistory: row.paymentStatusHistory.map((h) => ({
        id: h.id,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        actorType: h.actorType,
        occurredAt: iso(h.occurredAt),
      })),
      proofs: (row.payment?.proofs ?? []).map((p) => ({
        id: p.id,
        submittedAt: iso(p.submittedAt),
      })),
      scheduleExceptions: row.scheduleExceptions.map((e) => ({
        id: e.id,
        scheduleVersionId: e.scheduleVersionId,
        reason: e.reason,
        createdAt: iso(e.createdAt),
      })),
    };
  }

  ownerList(row: BookingAggregate): BookingOwnerListDto {
    return {
      id: row.booking.id,
      customerName: row.booking.customerName,
      customerPhone: row.booking.customerPhone,
      startAt: iso(row.booking.startAt),
      endAt: iso(row.booking.endAt),
      status: row.booking.status,
      totalPriceMinor: minor(this.totalPrice(row)),
      totalDurationMinutes: this.totalDuration(row),
      paymentStatus: row.payment?.status ?? null,
      services: row.booking.serviceItems.map(serviceView),
    };
  }

  publicCreated(row: BookingAggregate): BookingPublicCreatedDto {
    return {
      id: row.booking.id,
      status: row.booking.status,
      customerName: row.booking.customerName,
      startAt: iso(row.booking.startAt),
      endAt: iso(row.booking.endAt),
      totalPriceMinor: minor(this.totalPrice(row)),
      totalDurationMinutes: this.totalDuration(row),
      paymentStatus: row.payment?.status ?? 'PENDING',
      paymentMethod: row.payment?.method ?? null,
      prepaidMinor: row.payment ? minor(row.payment.prepaidMinor) : 0,
      services: row.booking.serviceItems.map(serviceView),
    };
  }

  adminStatus(row: BookingAggregate): BookingAdminStatusDto {
    const rejectionReason =
      row.payment && row.payment.rejectionEvents.length > 0
        ? (row.payment.rejectionEvents.at(0)?.reason ?? null)
        : null;
    return {
      id: row.booking.id,
      businessId: row.booking.businessId,
      customerName: row.booking.customerName,
      customerPhone: row.booking.customerPhone,
      startAt: iso(row.booking.startAt),
      endAt: iso(row.booking.endAt),
      status: row.booking.status,
      paymentStatus: row.payment?.status ?? null,
      rejectionReason,
      totalPriceMinor: minor(this.totalPrice(row)),
      totalDurationMinutes: this.totalDuration(row),
      services: row.booking.serviceItems.map(serviceView),
    };
  }

  superAdmin(row: BookingAggregate, notifications: NotificationRow[]): BookingSuperAdminDto {
    return {
      ...this.ownerDetail(row),
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        createdAt: iso(n.createdAt),
      })),
    };
  }

  availability(args: {
    available: boolean;
    startAt: Date;
    endAt: Date;
    totalPriceMinor: bigint;
    totalDurationMinutes: number;
    prepaidMinor: bigint;
  }): AvailabilityDto {
    return {
      available: args.available,
      startAt: iso(args.startAt),
      endAt: iso(args.endAt),
      totalPriceMinor: minor(args.totalPriceMinor),
      totalDurationMinutes: args.totalDurationMinutes,
      prepaidMinor: minor(args.prepaidMinor),
    };
  }

  private totalPrice(row: BookingAggregate): bigint {
    return row.booking.serviceItems.reduce((sum, item) => sum + item.unitPriceMinor, 0n);
  }

  private totalDuration(row: BookingAggregate): number {
    return row.booking.serviceItems.reduce((sum, item) => sum + item.durationMinutes, 0);
  }
}

function serviceView(item: BookingServiceItem): BookingServiceItemDto {
  return {
    id: item.id,
    serviceId: item.serviceId,
    name: item.nameSnapshot,
    unitPriceMinor: minor(item.unitPriceMinor),
    durationMinutes: item.durationMinutes,
  };
}
