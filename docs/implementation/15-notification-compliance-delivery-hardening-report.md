# 15 — Notification-Compliance & Delivery Hardening (Prompt 25) — Final Report

Status: **IMPLEMENTED** · Final quality-gate run: **all green**.

This report closes out Prompt 25 — Notification-Compliance & Delivery Hardening
(workstreams A–D): real verification-code delivery for rejected-booking
resubmission (`docs/01-master-specification.md` REQ-230, `docs/architecture/08-booking-concurrency.md` §Resubmission), owner Telegram subscription reminders (REQ-139 / `docs/architecture/10-subscription-billing-architecture.md` reminder plan), the SM-08 cancel-compliance fix (REQ-104 AC4, REQ-228 AC1), and the dedicated customer-delivery test matrix (REQ-061/063/064/227/228/229).

## 1. Conformance summary

| Dimension               | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement coverage    | **Workstream A (REQ-230)** — the resubmission verification code is now really delivered instead of dead-lettered: `requestCode` issues a 6-digit code (sha256 hash persisted), hands the PLAINTEXT to the delivery seam (`VerificationCodeChannel`), and the production `TelegramVerificationCodeChannel` sends it to the booking's ACTIVE customer chat (doc 08 §9.2 "approved Telegram channel if connected, else email if held, else no code path"; bookings carry no email, so the chat is the only real path). No path / provider rejection ⇒ the code is **voided at issue** (marks the row used) so it can never be consumed, and the API response stays identical to a phone with no booking (`expiresAt: null`) — REQ-109 anti-enumeration preserved. New security event `BOOKING_VERIFICATION_CODE_NO_CHANNEL` + existing `…_REQUESTED`. **Workstream B (REQ-139)** — the four subscription REMINDER types now fan out to BOTH the business-contact email AND every ACTIVE `business_owner_telegram_connection` chat; delivery re-validates the derived reminder decision (stale-safe, like the email twin), template is plain text with no links. **Workstream C (SM-08, REQ-104 AC4 / REQ-228 AC1)** — `cancelChain` enqueues `BOOKING_CANCELLED` **only** when the prior state was `CONFIRMED`; cancelling a Payment Pending booking produces no customer notification (slot stays locked, unchanged). **Workstream D** — dedicated delivery tests for REQ-061/063/064/227/228/229 asserting the real Telegram `SENT` path for connected customers, `SUPPRESSED` for unconnected, and that PP-cancel / Rejected-cancel never notify. |
| Partial                 | None. No targeted requirement remains partially met.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Deferred (out of scope) | Processing subscription payment workflow via Telegram; customer accounts; payment gateways; automatic verification; refunds; booking creation through Telegram; SMS channel. Dashboard UI automation (no vitest infrastructure exists in `apps/dashboard`; per prior prompts no framework was added — panels remain manually verified and logically covered by the API integration suite).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Explicitly omitted      | A second customer channel (email) for the code (bookings never capture email — `CreateBookingInput`); SMS delivery; exposing any code/booking id in API responses, logs, or security-event payloads; weakening the existing 400-vs-409 treatment (`resubmit` fails for a voided code exactly like an unknown phone). No DB migration was required (seam + security-event type are application-level).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## 2. Requirements addressed

