import { Inject, Injectable } from '@nestjs/common';
import { ErrorCodes } from '@werefa/shared';
import { AppException, ConflictException, NotFoundException } from '../common/http/app-error';
import { PrismaService } from '../database/prisma.service';
import { withOwnerBusinessContext, type TenantTransaction } from '../database/tenant-executor';
import { SecurityEventService } from '../iam/security-events.service';
import { withOwnerBookingLock } from '../booking/booking-lock';
import { evaluateFit, VIOLATION_LABELS, type ScheduleSnapshot } from './schedule-availability';
import {
  normalizeVersionRow,
  SCHEDULE_VERSION_INCLUDE,
  type ScheduleVersionRow,
} from './schedule-availability.service';
import type { ScheduleInputValue } from './schedule-input';
import { parseScheduleInput, parseKeepInput } from './schedule-input';
import { scheduleHistoryPdf, type SchedulePdfInput, type PdfVersionData } from './schedule-pdf';
import type {
  AffectedBookingEntry,
  KeepBookingResultDto,
  ScheduleCurrentDto,
  ScheduleHistoryDto,
} from './schedule.serializer';
import { ScheduleSerializer } from './schedule.serializer';
import { SuperAdminPrismaService } from '../booking/super-admin.prisma.service';
import { Prisma } from '@prisma/client';

/** Owner-facing scheduling alert fed to the notification outbox (doc 13). */
export const SCHEDULE_AFFECTED_TYPE = 'SCHEDULE_AFFECTED_OWNER';
export const SCHEDULE_NOTIFICATION_SCOPE = 'SCHEDULE';

const SCHEDULE_GROUPING_WINDOW_MS = 5 * 60 * 1000;

/** Booking statuses that hold a slot and can be adversely affected (REQ-090/093). */
const AFFECTABLE_BOOKING_STATUSES = ['PAYMENT_PENDING', 'CONFIRMED', 'REJECTED'] as const;

interface AffectedComputation {
  affected: AffectedBookingEntry[];
  kept: AffectedBookingEntry[];
}

interface ManageableVersion {
  row: ScheduleVersionRow | null;
  isPaused: boolean;
}

interface AffectedNotificationEntry {
  bookingId: string;
  customerName: string;
  customerPhone: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  services: { name: string; durationMinutes: number }[];
  reason: string;
  managementUrl: string;
  occurredAt: string;
}

/**
 * Scheduling management service (Prompt 12 — Domains 12/13/16).
 *
 * Owner flows: read/current, save (versioned; PENDING while paused), affected
 * bookings (fresh recompute), Keep Booking (schedule_exception), history and
 * PDF export. System/PROMPT flows: pending-schedule activation on resume.
 *
 * Every write runs under the SAME per-business advisory lock as slot creation
 * (doc 10 §8) so a schedule save can never interleave a booking creation:
 * bookings admitted just before the lock release are guaranteed to fit the
 * schedule that was active when they were checked.
 */
