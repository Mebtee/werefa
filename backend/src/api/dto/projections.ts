import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BookingState,
  BookingComponentType,
  PaymentMethod,
  PaymentState,
  ScheduleVersionStatus,
} from '@prisma/client';
import {
  BusinessWithOwner,
} from '../../domain/repositories/business.repository.port';
import { BookingWithHistory, BookingWithRelations } from '../../domain/repositories/booking.repository.port';
import { ScheduleWithDetails } from '../../domain/repositories/schedule.repository.port';
import { CustomerStatusEntry } from '../../domain/services/customer-status.service';

// ---------------------------------------------------------------------------
// Helpers: BigInt → JSON-safe number (minor currency units).
// ---------------------------------------------------------------------------
const toNumber = (value: bigint | number | null | undefined): number | null =>
  value == null ? null : typeof value === 'bigint' ? Number(value) : Number(value);

const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);

const PUBLIC_STATUS: Record<BookingState, string> = {
  PAYMENT_PENDING: 'awaiting-verification',
  CONFIRMED: 'confirmed',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  NO_SHOW: 'no-show',
};

// ---------------------------------------------------------------------------
// PUBLIC BUSINESS PAGE (spec §13). No owner identity, no ids, no subscription.
// ---------------------------------------------------------------------------
export class PublicCategoryView {
  @ApiProperty({ example: 'SALON_AND_BARBER' }) code: string;
  @ApiProperty({ example: 'Salon & Barber' }) label: string;
}

export class PublicBusinessView {
  @ApiProperty({ example: 'my-salon' }) slug: string;
  @ApiProperty({ example: 'My Salon' }) name: string;
  @ApiPropertyOptional({ example: 'A friendly neighbourhood salon.' }) description: string | null;
  @ApiPropertyOptional({ example: 'Bole Road, Addis Ababa' }) address: string | null;
  @ApiPropertyOptional({ example: '+251911000000' }) phonePublic: string | null;
  @ApiProperty({ type: PublicCategoryView }) category: PublicCategoryView;
  @ApiPropertyOptional() coordinates: { latitude: number | null; longitude: number | null } | null;
  @ApiProperty({ example: false }) isDeactivated: boolean;
  @ApiProperty({ example: false }) isPaused: boolean;
  @ApiPropertyOptional({ example: 'Reopening soon.' }) pauseMessage: string | null;
  @ApiPropertyOptional() reopenAt: string | null;
  @ApiProperty({ example: 60 }) bookingIntervalMinutes: number;
  @ApiProperty({
    description:
      'Media urls are always null until the real file storage service lands (Prompt 28). File ids are never exposed.',
    example: { logoUrl: null, coverUrl: null },
  })
  branding: { logoUrl: null; coverUrl: null };
}

export function publicBusinessProjection(
  source: {
    business: BusinessWithOwner;
    settings: {
      bookingIntervalMins: number;
      isPaused: boolean;
      pauseMessage: string | null;
      reopenAt: Date | null;
    } | null;
  },
): PublicBusinessView {
  const { business, settings } = source;
  return {
    slug: business.publicSlug,
    name: business.name,
    description: business.description,
    address: business.address,
    phonePublic: business.phonePublic,
    category: { code: business.categoryCode, label: business.category.label },
    coordinates: {
      latitude: business.latitude == null ? null : Number(business.latitude),
      longitude: business.longitude == null ? null : Number(business.longitude),
    },
    isDeactivated: business.deactivatedAt != null,
    isPaused: settings?.isPaused ?? false,
    pauseMessage: settings?.pauseMessage ?? null,
    reopenAt: iso(settings?.reopenAt),
    bookingIntervalMinutes: settings?.bookingIntervalMins ?? 60,
    branding: { logoUrl: null, coverUrl: null },
  };
}

export class PublicServiceVariantView {
  @ApiProperty({ example: 'uuid' }) id: string;
  @ApiProperty({ example: 'Short cut' }) name: string;
  @ApiProperty({ example: 5000 }) priceDeltaMinor: number;
  @ApiProperty({ example: 15 }) durationDeltaMinutes: number;
}

