import { Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { CONFIG } from '../config/config.constants';
import { DomainModule } from './domain.module';
import { TenantGuard } from './authorization/tenant-guard';
import { GLOBAL_CLOCK } from './time/global-clock';
import { IntlGlobalClock } from './time/global-clock';
import { DOMAIN_EVENT_BUS } from './events/domain-events';
import { InMemoryEventBus } from './events/domain-events';
import { BusinessService } from './services/business.service';
import { CatalogService } from './services/catalog.service';
import { ScheduleService } from './services/schedule.service';
import { AvailabilityService } from './services/availability.service';
import { BookingService } from './services/booking.service';
import { ResubmissionService } from './services/resubmission.service';
import { SubscriptionService } from './services/subscription.service';
import { CustomerStatusService } from './services/customer-status.service';
import { AuthService } from './services/auth.service';
import { RecoveryService } from './services/recovery.service';
import { AdminManagementService } from './services/admin-management.service';

/**
 * Domain/application services module (Prompt 41). Services implement the
 * business rules on top of the Prompt 40 repository boundaries and publish
 * typed domain events after the owning transaction commits (doc 03).
 */
@Module({
  imports: [DomainModule],
  providers: [
    {
      provide: GLOBAL_CLOCK,
      inject: [CONFIG],
      useFactory: (config: AppConfig) => new IntlGlobalClock(config.productParameters.appTimezone),
    },
    {
      provide: DOMAIN_EVENT_BUS,
      useClass: InMemoryEventBus,
    },
    TenantGuard,
    BusinessService,
    CatalogService,
    ScheduleService,
    AvailabilityService,
    BookingService,
    ResubmissionService,
    SubscriptionService,
    CustomerStatusService,
    AuthService,
    RecoveryService,
    AdminManagementService,
  ],
  exports: [
    GLOBAL_CLOCK,
    DOMAIN_EVENT_BUS,
    TenantGuard,
    BusinessService,
    CatalogService,
    ScheduleService,
    AvailabilityService,
    BookingService,
    ResubmissionService,
    SubscriptionService,
    CustomerStatusService,
    AuthService,
    RecoveryService,
    AdminManagementService,
  ],
})
export class DomainServicesModule {}