| REQ / DEC | Meaning                                                                   | Where                                                                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-230   | Customer resubmits rejected booking (Rejected → Payment Pending)          | `booking-resubmission.service.ts#requestCode` / `#resubmit` (verification step enforced before the T10 transition)                                                                                               |
| REQ-109   | Phone-only booking identification; no customer-facing reference           | Code rides Telegram as an anonymous 6-digit; response is enumeration-safe; plaintext never stored/logged                                                                                                         |
| REQ-139   | Subscription reminders by email AND business Telegram                     | `notification-catalog.ts#SUBSCRIPTION_OWNER_TELEGRAM_TYPES`, `notification-dispatcher.ts#fanOutOwnerTelegram` + `#deliverSubscriptionOwnerTelegram`, `notification-templates.ts#renderSubscriptionOwnerTelegram` |
| REQ-104   | Owner manual cancel (SM-08: PP cancel = no notification, slot blocked)    | `booking.service.ts#cancelChain` (enqueue gated on prior `CONFIRMED`)                                                                                                                                            |
| REQ-228   | Customer notified only on Cancellation of a Confirmed (connected) booking | `booking.service.ts#cancelChain`, `notifications-telegram.test.ts` describe D                                                                                                                                    |
| REQ-061   | Proof-received / verification-pending notification (connected customer)   | existing dispatcher path; asserted for connected `SENT` + disconnected `SUPPRESSED` in describe D                                                                                                                |
| REQ-063   | 24-hour reminder                                                          | `booking-lifecycle.job.ts#queueReminderWindow(23.5h,24.5h)`, describe D `REQ-063` test                                                                                                                           |
| REQ-064   | 1-hour reminder                                                           | `booking-lifecycle.job.ts#queueReminderWindow(0.5h,1.5h)`, describe D `REQ-064` test                                                                                                                             |
| REQ-227   | Customer notified on No Show (connected)                                  | dispatch of `BOOKING_NO_SHOW`, describe D `REQ-227` test                                                                                                                                                         |
| REQ-229   | Customer notified on reschedule WITH new date/time (connected)            | dispatch of `BOOKING_RESCHEDULED` using `formatBookingLine(newStartAt)`, describe D `REQ-229` test                                                                                                               |

## 3. Existing baseline reused

- **Prompt 11/23** resubmission verification (`resubmission_verification` rows,
  `RESUBMIT` rate limiting, booking-lock transaction, proof lineage
  `replaced_by_proof_id`), owner proof verification and booking chains.
- **Prompt 13** notification outbox + `notification_delivery`,
  customer `telegramConnection` state machine and webhook binding,
  `FakeTelegramProvider`/`TELEGRAM_PROVIDER` test seam, delivery
  retry/idempotency, reminders RLS and `booking-lifecycle.job.ts`.
- **Prompt 14** subscription reminder decision derivation (`reminderDecision`,
  `subscriptionReminderKindOf`), `SUBSCRIPTION_REMINDER_*` outbox rows, and the
  dual-channel admin/owner email fan-out.
- **Prompt 23** `businessOwnerTelegramConnection` ACTIVE-chat model and the
  owner `/start <token>` binding webhook used by the new REQ-139 test.

No second, competing Telegram or notification architecture was introduced.

## 4. Database / schema changes

**None.** Workstream A reuses `resubmission_verification` (voiding via the
existing `used_at` column), workstreams B/C/D ride the existing notification /
delivery / connection tables. The added security-event type
`BOOKING_VERIFICATION_CODE_NO_CHANNEL` lives in the application-level
`SECURITY_EVENT_TYPES` union (`security-events.service.ts`), consistent with how
all other event types are declared.

## 5. Delivery seam design (Workstream A)

`apps/api/src/booking/verification-code.channel.ts` defines the seam:

- `VerificationCodeChannel.deliver(input): Promise<boolean>` — `true` only when
  an approved path existed and the provider accepted the send.
- **`TelegramVerificationCodeChannel`** (production): resolves the booking's
  `telegramConnection` under `SUPER_ADMIN`; ACTIVE + non-null chatId ⇒
  `sendMessage` with `renderVerificationCodeTelegram` (plain text, states the
  code, its 15-minute TTL and single-use; no booking/business details). Any
  other condition returns `false`.
- **`InMemoryVerificationCodeChannel`**: the architected TEST-ONLY double
  (captures deliveries, `failDelivery` knob) — exported and unit-tested but
  **never wired** into the module graph.
- **`provideVerificationCodeChannel()`**: a `VERIFICATION_CODE_CHANNEL` provider
  injecting `[TELEGRAM_PROVIDER, PrismaService]` and always returning the real
  channel; registered in `booking.module.ts`.

`requestCode` flow (`booking-resubmission.service.ts`):

1. Rate-limit (`resub:req`, 3 / 10 min), find newest REJECTED booking for the
   phone under `PUBLIC` scope; no booking ⇒ generic message, nothing issued.
2. Insert `resubmission_verification` (sha256 hash, 15-min TTL, attempts 0).
3. `channel.deliver(...)`; on `false` (no path OR provider failure) **void** by
   setting `usedAt = now` under `PUBLIC + bookingPublic + customerPhone` with a
   `.catch(() => undefined)` guard, record `BOOKING_VERIFICATION_CODE_NO_CHANNEL`
   (FAILURE), and return `expiresAt: null`.
