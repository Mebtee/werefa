import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { UnauthenticatedException } from '../common/http/app-error';
import { APP_CONFIG, type AppConfig } from '../config/environment';
import { BusinessService } from '../business/business.service';
import { PrismaService } from '../database/prisma.service';
import { withTenantContext } from '../database/tenant-executor';
import { SecurityEventService } from '../iam/security-events.service';
import { RateLimitService } from '../iam/rate-limit.service';
import { SYSTEM_ACTOR_ID } from '../business/business.service';

const GENERIC_MESSAGE =
  'If a matching booking exists for that phone, check its Telegram status below.';

export interface TelegramConnectRequest {
  phone: string;
}

export interface TelegramStatusView {
  connected: boolean;
}

export interface TelegramConnectResult {
  /** True when an ACTIVE connection already exists for this booking. */
  connected: boolean;
  /** One-time link token (only when a new PENDING connection was issued). */
  token?: string;
  /** Bot handle for building the t.me deep link (when configured). */
  botUsername?: string;
  expiresAt?: Date;
  message: string;
}

/**
 * Customer Telegram connection flow (doc 12 §3/§4, REQ-056/058):
 *
 *  1. `initiate` — public, phone-gated. The caller must prove the booking's
 *     `customer_phone`; a one-time, expiring, non-guessable connect token is
 *     then issued (sha256 hash stored; TTL configurable). Response stays
 *     generic when no booking/phone match so callers cannot enumerate.
 *  2. `handleWebhook` — Telegram POST /start <token> arrives on the webhook
 *     (secret-header authenticated); the chat is bound and the token consumed
 *     atomically. The chat_id comes from Telegram-authenticated update data,
 *     never from the client.
 *  3. `status` / `disconnect` — phone-gated again (RLS pins UPDATEs to
 *     bookings matching the caller's phone).
 *
 * Disconnect never touches the booking or payment state (REQ-058).
 */
@Injectable()
export class TelegramConnectionService {
  private readonly logger = new Logger(TelegramConnectionService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessService,
    private readonly security: SecurityEventService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async initiate(
    slug: string,
    bookingId: string,
    input: TelegramConnectRequest,
    ip?: string,
  ): Promise<TelegramConnectResult> {
    const business = await this.businesses.findBySlug(slug);
    await this.rateLimit.check(
      `tg:connect:${business.id}:${bookingId}`,
      this.config.telegramConnectRateLimitMax,
      this.config.telegramConnectRateLimitWindowMs,
    );

    const ctx = {
      scope: 'PUBLIC' as const,
      businessId: business.id,
      bookingPublic: true,
      customerPhone: input.phone,
    };

    const handle = await withTenantContext(this.prisma, ctx, async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id: bookingId, businessId: business.id },
        select: { id: true, customerPhone: true },
      });
      if (!booking) return { ok: false as const };
      if (booking.customerPhone !== input.phone) return { ok: false as const };

