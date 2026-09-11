import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ActorContext } from '../common/context/actor-context';
import { NotFoundException } from '../common/http/app-error';
import { PrismaService } from '../database/prisma.service';
import { clientMetadata } from './client-metadata';
import { SecurityEventService } from './security-events.service';

/**
 * Who may view which history (doc 22 §3, REQ-201/202/203):
 *  - Owner       → own account events OR events on businesses they own
 *  - Admin       → own account events only (never another tenant's)
 *  - Super Admin → platform-wide (all relevant), plus deletion (REQ-205)
 *
 * `security_event` is platform-level (no RLS, doc 04 §3); the scope windows
 * below ARE the tenant-isolation boundary and are enforced at the service
 * layer from the session-validated actor — never from client-supplied fields.
 */
export type SecurityHistoryScope = 'OWNER' | 'ADMIN' | 'SUPER_ADMIN';

export interface SecurityHistoryFilter {
  type?: string;
  result?: string;
  from?: Date;
  to?: Date;
  /** Super-Admin only (scoped out below for Owner/Admin). */
  businessId?: string;
  userId?: string;
  role?: 'Owner' | 'Admin' | 'SuperAdmin';
}

export interface SecurityEventView {
  id: string;
  type: string;
  createdAt: Date;
  result: string | null;
  ip: string | null;
  device: string | null;
  browser: string | null;
  userId: string | null;
  businessId: string | null;
  /** Platform (Super Admin) view only — resolved from the user relation. */
  userEmail?: string | null;
  /** Sanitized against an explicit allow-list; Super Admin view only. */
  metadata?: Record<string, unknown> | null;
}

export interface SecurityHistoryPage {
  events: SecurityEventView[];
  total: number;
}

/** Allow-list of metadata keys the history API may return (Prompt 15). */
export const METADATA_ALLOW_LIST = [
  'deletedEventId',
  'deletedType',
  'deletedResult',
  'deletedAt',
  'byUserId',
  'purgedCount',
  'olderThanDays',
  'cutoff',
] as const;

/** Minimum shape of a security_event row used by the serializer. */
export interface SecurityEventRowShape {
  id: string;
  type: string;
  createdAt: Date;
  result: string | null;
  ip: string | null;
  device: string | null;
  browser: string | null;
  userId: string | null;
  businessId: string | null;
  metadata?: Prisma.JsonValue | null;
  user?: { email: string } | null;
}

/** Scope window, independent of filters (used by both list and detail). */
export function buildSecurityEventScopeWhere(
  scope: SecurityHistoryScope,
  userId: string,
  ownedBusinessIds: string[],
): Prisma.SecurityEventWhereInput {
  if (scope === 'SUPER_ADMIN') return {};
  if (scope === 'ADMIN') return { userId };
  const businessWindow =
    ownedBusinessIds.length > 0 ? [{ businessId: { in: ownedBusinessIds } }] : [];
  return { OR: [{ userId }, ...businessWindow] };
}

/**
 * Server-side filters. Owner/Admin are scoped out of businessId/userId/role —
 * applied at the service layer, so clients can never widen their window.
 */
export function applySecurityHistoryFilters(
  scope: SecurityHistoryScope,
  base: Prisma.SecurityEventWhereInput,
  filter: SecurityHistoryFilter,
): Prisma.SecurityEventWhereInput {
  let where: Prisma.SecurityEventWhereInput = { ...base };

  if (filter.type) where = { ...where, type: filter.type };
  if (filter.result) where = { ...where, result: filter.result };
  if (filter.from || filter.to) {
    where = {
      ...where,
      createdAt: {
        ...(filter.from ? { gte: filter.from } : {}),
        ...(filter.to ? { lte: filter.to } : {}),
      },
    };
  }

  if (scope === 'SUPER_ADMIN') {
    if (filter.businessId) where = { ...where, businessId: filter.businessId };
    if (filter.userId) where = { ...where, userId: filter.userId };
    if (filter.role) where = { ...where, user: { role: filter.role } };
  }
  return where;
}