export class PublicServiceView {
  @ApiProperty({ example: 'uuid' }) id: string;
  @ApiProperty({ example: 'Haircut' }) name: string;
  @ApiProperty({ example: 10000 }) basePriceMinor: number;
  @ApiProperty({ example: 30 }) baseDurationMinutes: number;
  @ApiProperty({ type: [PublicServiceVariantView] }) variations: PublicServiceVariantView[];
  @ApiProperty({ type: [PublicServiceVariantView] }) addOns: PublicServiceVariantView[];
}

export function publicServicesProjection(
  services: Array<{
    id: string;
    name: string;
    basePriceMinor: bigint;
    baseDurationMinutes: number;
    variations: Array<{ id: string; name: string; priceDeltaMinor: bigint; durationDeltaMinutes: number }>;
    addOns: Array<{ id: string; name: string; priceDeltaMinor: bigint; durationDeltaMinutes: number }>;
  }>,
): PublicServiceView[] {
  const row = (v: { id: string; name: string; priceDeltaMinor: bigint; durationDeltaMinutes: number }) => ({
    id: v.id,
    name: v.name,
    priceDeltaMinor: toNumber(v.priceDeltaMinor)!,
    durationDeltaMinutes: v.durationDeltaMinutes,
  });
  return services.map((s) => ({
    id: s.id,
    name: s.name,
    basePriceMinor: toNumber(s.basePriceMinor)!,
    baseDurationMinutes: s.baseDurationMinutes,
    variations: s.variations.map(row),
    addOns: s.addOns.map(row),
  }));
}

export class PublicSlotView {
  @ApiProperty({ example: '2026-09-20T09:00:00.000Z' }) startAt: string;
  @ApiProperty({ example: '2026-09-20T09:30:00.000Z' }) endAt: string;
}

export class PublicAvailabilityView {
  @ApiProperty({ example: '2026-09-20' }) date: string;
  @ApiProperty({ type: [PublicSlotView] }) slots: PublicSlotView[];
  @ApiProperty({ example: 30 }) computedDurationMinutes: number;
  @ApiProperty({ example: 10000 }) computedTotalPriceMinor: number;
}

// ---------------------------------------------------------------------------
// CUSTOMER FACING (spec §27/§31). Never an internal booking id, never owner
// identity, never subscription/proof internals.
// ---------------------------------------------------------------------------
export class CustomerBookingView {
  @ApiProperty({ example: 'awaiting-verification' }) status: string;
  @ApiProperty({ example: '2026-09-20T09:00:00.000Z' }) startAt: string;
  @ApiProperty({ example: '2026-09-20T09:30:00.000Z' }) endAt: string;
  @ApiProperty({ example: ['Haircut'] }) serviceNames: string[];
  @ApiProperty({ example: 'my-salon' }) businessSlug: string;
  @ApiProperty({ example: 10000 }) totalPriceMinor: number;
  @ApiProperty({ example: 0 }) prepaidMinor: number;
  @ApiProperty({ example: 'BANK_TRANSFER' }) paymentMethod: string;
  @ApiPropertyOptional() note: string | null;
}

export function customerBookingProjection(businessSlug: string, booking: BookingWithRelations): CustomerBookingView {
  return {
    status: PUBLIC_STATUS[booking.status],
    startAt: booking.startAt.toISOString(),
    endAt: booking.endAt.toISOString(),
    serviceNames: booking.components.map((c) => c.nameSnapshot),
    businessSlug,
    totalPriceMinor: toNumber(sumComponents(booking.components))!,
    prepaidMinor: toNumber(booking.payment?.prepaidMinor ?? 0n)!,
    paymentMethod: booking.payment?.method ?? PaymentMethod.BANK_TRANSFER,
    note: booking.note,
  };
}

export class CustomerStatusEntryView {
  @ApiProperty({ example: '2026-09-20T09:00:00.000Z' }) startAt: string;
  @ApiProperty({ example: '2026-09-20T09:30:00.000Z' }) endAt: string;
  @ApiProperty({ example: 'confirmed' }) status: string;
}

export class CustomerStatusView {
  @ApiProperty({ type: [CustomerStatusEntryView] }) bookings: CustomerStatusEntryView[];
}

