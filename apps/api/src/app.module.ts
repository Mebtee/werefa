import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from './config/config.module';
import { LoggerModule } from './common/logger/logger.module';
import { PrismaModule } from './database/prisma.module';
import { IamModule } from './iam/iam.module';
import { BusinessModule } from './business/business.module';
import { ServiceModule } from './service/service.module';
import { BookingModule } from './booking/booking.module';
import { ScheduleModule } from './schedule/schedule.module';
import { StorageModule } from './storage/storage.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { NotificationsModule } from './notifications/notifications.module';
import { CsrfGuard } from './common/guards/csrf.guard';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    PrismaModule,
    IamModule,
    BusinessModule,
    ServiceModule,
    BookingModule,
    ScheduleModule,
    StorageModule,
    HealthModule,
    JobsModule,
    NotificationsModule,
  ],
  providers: [
    // SameSite=Lax cookie + required custom header on state-changing calls.
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AppModule {}
