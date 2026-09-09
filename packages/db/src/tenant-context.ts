/**
 * Tenant-context helpers for DB access.
 *
 * Atomic-ish per-connection tenant setting: set inside an explicit transaction
 * with SET LOCAL so it never leaks across requests on pooled connections,
 * and is automatically cleared at transaction end.
 */

/** Keys the runtime uses as Postgres GUC settings (same names as policies read). */
export const GUC = {
  userId: 'app.user_id',
  businessId: 'app.business_id',
  scope: 'app.scope',
  creating: 'app.creating',
  bookingPublic: 'app.booking_public',
  customerPhone: 'app.customer_phone',
} as const;

/**
 * Tenant scopes the runtime can establish on a connection:
 *  - OWNER: the actor's owned businesses only (app role policies).
 *  - SUPER_ADMIN: elevated audited access for Admin/Super Admin flows.
 *  - PUBLIC: anonymous read projection for public business pages (Prompt 09) —
 *    grants SELECT on the public `business` profile uniquement; never a write
 *    scope, and only reached via the unauthenticated public controllers.
 */
export type TenantScope = 'OWNER' | 'SUPER_ADMIN' | 'PUBLIC';

export interface TenantContextValues {
  /** Optional for PUBLIC scope (anonymous read); required otherwise. */
  userId?: string;
  businessId?: string;
  scope?: TenantScope;
  /**
   * True ONLY while a brand-new business is being created (a transaction that
   * inserts a fresh, unowned business and links ownership). The rls policies
   * use this marker to open the narrow create-time window (INSERT...RETURNING
   * visibility / ownership self-claim) without ever trusting `business_id`
   * alone — an owner cannot point the window at a foreign business.
   */
  creating?: boolean;
  /**
   * True ONLY inside the public booking-creation transaction (Prompt 11). The
   * public booking flow runs with scope 'PUBLIC' and this marker, constraining
   * INSERTs of booking-domain rows to the SAME business_id carried in the
   * marker — an anonymous caller cannot point writes at an arbitrary tenant.
   */
  bookingPublic?: boolean;
  /**
   * Customer phone, set ONLY inside the rejected-booking resubmission
   * transaction (Prompt 11). Public UPDATE policies on booking/payment are
   * gated on a matching `customer_phone`, so a caller can only transition
   * bookings whose phone they have verified.
   */
  customerPhone?: string;
}

/**
 * Build a SQL fragment that sets the tenant GUCs for the *current* transaction.
 *
 * Rendered as a SINGLE SELECT with one `set_config(...)` per setting — Prisma's
 * `$executeRawUnsafe` uses the extended query protocol, which rejects strings
 * containing multiple statements ("cannot insert multiple commands into a
 * prepared statement"). A bare SELECT with several `set_config` columns is one
 * command and stays valid for both Prisma and raw `pg` (simple protocol).
 */
export function tenantContextSql(ctx: TenantContextValues): string {
  const assignments: string[] = [];
  if (ctx.userId) {
    assignments.push(`set_config('${GUC.userId}', '${escapeLiteral(ctx.userId)}', true)`);
  }
  if (ctx.businessId) {
    assignments.push(`set_config('${GUC.businessId}', '${escapeLiteral(ctx.businessId)}', true)`);
  }
  const scope = ctx.scope ?? (ctx.userId ? 'OWNER' : 'PUBLIC');
  assignments.push(`set_config('${GUC.scope}', '${escapeLiteral(scope)}', true)`);
  if (ctx.creating) {
    assignments.push(`set_config('${GUC.creating}', '1', true)`);
  }
  if (ctx.bookingPublic) {
    assignments.push(`set_config('${GUC.bookingPublic}', '1', true)`);
  }
  if (ctx.customerPhone) {
    assignments.push(
      `set_config('${GUC.customerPhone}', '${escapeLiteral(ctx.customerPhone)}', true)`,
    );
  }
  return `SELECT ${assignments.join(', ')}`;
}

function escapeLiteral(value: string): string {
  return value.replace(/'/g, "''");
}
