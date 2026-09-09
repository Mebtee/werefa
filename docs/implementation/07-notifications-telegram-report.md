# 07 — Notifications & Telegram (Prompt 13) — Section 38 Final Report

Status: **IMPLEMENTED** (core) · Final quality-gate run: **all green** · This report is the
Prompt 13 §38 close-out. Provider transport is layered behind interfaces with a real HTTP
implementation plus a fake used by the integration suite; the owner-Telegram channel and the SMS
channel remain **out of scope** and are recorded honestly below.

## 1. Conformance summary

| Dimension               | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement coverage    | Channels restricted to **EMAIL + TELEGRAM** (SMTP via Nodemailer/Mailhog transport, Telegram via Telegram Bot API over HTTPS); notification outbox written **inside** the tenant transaction (BookingNotificationService / document 13 §4/§6); delivery pipeline with `PENDING → SENDING → SENT` and `FAILED / DEAD_LETTERED / SUPPRESSED` terminal intent (per-channel dispatch); **REQ-060** Telegram connect/status/disconnect with per-booking one-time tokens, `sha256`-stored, 30-minute TTL, token invalidated at bind — **implemented** |
| Partial                 | Provider transports are real code behind `TgProvider`/`EmailProvider` interfaces; integration suite runs a `FakeTelegramProvider` (mode `ok`/`fail-all`, captured `.sent`) and a captured `MailService`. Production delivery therefore runs on the real Transports API but the _configured_ transport in dev is the fake/harness-provider, not a live external service. Outbox **deferred** types remain deferred (see Summary).                                                                                                                |
| Deferred (out of scope) | **Owner-Telegram delivery** (the customer Telegram channel is implemented; owner-facing Telegram chat was never in document 13's envelope — keep via email + dashboard); **SMS channel** (SM-13 reserves the channel constant, delivery never dispatches it); **PERMANENT/UNDELIVERABLE mail hard-bounce** and **retry-with-exponential-backoff job scheduling** beyond the in-worker retry loop demonstrated in tests; provider dead-letter chain beyond `DEAD_LETTERED` via retries with manual re-drive.                                     |
| Explicitly omitted      | No new invented channels (exactly `EMAIL`, `TELEGRAM`); no delivery duplicate in the outbox (idempotency is `(notification, channel, recipient)`, enforced UNIQUE on `notification_delivery.idempotency_key`); no silent data writes during provider calls (provider HTTP is invoked **outside** any DB transaction); no re-sending of a stale reminder (re-validated at fan-out: booking must still be `CONFIRMED` and `start_at` must still match the payload, else `SUPPRESSED` with recipient `'-'`).                                       |

## 2. Quality gate (final, this session)

| Step                 | Command                                                   | Result                                                                                                                                                                                                                                   |
| -------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Format            | `npm run format` then `npm run format:check`              | PASS (0 files flagged after formatting; one leftover debug artifact `apps/api/tmp-bootstrap.mjs` removed)                                                                                                                                |
| 2. Lint              | `npm run lint` (all workspaces)                           | PASS (0 errors)                                                                                                                                                                                                                          |
| 3. Typecheck         | `npm run typecheck` (all workspaces)                      | PASS (0 errors)                                                                                                                                                                                                                          |
| 4. DB bootstrap      | `npm run db:test:setup`                                   | PASS — clean `werefa_test` build; `bootstrap-rls.ts` DROPs the policy set from `foundation/rls.sql` and re-applies it ("RLS policies applied"). New `notification_delivery_superadmin_insert` policy added this session.                 |
| 5. Builds            | `npm run build` (all workspaces)                          | PASS — API `nest build`, dashboard + public `vite build`, db + shared `tsc`                                                                                                                                                              |
| 6. Unit tests        | `npm run test:unit`                                       | PASS — API **131** (15 files, incl. notification-templates, notification-providers, notification-schedule + config masking), DB **5**, Shared **4**                                                                                      |
| 7. Integration tests | `npm run test:integration`                                | PASS — **177** tests, 10 files, fileParallelism=false. `notifications-telegram.test.ts` (17) new; `rls-isolation.test.ts` extended 20 → 25 with the notifications/Telegram RLS block (tests A/B/D, PUBLIC phone-gate, SUPER_ADMIN scope) |
| 8. Startup smoke     | `node apps/api/dist/main.js` → `GET /api/v1/health/ready` | PASS — `{"status":"ok","db":"up"}` on :3000; `TelegramPublicController` (/telegram/connect                                                                                                                                               | status | disconnect mapped) + `TelegramWebhookController` (webhook on Telegram events) mapped; secret masking confirmed (`DATABASE_URL":"***"`, `TG_BOT_TOKEN":"(unset)"`, `TG_WEBHOOK_SECRET":"(unset)"`) |

Numeric deltas vs the Prompt 12 close-out: API unit **104 → 131** (+27), integration
**155 → 177** (+17 `notifications-telegram` +5 notifications/Telegram RLS).

## 3. What was implemented this session

**Data model** (extensions to the foundation migration + `rls.sql`):

- `TelegramConnection` — one connection per booking (`UNIQUE(booking_id)`), status
  `PENDING | ACTIVE | REVOKED | EXPIRED`, one-time `connect_token_hash` (`sha256`) +
  `connect_token_expires_at` (30-min TTL, PENDING-only), `chat_id` bound at bind.
- `Notification` — outbox row written in-transaction with the booking mutation (types
  `BOOKING_PROOF_RECEIVED`, `BOOKING_CONFIRMED`, `BOOKING_REJECTED`, `BOOKING_REMINDER_24H`,
  `BOOKING_REMINDER_1H`, `BOOKING_NO_SHOW`, `BOOKING_CANCELLED`, `BOOKING_RESCHEDULED`,
  `BOOKING_NEW_PROOF_OWNER`, `SCHEDULE_AFFECTED_OWNER`; `tenant_scope` `BOOKING|SCHEDULE`;
  nullable `business_id`/`booking_id` for schedule-scoped rows).
- `NotificationDelivery` — per (notification, channel, recipient) intent, status
  `PENDING | SENDING | SENT | FAILED | DEAD_LETTERED | SUPPRESSED`, `idempotency_key`
  UNIQUE, `provider_message_id`, `error_message`, timestamps; suppressed recipient `'-'`.

**Delivery pipeline** (`notification-dispatcher.ts`, `providers.ts`):

- `fanOutDue()`: PENDING rows with no in-flight dispatch → emails via `MailService` /
  Telegram via connected chat (chat id) or owner email — with the idempotency key so
  re-runs and restart replay are no-ops.
- Reminders re-validated at fan-out: booking must still be `CONFIRMED` and `start_at` must
  still match the notification payload; otherwise `SUPPRESSED` (recipient `'-'`).
- `processDue()`: retries with backoff inside the worker run (`FAILED`), and marks terminal
  after the retry budget (`DEAD_LETTERED`); provider HTTP is called **outside** any DB
  transaction; intents are marked `SENDING` before the provider call so a crashed process
  never silently duplicates dispatch.
- `CUSTOMER_TELEGRAM_TYPES`: the customer Telegram corpus (proof/confirmed/rejected/
  no-show/cancelled/rescheduled + the two reminders). `BOOKING_NEW_PROOF_OWNER` is
  **excluded from delivery** (`DELIVERY_EXCLUDED_TYPES`); owner email keeps the
  schedule-affected channel.

**Telegram public + webhook surface** (both `@Public()`):

- `POST /api/v1/public/businesses/:slug/bookings/:bookingId/telegram/connect` — validates the
  booking's `customer_phone` with the request, mints/refreshes a sha256 one-time token.
- `POST …/telegram/status` — phone-gated status of the connection (PENDING/ACTIVE/…).
- `POST …/telegram/disconnect` — phone-gated revoke.
- `POST /api/v1/telegram/webhook` — HMAC/`X-Telegram-Bot-Api-Secret-Token` protected; binds
  the chat to the booking on `/start` with the token, marks `ACTIVE`, invalidates the token
  one-time, and pages the dispatcher so pending customer intents flush immediately.

**RLS additions** (`foundation/rls.sql` + `bootstrap-rls.cs` drops):

- `telegram_connection`: owner windows (Business-owner select/insert);
  PUBLIC phone-gated window (`scope=PUBLIC AND booking_public AND business_id AND booking's
customer_phone = app.customer_phone`) for connect/status/disconnect; SUPER_ADMIN all.
- `notification_delivery`: owner select/update windows; **new**
  `notification_delivery_superadmin_insert` (scope `SUPER_ADMIN` as the `app` role) so the
  delivery pipeline's fan-out INSERT (SYSTEM actor, `withTenantContext`) is permitted inside
  the RLS columns — closed a gap where the app role had SELECT/UPDATE but no INSERT policy.

**Frontend** (`apps/public`):

- `TelegramConnectCard.tsx` shows the connection card / _Connect on Telegram_ CTA on the
  booking-management panel; `BookingPanel.tsx` wires connect + status + disconnect to the new
  phone-gated endpoints.

## 4. IMPLEMENTED / PARTIAL / DEFERRED summary

| Area                                                                   | Status       | Where / note                                                                                                                      |
| ---------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Channels restricted to EMAIL + TELEGRAM                                | IMPLEMENTED  | `NOTIFICATION_CHANNEL`; no other channel ever dispatched                                                                          |
| Outbox written in tenant transaction                                   | IMPLEMENTED  | `BookingNotificationService.enqueue` inside `TenantTransaction` (booking flows)                                                   |
| Delivery statuses PENDING/SENDING/SENT/FAILED/DEAD_LETTERED/SUPPRESSED | IMPLEMENTED  | dispatcher state machine + tests                                                                                                  |
| Idempotency `(notification, channel, recipient)`                       | IMPLEMENTED  | `deliveryIdempotencyKey()` + UNIQUE column; replay-safe `fanOutDue()`                                                             |
| REQ-060 Telegram connect/status/disconnect                             | IMPLEMENTED  | sha256 token, 30-min TTL, one-time invalidation; phone-gated endpoints                                                            |
| Reminder re-validation at delivery                                     | IMPLEMENTED  | CONFIRMED + start_at match else `SUPPRESSED` with `'-'`                                                                           |
| Provider calls outside any DB transaction                              | IMPLEMENTED  | providers invoked after tx; `SENDING` marker written first                                                                        |
| Owner-email + customer-Telegram dispatch                               | IMPLEMENTED  | workload mapped in test; capture + send verified                                                                                  |
| Producer transport (SMTP / Bot API)                                    | PARTIAL      | real transports exist; suite uses `FakeTelegramProvider` + captured `MailService` (deterministic; no external service dependency) |
| Owner-Telegram chat                                                    | OUT OF SCOPE | document 13 ships customer Telegram; owner goes via dashboard + email                                                             |
| SMS channel                                                            | OUT OF SCOPE | constant reserved, never dispatched                                                                                               |
| Hard-bounce / retry scheduler                                          | DEFERRED     | in-worker backoff demonstrated; cron-based exponential retry job + permanent-bounce handling future                               |
| `BOOKING_NEW_PROOF_OWNER` delivery                                     | OMITTED      | `DELIVERY_EXCLUDED_TYPES` – dashboard-only by design (owner proof inbox)                                                          |

## 5. Prompt-14 boundary

Not started. Next prompt may build on: the `TgProvider`/`EmailProvider` seams now isolate the
transport (a real bot credentials bootstrap + long-poll/webhook cert setup can land without
touching the dispatcher); `notification_delivery_superadmin_insert` closes the pipeline's RLS
INSERT seam; reminder refill and dead-letter ops jobs are natural next steps; no metrics /
analytics work or live Telegram account was required or started. Requirements file `v0.5.0` and
architecture `v1.0.1` were not modified.
