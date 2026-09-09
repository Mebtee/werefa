import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/environment';
import { BusinessModule } from '../business/business.module';
import { IamModule } from '../iam/iam.module';
import { MailService } from './mail.service';
import { NotificationDispatcher } from './notification-dispatcher';
import { telegramProviderFromConfig, TELEGRAM_PROVIDER, type TelegramProvider } from './providers';
import { TelegramConnectionService } from './telegram-connection.service';
import { TelegramPublicController } from './telegram-public.controller';
import { TelegramWebhookController } from './telegram-webhook.controller';

/** Selects the Telegram provider at boot (test → fake, enabled → HTTP, else disabled). */
export function provideTelegramProvider() {
  return {
    provide: TELEGRAM_PROVIDER,
    inject: [APP_CONFIG],
    useFactory: (config: AppConfig): TelegramProvider => {
      const provider = telegramProviderFromConfig(config);
      return provider as TelegramProvider;
    },
  };
}

/**
 * Global notification surface (docs 12/13/14 §2/17): mail + Telegram providers,
 * the delivery pipeline, and the customer Telegram connect webhook/controller.
 */
@Global()
@Module({
  imports: [IamModule, BusinessModule],
  controllers: [TelegramPublicController, TelegramWebhookController],
  providers: [
    MailService,
    NotificationDispatcher,
    TelegramConnectionService,
    provideTelegramProvider(),
  ],
  exports: [MailService, NotificationDispatcher, TelegramConnectionService, TELEGRAM_PROVIDER],
})
export class NotificationsModule {}
