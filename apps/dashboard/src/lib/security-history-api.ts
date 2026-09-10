import { api } from './api';

export type SecurityHistoryScope = 'owner' | 'admin' | 'superadmin';

export interface SecurityEventRow {
  id: string;
  type: string;
  createdAt: string;
  result: string | null;
  ip: string | null;
  device: string | null;
  browser: string | null;
  userId: string | null;
  businessId: string | null;
  userEmail?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface SecurityHistoryPage {
  events: SecurityEventRow[];
  total: number;
}

export interface SecurityHistoryFilters {
  type?: string;
  result?: string;
  from?: string;
  to?: string;
  businessId?: string;
  role?: string;
  page: number;
  pageSize: number;
}

/** Curated event-type options for the filter select (mirrors the API enum). */
export const SECURITY_FILTER_TYPES: readonly string[] = [
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
  'ADMIN_CREATE',
  'ADMIN_DEACTIVATE',
  'ADMIN_PASSWORD_CHANGE',
  'ADMIN_SELF_PASSWORD_DENIED',
  'FORCE_LOGOUT',
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
  'SERVICE_CREATE',
  'SERVICE_UPDATE',
  'SERVICE_DEACTIVATE',
  'SERVICE_REACTIVATE',
  'SERVICE_DELETE',
  'SERVICE_DELETE_BLOCKED',
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
  'SCHEDULE_SAVE',
  'SCHEDULE_BOOKING_KEEP',
  'SCHEDULE_HISTORY_EXPORT',
  'TELEGRAM_CONNECT_INITIATED',
  'TELEGRAM_CONNECT_DENIED',
  'TELEGRAM_CONNECTED',
  'TELEGRAM_DISCONNECTED',
  'TELEGRAM_TOKEN_EXPIRED',
  'TELEGRAM_LINK_INVALID',
  'TELEGRAM_WEBHOOK_DENIED',
  'TELEGRAM_PHONE_MISMATCH',
  'NOTIFICATION_DELIVERY_FAILED',
  'SUBSCRIPTION_PAYMENT_SUBMITTED',
  'SUBSCRIPTION_PAYMENT_APPROVED',
  'SUBSCRIPTION_PAYMENT_REJECTED',
  'SUBSCRIPTION_REMINDER_ENQUEUED',
  'SECURITY_EVENT_DELETED',
  'SECURITY_EVENT_PURGE',
  'SYSTEM',
];

const RESULT_OPTIONS = ['SUCCESS', 'FAILURE', 'DENIED'] as const;
export { RESULT_OPTIONS };

function buildQuery(
  filters: Omit<SecurityHistoryFilters, 'page' | 'pageSize'> & { page: number; pageSize: number },
): string {
  const q = new URLSearchParams();
  if (filters.type) q.set('type', filters.type);
  if (filters.result) q.set('result', filters.result);
  if (filters.from) q.set('from', new Date(filters.from).toISOString());
  if (filters.to) q.set('to', new Date(filters.to).toISOString());
  if (filters.businessId) q.set('businessId', filters.businessId);
  if (filters.role) q.set('role', filters.role);
  q.set('page', String(filters.page));
  q.set('pageSize', String(filters.pageSize));
  return q.toString();
}

export const ownerSecurityApi = {
  list: (
    f: Omit<SecurityHistoryFilters, 'page' | 'pageSize'> & { page: number; pageSize: number },
  ) => api.get<SecurityHistoryPage>(`/api/v1/owner/security-events?${buildQuery(f)}`),
};

export const adminSecurityApi = {
  list: (
    f: Omit<SecurityHistoryFilters, 'page' | 'pageSize'> & { page: number; pageSize: number },
  ) => api.get<SecurityHistoryPage>(`/api/v1/admin/security-events?${buildQuery(f)}`),
};

export const superAdminSecurityApi = {
  list: (
    f: Omit<SecurityHistoryFilters, 'page' | 'pageSize'> & { page: number; pageSize: number },
  ) => api.get<SecurityHistoryPage>(`/api/v1/super-admin/security-events?${buildQuery(f)}`),
  del: (id: string) => api.del<void>(`/api/v1/super-admin/security-events/${id}`),
};
