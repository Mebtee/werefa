import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export type SecurityEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'ACCOUNT_LOCKED'
  | 'LOGOUT'
  | 'UNRECOGNIZED_DEVICE'
  | 'PASSWORD_CHANGE'
  | 'PASSWORD_RESET_REQUEST'
  | 'PASSWORD_RESET_COMPLETE'
  | 'PASSWORD_RESET_DENIED'
  | 'RECOVERY_REQUEST'
  | 'RECOVERY_COMPLETE'
  | 'ADMIN_CREATE'
  | 'ADMIN_DEACTIVATE'
  | 'ADMIN_PASSWORD_CHANGE'
  | 'ADMIN_SELF_PASSWORD_DENIED'
  | 'FORCE_LOGOUT'
  // Business & tenant management events (Prompt 09, doc 22 / doc 04 §11).
  | 'BUSINESS_CREATE'
  | 'BUSINESS_UPDATE'
  | 'BUSINESS_PAUSE'
  | 'BUSINESS_RESUME'
  | 'BUSINESS_RESUME_DENIED'
  | 'BUSINESS_AUTO_RESUME'
  | 'BUSINESS_AUTO_RESUME_DENIED'
  | 'BUSINESS_DEACTIVATE'
  | 'BUSINESS_REACTIVATE'
  | 'BUSINESS_MEDIA_UPLOAD'
  | 'BUSINESS_SELECT'
  | 'BUSINESS_ADMIN_UPDATE'
  // Service catalog events (Prompt 10, Domain 8).
  | 'SERVICE_CREATE'
  | 'SERVICE_UPDATE'
  | 'SERVICE_DEACTIVATE'
  | 'SERVICE_REACTIVATE'
  | 'SERVICE_DELETE'
  | 'SERVICE_DELETE_BLOCKED'
  | 'SERVICE_VARIATION_CREATE'
  | 'SERVICE_VARIATION_UPDATE'
  | 'SERVICE_VARIATION_DELETE'
  | 'SERVICE_ADDON_CREATE'
  | 'SERVICE_ADDON_UPDATE'
  | 'SERVICE_ADDON_DELETE'
  // Booking & payment events (Prompt 11, Domains 5/6/10/11, doc 22).
  | 'BOOKING_CREATE'
  | 'BOOKING_ACCEPT'
  | 'BOOKING_REJECT'
  | 'BOOKING_CANCEL'
  | 'BOOKING_RELEASE_SLOT'
  | 'BOOKING_RESCHEDULE'
  | 'BOOKING_NO_SHOW'
  | 'BOOKING_COMPLETE'
  | 'BOOKING_VERIFICATION_CODE_REQUESTED'
  | 'BOOKING_VERIFICATION_CODE_FAILED'
  | 'BOOKING_VERIFICATION_LOCKED'
  | 'BOOKING_RESUBMIT'
  | 'BOOKING_STATUS_VIEW'
  | 'BOOKING_AUDIT_VIEW'
  // Scheduling events (Prompt 12, Domains 12/13/16, docs 10/13/21).
  | 'SCHEDULE_SAVE'
  | 'SCHEDULE_BOOKING_KEEP'
  | 'SCHEDULE_HISTORY_EXPORT'
  // Notifications & Telegram events (Prompt 13, docs 12/13/17).
  | 'TELEGRAM_CONNECT_INITIATED'
  | 'TELEGRAM_CONNECT_DENIED'
  | 'TELEGRAM_CONNECTED'
  | 'TELEGRAM_DISCONNECTED'
  | 'TELEGRAM_TOKEN_EXPIRED'
  | 'TELEGRAM_LINK_INVALID'
  | 'TELEGRAM_WEBHOOK_DENIED'
  | 'TELEGRAM_PHONE_MISMATCH'
  | 'NOTIFICATION_DELIVERY_FAILED'
  | 'SYSTEM';

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
}

/**
 * Append-only security-event logging (doc 22/14). Retention cleanup is a
 * background job (future prompt). Rows never carry PII beyond actor id and are
 * race-free inserts.
 */
@Injectable()
export class SecurityEventService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordSecurityEventInput): Promise<void> {
    await this.prisma.securityEvent.create({
      data: {
        type: input.type,
        userId: input.userId ?? null,
        businessId: input.businessId ?? null,
        ip: input.ip,
        device: input.device,
        browser: input.browser,
        result: input.result,
      },
    });
  }
}
