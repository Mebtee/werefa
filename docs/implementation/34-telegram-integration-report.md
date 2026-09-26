# 34 — Telegram Integration & Notification Delivery Report (Prompt 51; spec §18/§19, REQ-056/060–069/227–229, T-09)

> **Sequencing note.** `docs/implementation/33-telegram-integration-report.md` already existed in the
> tree when this pass started (it was committed together with report #32 at `18b15bf`, despite that
> checkpoint's text saying "no commit made"). Report #33 is therefore the *previous* Prompt 51 record;
> this is the next unused sequential number. This pass **audited and verified** the existing vertical,
> repaired one date-dependent frontend test flake, and re-ran the full regression gate. Nothing was
> duplicated and no product behavior was invented.

## 1. Objective

Replace any remaining mock-only Telegram connection/notification behavior with the real backend/
application integration, preserving the exact Telegram behavior approved by the canonical
specification — without turning Telegram into a booking channel. Telegram remains a
notification/management channel only (REQ-059).

## 2. Starting canonical specification SHA-256

`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`

## 3. Ending canonical specification SHA-256

`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b` (unchanged; re-hashed with
`certutil -hashfile` at the end of this pass).

## 4. Existing Telegram implementation audited

The real vertical was already present in the committed tree (commit `b8c3b0c` backend +
`4504921` frontend, reports at `18b15bf`). Audited in full:

- **Domain boundary:** `backend/src/domain/notifications/` — `telegram-provider.port.ts`,
  `http-telegram-provider.ts`, `disabled-telegram-provider.ts`, `telegram-connection.service.ts`,
  `telegram-webhook.service.ts`, `telegram-callback.service.ts`, `notification-catalog.ts`,
  `notification-message-renderer.ts`, `notification-outbox-event-bus.ts`,
  `notification-delivery.service.ts`, `notification-background.worker.ts`.
- **HTTP:** `api/telegram/telegram.controller.ts` (webhook), `api/owner/telegram.controller.ts`
  (owner status/connect), `api/public/public.controller.ts` (`POST :slug/telegram/connect`),
  projections/DTOs in `api/dto/`.
- **Persistence:** migrations `20260923115000_telegram_notifications` +
  `20260923120000_telegram_code_hash_unique`; models `TelegramConnection`,
  `TelegramConnectionToken`, `TelegramCallback`, `TelegramUpdate`, `Notification`,
  `NotificationDelivery`.
- **Lifecycle integration:** `domain/services/booking.service.ts` publishes `PAYMENT_PROOF_RECEIVED`,
  `BOOKING_CONFIRMED`, `PAYMENT_REJECTED`, `BOOKING_CANCELLED`, `NO_SHOW`, `BOOKING_RESCHEDULED`
  only **after commit**; `NotificationOutboxEventBus` implements the single `DOMAIN_EVENT_BUS`.
- **Frontend:** `api/telegram.ts`, `features/public-booking/.../TelegramConnectCard.tsx`,
  `features/owner-portal/components/TelegramOwnerCard.tsx`, `features/customer-status/BookingStatusPage.tsx`.

The audit found the vertical complete against spec §18/§19 and the N01–N09 catalog. No behavior was
missing and none was invented.

## 5. Files changed (this pass)

| File | Change |
| --- | --- |
| `frontend/src/features/owner-portal/OwnerPortal.test.tsx` | Scoped the "remove blocked period" click to the row the test added, removing a run-date dependency (see §22). |

No backend file, migration, configuration, specification, or product source was modified in this
pass. The full Prompt 51 implementation is the committed set summarized in §4.

## 6. Telegram provider boundary

- Single port `TelegramProvider` (`sendMessage`, `answerCallbackQuery`, `registerWebhook`) injected
  via the `TELEGRAM_PROVIDER` token. **No second sender abstraction exists.**
- Real adapter `HttpTelegramProvider` talks to `https://api.telegram.org/bot<token>/<method>` over
  `fetch`; the token is constructor-injected from validated config and never logged; every transport
  failure is returned as `{ ok:false, error }` (never thrown).
- `DisabledTelegramProvider` is bound when `TELEGRAM_ENABLED=false`; it never silently "sends".
- Message construction/routing lives in the notification services, not the provider.
- Tests inject deterministic fakes through the same token; the live Bot API is never required by
  ordinary unit tests.

## 7. Connection/linking flow

Code-based, per business and per phone (spec §18):

- `issueCustomerCode` validates the phone has a real booking at the business, expires prior active
  codes, and creates a **single-use** token: CSPRNG (`randomBytes(16)`), stored **only** as a SHA-256
  digest, 10-minute expiry. The plain code is returned exactly once inside the deep link
  `https://t.me/<handle>?start=<code>`; the customer never sees the bare code.
- `issueOwnerCode` is tenancy-guarded (`requireOwnedBusiness`) and binds `(userId, business)`.
- `redeem` is transactional and idempotent: `ISSUED → REDEEMED` with `usedAt`; expired/used codes are
  refused with distinct error codes; the `chatId` binding is written in the same transaction. A
  P2002 on the connection unique constraint maps to a conflict (a chat cannot silently bind to two
  businesses/recipients).
- `connectCustomer`/`connectOwner` are idempotent: already-connected ⇒ `{ status:'connected' }`,
  otherwise `{ status:'ready', deepLink, expiresInMs }`.
- The customer is never required to hold a Werefa account (REQ-040/056); no internal Booking ID is
  used as a connection mechanism.

## 8. Customer notification flow

`NotificationOutboxEventBus.writeCustomerDelivery` writes exactly one Telegram delivery per
`(recipient, event type, booking)` using the stable idempotency key
`customer:<type>:<bookingId>` (unique constraint = exactly-once). A connected customer's delivery is
`PENDING`; an **unconnected** customer's delivery is `SUPPRESSED` and nothing is fabricated. Covered
events (N01–N08): `PAYMENT_PROOF_RECEIVED`, `BOOKING_CONFIRMED`, `PAYMENT_REJECTED` (with the latest
reason resolved from `booking_status_history`), `REMINDER_24H`, `REMINDER_1H`, `NO_SHOW`,
`BOOKING_CANCELLED`, `BOOKING_RESCHEDULED`.

`NotificationDeliveryService.deliverPending` resolves the connected chat, renders canonical text via
`NotificationMessageRenderer`, and records `SENT`/`FAILED`/`DEAD_LETTERED`/`SUPPRESSED`. Booking
validity never depends on delivery (REQ-056): failures are recorded, never thrown, and never held
against the booking.

## 9. Owner notification/management flow

- N09 `PAYMENT_PROOF_RECEIVED` fans out to each connected `BUSINESS_OWNER` connection. At outbox
  write time two `TelegramCallback` rows (`ACCEPT_PROOF`, `REJECT_PROOF`) are created and bound to
  that exact `(connection, business, booking)`, and the callback ids are stored in the delivery
  `payloadRef`. The message carries an inline Accept/Reject keyboard.
- `TelegramCallbackService.acceptProof` calls the **same** authoritative
  `BookingService.acceptProof(ownerActor(...), businessId, bookingId)` as the dashboard — no
  duplicated state machine.
- `TelegramCallbackService.startReject` prompts for the mandatory reason (REQ-068);
  `submitRejectReason` calls the **same** `BookingService.rejectProof(...)`.
- `TelegramService` is the single authoritative payment-verification operation; Telegram has no
  parallel payment state machine.

## 10. Callback/webhook security

- Webhook endpoint `POST /api/v1/telegram/webhook` verifies `X-Telegram-Bot-Api-Secret-Token` in
  **constant time**; mismatches are journalled (`WEBHOOK_SECRET_MISMATCH`) and rejected 401.
- Updates are **exactly-once by `update_id`** (`telegram_update` unique row; P2002 ⇒ replay dropped).
- Inline callbacks are structured (`accept:<uuid>` / `reject:<uuid>`), parsed defensively, and
  claimed with an atomic `OPEN → USED` conditional update. The claim additionally requires that the
  callback's connection `chatId` matches the sender chat, the connection is `CONNECTED`, and the
  connection's business equals the callback's business (T-09) — preventing forged callbacks,
  cross-chat/cross-business/cross-booking replay, and double-tap double-apply.
- Owner actions re-verify ownership through `ownerActor` + the tenant guard at action time.
- Security events recorded: `TELEGRAM_REDEEM`, `TELEGRAM_CALLBACK`, `TELEGRAM_REJECT_REASON`,
  `UPDATE_PROCESSING_FAILED`, `WEBHOOK_SECRET_MISMATCH` (best-effort, never leak provider internals).

## 11. Idempotency/retry behavior

- Delivery identity is the `notification_delivery.idempotency_key` unique constraint; replayed
  publishes and overlapping reminder sweeps are P2002-skipped (earlier write wins).
- Reminders are exactly-once per booking window (24h and 1h are distinct keys).
- `recordFailure` applies bounded exponential backoff (30s → 10min cap) and dead-letters at
  `TELEGRAM_DELIVERY_MAX_ATTEMPTS` (default 5). Stale `SENDING` rows (crashed worker) are reclaimed
  after 10 minutes.
- Honest guarantee: **at-least-once with bounded retries and an exactly-once logical notification
  record**; the provider boundary cannot guarantee absolute exactly-once on the wire (documented, not
  overclaimed).

## 12. Booking lifecycle integration

Booking mutations publish after commit through the one `DOMAIN_EVENT_BUS`
(`NotificationOutboxEventBus`). Cancellation, reschedule, No Show, confirmation and rejection all
route through the existing `BookingService` transitions — Telegram code never mutates booking state.
Automatic completion at T4 is untouched. Telegram failures cannot alter booking state.

## 13. Payment-proof integration

The real Prompt 50 payment-proof workflow publishes `PAYMENT_PROOF_RECEIVED` on submission (T1) and
resubmission (T10). Customers get N01; owners get N09 with Accept/Reject. Telegram Accept/Reject call
the same `BookingService.acceptProof`/`rejectProof` used by the dashboard, preserving validation,
rejection-reason requirements, tenant authorization, resubmission logic and booking-state
transitions.

## 14. Reminder implementation/deferred status

**Implemented** for customer appointment reminders (REQ-063/064: 24h and 1h), which the canonical
spec resolves explicitly. The write side (`writeDueReminders`) and delivery side are exercised by DB
tests. The **unresolved** lead-time decision (spec §46 item 3 — *subscription*-reminder lead time,
REQ-139) was **not** implemented and no default was invented; subscription reminders remain out of
scope for this prompt.

## 15. Frontend changes

- `api/telegram.ts`: real client for `POST /public/businesses/:slug/telegram/connect`,
  `GET/POST /owner/businesses/:id/telegram/status|connect`; maps the wire view to
  `TelegramLinkState` (`connected` | `ready { deepLink, expiresAtMs }`) with the absolute expiry
  derived at response time.
- `TelegramConnectCard.tsx`: optional by-phone connect on the public booking Done step; never blocks
  or re-routes the booking; renders the one-time deep link + live countdown.
- `TelegramOwnerCard.tsx` + `DashboardPage.tsx`: owner card keyed by real `businessId`, real status
  via the owner endpoint, connect issues the one-time link; no disconnect (backend has none).
- `BookingStatusPage.tsx`: live `telegramConnected` projected as a page-level status line from the
  real `/customer/status` view.
- `business.mapper.ts` / `types/models.ts`: removed the fabricated production `telegramConnected`
  (kept optional as a documented mock-seam only).

## 16. Mock Telegram code removed from production paths

- Production pages read Telegram state from the real API only. `mockApi` is still imported by
  `PublicBookingPage`/`BookingStatusPage` **solely** for `getBusinessPage` (display hybridization);
  it never supplies Telegram state.
- `mock/api.ts`/`mock/store.ts` Telegram helpers remain as the **test-only** seam (used by
  `src/test/businessApi.ts`); no silent production fallback exists.
- `features/customer-status/TelegramNotificationsSection.tsx` is **dead code** (not imported
  anywhere); it is a leftover mock/demo component and is not on any production path. Left in place to
  avoid an unrelated deletion; flagged here for transparency.

## 17. Configuration changes

`app-config.ts` adds validated, fail-safe Telegram configuration: `TELEGRAM_ENABLED` (default false),
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_HANDLE`, `TELEGRAM_BOT_WEBHOOK_SECRET`,
`TELEGRAM_BOT_WEBHOOK_URL`, `TELEGRAM_DELIVERY_INTERVAL_MS` (5000), `TELEGRAM_DELIVERY_MAX_ATTEMPTS`
(5). Enabling without token/handle/webhook-secret fails validation. `backend/.env.example` documents
every value with placeholders; no real credentials are committed.

## 18. Security/audit behavior

Tenant/security boundaries: connection resolution is per business; owner actions re-check ownership;
callbacks are chat-bound; provider internals and secrets are never exposed via the API or logs.
Security events use the existing `security_event` table (retained per REQ-204). Telegram-supplied
identifiers are never trusted as authorization for arbitrary resources; identity is resolved
server-side from the bound connection.

## 19. Tests added/changed

- Backend unit: `notification-catalog.spec.ts` (8), `telegram-webhook.service.spec.ts` (13).
- Backend DB: `telegram.db.spec.ts` (20) — connect contract, deep-link-only code, single-use/expiry,
  replay dedupe, suppression vs delivery, reminder idempotency, owner connect, T-09 callbacks,
  accept/reject, secret comparison, bounded retries, tenant scoping.
- Frontend: `api/telegram.test.ts`, `BookingFlow.test.tsx` (Done-step connect),
  `BookingStatus.test.tsx` (connected/disconnected projection), `OwnerPortal.test.tsx` (owner
  connect/connected).
- **This pass:** scoped one schedule-editor assertion in `OwnerPortal.test.tsx` to its own row
  (test-stability only; no product assertion changed).

## 20. DB test results

`npm run test:db` (real PostgreSQL 16 via the dev container, `RUN_DB_TESTS=true`,
`--fileParallelism=false`): **339 passed / 21 files**, confirmed on **two consecutive clean runs**
(plus an initial clean run after the stale test schema was migrated forward). Telegram flow tests
(`telegram.db.spec.ts`, 20) are green in every run.

## 21. Frontend test results

`npx vitest run`: **430 passed / 35 files**. `npm run typecheck` (`tsc -b`), `npm run lint`,
`npm run build` (`tsc -b && vite build`): all PASS.

## 22. Browser QA results

Not run. The repository has **no Playwright/Cypress/Puppeteer tooling** (consistent with reports
#28–#33); the `frontend/qa-shot/` PNGs are static artifacts from earlier manual passes. Deterministic
seam-level tests (real-API boundary tests + real-DB HTTP tests) are the substitute and are green.
Because no product changes were made in this pass beyond a test-scoping fix, there is no visual
regression surface to exercise.

## 23. Known limitations/deferred infrastructure

- No in-repo browser automation harness (see §22).
- Delivery is at-least-once with bounded retries; no absolute wire exactly-once guarantee.
- `TelegramNotificationsSection.tsx` remains as unused dead mock code.
- Subscription reminders (REQ-139 lead time, spec §46 item 3) are deferred and not implemented.
- Email delivery is out of scope and recorded as `SUPPRESSED` outbox rows.

## 24. Unresolved product decisions left untouched

All six spec §46 items remain unresolved and were not invented or inferred: subscription monthly
price, global timezone identity, subscription-reminder lead time, owner booking-report PDF export,
owner "modify" scope, and timezone-abbreviation display. Prompt 38 Item 6 was not reconstructed.

## 25. Confirmation that no specification changes were made

The canonical specification was read-only throughout. Final full SHA-256 equals the checkpoint
`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`.

## 26. Confirmation that no commit was made

No `git add`/`commit`/`amend`/`push`/`reset` was run. Git history is untouched.

---

## Regression gate summary

| Layer | Command | Result |
| --- | --- | --- |
| Backend | `npm run typecheck` | PASS |
| Backend | `npm run lint` | PASS |
| Backend | `npm run build` | PASS |
| Backend | `npm test` (no DB) | **176 passed / 219 skipped** (25 files passed, 8 skipped) |
| Backend | `npm run test:db` | **339 passed / 21 files** × 2 consecutive clean runs |
| Frontend | `npx vitest run` | **430 passed / 35 files** |
| Frontend | `npm run typecheck` | PASS |
| Frontend | `npm run lint` | PASS |
| Frontend | `npm run build` | PASS |
| Spec | `docs/WEREFA-COMPLETE-SPECIFICATION.md` | unchanged |

## Close

- Telegram provider: **real `HttpTelegramProvider` implemented**, fail-safe `DisabledTelegramProvider`
  when disabled.
- Webhook/callback: **implemented** (`POST /api/v1/telegram/webhook`, constant-time secret, `update_id`
  dedupe, T-09 chat-bound structured callbacks).
- Reminders: **customer 24h/1h implemented**; subscription-reminder lead time **deferred** (§46 item 3).
- Working tree: only `frontend/src/features/owner-portal/OwnerPortal.test.tsx` modified (test-stability).
- **NO COMMIT MADE.**
