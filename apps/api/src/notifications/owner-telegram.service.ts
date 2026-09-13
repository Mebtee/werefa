import { Inject, Injectable, Logger } from '@nestjs/common';
import { ErrorCodes } from '@werefa/shared';
import type { TelegramConnectionStatus } from '@prisma/client';
import { AppException } from '../common/http/app-error';
import { APP_CONFIG, type AppConfig } from '../config/environment';
import { PrismaService } from '../database/prisma.service';
import { withOwnerBusinessContext, withSuperAdminContext } from '../database/tenant-executor';
import type { ActorContext } from '../common/context/actor-context';
import { SecurityEventService } from '../iam/security-events.service';
import { RateLimitService } from '../iam/rate-limit.service';
import { BookingService } from '../booking/booking.service';
import { SYSTEM_ACTOR_ID } from '../business/business.service';
import { createConnectToken, hashToken } from './telegram-connection.service';
import { TELEGRAM_PROVIDER, type TelegramProvider } from './providers';

const GENERIC_CALLBACK_REPLY = 'This action is no longer available.';

export interface OwnerTelegramConnectResult {
  connected: boolean;
  token?: string;
  botUsername?: string;
  expiresAt?: Date;
  message: string;
}

export interface OwnerTelegramStatusView {
  connected: boolean;
}

/** Reply messages for the durable callback workflow (never reveal raw tokens). */
const REJECT_REASON_PROMPT = 'Send the rejection reason as a text message (up to 500 characters).';

/** Discriminated result of the two-step reject reason lookup (never ambiguous). */
type PendingReasonOutcome =
  | { kind: 'none' }
  | { kind: 'unauthorized' }
  | { kind: 'reused' }
  | {
      kind: 'ready';
      row: { businessId: string; userId: string; bookingId: string };
    };

/**
 * Owner Telegram payment-verification flows (Prompt 23, REQ-065/066/067/068,
 * REQ-120). Works in tandem with the notification outbox:
 *
 *  - The dispatcher issues single-use, expiring, opaque action tokens
 *    (`pv:<kind>:<token>`) and embeds them in the Accept/Reject inline
 *    keyboard of the proof message. The raw token exists only in the chat; its
 *    sha256 hash is stored in `owner_telegram_action`.
 *  - `handleCallback` claims the action atomically (ISSUED → CONSUMED for
 *    Accept, ISSUED → AWAITING_REASON for the two-step Reject) and then
 *    executes the SAME authoritative dashboard service (`BookingService`),
 *    invoked with the owner's identity (REQ-120 — the bot holds no special
 *    power, it just proves "the connected owner for this business pressed a
 *    button").
 *  - Rejection wraps in a mandatory-reason step: the proof message asks for
 *    the reason and the next plain-text message from this chat completes the
 *    revoke against the same `BookingService.reject` (mirrors the dashboard
 *    `parseRejectInput` contract: non-empty, trimmed, ≤ 500 characters).
 *
 * Everything runs under the elevated SUPER_ADMIN scope because the row set is
 * small and heavily guarded (RLS: only the platform can mutate these rows;
 * `business_owner_telegram_connection` owner writes require `user_id = acting
 * owner` + business membership). Chat-relation checks happen against the
 * Telegram-authenticated `chatId`, never client-supplied ids.
 */