      const existing = await tx.telegramConnection.findUnique({
        where: { bookingId: booking.id },
        select: { id: true, status: true },
      });
      if (existing?.status === 'ACTIVE') {
        return { ok: true as const, connected: true as const, existingId: existing.id };
      }
      return { ok: true as const, connected: false as const, existingId: existing?.id };
    });

    if (!handle.ok) {
      await this.security.record({
        type: 'TELEGRAM_PHONE_MISMATCH',
        businessId: business.id,
        ip,
        result: 'FAILURE',
      });
      this.logger.warn(`Telegram connect denied for booking ${bookingId} (no phone match)`);
      return { connected: false, message: GENERIC_MESSAGE };
    }
    if (handle.connected) {
      return { connected: true, message: 'This booking is already connected to Telegram.' };
    }

    const token = createConnectToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + this.config.telegramTokenTtlMinutes * 60_000);

    await withTenantContext(this.prisma, ctx, async (tx) => {
      if (handle.existingId) {
        await tx.telegramConnection.update({
          where: { id: handle.existingId },
          data: {
            status: 'PENDING',
            connectTokenHash: tokenHash,
            connectTokenExpiresAt: expiresAt,
            chatId: null,
          },
        });
      } else {
        const created = await tx.telegramConnection.create({
          data: {
            businessId: business.id,
            bookingId,
            status: 'PENDING',
            connectTokenHash: tokenHash,
            connectTokenExpiresAt: expiresAt,
          },
        });
        void created;
      }
    });

    await this.security.record({
      type: 'TELEGRAM_CONNECT_INITIATED',
      businessId: business.id,
      ip,
      result: 'SUCCESS',
    });

    return {
      connected: false,
      token,
      botUsername: this.config.telegramBotUsername,
      expiresAt,
      message: 'Open the link in Telegram to receive updates about this booking.',
    };
  }

  async status(
    slug: string,
    bookingId: string,
    input: TelegramConnectRequest,
  ): Promise<TelegramStatusView> {
    const business = await this.businesses.findBySlug(slug);
    await this.rateLimit.check(
      `tg:status:${business.id}:${bookingId}`,
      this.config.telegramConnectRateLimitMax,
      this.config.telegramConnectRateLimitWindowMs,
    );
    const ctx = {
      scope: 'PUBLIC' as const,
      businessId: business.id,
      bookingPublic: true,
      customerPhone: input.phone,
    };
    return withTenantContext(this.prisma, ctx, async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id: bookingId, businessId: business.id, customerPhone: input.phone },
        select: { id: true },
      });
      if (!booking) return { connected: false };
      const connection = await tx.telegramConnection.findUnique({
        where: { bookingId: booking.id },
        select: { status: true },
      });
      return { connected: connection?.status === 'ACTIVE' };
    });
  }

  async disconnect(
    slug: string,
    bookingId: string,
    input: TelegramConnectRequest,
    ip?: string,
  ): Promise<{ message: string }> {
    const business = await this.businesses.findBySlug(slug);
    await this.rateLimit.check(
      `tg:disconnect:${business.id}:${bookingId}`,
      this.config.telegramConnectRateLimitMax,
      this.config.telegramConnectRateLimitWindowMs,
    );
    const ctx = {
      scope: 'PUBLIC' as const,
      businessId: business.id,
      bookingPublic: true,
      customerPhone: input.phone,
    };

    const disconnected = await withTenantContext(this.prisma, ctx, async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id: bookingId, businessId: business.id, customerPhone: input.phone },
        select: { id: true },
      });
      if (!booking) return false;
      const connection = await tx.telegramConnection.findUnique({
        where: { bookingId: booking.id },
        select: { id: true, status: true },
      });
      if (!connection || connection.status === 'REVOKED') return true;
      await tx.telegramConnection.update({
        where: { id: connection.id },
        data: { status: 'REVOKED', connectTokenHash: null, connectTokenExpiresAt: null },
      });
      return true;
    });

    if (!disconnected) {
      return { message: GENERIC_MESSAGE };
    }
    await this.security.record({
      type: 'TELEGRAM_DISCONNECTED',
      businessId: business.id,
      ip,
      result: 'SUCCESS',
    });
    return { message: 'Telegram updates disconnected.' };
  }

  /**
   * Webhook entry point (doc 12 §5). Authenticates via the shared secret header,
   * deduplicates update ids (at-most-once), and binds a chat to a booking using
   * an unexpired, unconsumed connect token. Returns `{ ok: true }` in every
   * legitimately-processed case (Telegram contract); unauthorized calls get 401.
   */
  async handleWebhook(
    raw: unknown,
    secretHeader: string | undefined,
    ip?: string,
  ): Promise<{ ok: true }> {
    if (!this.config.telegramWebhookSecret || !secretHeader) {
      await this.recordWebhookDenied(ip);
      throw new UnauthenticatedException('Telegram webhook rejected (missing secret).');
    }
    if (!secretsMatch(secretHeader, this.config.telegramWebhookSecret)) {
      await this.recordWebhookDenied(ip);
      throw new UnauthenticatedException('Telegram webhook rejected (invalid secret).');
    }
    await this.rateLimit.check(
      `tg:webhook:${ip ?? 'unknown'}`,
      this.config.telegramWebhookRateLimitMax,
      this.config.telegramWebhookRateLimitWindowMs,
    );

    const update = parseTelegramUpdate(raw);
    if (!update) throw new UnauthenticatedException('Invalid Telegram update payload.');

    // At-most-once: unique update_id insert (platform-level table, no RLS).
    const processed = await this.prisma.telegramUpdate
      .create({ data: { updateId: update.updateId } })
      .then(() => true)
      .catch((err) => {
        const code = (err as { code?: string })?.code;
        if (code === 'P2002') return false; // already processed
        throw err;
      });
    if (!processed) return { ok: true };

    const command = parseStartCommand(update.text);
    if (!command) return { ok: true }; // non-command message: ignore

    const outcome = await this.bindChatByToken(command, update.chatId, ip);
    if (outcome.type === 'linked') {
      await this.security.record({
        type: 'TELEGRAM_CONNECTED',
        businessId: outcome.businessId,
        ip,
        result: 'SUCCESS',
      });
      this.logger.log(`Telegram chat ${update.chatId} bound to booking ${outcome.bookingId}`);
    } else if (outcome.type === 'expired') {
      await this.security.record({
        type: 'TELEGRAM_TOKEN_EXPIRED',
        businessId: outcome.businessId,
        ip,
        result: 'FAILURE',
      });
    } else if (outcome.type === 'invalid') {
      await this.security.record({
        type: 'TELEGRAM_LINK_INVALID',
        ip,
        result: 'FAILURE',
      });
    }
    return { ok: true };
  }

  private async recordWebhookDenied(ip?: string): Promise<void> {
    await this.security.record({ type: 'TELEGRAM_WEBHOOK_DENIED', ip, result: 'DENIED' });
  }

  private async bindChatByToken(
    token: string,
    chatId: bigint,
    ip?: string,
  ): Promise<
    | { type: 'linked'; businessId: string; bookingId: string }
    | { type: 'expired'; businessId: string }
    | { type: 'invalid' }
  > {
    const tokenHash = hashToken(token);
    return withTenantContext(
      this.prisma,
      { userId: SYSTEM_ACTOR_ID, scope: 'SUPER_ADMIN' },
      async (tx) => {
        const connection = await tx.telegramConnection.findFirst({
          where: { connectTokenHash: tokenHash, status: 'PENDING' },
          select: { id: true, businessId: true, bookingId: true, connectTokenExpiresAt: true },
        });
        if (!connection) {
          void ip;
          return { type: 'invalid' as const };
        }
        if (
          connection.connectTokenExpiresAt !== null &&
          connection.connectTokenExpiresAt.getTime() < Date.now()
        ) {
          await tx.telegramConnection.update({
            where: { id: connection.id },
            data: { status: 'EXPIRED', connectTokenHash: null, connectTokenExpiresAt: null },
          });
          return { type: 'expired' as const, businessId: connection.businessId };
        }

        await tx.telegramConnection.update({
          where: { id: connection.id },
          data: {
            status: 'ACTIVE',
            chatId,
            connectTokenHash: null,
            connectTokenExpiresAt: null,
          },
        });
        return {
          type: 'linked' as const,
          businessId: connection.businessId,
          bookingId: connection.bookingId,
        };
      },
    );
  }
}