4. Record `BOOKING_VERIFICATION_CODE_REQUESTED` (SUCCESS) and return the generic
   message.

Anti-enumeration invariant: a voided code is indistinguishable from "no booking"
at `resubmit` time (both 400 `Invalid or expired code.`), so a caller cannot
probe whether a matching booking exists via the delivery result.

## 6. Owner Telegram reminders (Workstream B)

- Catalog gains `SUBSCRIPTION_OWNER_TELEGRAM_TYPES` (the four reminder types);
  `SUBSCRIPTION_OWNER_EMAIL_TYPES` keeps them for email, so fan-out is dual.
- `fanOutOwnerTelegram` (reused from the owner-proof branch) creates one
  TELEGRAM intent per ACTIVE owner chat (recipient = chatId); with no chat it
  inserts exactly one SUPPRESSED intent so fan-out stays idempotent.
- The subscription branch fans the Telegram intents and the EMAIL intent in one
  pass; the summed count is reported by `fanOutDue`.
- `deliverSubscriptionOwnerTelegram` re-validates `reminderDecision` against
  `subscriptionReminderKindOf(type)` at processing time (stale-safe, same rule
  as the email twin) and sends the plain-text `renderSubscriptionOwnerTelegram`
  message — no HTML, no links, business name + boundary shown.
- Delivery statuses are durable on `notification_delivery` (`SENT` / `SUPPRESSED`
  per channel), as required for exactly-once fan-out verification.

## 7. Cancellation compliance (Workstream C)

`booking.service.ts#cancelChain` now enqueues `BOOKING_CANCELLED` only when the
prior `booking.status === 'CONFIRMED'` (REQ-104 AC4 / REQ-228 AC1). Cancelling a
`PAYMENT_PENDING` booking keeps the slot LOCKED (SM-08, unchanged) and produces
no customer notification; a `REJECTED` cancel releases the slot (SM-09) and
produces no customer notification (the customer already received the rejection).

## 8. Tests added / updated

Unit (`apps/api/test/unit`):

- **`verification-code.channel.test.ts`** (new, 7 tests): real channel routing
  with a stubbed Prisma transaction (ACTIVE chat ⇒ sent; null / REVOKED /
  PENDING ⇒ false, nothing sent; provider `fail-all` ⇒ false); template has the
  code + TTL + single-use and no booking/business/phone/URL/HTML; the in-memory
  double captures and honors `failDelivery`.
- **`subscription-notifications.test.ts`**: `SUBSCRIPTION_OWNER_TELEGRAM_TYPES`
  exactly the four reminders (and disjoint from payment approve/reject/admin),
  plus all four `renderSubscriptionOwnerTelegram` variants (text-only, business
  name + boundary, no HTML/links) and the defensive fallback.

Integration:

- **`booking-management.test.ts` describe D (rewritten + 3 new tests)**: the
  test env now mounts the REAL `TelegramVerificationCodeChannel` over
  `FakeTelegramProvider` (codes are read from `telegram.sent`, not an in-memory
  double). Helpers add env vars (`TELEGRAM_ENABLED`, `TG_BOT_USERNAME`,
  `TG_WEBHOOK_SECRET`), `telegram.reset()`, `connectChat()`, `requestCode()` and
  `securityEventCount()`. New cases: REQ-230 real delivery with a **no-leak
  assertion** (code never in the API response/logs, stored `code_hash` is a
  64-char hex hash, not the code); **no-path void** (row `used_at` set, resubmit
  400 `Invalid or expired code.`, `BOOKING_VERIFICATION_CODE_NO_CHANNEL` +1);
  **provider-failure void** (`telegram.mode='fail-all'` ⇒ voided, then recovery).
- **`notifications-telegram.test.ts` describe D (7 tests, REQ-061/063/064/227/228/229)**: `confirmedConnected`
  helper drives connect + webhook + webhook-bind; delivery rows and
  `telegram.sent` are asserted per scenario (connected ⇒ SENT with the chatId
  recipient; unconnected ⇒ SUPPRESSED with no send; cancel of a Confirmed
  booking notifies, PP-cancel does not; reschedule message contains
  `formatBookingLine(newStartAt)`). Reminders sweep via
  `app.get(BookingLifecycleJob).queueDueReminders()`.
