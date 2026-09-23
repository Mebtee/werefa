import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient, SubscriptionProof, SubscriptionReviewState } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import { ActorContext, isSuperAdmin } from '../authorization/actor-context';
import { TenantGuard } from '../authorization/tenant-guard';
import { domainErrors } from '../errors/domain-errors';
import { DOMAIN_EVENT_BUS, DomainEventBus, SubscriptionNotificationEvent } from '../events/domain-events';
import { sniffProof, isAllowedProofMimeType, PROOF_MAX_BYTES } from '../lib/proof-file';
import { isEligible, nextPeriodEndsAt, paidGraceEndsAfter } from '../lib/subscription-lifecycle';
import { FileRepository } from '../repositories/file.repository.port';
import { PaymentProofStorage } from '../repositories/proof-storage.port';
import { SubscriptionProofWithBusiness, SubscriptionRepository } from '../repositories/subscription.repository.port';
import {
  FILE_REPOSITORY,
  PROOF_STORAGE,
  SUBSCRIPTION_REPOSITORY,
} from '../repositories/tokens';
import { GlobalClock, GLOBAL_CLOCK } from '../time/global-clock';
import { withBusinessAdvisoryLock } from '../transactions/business-advisory-lock';
import { SubscriptionService } from './subscription.service';

/**
 * Manual subscription billing workflow (Prompt 52; spec §17, REQ-125 … REQ-141).
 *
 * The owner pays by manual bank transfer and uploads an image/PDF proof
 * (REQ-135/136); exactly the two Admin accounts are notified (REQ-140); an
 * Admin or the Super Admin approves (activates/extends 30 days, REQ-137/130) or
 * rejects with a mandatory reason sent to the owner (REQ-138).
 *
 * Idempotency follows the REQ-121 `submission_key` architecture: a submitted
 * proof is keyed once and a replay returns the original proof. Approval is
 * guarded PENDING → APPROVED inside the per-business advisory lock, so the same
 * proof can never extend the period twice (concurrent double-approve is
 * exactly-once by construction, verified against the real database).
 *
 * No price value is hardcoded or served (unresolved §46 item 1); the workflow
 * is bank-transfer instructions + upload only.
 */
