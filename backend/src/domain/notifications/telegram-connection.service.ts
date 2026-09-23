/**
 * Telegram connection service (Prompt 51; spec §23.3, REQ-056).
 *
 * Code-based connection flow:
 *  1. `issueCustomerCode` / `issueOwnerCode` create a single-use, 10-minute
 *     token and return the deep link `https://t.me/<handle>?start=<code>`.
 *  2. Telegram delivers `/start <code>` to the bot; the webhook redeems the
 *     token via `redeem` — the (chatId, business, recipient) binding is written
 *     in the same transaction, so a redeemed chat and its verification are
 *     never desynchronized, and a chat can never silently end up bound to two
 *     different businesses/recipients (unique constraint).
 *
 * Codes are stored as SHA-256 digests only; the plain code is returned exactly
 * once, inside the deep link. No secrets are persisted.
 */

import { createHash, randomBytes } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT, CONFIG } from '../../config/config.constants';
import { AppConfig } from '../../config/app-config';
import { TenantGuard } from '../authorization/tenant-guard';
import { ownerActor } from '../authorization/actor-context';
import { domainErrors } from '../errors/domain-errors';
import { connectDeepLink } from './notification-catalog';

export const CONNECTION_CODE_TTL_MS = 10 * 60 * 1000;

export interface IssuedConnectionCode {
  deepLink: string;
  expiresInMs: number;
}

export interface RedeemedConnection {
  businessId: string;
  kind: 'CUSTOMER' | 'BUSINESS_OWNER';
  chatId: bigint;
  recipient: string;
}

