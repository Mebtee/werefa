import { apiRequest } from './http'
import type {
  OwnerTelegramStatusView,
  TelegramConnectionView,
  TelegramCustomerConnectInput,
} from './types'

/**
 * Telegram connection API client (Prompt 51; §23.3, REQ-056/065/066).
 *
 * Consumes exactly the implemented backend routes:
 *  - `POST /public/businesses/:slug/telegram/connect` (customer, by phone);
 *  - `GET  /owner/businesses/:id/telegram/status` (acting owner);
 *  - `POST /owner/businesses/:id/telegram/connect` (acting owner).
 *
 * All routes are tenancy-scoped by the backend. A connection response is either
 * `connected` (already linked) or `ready` with a one-time 10-minute deep link —
 * the plain code is never exposed to the client.
 */

/** The customer-facing "linked" shape consumed by the UI. */
export type TelegramLinkState =
  | { state: 'connected' }
  | { state: 'ready'; deepLink: string; expiresAtMs: number }

/**
 * Normalizes the wire connection view into the UI shape. `expiresAtMs` is
 * computed from the server-issued `expiresInMs` at response time so the UI can
 * count down the 10-minute code lifetime without trusting a client clock offset.
 */
export function telegramLinkFromView(
  view: TelegramConnectionView,
  now: number = Date.now(),
): TelegramLinkState {
  if (view.status === 'connected') return { state: 'connected' }
  if (!view.deepLink || view.expiresInMs === null) {
    // The backend guarantees a link whenever status is 'ready'; treat a missing
    // link as a non-fatal expire so the UI can offer a retry.
    return { state: 'ready', deepLink: '', expiresAtMs: 0 }
  }
  return {
    state: 'ready',
    deepLink: view.deepLink,
    expiresAtMs: now + view.expiresInMs,
  }
}

/** Connects a customer phone to Telegram for the business (REQ-056). */
export function connectCustomerTelegram(
  slug: string,
  phone: string,
  signal?: AbortSignal,
): Promise<TelegramConnectionView> {
  const payload: TelegramCustomerConnectInput = { phone }
  return apiRequest<TelegramConnectionView>(
    `/public/businesses/${encodeURIComponent(slug)}/telegram/connect`,
    { method: 'POST', body: payload, signal },
  ).then(({ data }) => data)
}

/** Whether the acting owner has a live Telegram connection for this business. */
export function getOwnerTelegramStatus(
  businessId: string,
  signal?: AbortSignal,
): Promise<OwnerTelegramStatusView> {
  return apiRequest<OwnerTelegramStatusView>(
    `/owner/businesses/${encodeURIComponent(businessId)}/telegram/status`,
    { method: 'GET', signal },
  ).then(({ data }) => data)
}

/** Issues a one-time deep link connecting the acting owner's Telegram (N09). */
export function connectOwnerTelegram(
  businessId: string,
  signal?: AbortSignal,
): Promise<TelegramConnectionView> {
  return apiRequest<TelegramConnectionView>(
    `/owner/businesses/${encodeURIComponent(businessId)}/telegram/connect`,
    { method: 'POST', signal },
  ).then(({ data }) => data)
}