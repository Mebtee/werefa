import { Module } from '@nestjs/common';
import { PrismaBusinessRepository } from './repositories/prisma-business.repository';
import { PrismaBookingRepository } from './repositories/prisma-booking.repository';
import { PrismaScheduleRepository } from './repositories/prisma-schedule.repository';
import { PrismaPaymentRepository } from './repositories/prisma-payment.repository';
import { PrismaResubmissionVerificationRepository } from './repositories/prisma-resubmission.repository';
import { PrismaSubscriptionRepository } from './repositories/prisma-subscription.repository';
import { PrismaUserAuthRepository } from './repositories/prisma-user-auth.repository';
import { PrismaSessionRepository } from './repositories/prisma-session.repository';
import { PrismaEmergencyRecoveryRepository } from './repositories/prisma-emergency-recovery.repository';
import { PrismaSecurityEventAuthRepository } from './repositories/prisma-security-event-auth.repository';
import { PrismaAuditEventAuthRepository } from './repositories/prisma-audit-event-auth.repository';
import {
  BUSINESS_REPOSITORY,
  BOOKING_REPOSITORY,
  SCHEDULE_REPOSITORY,
  PAYMENT_REPOSITORY,
  RESUBMISSION_REPOSITORY,
  SUBSCRIPTION_REPOSITORY,
  USER_AUTH_REPOSITORY,
  SESSION_REPOSITORY,
  EMERGENCY_RECOVERY_REPOSITORY,
  SECURITY_EVENT_AUTH_REPOSITORY,
  AUDIT_EVENT_AUTH_REPOSITORY,
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
    { provide: USER_AUTH_REPOSITORY, useClass: PrismaUserAuthRepository },
    { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
    { provide: EMERGENCY_RECOVERY_REPOSITORY, useClass: PrismaEmergencyRecoveryRepository },
    { provide: SECURITY_EVENT_AUTH_REPOSITORY, useClass: PrismaSecurityEventAuthRepository },
    { provide: AUDIT_EVENT_AUTH_REPOSITORY, useClass: PrismaAuditEventAuthRepository },
  ],
  exports: [
    BUSINESS_REPOSITORY,
    BOOKING_REPOSITORY,
    SCHEDULE_REPOSITORY,
    PAYMENT_REPOSITORY,
    RESUBMISSION_REPOSITORY,
    SUBSCRIPTION_REPOSITORY,
    USER_AUTH_REPOSITORY,
    SESSION_REPOSITORY,
    EMERGENCY_RECOVERY_REPOSITORY,
    SECURITY_EVENT_AUTH_REPOSITORY,
    AUDIT_EVENT_AUTH_REPOSITORY,
  ],
})
export class DomainModule {}