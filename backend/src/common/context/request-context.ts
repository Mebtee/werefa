import { AsyncLocalStorage } from 'node:async_hooks';

export type TenantScope = 'public' | 'owner' | 'admin' | 'super-admin' | 'system';

export interface RequestContext {
  /** Correlation id for the request; echoed on X-Request-Id and in logs. */
  requestId: string;
  /** Tenant (business) in scope for this request, when known. RLS hook point. */
  businessId?: string;
  /** Actor (platform user) id when authenticated; id only, never PII. */
  actorId?: string;
  /** Authorization scope resolved for the request (spec §21 / doc 14). */
  scope?: TenantScope;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestContextStorage.run(ctx, fn);
}

export function withRequestId<T>(requestId: string, fn: () => T): T {
  return requestContextStorage.run({ requestId }, fn);
}

export function currentRequestId(): string | undefined {
  return requestContextStorage.getStore()?.requestId;
}