/**
 * Production verification-code channel (REQ-230; canonical Section 23.3).
 *
 * Delivers the plaintext one-time code to the booking customer's connected
 * Telegram chat via the existing `TelegramProvider` boundary. The plaintext is
 * handed straight to the provider and never persisted or logged; the row only
 * ever stores its SHA-256 hash.
 *
 * The channel is deliberately shape-only, like the rest of the Telegram
 * boundary: message construction and routing live here, transport lives in the
 * provider.
 */

import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CONFIG, PRISMA_CLIENT } from '../../config/config.constants';
import { AppConfig } from '../../config/app-config';
import { TelegramProvider, TELEGRAM_PROVIDER } from './telegram-provider.port';
import {
  VerificationCodeChannel,
  VerificationCodeDeliveryInput,
  VerificationCodeDeliveryResult,
} from './verification-code-channel.port';

@Injectable()
export class TelegramVerificationCodeChannel implements VerificationCodeChannel {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(TELEGRAM_PROVIDER) private readonly provider: TelegramProvider,
  ) {}

  async deliver(input: VerificationCodeDeliveryInput): Promise<VerificationCodeDeliveryResult> {
    if (!this.config.telegramEnabled) return 'CHANNEL_DISABLED';

    // The customer's connected chat for THIS business + phone is the approved
    // channel (Section 23.3). A revoked/absent connection is "no channel".
    const connection = await this.prisma.telegramConnection.findFirst({
      where: {
        businessId: input.businessId,
        customerPhone: input.customerPhone,
        kind: 'CUSTOMER',
        state: 'CONNECTED',
      },
      orderBy: { connectedAt: 'desc' },
      select: { chatId: true },
    });
    if (!connection) return 'NO_CHANNEL';

    const sent = await this.provider.sendMessage({
      chatId: connection.chatId,
      text:
        `Werefa verification code: ${input.code}\n` +
        'Enter this code to resubmit your payment proof. It expires in 10 minutes.',
    });
    // A provider refusal means the code did not reach the customer, so it is
    // treated as "no channel" and the caller voids it.
    return sent.ok ? 'DELIVERED' : 'NO_CHANNEL';
  }
}
