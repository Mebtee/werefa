import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { IsCalendarDateKey } from '../../common/validation/is-calendar-date';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------
export function limitValue(limit?: number): number {
  if (limit == null) return 50;
  return Math.min(200, Math.max(1, limit));
}

// ---------------------------------------------------------------------------
// CUSTOMER
// ---------------------------------------------------------------------------
export class CreateBookingSelectionBody {
  @ApiProperty({ example: 'uuid' })
  @IsUUID('4')
  serviceId: string;

  @ApiPropertyOptional({ example: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  variationId?: string;

  @ApiPropertyOptional({ example: ['uuid'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUUID('4', { each: true })
  addOnIds?: string[];
}

export class CreateBookingPayload {
  @ApiProperty({ example: 'my-salon' })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  businessSlug: string;

  @ApiProperty({
    type: [CreateBookingSelectionBody],
    description:
      'One or more service selections composing the appointment (REQ-070/074). The backend resolves, prices and snapshots every selection itself.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => CreateBookingSelectionBody)
  selections: CreateBookingSelectionBody[];

  @ApiProperty({ example: 'Awit' })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  customerName: string;

  @ApiProperty({ example: '+251911000000' })
  @IsString()
  @IsPhoneNumber('ET')
  customerPhone: string;

  @ApiPropertyOptional({ example: 'Please arrive 10 minutes early.' })
  @IsOptional()
  @IsString()
  @MaxLength(800)
  note?: string;

  @ApiProperty({ example: '2026-09-20T09:00:00.000Z' })
  @IsISO8601()
  startAt: string;

  @ApiProperty({ example: 'invoice-20260920-0001', description: 'Idempotency key (REQ-121).' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  submissionKey: string;

  @ApiPropertyOptional({ example: 'BANK_TRANSFER', enum: ['BANK_TRANSFER', 'TELEBIRR_MOBILE_MONEY'] })
  @IsOptional()
  @IsIn(['BANK_TRANSFER', 'TELEBIRR_MOBILE_MONEY'])
  paymentMethod?: 'BANK_TRANSFER' | 'TELEBIRR_MOBILE_MONEY';
}

export class CustomerStatusQuery {
  @ApiProperty({ example: 'my-salon' })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  slug: string;

  @ApiProperty({ example: '+251911000000' })
  @IsString()
  @IsPhoneNumber('ET')
  phone: string;
}

export class ResubmissionRequestPayload {
  @ApiProperty({ example: 'my-salon' })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  businessSlug: string;

  @ApiProperty({ example: '+251911000000' })
  @IsString()
  @IsPhoneNumber('ET')
  phone: string;
}

export class ResubmissionVerifyPayload extends ResubmissionRequestPayload {
  @ApiProperty({ example: '123456', description: 'One-time code delivered out-of-band (never in responses).' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Verification code must be exactly 6 digits.' })
  code: string;

  @ApiProperty({ example: 'invoice-20260920-0002' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  submissionKey: string;
}

// ---------------------------------------------------------------------------
// OWNER — business
// ---------------------------------------------------------------------------
export const BUSINESS_CATEGORIES = ['SALON_AND_BARBER', 'OTHER'] as const;

export class CreateBusinessPayload {
  @ApiProperty({ example: 'my-salon' })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'Slug may only contain lowercase letters, digits and hyphens.' })
  slug: string;

  @ApiProperty({ example: 'SALON_AND_BARBER', enum: BUSINESS_CATEGORIES })
  @IsIn(BUSINESS_CATEGORIES)
  categoryCode: string;

  @ApiProperty({ example: 'My Salon' })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name: string;

  @ApiPropertyOptional({ example: 'A friendly neighbourhood salon.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ example: 'Bole Road, Addis Ababa' })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  address?: string;

  @ApiPropertyOptional({ example: '+251911000000' })
  @IsOptional()
  @IsString()
  @IsPhoneNumber('ET')
  phonePublic?: string;

  @ApiPropertyOptional({ example: 60, description: 'Multiple of 5.' })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  bookingIntervalMinutes?: number;
}

export class UpdateBusinessProfilePayload {
  @ApiPropertyOptional({ example: 'My Salon (Upgraded)' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ example: 'A friendly neighbourhood salon.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ example: 'Bole Road, Addis Ababa' })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  address?: string;

  @ApiPropertyOptional({ example: '+251911000000' })
  @IsOptional()
  @IsString()
  @IsPhoneNumber('ET')
  phonePublic?: string;

  @ApiPropertyOptional({ example: 'SALON_AND_BARBER', enum: BUSINESS_CATEGORIES })
  @IsOptional()
  @IsIn(BUSINESS_CATEGORIES)
  categoryCode?: string;

  @ApiPropertyOptional({ example: 9.0108, description: 'REQ-211 AC1: the location may be saved with all three attributes.' })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ example: 38.7612 })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude?: number;
}

export class ChangeSlugPayload {
  @ApiProperty({ example: 'my-salon-v2' })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'Slug may only contain lowercase letters, digits and hyphens.' })
  publicSlug: string;
}

export class UpdateBusinessSettingsPayload {
  @ApiPropertyOptional({ example: 60 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  bookingIntervalMinutes?: number;

  @ApiPropertyOptional({ example: 'PERCENTAGE', enum: ['NONE', 'PERCENTAGE', 'FIXED'] })
  @IsOptional()
  @IsIn(['NONE', 'PERCENTAGE', 'FIXED'])
  prepaymentMode?: 'NONE' | 'PERCENTAGE' | 'FIXED';

  @ApiPropertyOptional({ example: 30, description: 'Required when prepaymentMode=PERCENTAGE.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  prepaymentPercent?: number | null;

  @ApiPropertyOptional({ example: 5000, description: 'Required when prepaymentMode=FIXED (minor units).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  prepaymentFixedMinor?: number | null;
}

export class PausePayload {
  @ApiPropertyOptional({ example: 'We will reopen on Monday.' })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  pauseMessage?: string;

  @ApiPropertyOptional({ example: '2026-09-21T08:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  reopenAt?: string;
}

// ---------------------------------------------------------------------------
// OWNER — catalog
// ---------------------------------------------------------------------------
export class CreateServicePayload {
  @ApiProperty({ example: 'Haircut' })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name: string;

  @ApiProperty({ example: 10000, description: 'Minor currency units.' })
  @IsInt()
  @Min(0)
  basePriceMinor: number;

  @ApiProperty({ example: 30 })
  @IsInt()
  @Min(1)
  @Max(1440)
  baseDurationMinutes: number;
}

export class UpdateServicePayload {
  @ApiPropertyOptional({ example: 'Haircut & Styling' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ example: 12000, description: 'Minor currency units.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  basePriceMinor?: number;

  @ApiPropertyOptional({ example: 45 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  baseDurationMinutes?: number;
}

export class CreateVariantPayload {
  @ApiProperty({ example: 'Short cut' })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name: string;

  @ApiProperty({ example: 5000, description: 'Delta vs base price, minor units.' })
  @IsInt()
  @Min(0)
  priceDeltaMinor: number;

  @ApiProperty({ example: 15, description: 'Delta vs base duration, minutes.' })
  @IsInt()
  @Min(0)
  @Max(1440)
  durationDeltaMinutes: number;
}

// ---------------------------------------------------------------------------
// OWNER — schedule
// ---------------------------------------------------------------------------
export class WorkingPeriodInput {
  @ApiProperty({ example: 1, description: '1 (Monday) … 7 (Sunday).' })
  @IsInt()
  @Min(1)
  @Max(7)
  weekday: number;

  @ApiProperty({ example: 480 })
  @IsInt()
  @Min(0)
  @Max(1439)
  startMinutes: number;

  @ApiProperty({ example: 1020 })
  @IsInt()
  @Min(1)
  @Max(1440)
  endMinutes: number;
}

export class BlockedPeriodInput {
  @ApiPropertyOptional({ description: 'Leave null to block every weekday.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek?: number | null;

  @ApiPropertyOptional({ example: 720 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  startMinutes?: number | null;

  @ApiPropertyOptional({ example: 780 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  endMinutes?: number | null;
}

export class SpecialDateInput {
  @ApiProperty({ example: '2026-12-25' })
  @IsISO8601()
  date: string;

  @ApiProperty({ example: 'CLOSED', enum: ['CLOSED', 'CUSTOM'] })
  @IsIn(['CLOSED', 'CUSTOM'])
  kind: 'CLOSED' | 'CUSTOM';

  @ApiPropertyOptional({ example: 540, description: 'Required for CUSTOM.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  startMinutes?: number | null;

  @ApiPropertyOptional({ example: 780 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  endMinutes?: number | null;
}

export class SaveSchedulePayload {
  @ApiPropertyOptional({ example: 'Summer opening hours' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @ApiProperty({ type: [WorkingPeriodInput] })
  @IsArray()
  @Type(() => WorkingPeriodInput)
  workingPeriods: WorkingPeriodInput[];

  @ApiProperty({ type: [BlockedPeriodInput], required: false })
  @IsOptional()
  @IsArray()
  @Type(() => BlockedPeriodInput)
  blockedPeriods?: BlockedPeriodInput[];

  @ApiProperty({ type: [SpecialDateInput], required: false })
  @IsOptional()
  @IsArray()
  @Type(() => SpecialDateInput)
  specialDates?: SpecialDateInput[];
}

export class RecordExceptionPayload {
  @ApiProperty({ example: 1, description: 'Owner-facing booking id.' })
  @IsInt()
  @Min(1)
  bookingId: number;

  @ApiProperty({ example: 'uuid' })
  @IsUUID('4')
  versionId: string;

  @ApiPropertyOptional({ example: 'Owner keeps the booking', description: 'Why the owner keeps the booking despite the conflict (REQ-160/161).' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

// ---------------------------------------------------------------------------
// OWNER — bookings
// ---------------------------------------------------------------------------
const BOOKING_STATES = ['PAYMENT_PENDING', 'CONFIRMED', 'REJECTED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] as const;

export class OwnerBookingListQuery {
  @ApiPropertyOptional({ example: 'CONFIRMED', enum: BOOKING_STATES })
  @IsOptional()
  @IsIn(BOOKING_STATES)
  status?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ example: 'Awit', description: 'Matches customer name (partial) or phone (prefix).' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  search?: string;

  @ApiPropertyOptional({ example: 20, default: 50 })
  @IsOptional()
  @Transform(({ value }) => limitValue(typeof value === 'string' ? parseInt(value, 10) : value))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class ReschedulePayload {
  @ApiProperty({ example: '2026-09-21T09:00:00.000Z' })
  @IsISO8601()
  startAt: string;
}

export class OwnerBookingAvailableTimesQuery {
  @ApiProperty({ example: '2026-09-20' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be YYYY-MM-DD.' })
  @IsCalendarDateKey()
  date: string;
}

export class RejectPayload {
  @ApiProperty({ example: 'The transfer did not include the account number.' })
  @IsString()
  @MinLength(1)
  @MaxLength(800)
  reason: string;
}

export class AvailabilityQuery {
  @ApiProperty({ example: '2026-09-20' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be YYYY-MM-DD.' })
  @IsCalendarDateKey()
  date: string;

  @ApiProperty({ example: 'uuid' })
  @IsUUID('4')
  serviceId: string;

  @ApiPropertyOptional({ example: 'uuid1,uuid2' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : value))
  @IsArray()
  @IsUUID('4', { each: true })
  variationIds?: string[];

  @ApiPropertyOptional({ example: 'uuid3' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : value))
  @IsArray()
  @IsUUID('4', { each: true })
  addOnIds?: string[];
}

export class AvailabilitySelectionBody {
  @ApiProperty({ example: 'uuid' })
  @IsUUID('4')
  serviceId: string;

  @ApiPropertyOptional({ example: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  variationId?: string;

  @ApiPropertyOptional({ example: ['uuid'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUUID('4', { each: true })
  addOnIds?: string[];
}

export class AvailabilityQueryBody {
  @ApiProperty({ example: '2026-09-20' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be YYYY-MM-DD.' })
  @IsCalendarDateKey()
  date: string;

  @ApiProperty({ type: [AvailabilitySelectionBody] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => AvailabilitySelectionBody)
  selections: AvailabilitySelectionBody[];
}

export class SlugParamsDto {
  @ApiProperty({ example: 'my-salon' })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  slug: string;
}

export class BusinessIdParamDto {
  @ApiProperty({ example: 'uuid' })
  @IsUUID('4')
  businessId: string;
}

export class ServiceIdParamDto extends BusinessIdParamDto {
  @ApiProperty({ example: 'uuid' })
  @IsUUID('4')
  serviceId: string;
}

export class VersionIdParamDto extends BusinessIdParamDto {
  @ApiProperty({ example: 'uuid' })
  @IsUUID('4')
  versionId: string;
}

export class BookingIdParamDto extends BusinessIdParamDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookingId: number;
}

export class ProofIdParamDto extends BookingIdParamDto {
  @ApiProperty({ example: 'uuid' })
  @IsUUID('4')
  proofId: string;
}

export class ResubmissionResultDto extends PickType(ResubmissionVerifyPayload, ['businessSlug', 'phone'] as const) {}