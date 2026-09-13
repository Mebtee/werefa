import { SYSTEM_ACTOR_ID } from '../business/business.service';
import { PrismaService } from '../database/prisma.service';
import { withTenantContext } from '../database/tenant-executor';
import { TELEGRAM_PROVIDER, type TelegramProvider } from '../notifications/providers';

/**
 * Verification-code delivery seam (REQ-109 / doc 08 §9.2/§9.4). The code is
 * issued and its sha256 hash persisted on `resubmission_verification`, but the
 * PLAINTEXT rides this channel exactly once and is never stored or logged.
 *
 * Approved delivery rule (doc 08 §9.2): "via the approved Telegram channel if
 * connected, else email if held, else no code path". A booking carries no
 * customer email (`CreateBookingInput` = name/phone/note), so the only real
 * production path is the booking's ACTIVE customer Telegram chat.
 * `deliver()` returns `true` only when the message was actually sent; `false`
 * means no approved code path or the provider rejected the send — the caller
 * MUST then void the issued code so it can never be consumed.
 *
 * `InMemoryVerificationCodeChannel` is the architected TEST-ONLY double: it
 * captures what would be sent and is never wired into the module graph.
 */
export interface CodeDeliveryInput {
  businessId: string;
  bookingId: string;
  phone: string;
  code: string;
  purpose: string;
  ttlMinutes: number;
}

export interface VerificationCodeChannel {
  /** True only when a real delivery path existed and the send succeeded. */
  deliver(input: CodeDeliveryInput): Promise<boolean>;
}

export const VERIFICATION_CODE_CHANNEL = Symbol('VERIFICATION_CODE_CHANNEL');

/** Test-only in-memory double: records deliveries; never wired in prod. */
export class InMemoryVerificationCodeChannel implements VerificationCodeChannel {
  readonly sent: (CodeDeliveryInput & { sentAt: Date })[] = [];

  /** Test knob: simulate "no code path / send failure" so callers void the code. */
  failDelivery = false;

  async deliver(input: CodeDeliveryInput): Promise<boolean> {
    if (this.failDelivery) return false;
    this.sent.push({ ...input, sentAt: new Date() });
    return true;
  }
}

/**
 * Production channel: deliver the code to the booking's customer over the
 * ACTIVE Telegram chat (doc 08 §9.2). Non-ACTIVE / missing connection, or a
 * provider-rejected send, yields `false` → the caller voids the code.
 */
export class TelegramVerificationCodeChannel implements VerificationCodeChannel {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramProvider,
  ) {}

  async deliver(input: CodeDeliveryInput): Promise<boolean> {
    const connection = await withTenantContext(
      this.prisma,
      { userId: SYSTEM_ACTOR_ID, scope: 'SUPER_ADMIN' },
      (tx) =>
        tx.telegramConnection.findUnique({
          where: { bookingId: input.bookingId },
          select: { status: true, chatId: true },
        }),
    );
    if (!connection || connection.status !== 'ACTIVE' || connection.chatId === null) {
      return false;
    }
    const failure = await this.telegram.sendMessage({
      chatId: connection.chatId,
      text: renderVerificationCodeTelegram(input.code, input.ttlMinutes).text,
    });
    return failure === null;
  }
}

/** Selects the verification-code channel at boot (mirrors provideTelegramProvider). */
export function provideVerificationCodeChannel() {
  return {
    provide: VERIFICATION_CODE_CHANNEL,
    inject: [TELEGRAM_PROVIDER, PrismaService],
    useFactory: (telegram: TelegramProvider, prisma: PrismaService): VerificationCodeChannel => {
      return new TelegramVerificationCodeChannel(prisma, telegram);
    },
  };
}

/**
 * Customer-facing Telegram text for a verification code. Plain text, no links,
 * no business/booking details (anti-enumeration: the code itself proves the
 * booking). The TTL and single-use semantics are stated so a leaked screenshot
 * cannot be silently reused.
 */
export function renderVerificationCodeTelegram(code: string, ttlMinutes: number): { text: string } {
  return {
    text:
      `Werefa booking verification code: ${code}. ` +
      `It expires in ${ttlMinutes} minutes and can only be used once.`,
  };
}
