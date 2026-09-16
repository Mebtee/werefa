import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, ScheduleVersion } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import {
  ScheduleRepository,
  ScheduleTemplate,
  ScheduleWithDetails,
} from './schedule.repository.port';

@Injectable()
export class PrismaScheduleRepository implements ScheduleRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async createPendingVersion(
    tx: Prisma.TransactionClient,
    args: { businessId: string; versionNo: number; name?: string | null; template: ScheduleTemplate },
  ): Promise<ScheduleVersion> {
    return tx.scheduleVersion.create({
      data: {
        businessId: args.businessId,
        versionNo: args.versionNo,
        name: args.name ?? null,
        status: 'PENDING',
        workingPeriods: {
          create: args.template.workingPeriods.map((w) => ({
            businessId: args.businessId,
            weekday: w.weekday,
            startMinutes: w.startMinutes,
            endMinutes: w.endMinutes,
          })),
        },
        blockedPeriods: {
          create: args.template.blockedPeriods.map((b) => ({
            businessId: args.businessId,
            dayOfWeek: b.dayOfWeek ?? null,
            startMinutes: b.startMinutes ?? null,
            endMinutes: b.endMinutes ?? null,
          })),
        },
        specialDates: {
          create: args.template.specialDates.map((s) => ({
            businessId: args.businessId,
            date: s.date,
            kind: s.kind,
            startMinutes: s.startMinutes ?? null,
            endMinutes: s.endMinutes ?? null,
          })),
        },
      },
    });
  }

  async applyVersion(
    tx: Prisma.TransactionClient,
    args: { versionId: string; businessId: string; appliedBy: string; reason?: string | null },
  ): Promise<ScheduleVersion> {
    return tx.scheduleVersion.update({
      where: { id: args.versionId },
      data: {
        status: 'ACTIVE',
        appliedAt: new Date(),
        appliedBy: args.appliedBy,
        reason: args.reason ?? null,
      },
    });
  }

  async getActiveVersion(businessId: string): Promise<ScheduleWithDetails | null> {
    return this.prisma.scheduleVersion.findFirst({
      where: { businessId, status: 'ACTIVE' },
      orderBy: { versionNo: 'desc' },
      include: { workingPeriods: true, blockedPeriods: true, specialDates: true },
    });
  }

  async listVersions(businessId: string): Promise<ScheduleVersion[]> {
    return this.prisma.scheduleVersion.findMany({
      where: { businessId },
      orderBy: { versionNo: 'asc' },
    });
  }

  async getById(businessId: string, versionId: string): Promise<ScheduleWithDetails | null> {
    return this.prisma.scheduleVersion.findFirst({
      where: { id: versionId, businessId },
      include: { workingPeriods: true, blockedPeriods: true, specialDates: true },
    });
  }

  async nextVersionNo(businessId: string): Promise<number> {
    const latest = await this.prisma.scheduleVersion.findFirst({
      where: { businessId },
      orderBy: { versionNo: 'desc' },
      select: { versionNo: true },
    });
    return (latest?.versionNo ?? 0) + 1;
  }

  async demoteActiveVersions(
    tx: Prisma.TransactionClient,
    args: { businessId: string; replacedAt: Date },
  ): Promise<number> {
    const res = await tx.scheduleVersion.updateMany({
      where: { businessId: args.businessId, status: 'ACTIVE' },
      data: { status: 'PENDING', replacedAt: args.replacedAt },
    });
    return res.count;
  }

  async promotePendingVersion(
    tx: Prisma.TransactionClient,
    args: { versionId: string; businessId: string; appliedBy: string; reason?: string | null },
  ): Promise<boolean> {
    const now = new Date();
    const res = await tx.scheduleVersion.updateMany({
      where: { id: args.versionId, businessId: args.businessId, status: 'PENDING' },
      data: { status: 'ACTIVE', appliedAt: now, appliedBy: args.appliedBy, reason: args.reason ?? null },
    });
    return res.count === 1;
  }

  async setBusinessActiveVersion(
    tx: Prisma.TransactionClient,
    args: { businessId: string; versionId: string | null },
  ): Promise<void> {
    await tx.business.update({
      where: { id: args.businessId },
      data: { activeScheduleVersionId: args.versionId },
    });
  }

  async listPendingVersions(businessId: string): Promise<ScheduleVersion[]> {
    return this.prisma.scheduleVersion.findMany({
      where: { businessId, status: 'PENDING' },
      orderBy: { versionNo: 'asc' },
    });
  }

  async createException(
    tx: Prisma.TransactionClient,
    args: { businessId: string; versionId: string; bookingId: number; createdBy?: string | null },
  ): Promise<import('@prisma/client').ScheduleException> {
    return tx.scheduleException.create({
      data: {
        businessId: args.businessId,
        scheduleVersionId: args.versionId,
        bookingId: args.bookingId,
        createdBy: args.createdBy ?? null,
      },
    });
  }
}