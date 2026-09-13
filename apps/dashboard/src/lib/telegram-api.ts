import { api } from './api';

export interface OwnerTelegramStatus {
  connected: boolean;
}

export interface OwnerTelegramConnect {
  connected: boolean;
  /** One-time, expiring deep-link token (only present when not yet connected). */
  token?: string;
  botUsername?: string;
  expiresAt?: string;
  message: string;
}

/**
 * Owner Telegram payment-verification connection (REQ-066/120).
 *
 * Owner-only routes under `/api/v1/businesses/:businessId/telegram`, business
 * scoped by the TenantGuard. The connect token is one-time, expiring and
 * consumed by the shared bot webhook (`/start <token>`); the raw token is never
 * persisted and is only used to build the `t.me` deep link.
 */
export const ownerTelegramApi = {
  status: (businessId: string) =>
    api
      .get<{ telegram: OwnerTelegramStatus }>(`/api/v1/businesses/${businessId}/telegram/status`)
      .then((r) => r.telegram),
  connect: (businessId: string) =>
    api
      .post<{ telegram: OwnerTelegramConnect }>(`/api/v1/businesses/${businessId}/telegram/connect`)
      .then((r) => r.telegram),
  disconnect: (businessId: string) =>
    api
      .post<{ telegram: { message: string } }>(
        `/api/v1/businesses/${businessId}/telegram/disconnect`,
      )
      .then((r) => r.telegram),
};

/** Build the Telegram deep link that binds a chat with the one-time token. */
export function deepLink(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?start=${encodeURIComponent(token)}`;
}