/** Drop everything not on the allow-list; keep only primitive values. */
export function sanitizeSecurityEventMetadata(
  raw: Prisma.JsonValue | null | undefined,
): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};
  for (const key of METADATA_ALLOW_LIST) {
    const value = record[key];
    if (value === null || value === undefined) continue;
    if (typeof value !== 'object') cleaned[key] = value;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

/** Serialize a row; never echoes raw metadata for Owner/Admin scopes. */
export function serializeSecurityEvent(
  row: SecurityEventRowShape,
  scope: SecurityHistoryScope,
): SecurityEventView {
  const view: SecurityEventView = {
    id: row.id,
    type: row.type,
    createdAt: row.createdAt,
    result: row.result,
    ip: row.ip,
    device: row.device,
    browser: row.browser,
    userId: row.userId,
    businessId: row.businessId,
  };
  if (scope === 'SUPER_ADMIN') {
    view.userEmail = row.user?.email ?? null;
    view.metadata = sanitizeSecurityEventMetadata(row.metadata);
  }
  return view;
}

@Injectable()
export class SecurityHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly security: SecurityEventService,
  ) {}

  private scopeWhere(actor: ActorContext, scope: SecurityHistoryScope) {
    return buildSecurityEventScopeWhere(scope, actor.userId, actor.ownedBusinessIds);
  }

  private listInclude(scope: SecurityHistoryScope) {
    return scope === 'SUPER_ADMIN' ? { user: { select: { email: true } } } : undefined;
  }

  async list(
    actor: ActorContext,
    scope: SecurityHistoryScope,
    filter: SecurityHistoryFilter,
    page: number,
    pageSize: number,
  ): Promise<SecurityHistoryPage> {
    const where = applySecurityHistoryFilters(scope, this.scopeWhere(actor, scope), filter);
    const include = this.listInclude(scope);
    const [rows, total] = await Promise.all([
      this.prisma.securityEvent.findMany({
        where,
        include,
        // Deterministic newest-first + stable ID tie-breaker (Prompt 15 §11).
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: page * pageSize,
        take: pageSize,
      }),
      this.prisma.securityEvent.count({ where }),
    ]);
    return {
      events: rows.map((row) => serializeSecurityEvent(row, scope)),
      total,
    };
  }

  async detail(
    actor: ActorContext,
    scope: SecurityHistoryScope,
    eventId: string,
  ): Promise<SecurityEventView> {
    const where = { id: eventId, ...this.scopeWhere(actor, scope) };
    const row = await this.prisma.securityEvent.findFirst({
      where,
      include: this.listInclude(scope),
    });
    if (!row) throw new NotFoundException('Security event not found.');
    return serializeSecurityEvent(row, scope);
  }

  /**
   * REQ-205/206 — Super Admin deletes a security event. The deletion is
   * audited in the SAME transaction as the removal: the SECURITY_EVENT_DELETED
   * audit row (a fresh row, inside the retention window) records the deleted
   * event's identity in sanitized metadata, so the audit survives the target
   * deletion and the retention cleanup can never purge it prematurely.
   */
  async deleteAsSuperAdmin(
    actor: ActorContext,
    eventId: string,
    ip?: string,
    ua?: string,
  ): Promise<void> {
    const meta = clientMetadata(ua, ip);
    await this.prisma.$transaction(async (tx) => {
      const target = await tx.securityEvent.findUnique({
        where: { id: eventId },
        select: {
          id: true,
          type: true,
          result: true,
          userId: true,
          businessId: true,
          createdAt: true,
        },
      });
      if (!target) throw new NotFoundException('Security event not found.');

      // The audit and the delete run in THIS transaction (doc 22 REQ-206):
      // the `tx` is passed through so a losing concurrent request rolls its
      // own audit back instead of leaving a duplicate SECURITY_EVENT_DELETED.
      await this.security.record(
        {
          type: 'SECURITY_EVENT_DELETED',
          userId: target.userId ?? undefined,
          businessId: target.businessId ?? undefined,
          ip,
          device: meta.device,
          browser: meta.browser,
          result: 'SUCCESS',
          // Subject columns keep the deleted record's scope; the acting Super
          // Admin is recorded as byUserId in metadata (doc 22 §2).
          metadata: {
            deletedEventId: target.id,
            deletedType: target.type,
            deletedResult: target.result ?? null,
            deletedAt: target.createdAt.toISOString(),
            byUserId: actor.userId,
          },
        },
        tx,
      );
      // deleteMany is race-safe under two concurrent identical requests: only
      // the request that actually removes the row keeps its audit (the other
      // observes count 0, rolls the audit back and reports 404).
      const { count } = await tx.securityEvent.deleteMany({ where: { id: target.id } });
      if (count === 0) throw new NotFoundException('Security event not found.');
    });
  }
}
