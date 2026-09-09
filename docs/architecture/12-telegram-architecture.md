# 12 — Telegram Architecture

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06
> Binding: REQ-056, REQ-059, REQ-060–069, REQ-124, REQ-139, REQ-227–229. Integration, **not** the core booking database (REQ-059: bookings only originate from the public flow).

## 1. Principle

Telegram is a **messaging integration** for a defined set of notifications and owner actions. All product truth lives in the application database/APIs. Telegram being down, disconnected, or maliciously noisy **never** blocks a valid booking (REQ-056) and **never** corrupts a booking/payment/slot transaction.

## 2. Connections

| Connection                    | Established by                                                                                                                                                              | Lifecycle                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Customer → bot** (optional) | During booking (R056), optional step: start bot with a one-time `connect_token`, verified → `telegram_connection(chat_id)` bound to the customer's booking contact (phone). | Revocable; deleted independently; notifications suppressed once revoked. |
| **Owner/business → bot**      | Owner links a business to the bot during setup (for owner notifications incl. proof requests R065/R066 and business-subscription reminders R139).                           | Per-business; reconnect/relink allowed.                                  |
| **Admin notifications**       | Platform-level: subscription-payment notifications to the two Admins are **email + dashboard**, not Telegram (R140 is email/push-driven; doc 13 for channels).              | —                                                                        |

No explicit Telegram channel is required for Admin/SuperAdmin flows (R142 constrains channels to email + Telegram where confirmed; subscription notifications to Admins are record-level (R140)).

## 3. Interaction modes

- **Pull (notifications):** outbound messages to connected chats via the bot API (`sendMessage`) — executed by the notification worker (doc 13). Content assembled from domain events; customer-specific content only for the customer's own bookings (privacy, R057/R097-style scoping).
- **Push (webhook):** the bot receives owner action callbacks (Accept / Reject with reason R67/R68, plus any other approved owner actions surfaced in Telegram). webhook handler:
  1. **Verify** Telegram signature/secret (`TG_WEBHOOK_SECRET`; X-Telegram-Bot-Api-Secret-Token).
  2. **Deduplicate** via `telegram_update(update_id)` unique — insert/ignore (at-most-once).
  3. **Authenticate actor** via the bound owner connection + linked booking reference (opaque token), never by chat text.
  4. **Map callback → API transition** (doc 09 guarded updates). Exceptions/invalid inputs → ephemeral error reply; no state change.

## 4. Identity & security

| Concern              | Design                                                                                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity association | chat_id ↔ `telegram_connection`; customer identity never derived from chat text/name.                                                                                                                                  |
| Message spoofing     | Callbacks are structured button payloads (`{bookingId:…, action:…, nonce:…}`), not free text; server verifies the webhook secret + connection binding.                                                                 |
| Token/secret mgmt    | Bot token and webhook secret in env/secrets manager; never logged (doc 24); rotate via config.                                                                                                                         |
| Privacy              | Customer chats only receive their own booking/payment events; owner chats only their businesses; PII minimized in message content (booking/phone visible to the owner who owns it, per owner-notification scope R066). |
| Rate limits          | Bot `sendMessage` throttled (sleep/queue per chat, default <20 msg/min); failures retried idempotently (doc 13).                                                                                                       |

## 5. Reliability

| Failure                             | Handling                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Telegram API failure                | NotificationDelivery stays `PENDING` → retry with backoff → `FAILED`→`DEAD_LETTERED` (doc 13). **No retry loops in the booking tx.** |
| Telegram unavailable for a customer | Notifications suppressed for that chat; booking/completion/switching unaffected (R056 AC3).                                          |
| Duplicate update delivery           | `update_id` dedup (insert-ignore) → at-most-once.                                                                                    |
| Bot down / token rotated            | Job alerts (doc 17); owner dashboard still operates fully (proofs reviewable in dashboard R119).                                     |
| Webhook reordering                  | Update idempotency + guarded transitions make ordering safe; stale callbacks are rejected by state guards.                           |

## 6. Cache/queue placement

Telegram sends are queued via NotificationDelivery → BullMQ worker (channels telemetry separate from domain-tx). Long-polling is used in dev/local; webhook in staging/production (ADR-009).