@Injectable()
export class OwnerTelegramService {
  private readonly logger = new Logger(OwnerTelegramService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    @Inject(TELEGRAM_PROVIDER) private readonly telegram: TelegramProvider,
    private readonly bookings: BookingService,
    private readonly security: SecurityEventService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** Dashboard connect (owner, REQ-066): issue a fresh one-time link token. */
  async initiate(
    actor: ActorContext,
    businessId: string,
    ip?: string,
  ): Promise<OwnerTelegramConnectResult> {
    await this.rateLimit.check(
      `tg:owner-connect:${actor.userId}:${businessId}`,
      this.config.telegramConnectRateLimitMax,
      this.config.telegramConnectRateLimitWindowMs,
    );
    const token = createConnectToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + this.config.telegramTokenTtlMinutes * 60_000);

    const connected = await withOwnerBusinessContext(
      this.prisma,
      actor.userId,
      businessId,
      async (tx) => {
        const existing = await tx.businessOwnerTelegramConnection.findFirst({
          where: { businessId, userId: actor.userId },
          select: { id: true, status: true },
        });
        if (existing?.status === 'ACTIVE') return true;
        const data = {
          status: 'PENDING' as TelegramConnectionStatus,
          connectTokenHash: tokenHash,
          connectTokenExpiresAt: expiresAt,
          chatId: null,
          connectedAt: null,
        };
        if (existing) {
          await tx.businessOwnerTelegramConnection.update({
            where: { id: existing.id },
            data,
          });
        } else {
          await tx.businessOwnerTelegramConnection.create({
            data: { businessId, userId: actor.userId, ...data },
          });
        }
        return false;
      },
    );

    if (connected) {
      return { connected: true, message: 'Telegram is already connected for this business.' };
    }

    await this.security.record({
      type: 'TELEGRAM_OWNER_CONNECT_INITIATED',
      userId: actor.userId,
      businessId,
      ip,
      result: 'SUCCESS',
    });
    return {
      connected: false,
      token,
      botUsername: this.config.telegramBotUsername,
      expiresAt,
      message: 'Open the link in Telegram to receive payment proof notifications.',
    };
  }

  async status(actor: ActorContext, businessId: string): Promise<OwnerTelegramStatusView> {
    const connection = await withOwnerBusinessContext(
      this.prisma,
      actor.userId,
      businessId,
      async (tx) =>
        tx.businessOwnerTelegramConnection.findFirst({
          where: { businessId, userId: actor.userId },
          select: { status: true },
        }),
    );
    return { connected: connection?.status === 'ACTIVE' };
  }

  /** Dashboard disconnect (owner). Never touches booking/payment state. */
  async disconnect(
    actor: ActorContext,
    businessId: string,
    ip?: string,
  ): Promise<{ message: string }> {
    await withOwnerBusinessContext(this.prisma, actor.userId, businessId, async (tx) => {
      const connection = await tx.businessOwnerTelegramConnection.findFirst({
        where: { businessId, userId: actor.userId },
        select: { id: true },
      });
      if (connection) {
        await tx.businessOwnerTelegramConnection.update({
          where: { id: connection.id },
          data: {
            status: 'REVOKED',
            connectTokenHash: null,
            connectTokenExpiresAt: null,
            chatId: null,
            connectedAt: null,
          },
        });
      }
    });
    await this.security.record({
      type: 'TELEGRAM_OWNER_DISCONNECTED',
      userId: actor.userId,
      businessId,
      ip,
      result: 'SUCCESS',
    });
    return { message: 'Telegram payment notifications disconnected.' };
  }

  /**
   * Bind the chat that pressed `/start <token>` (webhook). Verifies the token
   * inside a SUPER_ADMIN transaction and marks the connection ACTIVE. A
   * PENDING token can only ever bind once (single row, `@@unique`), and the
   * `@@unique([userId, chatId])` constraint prevents one chat silently taking
   * over a second business of the same owner.
   */
  async bindOwnerChat(
    token: string,
    chatId: bigint,
    ip?: string,
  ): Promise<
    | { type: 'linked'; businessId: string }
    | { type: 'expired'; businessId: string }
    | { type: 'invalid' }
  > {
    const tokenHash = hashToken(token);
    return withSuperAdminContext(this.prisma, SYSTEM_ACTOR_ID, async (tx) => {
      const connection = await tx.businessOwnerTelegramConnection.findFirst({
        where: { connectTokenHash: tokenHash, status: 'PENDING' },
        select: { id: true, businessId: true, connectTokenExpiresAt: true },
      });
      if (!connection) return { type: 'invalid' as const };
      if (
        connection.connectTokenExpiresAt !== null &&
        connection.connectTokenExpiresAt.getTime() < Date.now()
      ) {
        await tx.businessOwnerTelegramConnection.update({
          where: { id: connection.id },
          data: { status: 'EXPIRED', connectTokenHash: null, connectTokenExpiresAt: null },
        });
        return { type: 'expired' as const, businessId: connection.businessId };
      }
      try {
        await tx.businessOwnerTelegramConnection.update({
          where: { id: connection.id },
          data: {
            status: 'ACTIVE',
            chatId,
            connectTokenHash: null,
            connectTokenExpiresAt: null,
            connectedAt: new Date(),
          },
        });
      } catch (err) {
        if ((err as { code?: string })?.code === 'P2002') {
          void ip;
          return { type: 'invalid' as const };
        }
        throw err;
      }
      return { type: 'linked' as const, businessId: connection.businessId };
    });
  }

