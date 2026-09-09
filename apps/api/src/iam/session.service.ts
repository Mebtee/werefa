import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Session, UserRole } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from '../config/environment';
import { PrismaService } from '../database/prisma.service';
import { withTenantContext } from '../database/tenant-executor';
import type { ActorContext } from '../common/context/actor-context';
import { UnauthenticatedException } from '../common/http/app-error';

/**
 * Session tokens are opaque random strings stored hashed (SHA-256) — the DB
 * never stores the raw token (doc 14). Resolution by hash only.
 */
export interface SessionUser {
  id: string;
  role: UserRole;
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  /** Generate a raw token + its SHA-256 hash. */
  static newToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: SessionService.hashToken(token) };
  }

  static hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  /** Constant-time comparison of a provided hash with the stored one. */
  static safeEqualHash(a: string, b: string): boolean {
    const ha = Buffer.from(a, 'hex');
    const hb = Buffer.from(b, 'hex');
    return ha.length === hb.length && timingSafeEqual(ha, hb);
  }

  /**
   * Create a session for a user; returns raw token (issued once to the client)
   * plus metadata. Stores only the SHA-256 hash.
   */
  async createSession(
    user: SessionUser,
    ip: string | undefined,
    deviceFingerprint?: string,
    recognizedDevice = false,
  ): Promise<{ token: string; expiresAt: Date; session: Session }> {
    const { token, hash } = SessionService.newToken();
    const ttlMs = this.config.sessionTtlMinutes * 60_000;
    const expiresAt = new Date(Date.now() + ttlMs);

    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        expiresAt,
        ip,
        deviceFingerprint,
        recognizedDevice,
      },
    });
    return { token, expiresAt, session };
  }

  /** Revoke a session by id (e.g. logout / force-logout). */
  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  /** Revoke every live session of a user (password change, reset, deletion). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Device recognition (REQ-197): has this fingerprint been seen on a previous
   * live session for this user?
   */
  async recognizedBefore(userId: string, deviceFingerprint: string): Promise<boolean> {
    const prior = await this.prisma.session.findFirst({
      where: { userId, deviceFingerprint, revokedAt: null },
      select: { id: true },
    });
    return prior !== null;
  }

  /**
   * Resolve a raw token into an ActorContext, or throw. Called by guards per
   * request. Never returns raw token data; no PII beyond the actor id/role.
   */
  async resolveToken(
    rawToken: string,
    ip?: string,
    deviceFingerprint?: string,
  ): Promise<ActorContext> {
    const hash = SessionService.hashToken(rawToken);
    const session = await this.prisma.session.findFirst({
      where: { tokenHash: hash, revokedAt: null },
      include: { user: true },
    });
    if (!session) throw new UnauthenticatedException('Invalid session.');

    if (session.expiresAt.getTime() < Date.now()) {
      await this.revokeSession(session.id);
      throw new UnauthenticatedException('Session expired.');
    }

    // Deactivated accounts lose their sessions immediately (REQ-217 deactivate).
    if (session.user.disabledAt) {
      await this.revokeSession(session.id);
      throw new UnauthenticatedException('Session revoked.');
    }

    // Refresh sliding window if close to expiry (doc 14 keeps sessions until
    // expiry; sliding is optional — do it lazily at 50% life).
    const ttlMs = this.config.sessionTtlMinutes * 60_000;
    const halfLife = new Date(session.issuedAt.getTime() + ttlMs / 2);
    if (Date.now() > halfLife.getTime()) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { expiresAt: new Date(Date.now() + ttlMs) },
      });
    }

    // Resolve ownership matrix for the tenant guard. The ownership table is
    // RLS-protected for the `app` role (owner_membership_select), so this must
    // run inside a transaction that sets the tenant GUC first; otherwise RLS
    // filters every row and owners would appear to own nothing.
    const owned = await withTenantContext(
      this.prisma,
      { userId: session.user.id, scope: 'OWNER' },
      (tx) =>
        tx.businessOwner.findMany({
          where: { userId: session.user.id },
          select: { businessId: true },
        }),
    );
    const ownedBusinessIds = owned.map((o) => o.businessId);

    // The session may record an active business that is no longer owned (owner
    // removed meanwhile). Do not hand the handlers a stale tenant scope.
    const activeBusinessId =
      session.activeBusinessId && ownedBusinessIds.includes(session.activeBusinessId)
        ? session.activeBusinessId
        : null;

    const actor: ActorContext = {
      sessionId: session.id,
      userId: session.user.id,
      role: session.user.role,
      businessId: activeBusinessId ?? undefined,
      ownedBusinessIds,
    };
    void ip;
    void deviceFingerprint;
    return actor;
  }
}

export function hmacToken(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value, 'utf8').digest('hex');
}
