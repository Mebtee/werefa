import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { API_PREFIX, Role } from '@werefa/shared';
import { Actor } from '../common/decorators/actor.decorator';
import { Roles, RolesExact } from '../common/decorators/roles.decorator';
import { type ActorContext } from '../common/context/actor-context';
import { SessionGuard } from '../common/guards/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ValidationException } from '../common/http/app-error';
import { SECURITY_EVENT_TYPES } from './security-events.service';
import {
  SecurityHistoryService,
  type SecurityHistoryFilter,
  type SecurityHistoryScope,
} from './security-history.service';

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ['Owner', 'Admin', 'SuperAdmin'] as const;

/**
 * Security/activity history (Prompt 15, Domain 18):
 *  - REQ-201 Owner → own + owned-business events (`/owner/security-events`)
 *  - REQ-202 Admin → own account events only (`/admin/security-events`)
 *  - REQ-203 SA   → platform-wide list/detail + filters (`/super-admin/...`)
 *  - REQ-205/206  → SA deletes a single event; deletion is audited in-line.
 *
 * Every value flows through server-side whitelist/encoders — clients can never
 * supply an actor, role, timestamp, IP or type.
 */

@Controller(`${API_PREFIX}/owner/security-events`)
@UseGuards(SessionGuard, RolesGuard)
@RolesExact(Role.Owner)
export class OwnerSecurityHistoryController {
  constructor(private readonly service: SecurityHistoryService) {}

  @Get()
  async list(@Actor() actor: ActorContext, @Query() query: Record<string, unknown>) {
    const { page, pageSize } = pageParams(query);
    const result = await this.service.list(
      actor,
      'OWNER' as SecurityHistoryScope,
      commonFilters(query),
      page,
      pageSize,
    );
    return { ...result, page, pageSize };
  }
}

@Controller(`${API_PREFIX}/admin/security-events`)
@UseGuards(SessionGuard, RolesGuard)
@Roles(Role.Admin)
export class AdminSecurityHistoryController {
  constructor(private readonly service: SecurityHistoryService) {}

  @Get()
  async list(@Actor() actor: ActorContext, @Query() query: Record<string, unknown>) {
    const { page, pageSize } = pageParams(query);
    const result = await this.service.list(
      actor,
      'ADMIN' as SecurityHistoryScope,
      commonFilters(query),
      page,
      pageSize,
    );
    return { ...result, page, pageSize };
  }
}

@Controller(`${API_PREFIX}/super-admin/security-events`)
@UseGuards(SessionGuard, RolesGuard)
@RolesExact(Role.SuperAdmin)
export class SuperAdminSecurityHistoryController {
  constructor(private readonly service: SecurityHistoryService) {}

  @Get()
  async list(@Actor() actor: ActorContext, @Query() query: Record<string, unknown>) {
    const { page, pageSize } = pageParams(query);
    const result = await this.service.list(
      actor,
      'SUPER_ADMIN' as SecurityHistoryScope,
      superAdminFilters(query),
      page,
      pageSize,
    );
    return { ...result, page, pageSize };
  }

  @Get(':eventId')
  async detail(@Actor() actor: ActorContext, @Param('eventId') eventId: string) {
    assertUuid(eventId, 'eventId');
    return {
      event: await this.service.detail(actor, 'SUPER_ADMIN' as SecurityHistoryScope, eventId),
    };
  }

  @Delete(':eventId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Actor() actor: ActorContext,
    @Param('eventId') eventId: string,
    @Req() req: Request,
  ): Promise<void> {
    assertUuid(eventId, 'eventId');
    await this.service.deleteAsSuperAdmin(actor, eventId, req.ip, req.headers['user-agent']);
  }
}

function pageParams(query: Record<string, unknown>): { page: number; pageSize: number } {
  return {
    page: optionalInt(query.page, 'page', 0),
    pageSize: optionalInt(query.pageSize, 'pageSize', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
  };
}

/** Filters shared by every scope (type / result / date range). */
function commonFilters(query: Record<string, unknown>): SecurityHistoryFilter {
  const filter: SecurityHistoryFilter = {};

  const type = optionalEnum(query.type, 'type', SECURITY_EVENT_TYPES as readonly string[]);
  if (type) filter.type = type;

  const result = optionalString(query.result);
  if (result) filter.result = result;

  const from = optionalDate(query.from, 'from');
  if (from) filter.from = from;
  const to = optionalDate(query.to, 'to');
  if (to) filter.to = to;

  return filter;
}

/** Super Admin may also filter by actor, role and business (REQ-203). */
function superAdminFilters(query: Record<string, unknown>): SecurityHistoryFilter {
  const filter: SecurityHistoryFilter = commonFilters(query);

  const businessId = optionalUuid(query.businessId, 'businessId');
  if (businessId) filter.businessId = businessId;

  const userId = optionalUuid(query.userId, 'userId');
  if (userId) filter.userId = userId;

  const role = optionalEnum(query.role, 'role', ROLES as readonly string[]);
  if (role) filter.role = role as SecurityHistoryFilter['role'];

  return filter;
}

function optionalString(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  return raw.trim();
}

function optionalEnum(raw: unknown, field: string, allowed: readonly string[]): string | undefined {
  const value = optionalString(raw);
  if (value === undefined) return undefined;
  if (!allowed.includes(value)) {
    throw new ValidationException([{ field, message: `Unknown ${field} value.` }]);
  }
  return value;
}

function optionalDate(raw: unknown, field: string): Date | undefined {
  const value = optionalString(raw);
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationException([{ field, message: 'Must be a valid date-time.' }]);
  }
  return parsed;
}

function optionalUuid(raw: unknown, field: string): string | undefined {
  const value = optionalString(raw);
  if (value === undefined) return undefined;
  if (!UUID_PATTERN.test(value)) {
    throw new ValidationException([{ field, message: 'Must be a valid UUID.' }]);
  }
  return value;
}

function optionalInt(raw: unknown, field: string, fallback: number, max?: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new ValidationException([{ field, message: 'Must be a non-negative integer.' }]);
  }
  if (max !== undefined && value > max) {
    throw new ValidationException([{ field, message: `Must be at most ${max}.` }]);
  }
  return value;
}

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new ValidationException([{ field, message: 'Must be a valid UUID.' }]);
  }
}
