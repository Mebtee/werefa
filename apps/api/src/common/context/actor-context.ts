import { Injectable, type ExecutionContext } from '@nestjs/common';

/**
 * Actor + tenant context bound per HTTP request.
 * Injected by guards; written to history records and RLS GUC by services.
 */
export interface ActorContext {
  userId: string;
  role: 'Owner' | 'Admin' | 'SuperAdmin';
  sessionId: string;
  /** Active business scope (owner-flow). */
  businessId?: string;
  /** Elevated super-admin scope marker. */
  scope?: 'OWNER' | 'SUPER_ADMIN';
  /** Businesses the actor owns, resolved from the ownership matrix at session resolution. */
  ownedBusinessIds: string[];
}

export const ACTOR_CONTEXT_TRANSPORT = Symbol('actor_context');

/**
 * Request-scoped store for the actor context. Populated by the session guard.
 */
@Injectable()
export class ActorContextStore {
  private ctx: ActorContext | null = null;

  set(ctx: ActorContext): void {
    this.ctx = ctx;
  }

  get(): ActorContext | null {
    return this.ctx;
  }

  require(): ActorContext {
    if (!this.ctx) throw new Error('ActorContext required but not set');
    return this.ctx;
  }
}

export function currentActor(executionContext?: ExecutionContext): ActorContext | null {
  if (executionContext) {
    const req = executionContext.switchToHttp().getRequest();
    return (req as { actor?: ActorContext }).actor ?? null;
  }
  return null;
}
