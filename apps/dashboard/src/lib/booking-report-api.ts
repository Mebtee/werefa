import { api } from './api';

/**
 * Super Admin booking status-history report (REQ-177/178, doc 21). Reported
 * status changes come from the authoritative `booking_status_history` table;
 * Admin/owner surfaces never use these endpoints (403 enforced server-side).
 */

export const BOOKING_REPORT_STATUSES = [
  'PAYMENT_PENDING',
  'CONFIRMED',
  'REJECTED',
  'COMPLETED',
  'NO_SHOW',
  'CANCELLED',
] as const;

export const BOOKING_REPORT_ACTOR_TYPES = ['OWNER', 'ADMIN', 'SUPER_ADMIN', 'SYSTEM'] as const;

export type BookingReportStatus = (typeof BOOKING_REPORT_STATUSES)[number];
export type BookingReportActorType = (typeof BOOKING_REPORT_ACTOR_TYPES)[number];

export type BookingReportSortBy =
  'date' | 'bookingId' | 'customer' | 'business' | 'status' | 'actor';

export interface BookingHistoryRow {
  id: string;
  bookingId: string;
  customerName: string;
  businessName: string;
  occurredAt: string;
  fromStatus: string;
  toStatus: string;
  actorType: string;
  actorUserId: string | null;
}

export interface BookingHistoryPage {
  history: BookingHistoryRow[];
  total: number;
}

export interface BookingHistoryFilters {
  statuses: BookingReportStatus[];
  actorTypes: BookingReportActorType[];
  actorUserId?: string;
  businessId?: string;
  from?: string;
  to?: string;
  sortBy: BookingReportSortBy;
  sortDirection: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

function buildQuery(filters: BookingHistoryFilters): string {
  const q = new URLSearchParams();
  if (filters.statuses.length > 0) q.set('status', filters.statuses.join(','));
  if (filters.actorTypes.length > 0) q.set('actorType', filters.actorTypes.join(','));
  if (filters.actorUserId) q.set('actorUserId', filters.actorUserId);
  if (filters.businessId) q.set('businessId', filters.businessId);
  if (filters.from) q.set('from', new Date(filters.from).toISOString());
  if (filters.to) q.set('to', new Date(filters.to).toISOString());
  q.set('sortBy', filters.sortBy);
  q.set('sortDirection', filters.sortDirection);
  q.set('page', String(filters.page));
  q.set('pageSize', String(filters.pageSize));
  return q.toString();
}

export const superAdminBookingReportApi = {
  history: (filters: BookingHistoryFilters): Promise<BookingHistoryPage> =>
    api.get<BookingHistoryPage>(`/api/v1/super-admin/bookings/history?${buildQuery(filters)}`),
  /** Download URL carrying the current filters (REQ-179: custom range honored server-side). */
  pdfUrl: (filters: BookingHistoryFilters): string => {
    const q = new URLSearchParams();
    if (filters.statuses.length > 0) q.set('status', filters.statuses.join(','));
    if (filters.actorTypes.length > 0) q.set('actorType', filters.actorTypes.join(','));
    if (filters.actorUserId) q.set('actorUserId', filters.actorUserId);
    if (filters.businessId) q.set('businessId', filters.businessId);
    if (filters.from) q.set('from', new Date(filters.from).toISOString());
    if (filters.to) q.set('to', new Date(filters.to).toISOString());
    return `/api/v1/super-admin/bookings/history/pdf?${q.toString()}`;
  },
};
