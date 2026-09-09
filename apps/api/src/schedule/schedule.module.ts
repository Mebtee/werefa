import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { SuperAdminPrismaService } from '../booking/super-admin.prisma.service';
import { ScheduleController } from './schedule.controller';
import { ScheduleSuperAdminController } from './schedule-super-admin.controller';
import { ScheduleService } from './schedule.service';
import { ScheduleAvailabilityService } from './schedule-availability.service';
import { ScheduleSerializer } from './schedule.serializer';

/**
 * Scheduling Management module (Prompt 12 — Domains 12/13/16, docs 10/13/21).
 *
 * - Owner: versioned schedule editing, affected-bookings quick actions, keep
 *   exceptions, history + PDF export.
 * - Super Admin: cross-business history + export (REQ-167/170) via the
 *   elevated `app_superadmin` connection.
 * - Cross-domain: `ScheduleAvailabilityService` is exported for the public
 *   booking flow and owner reschedule (the window gate); `ScheduleService` is
 *   exported for pause/resume pending-schedule activation in BusinessService.
 *
 * No imports from Booking/Business modules — dependency arrows stay acyclic
 * (IamModule only).
 */
@Module({
  imports: [IamModule],
  controllers: [ScheduleController, ScheduleSuperAdminController],
  providers: [
    ScheduleService,
    ScheduleAvailabilityService,
    ScheduleSerializer,
    SuperAdminPrismaService,
  ],
  exports: [ScheduleAvailabilityService, ScheduleService],
})
export class ScheduleModule {}