@Injectable()
export class SubscriptionBillingService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(SUBSCRIPTION_REPOSITORY) private readonly subscriptionRepo: SubscriptionRepository,
    @Inject(FILE_REPOSITORY) private readonly fileRepo: FileRepository,
    @Inject(PROOF_STORAGE) private readonly proofStorage: PaymentProofStorage,
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    @Inject(GLOBAL_CLOCK) private readonly clock: GlobalClock,
    private readonly subscriptionService: SubscriptionService,
    private readonly tenantGuard: TenantGuard,
  ) {}

  /** Owner subscription status + proof history (REQ-141 dashboard / REQ-141 banner). */
  async getOwnerSubscriptionView(ctx: ActorContext, businessId: string) {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    const sub = await this.subscriptionService.reconcileStatus(businessId);
    if (!sub) throw domainErrors.businessNotFound();
    const proofs = await this.subscriptionRepo.listProofsByBusiness(businessId);
    return {
      subscription: sub,
      bookingsEnabled: isEligible(sub.status),
      proofs,
    };
  }

  /**
   * Owner uploads a subscription payment proof (REQ-136). Multipart file bytes
   * are validated authoritatively here (magic-byte sniffing) BEFORE any row is
   * created; bytes live in proof storage, never in PostgreSQL (REQ-118 storage
   * seam, Prompt 50). Replay of the same submissionKey returns the original
   * proof; reusing a key for a different business is a conflict.
   */
  async submitProof(
    ctx: ActorContext,
    businessId: string,
    input: { submissionKey: string; file: { bytes: Buffer; mimeType: string } },
  ): Promise<SubscriptionProof> {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    const submissionKey = input.submissionKey.trim();
    if (!submissionKey || submissionKey.length > 128) {
      throw domainErrors.invalidSchedule({ submissionKey: 'A submission key (max 128 chars) is required.' });
    }

    const existing = await this.subscriptionRepo.findProofBySubmissionKey(submissionKey);
    if (existing) {
      if (existing.businessId !== businessId) throw domainErrors.idempotencyConflict();
      return existing;
    }

    const sub = await this.subscriptionRepo.getByBusiness(businessId);
    if (!sub) throw domainErrors.businessNotFound();

    if (input.file.bytes.length > PROOF_MAX_BYTES) throw domainErrors.proofFileTooLarge();
    const sniffed = sniffProof(input.file.bytes);
    if (!sniffed || !isAllowedProofMimeType(sniffed.mimeType)) throw domainErrors.proofFileTypeInvalid();

    const stored = await this.proofStorage.store({
      businessId,
      bytes: input.file.bytes,
      mimeType: sniffed.mimeType,
      extension: sniffed.extension,
    });

    const proof = await this.prisma.$transaction(async (tx) => {
      const file = await this.fileRepo.create(tx, {
        businessId,
        category: 'SUBSCRIPTION_PROOF',
        storageKey: stored.storageKey,
        mimeType: sniffed.mimeType,
        sizeBytes: BigInt(stored.sizeBytes),
        checksumSha256: stored.checksumSha256,
      });
      const created = await this.subscriptionRepo.createProof(tx, {
        subscriptionId: sub.id,
        businessId,
        submissionKey,
        fileObjectId: file.id,
        requestedAt: this.clock.now(),
      }).catch((err: unknown) => {
        if (isP2002(err)) {
          // Race: an identical submission key committed between the read and
          // the create. Resolve as the idempotent replay, never a second row.
          return this.subscriptionRepo.findProofBySubmissionKey(submissionKey);
        }
        throw err;
      });
      if (!created) throw domainErrors.idempotencyConflict();
      return created;
    });

    await this.eventBus.publish([this.submittedEvent(proof)]);
    return proof;
  }

  /** Admin/Super Admin approval: activates or extends by exactly 30 days. */
  async approveProof(ctx: ActorContext, proofId: string): Promise<SubscriptionProofWithBusiness> {
    this.tenantGuard.requireAdminOrSuperAdmin(ctx);
    const actorUserId = ctx.actorUserId ?? 'system';
    const proof = await this.subscriptionRepo.getProofById(proofId);
    if (!proof) throw domainErrors.businessNotFound();

    const now = this.clock.now();
    await withBusinessAdvisoryLock(this.prisma, proof.businessId, async (tx) => {
      const sub = await tx.subscription.findUnique({ where: { businessId: proof.businessId } });
      if (!sub) throw domainErrors.businessNotFound();
      const newPeriodEnd = nextPeriodEndsAt(sub, now);
      const paidGraceEnd = paidGraceEndsAfter(newPeriodEnd);

      const ok = await this.subscriptionRepo.reviewProof(tx, {
        proofId,
        businessId: proof.businessId,
        state: 'APPROVED',
        reviewedBy: actorUserId,
        approvedUntil: newPeriodEnd,
      });
      if (!ok) {
        throw domainErrors.invalidLifecycleTransition('This subscription proof is no longer pending.');
      }
      await this.subscriptionRepo.setPaidBand(tx, {
        businessId: proof.businessId,
        periodEndsAt: newPeriodEnd,
        paidGraceEndsAt: paidGraceEnd,
      });
      await tx.subscription.update({ where: { businessId: proof.businessId }, data: { status: 'ACTIVE' } });
      await this.subscriptionRepo.appendHistory(tx, {
        subscriptionId: sub.id,
        businessId: proof.businessId,
        fromStatus: sub.status,
        toStatus: 'ACTIVE',
        actorType: isSuperAdmin(ctx) ? 'SUPER_ADMIN' : 'ADMIN',
        actorUserId,
        reason: `Subscription proof approved; period until ${newPeriodEnd.toISOString()}`,
      });
    });
    const row = await this.subscriptionRepo.getProofWithBusiness(proofId);
    if (!row) throw domainErrors.invalidLifecycleTransition('This subscription proof was not found after review.');
    return row;
  }

  /** Admin/Super Admin rejection: mandatory reason, sent to the owner (REQ-138). */
  async rejectProof(ctx: ActorContext, proofId: string, reason: string): Promise<SubscriptionProofWithBusiness> {
    this.tenantGuard.requireAdminOrSuperAdmin(ctx);
    const trimmed = reason.trim();
    if (!trimmed) {
      throw domainErrors.invalidSchedule({ rejectionReason: 'A rejection reason is required.' });
    }
    if (trimmed.length > 800) {
      throw domainErrors.invalidSchedule({ rejectionReason: 'The rejection reason must be 800 characters or fewer.' });
    }
    const proof = await this.subscriptionRepo.getProofById(proofId);
    if (!proof) throw domainErrors.businessNotFound();

    const actorUserId = ctx.actorUserId ?? 'system';
    await withBusinessAdvisoryLock(this.prisma, proof.businessId, async (tx) => {
      const ok = await this.subscriptionRepo.reviewProof(tx, {
        proofId,
        businessId: proof.businessId,
        state: 'REJECTED',
        reviewedBy: actorUserId,
        rejectionReason: trimmed,
      });
      if (!ok) {
        throw domainErrors.invalidLifecycleTransition('This subscription proof is no longer pending.');
      }
    });
    await this.eventBus.publish([this.rejectedEvent(proof)]);
    const row = await this.subscriptionRepo.getProofWithBusiness(proofId);
    if (!row) throw domainErrors.invalidLifecycleTransition('This subscription proof was not found after review.');
    return row;
  }

  /** Admin/Super Admin proof queue (REQ-137 review workflow). */
  async listProofsForReview(
    ctx: ActorContext,
    state: SubscriptionReviewState,
  ): Promise<SubscriptionProofWithBusiness[]> {
    this.tenantGuard.requireAdminOrSuperAdmin(ctx);
    return this.subscriptionRepo.listProofsByReviewState(state);
  }

  private submittedEvent(proof: SubscriptionProof): SubscriptionNotificationEvent {
    return { type: 'SUBSCRIPTION_PROOF_SUBMITTED', businessId: proof.businessId, proofId: proof.id, occurredAt: this.clock.now() };
  }

  private rejectedEvent(proof: SubscriptionProof): SubscriptionNotificationEvent {
    return {
      type: 'SUBSCRIPTION_PROOF_REJECTED',
      businessId: proof.businessId,
      proofId: proof.id,
      occurredAt: this.clock.now(),
      payload: { reason: proof.rejectionReason ?? undefined },
    };
  }
}

function isP2002(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}