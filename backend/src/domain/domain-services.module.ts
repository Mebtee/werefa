import { Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { CONFIG } from '../config/config.constants';
import { DomainModule } from './domain.module';
import { TenantGuard } from './authorization/tenant-guard';
import { GLOBAL_CLOCK } from './time/global-clock';
import { IntlGlobalClock } from './time/global-clock';
import { DOMAIN_EVENT_BUS } from './events/domain-events';
import { BusinessService } from './services/business.service';
import { CatalogService } from './services/catalog.service';
import { ScheduleService } from './services/schedule.service';
import { AvailabilityService } from './services/availability.service';
import { BookingService } from './services/booking.service';
import { ResubmissionService } from './services/resubmission.service';
import { SubscriptionService } from './services/subscription.service';
import { SubscriptionBillingService } from './services/subscription-billing.service';
import { BusinessLifecycleWorker } from './services/business-lifecycle.worker';
import { CustomerStatusService } from './services/customer-status.service';
import { AuthService } from './services/auth.service';
import { RecoveryService } from './services/recovery.service';
import { AdminManagementService } from './services/admin-management.service';
import { TELEGRAM_PROVIDER } from './notifications/telegram-provider.port';
import { HttpTelegramProvider } from './notifications/http-telegram-provider';
import { DisabledTelegramProvider } from './notifications/disabled-telegram-provider';
import { EMAIL_PROVIDER } from './notifications/email-provider.port';
import { DisabledEmailProvider } from './notifications/disabled-email-provider';
import { NotificationMessageRenderer } from './notifications/notification-message-renderer';
import { NotificationOutboxEventBus } from './notifications/notification-outbox-event-bus';
import { TelegramConnectionService } from './notifications/telegram-connection.service';
import { TelegramCallbackService } from './notifications/telegram-callback.service';
import { NotificationDeliveryService } from './notifications/notification-delivery.service';
import { NotificationBackgroundWorker } from './notifications/notification-background.worker';
import { TelegramWebhookService } from './notifications/telegram-webhook.service';

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
      useClass: NotificationOutboxEventBus,
    },
    {
      // Fail-safe transport: HTTP Bot API adapter when enabled, otherwise a
      // no-op adapter so any accidental sweep is harmless (never a silent
      // success — write-time gating marks deliveries SUPPRESSED).
      provide: TELEGRAM_PROVIDER,
      inject: [CONFIG],
      useFactory: (config: AppConfig) =>
        config.telegramEnabled
          ? new HttpTelegramProvider(
              config.telegramBotToken ?? '',
              config.telegramBotWebhookSecret ?? '',
              config.telegramBotWebhookUrl,
            )
          : new DisabledTelegramProvider(),
    },
    {
      // No provider is selected until deployment approves and configures one.
      // This binding is deliberately unable to report email acceptance.
      provide: EMAIL_PROVIDER,
      useClass: DisabledEmailProvider,
    },
    TenantGuard,
    BusinessService,
    CatalogService,
    ScheduleService,
    AvailabilityService,
    BookingService,
    ResubmissionService,
    SubscriptionService,
    SubscriptionBillingService,
    CustomerStatusService,
    AuthService,
    RecoveryService,
    AdminManagementService,
    NotificationMessageRenderer,
    NotificationOutboxEventBus,
    TelegramConnectionService,
    TelegramCallbackService,
    NotificationDeliveryService,
    NotificationBackgroundWorker,
    BusinessLifecycleWorker,
    TelegramWebhookService,
  ],
  exports: [
    GLOBAL_CLOCK,
    DOMAIN_EVENT_BUS,
    TELEGRAM_PROVIDER,
    EMAIL_PROVIDER,
    TenantGuard,
    BusinessService,
    CatalogService,
    ScheduleService,
    AvailabilityService,
    BookingService,
    ResubmissionService,
    SubscriptionService,
    SubscriptionBillingService,
    CustomerStatusService,
    AuthService,
    RecoveryService,
    AdminManagementService,
    NotificationMessageRenderer,
    NotificationOutboxEventBus,
    TelegramConnectionService,
    TelegramCallbackService,
    NotificationDeliveryService,
    TelegramWebhookService,
  ],
})
export class DomainServicesModule {}