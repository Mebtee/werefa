import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/**
 * Authoritative, exhaustive event-type list (Prompt 15). The type union is
 * derived from this const so consumers (e.g. history filters, doc 22) share a
 * single source of truth for validation.
 */
export const SECURITY_EVENT_TYPES = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'ACCOUNT_LOCKED',
  'LOGOUT',
  'UNRECOGNIZED_DEVICE',
  'PASSWORD_CHANGE',
  'PASSWORD_RESET_REQUEST',
  'PASSWORD_RESET_COMPLETE',
  'PASSWORD_RESET_DENIED',
  'RECOVERY_REQUEST',
  'RECOVERY_COMPLETE',
  // Owner self-registration + email verification (Prompt 17, doc 14 §4).
  'REGISTER',
  'EMAIL_VERIFICATION_REQUEST',
  'EMAIL_VERIFICATION_COMPLETE',
  'ADMIN_CREATE',
  'ADMIN_DEACTIVATE',
  'ADMIN_REACTIVATE',
  'ADMIN_PASSWORD_CHANGE',
  'ADMIN_SELF_PASSWORD_DENIED',
  'FORCE_LOGOUT',
  // Business & tenant management events (Prompt 09, doc 22 / doc 04 §11).
  'BUSINESS_CREATE',
  'BUSINESS_UPDATE',
  'BUSINESS_PAUSE',
  'BUSINESS_RESUME',
  'BUSINESS_RESUME_DENIED',
  'BUSINESS_AUTO_RESUME',
  'BUSINESS_AUTO_RESUME_DENIED',
  'BUSINESS_DEACTIVATE',
  'BUSINESS_REACTIVATE',
  'BUSINESS_MEDIA_UPLOAD',
  'BUSINESS_SELECT',
  'BUSINESS_ADMIN_UPDATE',
  // Service catalog events (Prompt 10, Domain 8).
  'SERVICE_CREATE',
  'SERVICE_UPDATE',
  'SERVICE_DEACTIVATE',
  'SERVICE_REACTIVATE',
  'SERVICE_DELETE',
  'SERVICE_DELETE_BLOCKED',
  'SERVICE_VARIATION_CREATE',
  'SERVICE_VARIATION_UPDATE',
  'SERVICE_VARIATION_DELETE',
  'SERVICE_ADDON_CREATE',
  'SERVICE_ADDON_UPDATE',
  'SERVICE_ADDON_DELETE',
  // Booking & payment events (Prompt 11, Domains 5/6/10/11, doc 22).
  'BOOKING_CREATE',
  'BOOKING_ACCEPT',
  'BOOKING_REJECT',
  'BOOKING_CANCEL',
  'BOOKING_RELEASE_SLOT',
  'BOOKING_RESCHEDULE',
  'BOOKING_NO_SHOW',
  'BOOKING_COMPLETE',
  'BOOKING_VERIFICATION_CODE_REQUESTED',
  'BOOKING_VERIFICATION_CODE_FAILED',
  'BOOKING_VERIFICATION_LOCKED',
  'BOOKING_RESUBMIT',
  'BOOKING_STATUS_VIEW',
  'BOOKING_AUDIT_VIEW',
  'BOOKING_HISTORY_VIEW',
  'BOOKING_HISTORY_EXPORT',
  // Scheduling events (Prompt 12, Domains 12/13/16, docs 10/13/21).
  'SCHEDULE_SAVE',
  'SCHEDULE_BOOKING_KEEP',
  'SCHEDULE_HISTORY_EXPORT',
  // Notifications & Telegram events (Prompt 13, docs 12/13/17).
  'TELEGRAM_CONNECT_INITIATED',
  'TELEGRAM_CONNECT_DENIED',
  'TELEGRAM_CONNECTED',
  'TELEGRAM_DISCONNECTED',
  'TELEGRAM_TOKEN_EXPIRED',
  'TELEGRAM_LINK_INVALID',
  'TELEGRAM_WEBHOOK_DENIED',
  'TELEGRAM_PHONE_MISMATCH',
  'NOTIFICATION_DELIVERY_FAILED',
  // Subscription & billing events (Prompt 14, Domain 17, doc 15/22).
  'SUBSCRIPTION_PAYMENT_SUBMITTED',
  'SUBSCRIPTION_PAYMENT_APPROVED',
  'SUBSCRIPTION_PAYMENT_REJECTED',
  'SUBSCRIPTION_REMINDER_ENQUEUED',
  'SYSTEM',
  // Security-history administration (Prompt 15, REQ-205/206, doc 22 §2/§5).
  'SECURITY_EVENT_DELETED',
  'SECURITY_EVENT_PURGE',
] as const;

export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

export interface RecordSecurityEventInput {
  type: SecurityEventType;
  userId?: string;
  // Business/tenant scope (Prompt 09). Platform events unrelated to a tenant
  // leave this null (security_event is platform-level, no RLS).
  businessId?: string;
  ip?: string;
  device?: string;
  browser?: string;
  result?: 'SUCCESS' | 'FAILURE' | 'DENIED' | string;
  /**
   * Structured, allow-listed audit metadata (Prompt 15). Written only by
   * platform code from DB facts (never client-supplied); the history API
   * returns it sanitized against an explicit allow-list.
   */
  metadata?: Prisma.InputJsonValue | null;
}

/**
 * Append-only security-event logging (doc 22/14). Retention cleanup is a
 * background job (future prompt). Rows never carry PII beyond actor id and are
 * race-free inserts.
 */
@Injectable()
export class SecurityEventService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordSecurityEventInput, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.securityEvent.create({
      data: {
        type: input.type,
        userId: input.userId ?? null,
        businessId: input.businessId ?? null,
        ip: input.ip,
        device: input.device,
        browser: input.browser,
        result: input.result,
        metadata: input.metadata ?? Prisma.JsonNull,
      },
    });
  }
}
