import {
  BlockedPeriod,
  Prisma,
  ScheduleException,
  ScheduleVersion,
  SpecialDate,
  WorkingPeriod,
} from '@prisma/client';

/**
 * Schedule domain repository — versioned weekly/blocked/special-date foundation
 * (REQ-082 … REQ-099). One shared queue per business (REQ-009); PENDING/ACTIVE
 * versions with a partial unique index enforcing at most one ACTIVE version.
 */
export interface ScheduleTemplate {
  workingPeriods: { weekday: number; startMinutes: number; endMinutes: number }[];
  blockedPeriods: { dayOfWeek?: number | null; startMinutes?: number | null; endMinutes?: number | null }[];
  specialDates: { date: Date; kind: 'CLOSED' | 'CUSTOM'; startMinutes?: number | null; endMinutes?: number | null }[];
}

export interface ScheduleWithDetails extends ScheduleVersion {
  workingPeriods: WorkingPeriod[];
  blockedPeriods: BlockedPeriod[];
  specialDates: SpecialDate[];
}

export interface ScheduleRepository {
  createPendingVersion(
    tx: Prisma.TransactionClient,
    args: { businessId: string; versionNo: number; name?: string | null; template: ScheduleTemplate },
  ): Promise<ScheduleVersion>;
  applyVersion(
    tx: Prisma.TransactionClient,
    args: { versionId: string; businessId: string; appliedBy: string; reason?: string | null },
  ): Promise<ScheduleVersion>;
  getActiveVersion(businessId: string): Promise<ScheduleWithDetails | null>;
  listVersions(businessId: string): Promise<ScheduleVersion[]>;
  getById(businessId: string, versionId: string): Promise<ScheduleWithDetails | null>;
  nextVersionNo(businessId: string): Promise<number>;
  /** Set all ACTIVE versions to PENDING (record replacedAt); used before promoting a new one. */
  demoteActiveVersions(tx: Prisma.TransactionClient, args: { businessId: string; replacedAt: Date }): Promise<number>;
  /** Guarded: PENDING → ACTIVE (many would be >1 if data is inconsistent; still at most 1 per index). */
  promotePendingVersion(
    tx: Prisma.TransactionClient,
    args: { versionId: string; businessId: string; appliedBy: string; reason?: string | null },
  ): Promise<boolean>;
  setBusinessActiveVersion(tx: Prisma.TransactionClient, args: { businessId: string; versionId: string | null }): Promise<void>;
  listPendingVersions(businessId: string): Promise<ScheduleVersion[]>;
  createException(
    tx: Prisma.TransactionClient,
    args: { businessId: string; versionId: string; bookingId: number; createdBy?: string | null },
  ): Promise<ScheduleException>;
}