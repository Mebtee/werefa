import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { BusinessModule } from '../business/business.module';
import { JobsModule } from '../jobs/jobs.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { BookingAdminController, BookingSuperAdminController } from './booking-admin.controller';
import { BookingController } from './booking.controller';
import {
  BookingPublicController,
  BookingResubmissionController,
} from './booking-public.controller';
import { BookingService } from './booking.service';
import { BookingPublicService } from './booking-public.service';
import { BookingResubmissionService } from './booking-resubmission.service';
import { BookingAdminService } from './booking-admin.service';
import { BookingAvailabilityService } from './booking-availability';
import { BookingNotificationService } from './booking-notifications';
import { BookingPricingService } from './booking-pricing';
import { BookingSerializer } from './booking.serializer';
import { SuperAdminPrismaService } from './super-admin.prisma.service';
import { InMemoryVerificationCodeChannel } from './verification-code.channel';
import { BookingLifecycleJob } from '../jobs/booking-lifecycle.job';

/**
 * Booking domain module (Prompt 11, Domains 5/6/10/11).
 *
 * - Public: availability + create (T1) + rejected-proof resubmission (T10).
 * - Owner: accept/reject/cancel/reschedule/no-show/release-slot + lists.
 * - Admin/Super Admin: cross-business status/audit views + batch completion via
 *   the elevated `app_superadmin` connection.
 * - Lifecycle: auto-complete + reminder sweeps registered into the job queue.
 */
@Module({
  imports: [IamModule, BusinessModule, JobsModule, ScheduleModule],
  controllers: [
    BookingController,
    BookingPublicController,
    BookingResubmissionController,
    BookingAdminController,
    BookingSuperAdminController,
  ],
  providers: [
    BookingService,
    BookingPublicService,
    BookingResubmissionService,
    BookingAdminService,
    BookingAvailabilityService,
    BookingNotificationService,
    BookingPricingService,
    BookingSerializer,
    SuperAdminPrismaService,
    InMemoryVerificationCodeChannel,
    BookingLifecycleJob,
  ],
  exports: [BookingNotificationService, BookingPricingService],
})
export class BookingModule {}