@Injectable()
export class ScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly security: SecurityEventService,
    private readonly serializer: ScheduleSerializer,
    @Inject(SuperAdminPrismaService) private readonly superAdmin: SuperAdminPrismaService,
  ) {}

  // ---------------------------------------------------------------------------
  // Owner: current schedule + advisory warnings
  // ---------------------------------------------------------------------------

  async getCurrent(actor: { userId: string }, businessId: string): Promise<ScheduleCurrentDto> {
    return withOwnerBusinessContext(this.prisma, actor.userId, businessId, async (tx) => {
      const manageable = await this.latestManageableVersion(tx, businessId);
      const computation = manageable.row
        ? await this.computeAffected(tx, normalizeVersionRow(manageable.row), businessId)
        : { affected: [], kept: [] };
      return this.currentView(manageable, computation);
    });
  }

  // ---------------------------------------------------------------------------
  // Owner: save (versioned). PENDING while paused (REQ-150/151/152)
  // ---------------------------------------------------------------------------

  async save(
    actor: { userId: string },
    businessId: string,
    body: unknown,
  ): Promise<ScheduleCurrentDto> {
    const input = parseScheduleInput(body);
    const result = await withOwnerBookingLock(this.prisma, actor.userId, businessId, async (tx) => {
      const current = await tx.business.findUnique({ where: { id: businessId } });
      if (!current) throw new NotFoundException('Business not found.');
      if (current.deactivatedAt) {
        throw new AppException(
          ErrorCodes.SCHEDULE_INVALID,
          400,
          'Deactivated businesses cannot schedule; reactivate first.',
        );
      }
      const status = current.isPaused ? 'PENDING' : 'ACTIVE';
      if (!current.isPaused) {
        await tx.scheduleVersion.updateMany({
          where: { businessId, status: 'ACTIVE' },
          data: { status: 'SUPERSEDED' },
        });
      }
      const version = await this.createVersion(tx, businessId, status, actor.userId, input);
      const row = await this.loadVersionRow(tx, version.id);
      const computation =
        status === 'ACTIVE'
          ? await this.computeAffected(tx, normalizeVersionRow(row), businessId)
          : { affected: [], kept: [] };
      if (status === 'ACTIVE' && computation.affected.length > 0) {
        await this.persistConflicts(tx, businessId, version.id, computation.affected);
        await this.maybeEnqueueAffected(tx, businessId, version.id, computation.affected);
      }
      return this.currentView({ row, isPaused: current.isPaused }, computation);
    });

    await this.security.record({
      type: 'SCHEDULE_SAVE',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Owner: affected bookings (fresh recompute — self-healing, doc 10 §4)
  // ---------------------------------------------------------------------------

  async listConflicts(actor: { userId: string }, businessId: string): Promise<ScheduleCurrentDto> {
    return this.getCurrent(actor, businessId);
  }

  // ---------------------------------------------------------------------------
  // Owner: Keep Booking (schedule_exception, REQ-160/161)
  // ---------------------------------------------------------------------------

  async keepBooking(
    actor: { userId: string },
    businessId: string,
    bookingId: string,
    body: unknown,
  ): Promise<KeepBookingResultDto> {
    const input = parseKeepInput(body);
    const result = await withOwnerBookingLock(this.prisma, actor.userId, businessId, async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!booking || booking.businessId !== businessId) {
        throw new NotFoundException('Booking not found.');
      }
      if (!(AFFECTABLE_BOOKING_STATUSES as readonly string[]).includes(booking.status)) {
        throw new ConflictException(
          'Only active bookings can be kept under a changed schedule.',
          ErrorCodes.INVALID_TRANSITION,
        );
      }
      const version = await tx.scheduleVersion.findFirst({
        where: { businessId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      });
      if (!version) {
        throw new ConflictException(
          'This business has no active schedule to keep the booking against.',
          ErrorCodes.SCHEDULE_AFFECTED,
        );
      }
      const snapshot = await this.snapshotOfVersion(tx, businessId, version.id);
      const fit = evaluateFit(snapshot, booking.startAt, booking.endAt);
      const existing = await tx.scheduleException.findUnique({ where: { bookingId } });
      if (fit.ok && !existing) {
        throw new ConflictException(
          'This booking does not conflict with the current schedule.',
          ErrorCodes.SCHEDULE_AFFECTED,
        );
      }

      const now = new Date();
      const exception = await tx.scheduleException.upsert({
        where: { bookingId },
        update: {
          scheduleVersionId: version.id,
          reason: input.reason ?? existing?.reason ?? null,
          createdByUserId: actor.userId,
        },
        create: {
          businessId,
          bookingId,
          scheduleVersionId: version.id,
          reason: input.reason,
          createdByUserId: actor.userId,
        },
      });
      await tx.scheduleConflict.updateMany({
        where: { scheduleVersionId: version.id, bookingId },
        data: { status: 'RESOLVED_KEPT', resolvedAt: now, resolvedByUserId: actor.userId },
      });
      // Same-status transition records the owner's keep decision (REQ-163). No
      // customer notification is sent for a keep (REQ-161).
      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          businessId,
          fromStatus: booking.status,
          toStatus: booking.status,
          actorType: 'OWNER',
          actorUserId: actor.userId,
          reason: 'kept under changed schedule',
          occurredAt: now,
        },
      });
      return { ok: true as const, bookingId, exception: keepExceptionView(exception) };
    });

    await this.security.record({
      type: 'SCHEDULE_BOOKING_KEEP',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Owner: history (REQ-166) + PDF export (REQ-167)
  // ---------------------------------------------------------------------------

  async history(
    actor: { userId: string },
    businessId: string,
    params: { skip: number; take: number; from?: Date; to?: Date },
  ): Promise<ScheduleHistoryDto> {
    return withOwnerBusinessContext(this.prisma, actor.userId, businessId, async (tx) => {
      const where = historyWhere(businessId, params);
      const [total, rows] = await Promise.all([
        tx.scheduleVersion.count({ where }),
        tx.scheduleVersion.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: params.skip,
          take: params.take,
          include: SCHEDULE_VERSION_INCLUDE,
        }),
      ]);
      return { total, versions: rows.map((row) => this.serializer.version(row)) };
    });
  }

  /** Owner PDF export (custom period). PDF never carries owner/reason details (REQ-172). */
  async exportPdf(
    actor: { userId: string },
    businessId: string,
    params: { from?: Date; to?: Date },
  ): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const pdf = await withOwnerBusinessContext(
      this.prisma,
      actor.userId,
      businessId,
      async (tx) => {
        const business = await tx.business.findUnique({
          where: { id: businessId },
          select: { name: true, publicSlug: true },
        });
        if (!business) throw new NotFoundException('Business not found.');
        const versions = await this.historyRows(tx, businessId, params);
        return scheduleHistoryPdf(toPdfInput(business.name, params, versions));
      },
    );

    await this.security.record({
      type: 'SCHEDULE_HISTORY_EXPORT',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return pdf;
  }

  // ---------------------------------------------------------------------------
  // Super Admin: cross-business history + export (REQ-167/170), Admin excluded
  // ---------------------------------------------------------------------------

  async historyForSuperAdmin(
    businessId: string,
    params: { from?: Date; to?: Date },
  ): Promise<ScheduleHistoryDto> {
    const business = await this.superAdmin.business.findUnique({
      where: { id: businessId },
      select: { id: true },
    });
    if (!business) throw new NotFoundException('Business not found.');
    const where = historyWhere(businessId, params);
    const [total, rows] = await Promise.all([
      this.superAdmin.scheduleVersion.count({ where }),
      this.superAdmin.scheduleVersion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: SCHEDULE_VERSION_INCLUDE,
      }),
    ]);
    return { total, versions: rows.map((row) => this.serializer.version(row)) };
  }

  async exportPdfForSuperAdmin(
    businessId: string,
    params: { from?: Date; to?: Date },
  ): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const business = await this.superAdmin.business.findUnique({
      where: { id: businessId },
      select: { name: true },
    });
    if (!business) throw new NotFoundException('Business not found.');
    const versions = await this.superAdmin.scheduleVersion.findMany({
      where: historyWhere(businessId, params),
      orderBy: { createdAt: 'asc' },
      include: SCHEDULE_VERSION_INCLUDE,
    });
    return scheduleHistoryPdf(toPdfInput(business.name, params, versions));
  }

  // ---------------------------------------------------------------------------
  // Pending-schedule activation on resume (REQ-151/158)
  // ---------------------------------------------------------------------------

  /**
   * Activate the LATEST pending schedule version as part of a business resume
   * (manual or auto sweep). Runs inside the caller's tenant transaction which
   * already holds the per-business advisory lock. Supersedes the previous
   * ACTIVE and any older PENDING versions, then surfaces affected bookings:
   * conflicts are persisted for email delivery and the grouped SCHEDULE
   * notification is enqueued (doc 13 grouping, 5-minute window).
   */
  async activatePendingSchedule(
    tx: TenantTransaction,
    businessId: string,
    actor: { actorType: 'OWNER' | 'SYSTEM'; actorUserId?: string | null },
  ): Promise<{ activated: boolean; affected: number }> {
    const pending = await tx.scheduleVersion.findMany({
      where: { businessId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (pending.length === 0) return { activated: false, affected: 0 };
    const latest = pending[pending.length - 1];
    if (!latest) return { activated: false, affected: 0 };

    await tx.scheduleVersion.updateMany({
      where: { businessId, status: { in: ['ACTIVE', 'PENDING'] }, id: { not: latest.id } },
      data: { status: 'SUPERSEDED' },
    });
    await tx.scheduleVersion.update({
      where: { id: latest.id },
      data: { status: 'ACTIVE', updatedAt: new Date() },
    });
    void actor;

    const snapshot = await this.snapshotOfVersion(tx, businessId, latest.id);
    const computation = await this.computeAffected(tx, snapshot, businessId);
    if (computation.affected.length > 0) {
      await this.persistConflicts(tx, businessId, latest.id, computation.affected);
      await this.maybeEnqueueAffected(tx, businessId, latest.id, computation.affected);
    }
    return { activated: true, affected: computation.affected.length };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async latestManageableVersion(
    tx: TenantTransaction,
    businessId: string,
  ): Promise<ManageableVersion> {
    const business = await tx.business.findUnique({
      where: { id: businessId },
      select: { isPaused: true },
    });
    if (!business) throw new NotFoundException('Business not found.');
    const row = await tx.scheduleVersion.findFirst({
      where: { businessId, status: { in: ['ACTIVE', 'PENDING'] } },
      orderBy: { createdAt: 'desc' },
      include: SCHEDULE_VERSION_INCLUDE,
    });
    return { row, isPaused: business.isPaused };
  }

  private async createVersion(
    tx: TenantTransaction,
    businessId: string,
    status: 'ACTIVE' | 'PENDING',
    actorUserId: string,
    input: ScheduleInputValue,
  ): Promise<{ id: string }> {
    const version = await tx.scheduleVersion.create({
      data: {
        businessId,
        status,
        actorType: 'OWNER',
        actorUserId,
        reason: input.reason,
        bookingIntervalMinutes: input.bookingIntervalMinutes,
      },
    });
    for (const period of input.workingPeriods) {
      await tx.workingPeriod.create({
        data: {
          scheduleVersionId: version.id,
          businessId,
          dayOfWeek: period.dayOfWeek,
          startMinutes: period.startMinutes,
          endMinutes: period.endMinutes,
        },
      });
    }
    for (const special of input.specialDates) {
      const row = await tx.specialDate.create({
        data: {
          scheduleVersionId: version.id,
          businessId,
          calendarDate: special.date,
          isClosed: special.isClosed,
        },
      });
      for (const period of special.periods) {
        await tx.specialDatePeriod.create({
          data: {
            specialDateId: row.id,
            scheduleVersionId: version.id,
            businessId,
            startMinutes: period.startMinutes,
            endMinutes: period.endMinutes,
          },
        });
      }
    }
    for (const block of input.blockedPeriods) {
      await tx.blockedPeriod.create({
        data: {
          scheduleVersionId: version.id,
          businessId,
          startAt: block.startAt,
          endAt: block.endAt,
          reason: block.reason,
        },
      });
    }
    return { id: version.id };
  }

  private async loadVersionRow(
    tx: TenantTransaction,
    versionId: string,
  ): Promise<ScheduleVersionRow> {
    const row = await tx.scheduleVersion.findUnique({
      where: { id: versionId },
      include: SCHEDULE_VERSION_INCLUDE,
    });
    if (!row)
      throw new ConflictException('Schedule version could not be loaded.', ErrorCodes.CONFLICT);
    return row;
  }

  private async snapshotOfVersion(
    tx: TenantTransaction,
    businessId: string,
    versionId: string,
  ): Promise<ScheduleSnapshot> {
    const row = await tx.scheduleVersion.findUnique({
      where: { id: versionId },
      include: SCHEDULE_VERSION_INCLUDE,
    });
    if (!row || row.businessId !== businessId) {
      throw new NotFoundException('Schedule version not found.');
    }
    return normalizeVersionRow(row);
  }

  /**
   * Fresh recompute of affected bookings against a version snapshot: every
   * active slot-holding booking that no longer fits (and is NOT marked kept for
   * this version) is adversely affected; kept duplicates are returned separately.
   */
  private async computeAffected(
    tx: TenantTransaction,
    snapshot: ScheduleSnapshot,
    businessId: string,
  ): Promise<AffectedComputation> {
    const [bookings, keptRows] = await Promise.all([
      tx.booking.findMany({
        where: { businessId, status: { in: [...AFFECTABLE_BOOKING_STATUSES] } },
        include: { serviceItems: true },
        orderBy: { startAt: 'asc' },
      }),
      tx.scheduleException.findMany({
        where: { businessId, scheduleVersionId: snapshot.versionId },
        select: { bookingId: true },
      }),
    ]);
    const keptIds = new Set(keptRows.map((row) => row.bookingId));
    const affected: AffectedBookingEntry[] = [];
    const kept: AffectedBookingEntry[] = [];
    for (const booking of bookings) {
      const fit = evaluateFit(snapshot, booking.startAt, booking.endAt);
      if (fit.ok) continue;
      const services = booking.serviceItems.map((item) => ({
        name: item.nameSnapshot,
        durationMinutes: item.durationMinutes,
      }));
      const entry: AffectedBookingEntry = {
        bookingId: booking.id,
        customerName: booking.customerName,
        customerPhone: booking.customerPhone,
        startAt: booking.startAt,
        endAt: booking.endAt,
        durationMinutes: services.reduce((sum, s) => sum + s.durationMinutes, 0),
        services,
        reason: VIOLATION_LABELS[fit.reason ?? 'WEEKLY_HOURS'] ?? 'Outside working hours',
        kept: keptIds.has(booking.id),
      };
      (keptIds.has(booking.id) ? kept : affected).push(entry);
    }
    return { affected, kept };
  }

  private async persistConflicts(
    tx: TenantTransaction,
    businessId: string,
    versionId: string,
    entries: AffectedBookingEntry[],
  ): Promise<void> {
    await tx.scheduleConflict.createMany({
      data: entries.map((entry) => ({
        businessId,
        scheduleVersionId: versionId,
        bookingId: entry.bookingId,
        reason: entry.reason,
      })),
      skipDuplicates: true,
    });
  }

  private async historyRows(
    tx: TenantTransaction,
    businessId: string,
    params: { from?: Date; to?: Date },
  ): Promise<ScheduleVersionRow[]> {
    return tx.scheduleVersion.findMany({
      where: historyWhere(businessId, params),
      orderBy: { createdAt: 'asc' },
      include: SCHEDULE_VERSION_INCLUDE,
    });
  }

  /**
   * Grouped owner alert (doc 13 §4/§8): creates a SCHEDULE_AFFECTED_OWNER
   * outbox row, or merges into an existing one for the same business created
   * within the last 5 minutes — appending per-booking entries with dedup by
   * bookingId. Row writes happen inside the caller's transaction; delivery is
   * deferred to the (future) provider pipeline.
   */
  private async maybeEnqueueAffected(
    tx: TenantTransaction,
    businessId: string,
    versionId: string,
    entries: AffectedBookingEntry[],
  ): Promise<void> {
    if (entries.length === 0) return;
    const now = new Date();
    const windowCutoff = new Date(now.getTime() - SCHEDULE_GROUPING_WINDOW_MS);
    const nextEntries: AffectedNotificationEntry[] = entries.map((entry) => ({
      bookingId: entry.bookingId,
      customerName: entry.customerName,
      customerPhone: entry.customerPhone,
      startAt: entry.startAt.toISOString(),
      endAt: entry.endAt.toISOString(),
      durationMinutes: entry.durationMinutes,
      services: entry.services,
      reason: entry.reason,
      managementUrl: `/manage/#/businesses/${businessId}/bookings/${entry.bookingId}`,
      occurredAt: now.toISOString(),
    }));

    const existing = await tx.notification.findFirst({
      where: {
        businessId,
        type: SCHEDULE_AFFECTED_TYPE,
        tenantScope: SCHEDULE_NOTIFICATION_SCOPE,
        createdAt: { gte: windowCutoff },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      const payload = readPayload(existing.payload);
      const existingEntries = Array.isArray(payload.entries) ? (payload.entries as unknown[]) : [];
      const merged = dedupeBookingEntries([
        ...(existingEntries as AffectedNotificationEntry[]),
        ...nextEntries,
      ]);
      await tx.notification.update({
        where: { id: existing.id },
        data: {
          payload: {
            versionId,
            grouped: true,
            entries: merged as unknown as Prisma.InputJsonValue,
          } as Prisma.InputJsonValue,
        },
      });
      return;
    }
    await tx.notification.create({
      data: {
        businessId,
        type: SCHEDULE_AFFECTED_TYPE,
        tenantScope: SCHEDULE_NOTIFICATION_SCOPE,
        payload: {
          versionId,
          grouped: false,
          entries: nextEntries as unknown as Prisma.InputJsonValue,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private currentView(
    manageable: ManageableVersion,
    computation: AffectedComputation,
  ): ScheduleCurrentDto {
    return {
      version: manageable.row ? this.serializer.version(manageable.row) : null,
      isPaused: manageable.isPaused,
      warnings: computation.affected.map((entry) => this.serializer.affected(entry)),
      kept: computation.kept.map((entry) => this.serializer.affected(entry)),
    };
  }
}

function historyWhere(
  businessId: string,
  params: { from?: Date; to?: Date },
): { businessId: string; createdAt?: { gte?: Date; lte?: Date } } {
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (params.from) createdAt.gte = params.from;
  if (params.to) createdAt.lte = params.to;
  return { businessId, ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}) };
}

function readPayload(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return {};
}

function dedupeBookingEntries(entries: AffectedNotificationEntry[]): AffectedNotificationEntry[] {
  const seen = new Set<string>();
  const out: AffectedNotificationEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.bookingId)) continue;
    seen.add(entry.bookingId);
    out.push(entry);
  }
  return out;
}

function keepExceptionView(exception: {
  id: string;
  scheduleVersionId: string;
  reason: string | null;
  createdAt: Date;
}): KeepBookingResultDto['exception'] {
  return {
    id: exception.id,
    scheduleVersionId: exception.scheduleVersionId,
    reason: exception.reason,
    createdAt: exception.createdAt.toISOString(),
  };
}

function toPdfInput(
  businessName: string,
  params: { from?: Date; to?: Date },
  versions: ScheduleVersionRow[],
): SchedulePdfInput {
  return {
    businessName,
    range: { from: params.from, to: params.to },
    versions: versions.map((row, index): PdfVersionData => ({
      ordinal: index + 1,
      status: row.status,
      createdAt: row.createdAt,
      workingPeriods: row.workingPeriods.map((p) => ({
        dayOfWeek: p.dayOfWeek,
        startMinutes: p.startMinutes,
        endMinutes: p.endMinutes,
      })),
      specialDates: row.specialDates.map((s) => ({
        calendarDate: s.calendarDate,
        isClosed: s.isClosed,
        periods: s.periods.map((p) => ({ startMinutes: p.startMinutes, endMinutes: p.endMinutes })),
      })),
      blockedPeriods: row.blockedPeriods.map((b) => ({ startAt: b.startAt, endAt: b.endAt })),
    })),
  };
}