export function customerStatusProjection(entries: CustomerStatusEntry[]): CustomerStatusView {
  return {
    bookings: entries.map((e) => ({
      startAt: e.startAt.toISOString(),
      endAt: e.endAt.toISOString(),
      status: e.status,
    })),
  };
}

export class CustomerResubmissionResultView {
  @ApiProperty({ type: CustomerBookingView }) booking: CustomerBookingView;
  @ApiProperty({ example: 'PROOF_RECEIVED' }) outcome: string;
}

// ---------------------------------------------------------------------------
// OWNER FACING (spec §25).
// ---------------------------------------------------------------------------
export interface OwnerBusinessSettingsSource {
  bookingIntervalMins: number;
  prepaymentMode: string;
  prepaymentPercent: number | null;
  prepaymentFixedMinor: bigint | null;
  isPaused: boolean;
  pauseMessage: string | null;
  reopenAt: Date | null;
}

export class OwnerBusinessView {
  @ApiProperty({ example: 'uuid' }) id: string;
  @ApiProperty({ example: 'my-salon' }) slug: string;
  @ApiProperty({ example: 'My Salon' }) name: string;
  @ApiProperty({ type: PublicCategoryView }) category: PublicCategoryView;
  @ApiPropertyOptional() description: string | null;
  @ApiPropertyOptional() address: string | null;
  @ApiPropertyOptional() phonePublic: string | null;
  @ApiProperty({ example: false }) isDeactivated: boolean;
  @ApiProperty({ example: false }) isPaused: boolean;
  @ApiPropertyOptional() pauseMessage: string | null;
  @ApiPropertyOptional() reopenAt: string | null;
  @ApiProperty({ example: 60 }) bookingIntervalMinutes: number;
  @ApiProperty({ example: 'NONE' }) prepaymentMode: string;
  @ApiPropertyOptional() prepaymentPercent: number | null;
  @ApiPropertyOptional() prepaymentFixedMinor: number | null;
  @ApiProperty() createdAt: string;
}

export function ownerBusinessProjection(source: { business: BusinessWithOwner; settings: OwnerBusinessSettingsSource | null }): OwnerBusinessView {
  const { business, settings } = source;
  return {
    id: business.id,
    slug: business.publicSlug,
    name: business.name,
    category: { code: business.categoryCode, label: business.category.label },
    description: business.description,
    address: business.address,
    phonePublic: business.phonePublic,
    isDeactivated: business.deactivatedAt != null,
    isPaused: settings?.isPaused ?? false,
    pauseMessage: settings?.pauseMessage ?? null,
    reopenAt: iso(settings?.reopenAt),
    bookingIntervalMinutes: settings?.bookingIntervalMins ?? 60,
    prepaymentMode: settings?.prepaymentMode ?? 'NONE',
    prepaymentPercent: settings?.prepaymentPercent ?? null,
    prepaymentFixedMinor: toNumber(settings?.prepaymentFixedMinor ?? null),
    createdAt: business.createdAt.toISOString(),
  };
}

export class OwnerServiceView {
  @ApiProperty({ example: 'uuid' }) id: string;
  @ApiProperty({ example: 'Haircut' }) name: string;
  @ApiProperty({ example: 10000 }) basePriceMinor: number;
  @ApiProperty({ example: 30 }) baseDurationMinutes: number;
  @ApiProperty({ example: true }) isActive: boolean;
  @ApiProperty({ type: [PublicServiceVariantView] }) variations: PublicServiceVariantView[];
  @ApiProperty({ type: [PublicServiceVariantView] }) addOns: PublicServiceVariantView[];
}

export function ownerServicesProjection(
  services: Array<{
    id: string;
    name: string;
    basePriceMinor: bigint;
    baseDurationMinutes: number;
    isActive: boolean;
    variations: Array<{ id: string; name: string; priceDeltaMinor: bigint; durationDeltaMinutes: number; isActive: boolean }>;
    addOns: Array<{ id: string; name: string; priceDeltaMinor: bigint; durationDeltaMinutes: number; isActive: boolean }>;
  }>,
): OwnerServiceView[] {
  const row = (v: { id: string; name: string; priceDeltaMinor: bigint; durationDeltaMinutes: number; isActive: boolean }) => ({
    id: v.id,
    name: v.name,
    priceDeltaMinor: toNumber(v.priceDeltaMinor)!,
    durationDeltaMinutes: v.durationDeltaMinutes,
  });
  return services.map((s) => ({
    id: s.id,
    name: s.name,
    basePriceMinor: toNumber(s.basePriceMinor)!,
    baseDurationMinutes: s.baseDurationMinutes,
    isActive: s.isActive,
    variations: s.variations.map(row),
    addOns: s.addOns.map(row),
  }));
}