export interface TelegramUpdateView {
  updateId: bigint;
  chatId: bigint;
  text?: string;
}

/** Defensive parser for the Telegram update envelope (doc 12 §5). */
export function parseTelegramUpdate(raw: unknown): TelegramUpdateView | null {
  if (!raw || typeof raw !== 'object') return null;
  const root = raw as Record<string, unknown>;
  if (typeof root.update_id !== 'number' && typeof root.update_id !== 'string') return null;
  const updateId = toBigInt(root.update_id);
  if (updateId === null) return null;

  const message = root.message as Record<string, unknown> | undefined;
  if (!message || typeof message !== 'object') return null;
  const chat = message.chat as Record<string, unknown> | undefined;
  if (!chat || typeof chat !== 'object') return null;
  const chatId = toBigInt(chat.id);
  if (chatId === null) return null;

  const text = typeof message.text === 'string' ? message.text : undefined;
  return { updateId, chatId, text };
}

/** Parse `/start <token>` (case-insensitive command) from a message text. */
export function parseStartCommand(text: string | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  const m = trimmed.match(/^\/start\s+(\S+)/i);
  return m?.[1] ?? null;
}

function toBigInt(value: unknown): bigint | null {
  try {
    const v = typeof value === 'number' ? BigInt(Math.round(value)) : BigInt(String(value));
    return v;
  } catch {
    return null;
  }
}

function secretsMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 256-bit, URL-safe, non-guessable connect token (43 chars base64url). */
export function createConnectToken(): string {
  return randomBytes(32).toString('base64url');
}

/** sha256 hex digest persisted on the connection (raw token never stored). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
