import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@werefa/shared';
import { Actor } from '../common/decorators/actor.decorator';
import { Roles, RolesExact } from '../common/decorators/roles.decorator';
import { SessionGuard } from '../common/guards/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import type { ActorContext } from '../common/context/actor-context';
import { ValidationException } from '../common/http/app-error';
import { bodyObject, readString } from '../iam/validation';
import { SubscriptionService, type ReviewActor } from './subscription.service';

/**
 * Platform subscription review endpoints (Prompt 14, REQ-137/138, doc 15).
 * Admin (`@Roles(Role.Admin)`, rank-inclusive so Super Admin may also use it):
 * pending queue, detail, approve / reject. Backed by the elevated
 * `app_superadmin` connection and fully audit-trailed. A reviewer can never
 * review a business they own (enforced in the service).
 */
@Controller('/api/v1/admin/subscriptions')
@UseGuards(SessionGuard, RolesGuard)
@Roles(Role.Admin)
export class SubscriptionAdminController {
  constructor(private readonly service: SubscriptionService) {}

  @Get('payments')
  async list(@Actor() actor: ActorContext, @Query() query: Record<string, unknown>) {
    const page = optionalInt(query.page, 'page', 0);
    const pageSize = optionalInt(query.pageSize, 'pageSize', 50);
    return {
      payments: await this.service.adminList(this.asReviewActor(actor), {
        status: optionalStatus(query.status),
        skip: page * pageSize,
        take: pageSize,
      }),
    };
  }

  @Get('payments/:paymentId')
  async detail(@Actor() actor: ActorContext, @Param('paymentId') paymentId: string) {
    return { payment: await this.service.adminDetail(this.asReviewActor(actor), paymentId) };
  }

  @Post('payments/:paymentId/approve')
  @HttpCode(HttpStatus.OK)
  async approve(@Actor() actor: ActorContext, @Param('paymentId') paymentId: string) {
    return this.service.approve(this.asReviewActor(actor), paymentId);
  }

  @Post('payments/:paymentId/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Actor() actor: ActorContext,
    @Param('paymentId') paymentId: string,
    @Body() bodyRaw: unknown,
  ) {
    const body = bodyObject(bodyRaw);
    const reason = readString(body, 'reason', { required: true, min: 5, max: 500 });
    if (!reason) throw new ValidationException([{ field: 'reason', message: 'Required.' }]);
    return this.service.reject(this.asReviewActor(actor), paymentId, reason);
  }

  private asReviewActor(actor: ActorContext): ReviewActor {
    return { userId: actor.userId, role: actor.role === Role.SuperAdmin ? 'SuperAdmin' : 'Admin' };
  }
}

/**
 * Super Admin subscription audit (REQ-177-style; doc 15 §7): strict Super Admin
 * only (`@RolesExact`), full payment + subscription + status history read.
 */
@Controller('/api/v1/super-admin/subscriptions')
@UseGuards(SessionGuard, RolesGuard)
@RolesExact(Role.SuperAdmin)
export class SubscriptionSuperAdminController {
  constructor(private readonly service: SubscriptionService) {}

  @Get('payments/:paymentId')
  async audit(@Actor() actor: ActorContext, @Param('paymentId') paymentId: string) {
    return this.service.superAdminDetail({ userId: actor.userId, role: 'SuperAdmin' }, paymentId);
  }
}

const PAYMENT_STATUSES: readonly string[] = ['PENDING', 'APPROVED', 'REJECTED'];

function optionalStatus(raw: unknown): 'PENDING' | 'APPROVED' | 'REJECTED' | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  if (!PAYMENT_STATUSES.includes(raw)) {
    throw new ValidationException([{ field: 'status', message: 'Unknown payment status filter.' }]);
  }
  return raw as 'PENDING' | 'APPROVED' | 'REJECTED';
}

function optionalInt(raw: unknown, field: string, fallback = 0): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new ValidationException([{ field, message: 'Must be a non-negative integer.' }]);
  }
  return value;
}