export class OwnerBookingComponentView {
  @ApiProperty({ example: 'SERVICE', enum: BookingComponentType }) componentType: BookingComponentType;
  @ApiProperty({ example: 'Haircut' }) name: string;
  @ApiProperty({ example: 10000 }) unitPriceMinor: number;
  @ApiProperty({ example: 30 }) durationMinutes: number;
}

export class OwnerPaymentView {
  @ApiProperty({ example: 'PENDING', enum: PaymentState }) status: PaymentState;
  @ApiProperty({ example: 'BANK_TRANSFER', enum: PaymentMethod }) method: PaymentMethod;
  @ApiProperty({ example: 0 }) prepaidMinor: number;
}

function sumComponents(components: Array<{ unitPriceMinor: bigint }>): bigint {
  return components.reduce((acc, c) => acc + c.unitPriceMinor, 0n);
}

export class OwnerBookingView {
  @ApiProperty({ example: 1 }) bookingId: number;
  @ApiProperty({ example: 'PAYMENT_PENDING', enum: BookingState }) status: BookingState;
  @ApiProperty({ example: 'Awit' }) customerName: string;
  @ApiProperty({ example: '+251911000000' }) customerPhone: string;
  @ApiPropertyOptional() note: string | null;
  @ApiProperty({ example: '2026-09-20T09:00:00.000Z' }) startAt: string;
  @ApiProperty({ example: '2026-09-20T09:30:00.000Z' }) endAt: string;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
  @ApiProperty({ type: OwnerPaymentView, nullable: true }) payment: OwnerPaymentView | null;
  @ApiProperty({ type: [OwnerBookingComponentView] }) components: OwnerBookingComponentView[];
  @ApiProperty({ example: 10000 }) totalPriceMinor: number;
}

export function ownerBookingProjection(booking: BookingWithRelations): OwnerBookingView {
  return {
    bookingId: booking.id,
    status: booking.status,
    customerName: booking.customerName,
    customerPhone: booking.customerPhone,
    note: booking.note,
    startAt: booking.startAt.toISOString(),
    endAt: booking.endAt.toISOString(),
    createdAt: booking.createdAt.toISOString(),
    updatedAt: booking.updatedAt.toISOString(),
    payment: booking.payment
      ? {
          status: booking.payment.status,
          method: booking.payment.method,
          prepaidMinor: toNumber(booking.payment.prepaidMinor)!,
        }
      : null,
    components: booking.components.map((c) => ({
      componentType: c.componentType,
      name: c.nameSnapshot,
      unitPriceMinor: toNumber(c.unitPriceMinor)!,
      durationMinutes: c.durationMinutes,
    })),
    totalPriceMinor: toNumber(sumComponents(booking.components))!,
  };
}

export class OwnerBookingHistoryView {
  @ApiProperty() occurredAt: string;
  @ApiPropertyOptional() fromStatus: BookingState | null;
  @ApiProperty({ example: 'CONFIRMED', enum: BookingState }) toStatus: BookingState;
  @ApiProperty() actorType: string;
  @ApiPropertyOptional() actorUserId: string | null;
  @ApiPropertyOptional() reason: string | null;
}

export class OwnerBookingProofView {
  @ApiProperty({ example: '2026-09-20T09:05:00.000Z' }) submittedAt: string;
}

export class OwnerBookingDetailView extends OwnerBookingView {
  @ApiProperty({ type: [OwnerBookingHistoryView] }) history: OwnerBookingHistoryView[];
  @ApiProperty({ type: [OwnerBookingProofView] }) proofs: OwnerBookingProofView[];
}

