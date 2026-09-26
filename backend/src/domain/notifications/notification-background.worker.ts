/**
 * Notification background worker (Prompt 51).
 *
 * Runs only when TELEGRAM_ENABLED=true (fail-safe: a disabled channel has
 * nothing pending — write-time gating suppresses every delivery). On bootstrap
 * it (re)registers the bot webhook and then sweeps outbox + reminders on the
 * configured interval. The timer is unref'd so it never keeps the process
 * alive; sweep failures are recorded and never thrown (REQ-056).
 */

import { Inject, Injectable, Optional, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Logger } from 'pino';
import { CONFIG } from '../../config/config.constants';
import { AppConfig } from '../../config/app-config';
import { LOGGER } from '../../common/logging/logging.module';
import { TELEGRAM_PROVIDER, TelegramProvider } from './telegram-provider.port';
import { NotificationDeliveryService } from './notification-delivery.service';

@Injectable()
export class NotificationBackgroundWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(TELEGRAM_PROVIDER) private readonly provider: TelegramProvider,
    private readonly delivery: NotificationDeliveryService,
    @Optional() @Inject(LOGGER) private readonly logger?: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.telegramEnabled) return;
    await this.safeRun('telegram webhook registration', async () => this.provider.registerWebhook());
    const interval = this.config.telegramDeliveryIntervalMs;
    this.timer = setInterval(
      () => void this.safeRun('notification delivery sweep', () => this.delivery.sweep()),
      interval,
    );
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async safeRun(label: string, task: () => Promise<unknown>): Promise<void> {
    try {
      await task();
    } catch (err) {
      // best-effort by design: a background failure must never take the API down.
      // Keep it observable without logging values that could carry secrets.
      this.logger?.warn(
        { err: err instanceof Error ? err.message : String(err) },
        `notification background ${label} failed`,
      );
    }
  }
}