/**
 * Telegram structured-callback service (Prompt 51; REQ-067/068, T-09).
 *
 * Inline buttons (Accept / Reject) carry a P-1 callback id that is bound at
 * outbox-write time to (business, connection, booking). Handling enforces:
 *
 *  - T-09: the callback may only be triggered from the chat bound to the same
 *    connection — a callback from a different chat or a revoked connection is
 *    refused.
 *  - Exactly-once: the OPEN → USED transition is an atomic conditional claim,
 *    so a double-tap on the same button executes the action once (second tap ⇒
 *    "already handled").
 *  - REQ-068: a rejection without a reason is refused. Tap "Reject" ⇒ the bot
 *    prompts for a reason and the owner's next chat message supplies it
 *    (prompt is bound to the chat, expires after 10 minutes, never persisted).
 *  - Authorization: the owner action runs through BookingService with an
 *    explicit owner actor, so the tenant guard re-verifies that the connection
 *    user still owns the business at the moment of the action.
 */

import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import { BookingService } from '../services/booking.service';
import { ownerActor } from '../authorization/actor-context';
import { domainErrors } from '../errors/domain-errors';

interface PendingRejection {
  businessId: string;
  connectionId: string;
  bookingId: number;
  promptedAt: number;
}

const PROMPT_TTL_MS = 10 * 60 * 1000;

export type CallbackOutcome =
  | { kind: 'EXECUTED'; message: string }
  | { kind: 'NEEDS_REASON'; prompt: string }
  | { kind: 'REFUSED'; message: string };

@Injectable()
export class TelegramCallbackService {
  private readonly pendingRejections = new Map<string, PendingRejection>();

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly bookingService: BookingService,
  ) {}

  /** Handle an inline Accept tap. */
  async acceptProof(callbackId: string, chatId: bigint): Promise<CallbackOutcome> {
    const ctx = await this.claim(callbackId, chatId);
    if (!ctx) return { kind: 'REFUSED', message: 'This action is no longer available.' };

    await this.bookingService.acceptProof(ownerActor(ctx.connection.userId ?? ''), ctx.callback.businessId, ctx.callback.bookingId);
    return { kind: 'EXECUTED', message: 'The payment proof has been accepted and the booking confirmed.' };
  }

  /** Handle an inline Reject tap: mark used and prompt for the required reason. */
  async startReject(callbackId: string, chatId: bigint): Promise<CallbackOutcome> {
    const ctx = await this.claim(callbackId, chatId);
    if (!ctx) return { kind: 'REFUSED', message: 'This action is no longer available.' };

    this.pendingRejections.set(chatId.toString(), {
      businessId: ctx.callback.businessId,
      connectionId: ctx.connection.id,
      bookingId: ctx.callback.bookingId,
      promptedAt: Date.now(),
    });
    return {
      kind: 'NEEDS_REASON',
      prompt: 'Please send the reason for the rejection (REQ-068). The reason will be sent to the customer.',
    };
  }

  /** Consume the owner's next message as the rejection reason. */
  async submitRejectReason(chatId: bigint, reason: string): Promise<CallbackOutcome> {
    const pending = this.pendingRejections.get(chatId.toString());
    if (!pending || Date.now() - pending.promptedAt > PROMPT_TTL_MS) {
      this.pendingRejections.delete(chatId.toString());
      return { kind: 'REFUSED', message: 'There is no pending rejection for this chat.' };
    }
    if (!reason || !reason.trim()) {
      return { kind: 'REFUSED', message: 'A rejection reason is required (REQ-068). Please send the reason.' };
    }

    this.pendingRejections.delete(chatId.toString());
    await this.bookingService.rejectProof(ownerActor(await this.ownerUser(pending.connectionId)), pending.businessId, pending.bookingId, reason.trim());
    return { kind: 'EXECUTED', message: 'The payment proof has been rejected and the reason was sent on.' };
  }

  private async ownerUser(connectionId: string): Promise<string> {
    const connection = await this.prisma.telegramConnection.findUnique({
      where: { id: connectionId },
      select: { userId: true },
    });
    if (!connection?.userId) throw domainErrors.telegramCallbackInvalid();
    return connection.userId;
  }

  /**
   * Atomically claim an OPEN callback and verify its chat binding (T-09).
   * Returns null when the callback is already used, from another chat, revoked,
   * or the booking/business is gone.
   */
  private async claim(
    callbackId: string,
    chatId: bigint,
  ): Promise<{ callback: { businessId: string; bookingId: number }; connection: { id: string; userId: string | null } } | null> {
    const row = await this.prisma.telegramCallback.findFirst({
      where: { id: callbackId, state: 'OPEN' },
      include: { connection: { select: { id: true, chatId: true, state: true, userId: true, businessId: true } } },
    });
    if (!row || !row.connection) return null;
    if (row.connection.chatId !== chatId || row.connection.state !== 'CONNECTED') return null;
    if (row.connection.businessId !== row.businessId) return null;

    const claimed = await this.prisma.telegramCallback.updateMany({
      where: { id: callbackId, state: 'OPEN' },
      data: { state: 'USED', usedAt: new Date() },
    });
    if (claimed.count === 0) return null;

    return {
      callback: { businessId: row.businessId, bookingId: row.bookingId },
      connection: { id: row.connection.id, userId: row.connection.userId },
    };
  }
}