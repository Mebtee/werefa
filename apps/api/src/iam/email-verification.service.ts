import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { APP_CONFIG, type AppConfig } from '../config/environment';
import { PasswordService } from './password.service';
import { SecurityEventService } from './security-events.service';
import { PlatformEmailer } from '../jobs/platform-email.job';
import { clientMetadata } from './client-metadata';
import { normalizeEmail } from './validation';
import { validateNewPassword } from './password-policy';
import { AppException } from '../common/http/app-error';
import { ErrorCodes } from '@werefa/shared';

const UNIFORM_REGISTER_RESPONSE = {
  message: 'Your request was received. If this email is available, a verification link was sent.',
};

const UNIFORM_REQUEST_RESPONSE = {
  message: 'If an account exists for this email, a verification link has been sent.',
};

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Owner self-service registration + email verification (REQ-005 completion,
 * REQ-026..032, Prompt 17).
 *
 * Security invariants (doc 14 §4/§5):
 *  - Only the OWNER role is ever created; the server decides the role and never
 *    reads a client-supplied one, so role manipulation is impossible.
 *  - The raw token is only ever sent to the account owner by email; the DB
 *    stores the SHA-256 hash. Tokens are one-time, expire after
 *    `verificationTokenTtlMinutes`, and each new request invalidates
 *    outstanding ones (single active per user).
 *  - Responses are uniform and non-enumerating: identical body whether the
 *    email is free, taken by an Owner, or taken by a platform account.
 *  - No passwords or tokens ever appear in security events.
 *  - Rate limiting is enforced at the controller; this service never reveals
 *    which accounts exist.
 *
 * `now` is an injectable clock for deterministic expiry tests (defaults to the
 * real wall clock — production behaviour unchanged).
 */
@Injectable()
export class EmailVerificationService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
    private readonly security: SecurityEventService,
    private readonly emailer: PlatformEmailer,
  ) {}

  /**
   * Register a new Owner account (REQ-026). Non-enumerating: an existing Owner
   * gets a fresh verification link, an existing platform account gets the same
   * uniform 202 and no email. No business/tenant/subscription is auto-created —
   * the Owner creates their business after verifying (REQ-005 later steps).
   */
  async register(
    emailIn: string,
    password: string,
    ip?: string,
    ua?: string,
    now: Date = new Date(),
  ): Promise<{ message: string }> {
    const email = normalizeEmail(emailIn);
    validateNewPassword(password, this.config, 'password');
    const meta = clientMetadata(ua, ip);

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, isEmailVerified: true },
    });

    // Existing platform account (Admin / Super Admin): uniform no-op, no email —
    // sending a verification link to a non-owner would leak account status.
    if (existing && existing.role !== 'Owner') {
      return UNIFORM_REGISTER_RESPONSE;
    }

    // Existing Owner (unverified): re-issue a fresh verification link instead
    // of failing — the request is idempotent and the address is the requester's
    // own mailbox, so no enumeration is leaked.
    if (existing && existing.role === 'Owner' && !existing.isEmailVerified) {
      await this.issue(existing.id, email, 'EMAIL_VERIFICATION_REQUEST', ip, meta, now);
      return UNIFORM_REGISTER_RESPONSE;
    }

    const hash = await this.password.hash(password);
    let userId: string;
    try {
      const user = await this.prisma.user.create({
        data: { email, passwordHash: hash, role: 'Owner', isEmailVerified: false },
        select: { id: true },
      });
      userId = user.id;
    } catch (err) {
      // citext unique race: a concurrent request created the account first.
      // Treat as the already-exists path — uniform response, no error.
      if ((err as { code?: string } | null)?.code === 'P2002') {
        return UNIFORM_REGISTER_RESPONSE;
      }
      throw err;
    }

    await this.security.record({
      type: 'REGISTER',
      userId,
      ip,
      device: meta.device,
      browser: meta.browser,
      result: 'SUCCESS',
    });
    await this.issue(userId, email, 'EMAIL_VERIFICATION_REQUEST', ip, meta, now);
    return UNIFORM_REGISTER_RESPONSE;
  }

  /**
   * Resend the verification link (REQ-031, "resend available"). If the address
   * belongs to a still-unverified Owner account, invalidates the outstanding
   * token and mints a fresh one. Unknown/other accounts: uniform response,
   * nothing sent.
   */
  async request(
    emailIn: string,
    ip?: string,
    ua?: string,
    now: Date = new Date(),
  ): Promise<{ message: string }> {
    const email = normalizeEmail(emailIn);
    const meta = clientMetadata(ua, ip);

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, isEmailVerified: true },
    });
    if (!existing || existing.role !== 'Owner' || existing.isEmailVerified) {
      return UNIFORM_REQUEST_RESPONSE;
    }

    await this.issue(existing.id, email, 'EMAIL_VERIFICATION_REQUEST', ip, meta, now);
    return UNIFORM_REQUEST_RESPONSE;
  }

  /**
   * Complete email verification (REQ-027..030). Token must exist, be unused and
   * unexpired; consumption is atomic (row-locked updateMany) so parallel
   * submissions cannot double-claim. Marks the Owner verified so they can sign
   * in and reach the dashboard.
   */
  async complete(tokenIn: string, ip?: string, ua?: string, now: Date = new Date()): Promise<void> {
    const meta = clientMetadata(ua, ip);
    const tokenHash = sha256((tokenIn ?? '').trim());

    let userId = '';
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.emailVerificationToken.findFirst({
        where: { tokenHash },
        select: { id: true, userId: true, usedAt: true, expiresAt: true },
      });
      if (!row || row.expiresAt.getTime() < now.getTime()) {
        throw new AppException(ErrorCodes.TOKEN_EXPIRED, 401, 'Verification link invalid', {
          detail: 'This verification link is invalid or has expired.',
        });
      }
      const claimed = await tx.emailVerificationToken.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count === 0) {
        throw new AppException(ErrorCodes.TOKEN_USED, 409, 'Verification link already used', {
          detail: 'This verification link has already been used.',
        });
      }
      await tx.user.update({
        where: { id: row.userId },
        data: { isEmailVerified: true },
      });
      // Restore the single-active invariant for future resends.
      await tx.emailVerificationToken.updateMany({
        where: { userId: row.userId, usedAt: null },
        data: { usedAt: now },
      });
      userId = row.userId;
    });

    await this.security.record({
      type: 'EMAIL_VERIFICATION_COMPLETE',
      userId,
      ip,
      device: meta.device,
      browser: meta.browser,
      result: 'SUCCESS',
    });
  }

  /** Invalidate outstanding tokens, mint a fresh one, email it, and audit. */
  private async issue(
    userId: string,
    email: string,
    eventType: 'EMAIL_VERIFICATION_REQUEST',
    ip: string | undefined,
    meta: ReturnType<typeof clientMetadata>,
    now: Date,
  ): Promise<void> {
    await this.prisma.emailVerificationToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now },
    });

    const token = randomBytes(32).toString('base64url');
    await this.prisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash: sha256(token),
        expiresAt: new Date(now.getTime() + this.config.verificationTokenTtlMinutes * 60_000),
      },
    });

    await this.emailer.sendTo('verification', email, { token });
    await this.security.record({
      type: eventType,
      userId,
      ip,
      device: meta.device,
      browser: meta.browser,
      result: 'SUCCESS',
    });
  }
}
