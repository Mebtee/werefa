import { Module } from '@nestjs/common';
import { PrismaBusinessRepository } from './repositories/prisma-business.repository';
import { PrismaBookingRepository } from './repositories/prisma-booking.repository';
import { PrismaScheduleRepository } from './repositories/prisma-schedule.repository';
import { PrismaPaymentRepository } from './repositories/prisma-payment.repository';
import { PrismaResubmissionVerificationRepository } from './repositories/prisma-resubmission.repository';
import { PrismaSubscriptionRepository } from './repositories/prisma-subscription.repository';
import {
  BUSINESS_REPOSITORY,
  BOOKING_REPOSITORY,
  SCHEDULE_REPOSITORY,
  PAYMENT_REPOSITORY,
  RESUBMISSION_REPOSITORY,
  SUBSCRIPTION_REPOSITORY,
} from './repositories/tokens';

/**
 * Domain repository module. HTTP → service → repository → Prisma → PostgreSQL
 * (doc 03/28). All six core persistence boundaries are now wired:
 * business, booking, schedule (foundation) plus payment, resubmission
 * verification and subscription (Prompt 41 additions).
 */
@Module({
  providers: [
    { provide: BUSINESS_REPOSITORY, useClass: PrismaBusinessRepository },
    { provide: BOOKING_REPOSITORY, useClass: PrismaBookingRepository },
    { provide: SCHEDULE_REPOSITORY, useClass: PrismaScheduleRepository },
    { provide: PAYMENT_REPOSITORY, useClass: PrismaPaymentRepository },
    { provide: RESUBMISSION_REPOSITORY, useClass: PrismaResubmissionVerificationRepository },
    { provide: SUBSCRIPTION_REPOSITORY, useClass: PrismaSubscriptionRepository },
  ],
  exports: [
    BUSINESS_REPOSITORY,
    BOOKING_REPOSITORY,
    SCHEDULE_REPOSITORY,
    PAYMENT_REPOSITORY,
    RESUBMISSION_REPOSITORY,
    SUBSCRIPTION_REPOSITORY,
  ],
})
export class DomainModule {}