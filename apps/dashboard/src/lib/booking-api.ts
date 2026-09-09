import { api } from './api';

export interface BookingServiceItem {
  id: string;
  serviceId: string | null;
  name: string;
  unitPriceMinor: number;
  durationMinutes: number;
}

export interface BookingOwnerListRow {
  id: string;
  customerName: string;
  customerPhone: string;
  startAt: string;
  endAt: string;
  status: string;
  totalPriceMinor: number;
  totalDurationMinutes: number;
  paymentStatus: string | null;
  services: BookingServiceItem[];
}

export interface BookingHistory {
  id: string;
  fromStatus: string;
  toStatus: string;
  actorType: string;
  occurredAt: string;
  reason: string | null;
}

export interface PaymentHistory {
  id: string;
  fromStatus: string;
  toStatus: string;
  actorType: string;
  occurredAt: string;
}

export interface BookingOwnerDetail {
  id: string;
  businessId: string;
  customerName: string;
  customerPhone: string;
  note: string | null;
  startAt: string;
  endAt: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  totalPriceMinor: number;
  totalDurationMinutes: number;
  services: BookingServiceItem[];
  payment: {
    id: string;
    status: string;
    method: string;
    prepaidMinor: number;
    rejectionReason: string | null;
  } | null;
  slotLock: string | null;
  statusHistory: BookingHistory[];
  paymentStatusHistory: PaymentHistory[];
  proofs: { id: string; submittedAt: string }[];
}

export type BookingSort = 'RECENT' | 'UPCOMING';

export const bookingApi = {
  list: (
    businessId: string,
    opts: {
      status?: string;
      from?: string;
      to?: string;
      sort?: BookingSort;
      page?: number;
      pageSize?: number;
    } = {},
  ) => {
    const q = new URLSearchParams();
    if (opts.status) q.set('status', opts.status);
    if (opts.from) q.set('from', opts.from);
    if (opts.to) q.set('to', opts.to);
    if (opts.sort) q.set('sort', opts.sort);
    if (opts.page != null) q.set('page', String(opts.page));
    if (opts.pageSize != null) q.set('pageSize', String(opts.pageSize));
    const qs = q.toString();
    return api
      .get<{ bookings: BookingOwnerListRow[]; total: number }>(
        `/api/v1/businesses/${businessId}/bookings${qs ? `?${qs}` : ''}`,
      )
      .then((r) => r);
  },
  detail: (businessId: string, bookingId: string) =>
    api
      .get<{ booking: BookingOwnerDetail }>(
        `/api/v1/businesses/${businessId}/bookings/${bookingId}`,
      )
      .then((r) => r.booking),
  accept: (businessId: string, bookingId: string) =>
    api
      .post<{ booking: BookingOwnerDetail }>(
        `/api/v1/businesses/${businessId}/bookings/${bookingId}/accept`,
      )
      .then((r) => r.booking),
  reject: (businessId: string, bookingId: string, reason: string) =>
    api
      .post<{ booking: BookingOwnerDetail }>(
        `/api/v1/businesses/${businessId}/bookings/${bookingId}/reject`,
        {
          reason,
        },
      )
      .then((r) => r.booking),
  cancel: (businessId: string, bookingId: string) =>
    api
      .post<{ booking: BookingOwnerDetail }>(
        `/api/v1/businesses/${businessId}/bookings/${bookingId}/cancel`,
      )
      .then((r) => r.booking),
  reschedule: (businessId: string, bookingId: string, newStartAt: string) =>
    api
      .post<{ booking: BookingOwnerDetail }>(
        `/api/v1/businesses/${businessId}/bookings/${bookingId}/reschedule`,
        { newStartAt },
      )
      .then((r) => r.booking),
  noShow: (businessId: string, bookingId: string) =>
    api
      .post<{ booking: BookingOwnerDetail }>(
        `/api/v1/businesses/${businessId}/bookings/${bookingId}/no-show`,
      )
      .then((r) => r.booking),
  releaseSlot: (businessId: string, bookingId: string) =>
    api
      .post<{ ok: boolean }>(`/api/v1/businesses/${businessId}/bookings/${bookingId}/release-slot`)
      .then((r) => r.ok),
};

export function majorFromMinor(minor: number): string {
  return (minor / 100).toFixed(2);
}

export function minutes(m: number): string {
  return `${m} min`;
}

export function toLocalDateTime(value: string): string {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const STATUS_LABELS: Record<string, string> = {
  PAYMENT_PENDING: 'Payment pending',
  CONFIRMED: 'Confirmed',
  REJECTED: 'Rejected',
  COMPLETED: 'Completed',
  NO_SHOW: 'No-show',
  CANCELLED: 'Cancelled',
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  BANK_TRANSFER: 'Bank transfer',
  TELEBIRR_MOBILE_MONEY: 'Telebirr / mobile money',
};

export const ACTOR_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Platform admin',
  SUPER_ADMIN: 'Super admin',
  CUSTOMER: 'Customer',
  SYSTEM: 'System',
};

export function statusPillClass(status: string): string {
  switch (status) {
    case 'CONFIRMED':
    case 'COMPLETED':
      return 'pill info';
    case 'PAYMENT_PENDING':
      return 'pill warn';
    case 'REJECTED':
    case 'NO_SHOW':
    case 'CANCELLED':
      return 'pill danger';
    default:
      return 'pill';
  }
}