  /**
   * Inline-button callback (webhook): execute the Accept / Reject step whose
   * opaque token this chat legitimately received.
   */
  async handleCallback(
    chatId: bigint,
    callbackQueryId: string,
    callbackData: string,
    ip?: string,
  ): Promise<{ handled: boolean }> {
    const parsed = parseOwnerCallback(callbackData);
    if (!parsed) return { handled: false };
    await this.rateLimit.check(
      `tg:owner-action:${chatId}`,
      this.config.ownerTelegramActionRateLimitMax,
      this.config.ownerTelegramActionRateLimitWindowMs,
    );

    const outcome = await withSuperAdminContext(this.prisma, SYSTEM_ACTOR_ID, async (tx) => {
      const action = await tx.ownerTelegramAction.findUnique({
        where: { tokenHash: hashToken(parsed.token) },
        select: {
          id: true,
          kind: true,
          status: true,
          chatId: true,
          expiresAt: true,
          businessId: true,
          userId: true,
          bookingId: true,
        },
      });
      if (!action) return { result: 'invalid' as const };
      // The token is bound to exactly one kind in the DB; a callback whose kind
      // does not match the stored action is treated as invalid.
      if (action.kind !== parsed.kind) return { result: 'invalid' as const };
      if (action.chatId !== chatId) return { result: 'unauthorized' as const };
      // A disconnected/revoked owner identity must not be able to act on a token
      // it received earlier: the issuing chat must still be the ACTIVE
      // connection for this business + owner.
      const live = await tx.businessOwnerTelegramConnection.findFirst({
        where: {
          businessId: action.businessId,
          userId: action.userId,
          chatId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      if (!live) return { result: 'unauthorized' as const };
      const now = new Date();
      const claimed = await tx.ownerTelegramAction.updateMany({
        where: { id: action.id, status: 'ISSUED', usedAt: null, expiresAt: { gt: now } },
        data: {
          status: parsed.kind === 'REJECT' ? 'AWAITING_REASON' : 'CONSUMED',
          usedAt: now,
          // A rejection stays open only for the short reason window; an accept
          // is terminal immediately.
          ...(parsed.kind === 'REJECT'
            ? {
                expiresAt: new Date(
                  now.getTime() + this.config.ownerTelegramRejectReasonTtlMinutes * 60_000,
                ),
              }
            : {}),
        },
      });
      if (claimed.count === 0) {
        const current = await tx.ownerTelegramAction.findUnique({
          where: { id: action.id },
          select: { status: true, expiresAt: true, usedAt: true },
        });
        if (!current) return { result: 'invalid' as const };
        // No longer ISSUED: either it expired unused, or it was already used.
        if (current.usedAt === null && current.expiresAt.getTime() <= now.getTime()) {
          return { result: 'expired' as const };
        }
        return { result: 'reused' as const };
      }
      return {
        result: 'consumed' as const,
        id: action.id,
        businessId: action.businessId,
        userId: action.userId,
        bookingId: action.bookingId,
        kind: action.kind as 'ACCEPT' | 'REJECT',
      };
    });

    if (outcome.result === 'invalid') {
      await this.security.record({ type: 'TELEGRAM_ACTION_INVALID', ip, result: 'FAILURE' });
      await this.answerCallback(callbackQueryId, GENERIC_CALLBACK_REPLY);
      return { handled: true };
    }
    if (outcome.result === 'unauthorized') {
      await this.security.record({
        type: 'TELEGRAM_ACTION_UNAUTHORIZED',
        businessId: await this.businessIdForChat(chatId),
        ip,
        result: 'DENIED',
      });
      await this.answerCallback(callbackQueryId, GENERIC_CALLBACK_REPLY);
      return { handled: true };
    }
    if (outcome.result === 'expired') {
      await this.security.record({
        type: 'TELEGRAM_ACTION_EXPIRED',
        businessId: await this.businessIdForChat(chatId),
        ip,
        result: 'FAILURE',
      });
      await this.answerCallback(callbackQueryId, 'This action has expired.');
      return { handled: true };
    }
    if (outcome.result === 'reused') {
      await this.security.record({
        type: 'TELEGRAM_ACTION_REUSED',
        businessId: await this.businessIdForChat(chatId),
        ip,
        result: 'FAILURE',
      });
      await this.answerCallback(callbackQueryId, 'This action has already been used.');
      return { handled: true };
    }

    if (outcome.kind === 'REJECT') {
      await this.security.record({
        type: 'TELEGRAM_ACTION_REJECTED',
        userId: outcome.userId,
        businessId: outcome.businessId,
        ip,
        result: 'SUCCESS',
      });
      await this.answerCallback(callbackQueryId, REJECT_REASON_PROMPT);
      return { handled: true };
    }

    const actor = this.actorFor(outcome.userId, outcome.businessId);
    try {
      await this.bookings.accept(actor, outcome.businessId, outcome.bookingId);
      await this.answerCallback(callbackQueryId, 'Payment accepted. The booking is confirmed.');
      await this.security.record({
        type: 'TELEGRAM_ACTION_ACCEPTED',
        userId: outcome.userId,
        businessId: outcome.businessId,
        ip,
        result: 'SUCCESS',
      });
    } catch (err) {
      const alreadyDone =
        err instanceof AppException ? err.code === ErrorCodes.INVALID_TRANSITION : false;
      await this.security.record({
        type: 'TELEGRAM_ACTION_ACCEPTED',
        userId: outcome.userId,
        businessId: outcome.businessId,
        ip,
        result: 'FAILURE',
      });
      await this.answerCallback(
        callbackQueryId,
        alreadyDone ? 'The booking has already been processed.' : GENERIC_CALLBACK_REPLY,
      );
    }
    return { handled: true };
  }

  /**
   * Plain-text message handler (webhook). If a REJECT action for this chat is
   * awaiting its reason, complete the two-step rejection; otherwise the
   * message is ignored (the shared bot must stay silent for unrelated chat).
   */
  async handleTextMessage(
    chatId: bigint,
    text: string | undefined,
    ip?: string,
  ): Promise<{ handled: boolean }> {
    const reason = parseOwnerRejectReason(text);
    if (reason === null) {
      // Only respond when a pending reason step exists (a too-long/blank reply
      // is still relevant); unrelated chat text stays silent.
      const hasPending = await withSuperAdminContext(this.prisma, SYSTEM_ACTOR_ID, (tx) =>
        tx.ownerTelegramAction.findFirst({
          where: { chatId, status: 'AWAITING_REASON', expiresAt: { gt: new Date() } },
          select: { id: true },
        }),
      );
      if (hasPending) {
        await this.replyTo(chatId, REJECT_REASON_PROMPT);
        return { handled: true };
      }
      return { handled: false };
    }

    await this.rateLimit.check(
      `tg:owner-action:${chatId}`,
      this.config.ownerTelegramActionRateLimitMax,
      this.config.ownerTelegramActionRateLimitWindowMs,
    );

    const pending: PendingReasonOutcome = await withSuperAdminContext(
      this.prisma,
      SYSTEM_ACTOR_ID,
      async (tx) => {
        const row = await tx.ownerTelegramAction.findFirst({
          where: { chatId, status: 'AWAITING_REASON', expiresAt: { gt: new Date() } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, businessId: true, userId: true, bookingId: true },
        });
        if (!row) return { kind: 'none' };
        // Revoked/disconnected identity (or an action issued to another chat)
        // must never complete a rejection, even with a valid reason text.
        const live = await tx.businessOwnerTelegramConnection.findFirst({
          where: {
            businessId: row.businessId,
            userId: row.userId,
            chatId,
            status: 'ACTIVE',
          },
          select: { id: true },
        });
        if (!live) return { kind: 'unauthorized' };
        const claimed = await tx.ownerTelegramAction.updateMany({
          where: { id: row.id, status: 'AWAITING_REASON', expiresAt: { gt: new Date() } },
          data: { status: 'CONSUMED', usedAt: new Date(), reason },
        });
        if (claimed.count === 0) return { kind: 'reused' };
        return { kind: 'ready', row };
      },
    );

    if (pending.kind === 'none') return { handled: false };
    if (pending.kind === 'unauthorized') {
      await this.security.record({
        type: 'TELEGRAM_ACTION_UNAUTHORIZED',
        businessId: await this.businessIdForChat(chatId),
        ip,
        result: 'DENIED',
      });
      await this.replyTo(chatId, GENERIC_CALLBACK_REPLY);
      return { handled: true };
    }
    if (pending.kind === 'reused') {
      await this.security.record({
        type: 'TELEGRAM_ACTION_REUSED',
        businessId: await this.businessIdForChat(chatId),
        ip,
        result: 'FAILURE',
      });
      await this.replyTo(chatId, 'This action has already been used.');
      return { handled: true };
    }

    const { businessId, userId, bookingId } = pending.row;
    const actor = this.actorFor(userId, businessId);
    try {
      await this.bookings.reject(actor, businessId, bookingId, reason);
      await this.replyTo(chatId, 'Payment rejected. The customer can submit a new proof.');
      await this.security.record({
        type: 'TELEGRAM_ACTION_REJECTED',
        userId,
        businessId,
        ip,
        result: 'SUCCESS',
      });
    } catch (err) {
      const alreadyDone =
        err instanceof AppException ? err.code === ErrorCodes.INVALID_TRANSITION : false;
      await this.security.record({
        type: 'TELEGRAM_ACTION_REJECTED',
        userId,
        businessId,
        ip,
        result: 'FAILURE',
      });
      await this.replyTo(
        chatId,
        alreadyDone ? 'The booking has already been processed.' : GENERIC_CALLBACK_REPLY,
      );
    }
    return { handled: true };
  }

  private actorFor(userId: string, businessId: string): ActorContext {
    return {
      userId,
      role: 'Owner',
      sessionId: '',
      businessId,
      scope: 'OWNER',
      ownedBusinessIds: [businessId],
    };
  }

  private async businessIdForChat(chatId: bigint): Promise<string | undefined> {
    return withSuperAdminContext(this.prisma, SYSTEM_ACTOR_ID, async (tx) => {
      const row = await tx.businessOwnerTelegramConnection.findFirst({
        where: { chatId },
        select: { businessId: true },
      });
      return row?.businessId;
    });
  }

  private async answerCallback(callbackQueryId: string, text: string): Promise<void> {
    try {
      await this.telegram.answerCallbackQuery({ callbackQueryId, text });
    } catch (err) {
      this.logger.debug(`answerCallbackQuery failed: ${(err as Error)?.message ?? err}`);
    }
  }

  private async replyTo(chatId: bigint, text: string): Promise<void> {
    try {
      await this.telegram.sendMessage({ chatId, text });
    } catch (err) {
      this.logger.debug(`owner reply sendMessage failed: ${(err as Error)?.message ?? err}`);
    }
  }
}

/** Parse an owner action callback: `pv:<kind>:<token>` (43-char base64url token). */
export function parseOwnerCallback(
  data: string,
): { kind: 'ACCEPT' | 'REJECT'; token: string } | null {
  if (!data) return null;
  const m = data.match(/^pv:(accept|reject):([A-Za-z0-9_-]{43})$/);
  if (!m) return null;
  const kind = m[1]?.toUpperCase();
  const token = m[2];
  if (kind !== 'ACCEPT' && kind !== 'REJECT') return null;
  if (!token) return null;
  return { kind, token };
}

/**
 * Dashboard-compatible reject reason (REQ-068): required, trimmed, ≤ 500
 * characters. Exported so the Telegram path is unit-tested against exactly the
 * same minimum rule the dashboard `parseRejectInput` enforces — the Telegram
 * flow must never accept a weaker reason than the dashboard.
 */
export function parseOwnerRejectReason(text: string | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 500) return null;
  return trimmed;
}