export function ownerBookingDetailProjection(booking: BookingWithHistory): OwnerBookingDetailView {
  return {
    ...ownerBookingProjection(booking),
    history: booking.statusHistory.map((h) => ({
      occurredAt: h.occurredAt.toISOString(),
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      actorType: h.actorType,
      actorUserId: h.actorUserId,
      reason: h.reason,
    })),
    proofs: booking.proofsSubmittedAt.map((d) => ({ submittedAt: d.toISOString() })),
  };
}

export class OwnerScheduleVersionView {
  @ApiProperty({ example: 'uuid' }) versionId: string;
  @ApiProperty({ example: 1 }) versionNo: number;
  @ApiProperty({ example: 'ACTIVE', enum: ScheduleVersionStatus }) status: ScheduleVersionStatus;
  @ApiPropertyOptional() name: string | null;
  @ApiPropertyOptional() appliedAt: string | null;
  @ApiPropertyOptional() appliedBy: string | null;
  @ApiPropertyOptional() reason: string | null;
  @ApiProperty() createdAt: string;
}

export class WorkingPeriodView {
  @ApiProperty({ example: 1 }) weekday: number;
  @ApiProperty({ example: 480 }) startMinutes: number;
  @ApiProperty({ example: 1020 }) endMinutes: number;
}

export class BlockedPeriodView {
  @ApiPropertyOptional() dayOfWeek: number | null;
  @ApiPropertyOptional() startMinutes: number | null;
  @ApiPropertyOptional() endMinutes: number | null;
}

export class SpecialDateView {
  @ApiProperty({ example: '2026-12-25' }) date: string;
  @ApiProperty({ example: 'CLOSED' }) kind: string;
  @ApiPropertyOptional() startMinutes: number | null;
  @ApiPropertyOptional() endMinutes: number | null;
}

export class OwnerScheduleView extends OwnerScheduleVersionView {
  @ApiProperty({ type: [WorkingPeriodView] }) workingPeriods: WorkingPeriodView[];
  @ApiProperty({ type: [BlockedPeriodView] }) blockedPeriods: BlockedPeriodView[];
  @ApiProperty({ type: [SpecialDateView] }) specialDates: SpecialDateView[];
}

export function ownerScheduleProjection(version: ScheduleWithDetails): OwnerScheduleView {
  const base = ownerScheduleVersionProjection(version);
  return {
    ...base,
    workingPeriods: version.workingPeriods.map((w) => ({
      weekday: w.weekday,
      startMinutes: w.startMinutes,
      endMinutes: w.endMinutes,
    })),
    blockedPeriods: version.blockedPeriods.map((b) => ({
      dayOfWeek: b.dayOfWeek,
      startMinutes: b.startMinutes,
      endMinutes: b.endMinutes,
    })),
    specialDates: version.specialDates.map((s) => ({
      date: s.date.toISOString().slice(0, 10),
      kind: s.kind,
      startMinutes: s.startMinutes,
      endMinutes: s.endMinutes,
    })),
  };
}

export function ownerScheduleVersionProjection(
  v: {
    id: string;
    versionNo: number;
    status: ScheduleVersionStatus;
    name: string | null;
    appliedAt: Date | null;
    appliedBy: string | null;
    reason: string | null;
    createdAt: Date;
  },
): OwnerScheduleVersionView {
  return {
    versionId: v.id,
    versionNo: v.versionNo,
    status: v.status,
    name: v.name,
    appliedAt: iso(v.appliedAt),
    appliedBy: v.appliedBy,
    reason: v.reason,
    createdAt: v.createdAt.toISOString(),
  };
}

export class OwnerScheduleSaveResultView {
  @ApiProperty({ example: 'uuid' }) versionId: string;
  @ApiProperty({ example: 2 }) versionNo: number;
  @ApiProperty({ example: true }) activated: boolean;
  @ApiProperty({ type: OwnerScheduleView }) version: OwnerScheduleView;
}

export class ScheduleExceptionView {
  @ApiProperty({ example: 'uuid' }) id: string;
  @ApiProperty({ example: 'uuid' }) scheduleVersionId: string;
  @ApiProperty({ example: 1 }) bookingId: number;
  @ApiProperty() createdAt: string;
}