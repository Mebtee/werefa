import { api } from './api';

export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'GRACE' | 'EXPIRED';

export interface SubscriptionView {
  status: SubscriptionStatus;
  canAcceptBookings: boolean;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  paidPeriodStartAt: string | null;
  paidEndsAt: string | null;
  paidGraceEndsAt: string | null;
  priceMinor: string;
}

export type PaymentStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface PaymentView {
  id: string;
  status: PaymentStatus;
  amountMinor: string;
  note: string | null;
  mime: string;
  sizeBytes: number;
  submittedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

export interface HistoryRow {
  id: string;
  fromStatus: SubscriptionStatus;
  toStatus: SubscriptionStatus;
  actorType: 'OWNER' | 'ADMIN' | 'SUPER_ADMIN' | 'SYSTEM';
  reason: string | null;
  occurredAt: string;
}

export interface AdminPaymentRow {
  id: string;
  businessId: string;
  businessName: string;
  businessSlug: string;
  ownerEmail: string | null;
  status: PaymentStatus;
  amountMinor: string;
  note: string | null;
  mime: string;
  sizeBytes: number;
  submissionKey: string;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  rejectionReason: string | null;
  proofUrl?: string | null;
}

export interface SubscriptionOverview {
  subscription: SubscriptionView;
  payments: PaymentView[];
}

/** Converts the string minor-units amount (e.g. "150000") to major units. */
export function majorFromMinorString(minor: string): string {
  const n = Number(minor);
  return Number.isFinite(n) ? (n / 100).toFixed(2) : minor;
}

export const subscriptionApi = {
  overview: (businessId: string) =>
    api.get<SubscriptionOverview>(`/api/v1/businesses/${businessId}/subscription`).then((r) => r),
  history: (businessId: string) =>
    api
      .get<{ status: SubscriptionStatus; history: HistoryRow[] }>(
        `/api/v1/businesses/${businessId}/subscription/history`,
      )
      .then((r) => r),
  submitPayment: (
    businessId: string,
    file: File,
    submissionKey: string,
    note?: string,
  ): Promise<{ payment: PaymentView; created: boolean }> => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('submissionKey', submissionKey);
    if (note) fd.append('note', note);
    return fetch(`/api/v1/businesses/${businessId}/subscription/payments`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'x-requested-with': 'fetch' },
      body: fd,
    }).then(async (res) => {
      const body = (await res.json().catch(() => null)) as
        | { payment: PaymentView; created: boolean }
        | { error: { detail: string | null; title: string } }
        | null;
      if (!res.ok) {
        const env = body as { error?: { detail?: string | null; title?: string } } | null;
        throw new Error(env?.error?.detail ?? env?.error?.title ?? 'Payment upload failed.');
      }
      return body as { payment: PaymentView; created: boolean };
    });
  },
  getProof: (businessId: string, paymentId: string) =>
    api
      .get<{ url: string; mime: string; sizeBytes: number; submittedAt: string }>(
        `/api/v1/businesses/${businessId}/subscription/payments/${paymentId}/proof`,
      )
      .then((r) => r),
};

export const adminSubscriptionApi = {
  list: (status?: PaymentStatus) => {
    const q = status ? `?status=${status}` : '';
    return api
      .get<{ payments: AdminPaymentRow[] }>(`/api/v1/admin/subscriptions/payments${q}`)
      .then((r) => r.payments);
  },
  detail: (paymentId: string) =>
    api
      .get<{ payment: AdminPaymentRow }>(`/api/v1/admin/subscriptions/payments/${paymentId}`)
      .then((r) => r.payment),
  approve: (paymentId: string) =>
    api
      .post<{ payment: AdminPaymentRow; subscription: SubscriptionView }>(
        `/api/v1/admin/subscriptions/payments/${paymentId}/approve`,
      )
      .then((r) => r),
  reject: (paymentId: string, reason: string) =>
    api
      .post<{ payment: AdminPaymentRow }>(
        `/api/v1/admin/subscriptions/payments/${paymentId}/reject`,
        { reason },
      )
      .then((r) => r.payment),
};

export const superAdminSubscriptionApi = {
  audit: (paymentId: string) =>
    api
      .get<{ payment: AdminPaymentRow; subscription: SubscriptionView; history: HistoryRow[] }>(
        `/api/v1/super-admin/subscriptions/payments/${paymentId}`,
      )
      .then((r) => r),
};