- **`subscription-billing.test.ts` describe F (updated + 1 new test)**: the two
  reminder tests became channel-aware (EMAIL + TELEGRAM rows asserted
  separately), and a new REQ-139 test connects an owner chat
  (`/start <token>` webhook) and proves a due PAID_END reminder reaches it as
  `SENT` while its email twin is `SENT`. `beforeEach` now truncates the
  Telegram tables (`telegram_update`, `business_owner_telegram_connection`,
  `owner_telegram_action`) matching the other suites — required so the shared
  webhook `update_id` dedup and per-chat uniques stay clean.

## 9. Security & compliance notes

- Code plaintext exists only in memory and on the outbound Telegram message;
  `code_hash` is sha256 hex; screenshots cannot be silently reused (TTL +
  single-use stated in the message).
- Attempt lockout (5), expiry (15 min), phone/business scoping, RLS-pinned
  UPDATEs (`app.customer_phone`), requestCode rate limit (3/10 min) and
  `resubmit` rate limit (5/10 min) all unchanged from Prompt 23.
- Voiding uses `used_at` (not `expires_at`) so the failure state is
  indistinguishable from a non-existent code path at `resubmit` — no 409 code-
  exists oracle.
- The no-path audit trail (`BOOKING_VERIFICATION_CODE_NO_CHANNEL`) never contains
  the code or any booking identifier.

## 10. Final quality gate (this session)

| #   | Gate                   | Command / note                                                                  | Result                                                                                              |
| --- | ---------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | Format                 | `npm run format -- --check`                                                     | PASS                                                                                                |
| 2   | Lint                   | `npm run lint` (root, api, db, shared workspaces)                               | PASS                                                                                                |
| 3   | Typecheck              | `npm run typecheck` (root, api, db, shared workspaces)                          | PASS                                                                                                |
| 4   | Unit tests             | api `253`, shared `4`                                                           | PASS — all green                                                                                    |
| 5   | DB fresh setup         | `set -a; source .env; set +a; npm run db:test:setup --workspace @werefa/db`     | PASS (migrate + RLS)                                                                                |
| 6   | Integration            | `apps/api`: `npx vitest run test/integration`                                   | PASS — 15 files / **312** tests                                                                     |
| 7   | Builds                 | `npm run build` (shared, db, dashboard, public) + `nest build` (api)            | PASS                                                                                                |
| 8   | Startup smoke          | `node --env-file=.env apps/api/dist/main.js` on :3200 → `/api/v1/health/ready`  | PASS — `{"status":"ok","db":"up"}`; secrets masked (`DATABASE_URL:"***"`, `TG_BOT_TOKEN:"(unset)"`) |
| 9   | `git diff --check`     | whitespace sanity                                                               | clean                                                                                               |
| 10  | `.only/.skip` bypasses | none                                                                            | PASS                                                                                                |
| 11  | Debug files/secrets    | none tracked (temporary debug logs removed; smoke log in temp dir, not tracked) | PASS                                                                                                |

Notes: one full-suite run during this session produced a parallel-worker hang
in `owner-payment-verification.test.ts` (identity lock under contention); the
file **passes in isolation (30/30, ~33s)** and the final full-suite run (fresh
DB) is **all green (312/312)** — no code change was involved. Left
**uncommitted** for review, per the working commit rule.

## 11. Known gaps / follow-ups

- The in-memory delivery double remains TEST-ONLY and unwired, as archived —
  a future SMS/email channel would add an implementation beside
  `TelegramVerificationCodeChannel` with no seam change.
- Dashboard panels for the new flows remain manually verified (no
  vitest/testing-library infrastructure in `apps/dashboard`, per prior prompts).
- Reminder delivery for `reminderTrialEnd` / `reminderPaidGrace` /
  `reminderTrialGrace` is covered by catalog/template unit tests and the
  stale-safe integration path; the REQ-139 integration happy-path exercise uses
  PAID_END.
