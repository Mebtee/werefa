import { ActorType } from '@prisma/client';

/**
 * Explicit application authorization context (Prompt 41 §18).
 *
 * Authentication is NOT implemented in this prompt; services never receive an
 * arbitrary business id. Instead the caller supplies an explicit context that
 * declares the actor and — after the tenant guard resolves ownership — the
 * business ids the actor may operate on. Platform administration uses a
 * distinct path. The System actor drives automatic lifecycle operations.
 */
export type ActorRole = Extract<ActorType, 'OWNER' | 'ADMIN' | 'SUPER_ADMIN' | 'SYSTEM'> | 'CUSTOMER';

export interface ActorContext {
  /** Primary role driving the operation. */
  actorType: ActorRole;
  /** Platform user id when the actor is an internal user (Owner/Admin/SuperAdmin). */
  actorUserId?: string | null;
  /** Business ids the actor is authorized to operate on (filled by the tenant guard for OWNER). */
  authorizedBusinessIds?: string[];
}

export const systemActor = (): ActorContext => ({ actorType: 'SYSTEM', actorUserId: null });

export const customerActor = (): ActorContext => ({ actorType: 'CUSTOMER', actorUserId: null });

export const ownerActor = (userId: string): ActorContext => ({
  actorType: 'OWNER',
  actorUserId: userId,
});

export const isOwner = (ctx: ActorContext): boolean => ctx.actorType === 'OWNER';

export const isAdminOrSuperAdmin = (ctx: ActorContext): boolean =>
  ctx.actorType === 'ADMIN' || ctx.actorType === 'SUPER_ADMIN';

export const isSystem = (ctx: ActorContext): boolean => ctx.actorType === 'SYSTEM';