@Injectable()
export class TelegramConnectionService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly tenantGuard: TenantGuard,
  ) {}

  /** Customer connect: validates the phone against recent activity by this business. */
  async issueCustomerCode(businessSlug: string, customerPhone: string): Promise<IssuedConnectionCode> {
    if (!this.config.telegramEnabled || !this.config.telegramBotHandle) {
      throw domainErrors.telegramUnavailable();
    }
    const business = await this.prisma.business.findUnique({
      where: { publicSlug: businessSlug },
      select: { id: true, name: true },
    });
    if (!business) throw domainErrors.businessNotFound();

    // The phone must have a real booking in this business — nobody can start
    // a chat with a business unless they have an appointment there (REQ-056).
    const hasBooking = await this.prisma.booking.findFirst({
      where: { businessId: business.id, customerPhone },
      select: { id: true },
    });
    if (!hasBooking) throw domainErrors.telegramTokenInvalid('No booking found for this phone.');

    await this.expireActiveCodes(business.id, 'CUSTOMER', customerPhone);
    const { plain, hash } = newConnectionCode();
    await this.prisma.telegramConnectionToken.create({
      data: {
        businessId: business.id,
        kind: 'CUSTOMER',
        customerPhone,
        codeHash: hash,
        expiresAt: new Date(Date.now() + CONNECTION_CODE_TTL_MS),
      },
    });
    return this.issued(plain);
  }

  /** Owner connect: requires the acting user to own the business. */
  async issueOwnerCode(userId: string, businessId: string): Promise<IssuedConnectionCode> {
    if (!this.config.telegramEnabled || !this.config.telegramBotHandle) {
      throw domainErrors.telegramUnavailable();
    }
    await this.tenantGuard.requireOwnedBusiness(ownerActor(userId), businessId);
    await this.expireActiveCodes(businessId, 'BUSINESS_OWNER', undefined, userId);
    const { plain, hash } = newConnectionCode();
    await this.prisma.telegramConnectionToken.create({
      data: {
        businessId,
        kind: 'BUSINESS_OWNER',
        userId,
        codeHash: hash,
        expiresAt: new Date(Date.now() + CONNECTION_CODE_TTL_MS),
      },
    });
    return this.issued(plain);
  }

  /**
   * Customer connect endpoint semantics: already-connected customers get
   * `{ status: 'connected' }`; otherwise a fresh 10-minute code + deep link.
   */
  async connectCustomer(businessSlug: string, customerPhone: string): Promise<{ status: 'connected' } | { status: 'ready'; deepLink: string; expiresInMs: number }> {
    if (await this.customerConnected(businessSlug, customerPhone)) {
      return { status: 'connected' };
    }
    return { status: 'ready', ...(await this.issueCustomerCode(businessSlug, customerPhone)) };
  }

  /** Whether this business + phone has a live customer connection. */
  async customerConnected(businessSlug: string, customerPhone: string): Promise<boolean> {
    const business = await this.prisma.business.findUnique({
      where: { publicSlug: businessSlug },
      select: { id: true },
    });
    if (!business) throw domainErrors.businessNotFound();
    const id = await findConnectionId(this.prisma, {
      businessId: business.id,
      kind: 'CUSTOMER',
      customerPhone,
    });
    return id !== null;
  }

  /**
   * Owner connect endpoint semantics: already-connected owners get
   * `{ status: 'connected' }`; otherwise a fresh 10-minute code + deep link.
   */
  async connectOwner(userId: string, businessId: string): Promise<{ status: 'connected' } | { status: 'ready'; deepLink: string; expiresInMs: number }> {
    await this.tenantGuard.requireOwnedBusiness(ownerActor(userId), businessId);
    const id = await findConnectionId(this.prisma, { businessId, kind: 'BUSINESS_OWNER', userId });
    if (id !== null) return { status: 'connected' };
    return { status: 'ready', ...(await this.issueOwnerCode(userId, businessId)) };
  }

  /** Whether the acting owner has a live connection for this business. */
  async ownerConnected(userId: string, businessId: string): Promise<boolean> {
    await this.tenantGuard.requireOwnedBusiness(ownerActor(userId), businessId);
    const id = await findConnectionId(this.prisma, { businessId, kind: 'BUSINESS_OWNER', userId });
    return id !== null;
  }

  /**
   * Redemption (called by the webhook for `/start <code>`). Single use; binds
   * chatId to (business, recipient). Owner redemptions bind the user's owned
   * business to the chat; customer redemptions bind the phone.
   */
  async redeem(plainCode: string, chatId: bigint): Promise<RedeemedConnection> {
    const token = await this.prisma.telegramConnectionToken.findUnique({
      where: { codeHash: sha256(plainCode) },
    });
    if (!token) throw domainErrors.telegramTokenInvalid();
    if (token.state === 'REDEEMED') throw domainErrors.telegramTokenUsed();
    if (token.state === 'EXPIRED' || token.expiresAt.getTime() < Date.now()) {
      if (token.state !== 'EXPIRED') {
        await this.prisma.telegramConnectionToken.update({
          where: { id: token.id },
          data: { state: 'EXPIRED' },
        });
      }
      throw domainErrors.telegramTokenExpired();
    }

    const business = await this.prisma.business.findUnique({
      where: { id: token.businessId },
      select: { id: true },
    });
    if (!business) throw domainErrors.telegramTokenInvalid();

    const connection = await this.prisma.$transaction(async (tx) => {
      await tx.telegramConnectionToken.update({
        where: { id: token.id },
        data: { state: 'REDEEMED', usedAt: new Date() },
      });

      const recipient =
        token.kind === 'CUSTOMER'
          ? { customerPhone: token.customerPhone ?? null, userId: null }
          : { customerPhone: null, userId: token.userId ?? null };
      const existing = await tx.telegramConnection.findFirst({
        where: {
          businessId: token.businessId,
          kind: token.kind,
          ...(token.kind === 'CUSTOMER' ? { customerPhone: token.customerPhone } : {}),
          ...(token.kind === 'BUSINESS_OWNER' ? { userId: token.userId } : {}),
        },
        orderBy: { connectedAt: 'desc' },
        select: { id: true },
      });

      try {
        return existing
          ? await tx.telegramConnection.update({
              where: { id: existing.id },
              data: {
                state: 'CONNECTED',
                chatId,
                connectedAt: new Date(),
                revokedAt: null,
                ...recipient,
                businessId: token.businessId,
                kind: token.kind,
              },
            })
          : await tx.telegramConnection.create({
              data: {
                state: 'CONNECTED',
                chatId,
                connectedAt: new Date(),
                businessId: token.businessId,
                kind: token.kind,
                ...recipient,
              },
            });
      } catch (err) {
        throw connectionConflictOr(err); // P2002 = chat already bound elsewhere
      }
    });

    return {
      businessId: connection.businessId ?? token.businessId,
      kind: token.kind,
      chatId,
      recipient: token.customerPhone ?? token.userId ?? '',
    };
  }

  private async expireActiveCodes(
    businessId: string,
    kind: 'CUSTOMER' | 'BUSINESS_OWNER',
    customerPhone?: string,
    userId?: string,
  ): Promise<void> {
    await this.prisma.telegramConnectionToken.updateMany({
      where: {
        businessId,
        kind,
        state: 'ISSUED',
        ...(kind === 'CUSTOMER' ? { customerPhone } : {}),
        ...(kind === 'BUSINESS_OWNER' ? { userId } : {}),
      },
      data: { state: 'EXPIRED' },
    });
  }

  private issued(plain: string): IssuedConnectionCode {
    return {
      deepLink: connectDeepLink(this.config.telegramBotHandle ?? '', plain),
      expiresInMs: CONNECTION_CODE_TTL_MS,
    };
  }
}

export function newConnectionCode(): { plain: string; hash: string } {
  const plain = randomBytes(16).toString('hex'); // 32 hex chars (< 64-byte start payload)
  return { plain, hash: sha256(plain) };
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function connectionConflictOr(err: unknown): unknown {
  if (isPrismaP2002(err)) return domainErrors.telegramConnectionConflict();
  return err;
}

function isPrismaP2002(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002'
  );
}

/** Identify an existing connection for a recipient by business + kind. */
export async function findConnectionId(
  prisma: PrismaClient,
  input: { businessId: string; kind: 'CUSTOMER' | 'BUSINESS_OWNER'; customerPhone?: string; userId?: string },
): Promise<string | null> {
  const connection = await prisma.telegramConnection.findFirst({
    where: {
      businessId: input.businessId,
      kind: input.kind,
      ...(input.kind === 'CUSTOMER' ? { customerPhone: input.customerPhone } : {}),
      ...(input.kind === 'BUSINESS_OWNER' ? { userId: input.userId } : {}),
      state: 'CONNECTED',
    },
    orderBy: { connectedAt: 'desc' },
    select: { id: true },
  });
  return connection?.id ?? null;
}