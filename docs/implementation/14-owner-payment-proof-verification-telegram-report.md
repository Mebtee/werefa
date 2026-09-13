# 14 — Owner Payment-Proof Verification & Owner Telegram Workflow (Prompt 23) — Section 38 Final Report

Status: **IMPLEMENTED** · Final quality-gate run: **all green**.

This report closes out Prompt 23: Owner Payment-Proof Verification & Owner
Telegram Workflow, `docs/01-master-specification.md` REQ-065, REQ-066,
REQ-067, REQ-068, REQ-119 and REQ-120.

An owner can now inspect the actual submitted payment proof from the dashboard
and complete the full Accept / Reject verification from Telegram. Telegram is
strictly a **second writer into the existing authoritative booking service**:
the bot proves "the connected owner for this business pressed this button" and
then calls the same `BookingService.accept` / `BookingService.reject` used by
the dashboard. No second state machine, no Telegram-only validation, no
public endpoint.

## 1. Conformance summary

| Dimension               | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement coverage    | **REQ-119** — owner can retrieve the exact proof of a business booking; endpoint returns a 5-minute presigned read URL, never a storage key, owner-scoped by RLS (`proofView`). **REQ-065** — the booking transaction already created the `BOOKING_NEW_PROOF_OWNER` outbox row; it is no longer in `DELIVERY_EXCLUDED_TYPES` and the dispatcher now fans it out to every ACTIVE owner Telegram connection of the business. **REQ-066** — `renderOwnerTelegramProof` builds the caption (business, customer name/phone, date/time, services, payment method, total, prepaid) and the dispatcher attaches the proof itself (image → `sendPhoto`, PDF → `sendDocument`) with an inline `Accept payment` / `Reject payment` keyboard. **REQ-067** — `pv:accept:<token>` callback executes `BookingService.accept` after chat/ownership/state checks. **REQ-068** — `pv:reject:<token>` opens a short-lived, single-use, chat-scoped `AWAITING_REASON` state; the next text message from the same ACTIVE owner chat supplies the reason and executes `BookingService.reject` with the exact dashboard minimum rule (non-empty, trimmed, ≤ 500 chars). **REQ-120** — the complete receive → review → accept/reject workflow runs through those same services. |
| Partial                 | None. No targeted requirement remains partially met.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Deferred (out of scope) | Telegram subscription reminders, new subscription payment workflows, scheduling UI, booking-interval UI, Redis rate limiting, DB role-count constraints, customer accounts, payment gateways, automatic verification, refunds, new payment statuses, booking creation through Telegram. Dashboard UI automation (no vitest/testing-library infrastructure exists in `apps/dashboard`; per prior prompts no framework was added — panels are manually verified and logically covered by the API integration suite).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Explicitly omitted      | No proof-amount policy (a proof is never auto-rejected for its size); no automatic verification; no new payment states; no customer/booking reference codes; no public proof download; no change to Prompt 21 `payment.prepaid_minor` snapshot semantics.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## 2. Requirements addressed

| REQ     | Meaning                                                    | Where                                                                                                            |
| ------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| REQ-119 | Owner verifies payment proof in dashboard                  | `booking.service.ts#proofView`, `booking.controller.ts` `GET /:bookingId/proofs/:proofId`, `BookingsManager.tsx` |
| REQ-065 | Owner notified when a new payment proof is submitted       | `notification-catalog.ts`, `notification-dispatcher.ts#deliverOwnerProof`                                        |
| REQ-066 | Owner Telegram notification content incl. proof attachment | `notification-templates.ts#renderOwnerTelegramProof`, `providers.ts` media send, dispatcher `deliverOwnerProof`  |
| REQ-067 | Owner can Accept payment proof from Telegram               | `owner-telegram.service.ts#handleCallback` → `BookingService.accept`                                             |
| REQ-068 | Owner can Reject payment proof from Telegram with reason   | `owner-telegram.service.ts#handleTextMessage` → `BookingService.reject`                                          |
| REQ-120 | Owner verifies payment proof through Telegram              | Whole owner-Telegram path above                                                                                  |

## 3. Existing baseline reused

- **Prompt 11** booking/payment model, payment-proof entity + upload, owner
  dashboard Accept/Reject (`BookingService.accept` / `.reject`,
  `withOwnerBookingLock`, `confirmChain` / `rejectChain`), rejected-proof
  resubmission.
- **Prompt 13** notification outbox, `notification_delivery` lifecycle
  (idempotency, retries/backoff, dead-letter, stale-reminder suppression),
  customer Telegram connection model/state machine, webhook
  (`X-Telegram-Bot-Api-Secret-Token`, `update_id` dedup, per-IP rate limit),
  notifications RLS incl. the superadmin INSERT policy.
- **Prompt 21** prepayment configuration and the immutable
  `payment.prepaid_minor` snapshot.
- Existing storage abstraction (`StorageService.presignRead`, 300 s default)
  and the presigned-read pattern already wired for subscription proofs.

No second, competing Telegram architecture was introduced.

## 4. Database changes

New migration
`packages/db/prisma/migrations/20260912_000000_owner_telegram_verification/migration.sql`
(additive, no change to existing migration history):

- **`business_owner_telegram_connection`** — one row per `(user_id, business_id)`;
  `status` (`PENDING|ACTIVE|REVOKED|EXPIRED`), sha256 `connect_token_hash`,
  `connect_token_expires_at`, `chat_id`, `connected_at`.
  - `@@unique([user_id, business_id])` — one binding per owner×business.
  - `@@unique([user_id, chat_id])` — one chat cannot silently take over a second
    business of the same owner. **No global `chat_id` uniqueness**: the shared
    bot legitimately serves one chat across several businesses.
  - FK to `business` (CASCADE) and `user` (RESTRICT).
- **`owner_telegram_action`** — single-use, expiring Accept/Reject action tokens:
  `business_id`, `user_id`, `booking_id`, `payment_id`, `proof_id`, `chat_id`,
  `kind` (`ACCEPT|REJECT`), `status` (`ISSUED|AWAITING_REASON|CONSUMED|EXPIRED`),
  sha256 `token_hash`, `reason`, `expires_at`, `used_at`.
  - CHECK constraints: `kind` and `status` vocabularies; a reason may only exist
    for a REJECT and must be 1..500 chars.
  - Unique `token_hash`; index on `(chat_id, status)` for the pending-reason
    lookup.
- **Prisma schema** — the two models plus `TelegramConnectionStatus` reuse.

Migration verified on: fresh test DB (`db:test:setup`, integration bootstrap),
dev DB (`npm run db:migrate` applied all 14), and RLS re-applied via
`npm run db:rls`.

## 5. API changes

- `GET /api/v1/businesses/:businessId/bookings/:bookingId/proofs/:proofId`
  (owner-only, `TenantGuard`) — REQ-119. Returns `{ url, mime, sizeBytes,
submittedAt }`; the booking must belong to the business and the proof to that
  booking, both checked under `withOwnerBusinessContext` (RLS). Records a
  `PAYMENT_PROOF_VIEWED` security event with `{ proofId, bookingId }` metadata.
  `Cache-Control: no-store`.
- `GET /api/v1/businesses/:businessId/telegram/status` (owner, `TenantGuard`) —
  `{ connected }`.
- `POST /api/v1/businesses/:businessId/telegram/connect` (owner, `TenantGuard`) —
  issues a one-time token (raw returned once; sha256 persisted, TTL 30 min).
- `POST /api/v1/businesses/:businessId/telegram/disconnect` (owner,
  `TenantGuard`) — marks the binding `REVOKED`, clears token/chat.
- No owner-Telegram action endpoint was created; all verification actions arrive
  through the existing authenticated webhook.

`Admin` / `Super Admin` are rejected by `RolesExact(Role.Owner)` on these routes.
Admin/Super Admin retain only their pre-existing platform-level payment review;
they do **not** inherit owner proof-view or owner Telegram action scope.

## 6. Dashboard changes

- `BookingsManager.tsx` — each proof in the booking detail is now clickable;
  "View proof" calls the presign endpoint and opens the short-lived URL. The
  panel already exposed Accept / Reject-with-reason and payment status; the
  prepared/viewable amount comes from the existing booking/payment data
  (`prepaidMinor`, totals).
- `apps/dashboard/src/lib/booking-api.ts` — `proofView` client.
- `apps/dashboard/src/lib/telegram-api.ts` (new) — status/connect/disconnect.
- `apps/dashboard/src/business/OwnerTelegramPanel.tsx` (new) — owner connect
  surface (deep-link token + bot username, status, disconnect); no other
  Telegram UI is exposed to Admin/Super Admin. Wired into `BusinessProfile.tsx`.

## 7. Telegram changes

- **Provider abstraction** (`providers.ts`) — `TelegramProvider` gains
  `sendPhoto`, `sendDocument`, `answerCallbackQuery` and an optional
  `inlineKeyboard` reply markup; `DisabledTelegramProvider` and
  `FakeTelegramProvider` implement all of them. `sendMessage` remains text-only.
- **Notification catalog** — `OWNER_TELEGRAM_TYPES = { BOOKING_NEW_PROOF_OWNER }`.
- **Dispatcher** — `deliverOwnerProof` fetches the proof bytes through
  `StorageService.get(storageKey)`, builds the caption, issues the Accept/Reject
  action rows, and sends the media with the inline keyboard. It suppresses
  safely when the booking is no longer `PAYMENT_PENDING`, when the proof is
  missing, or when the object is gone from storage.
- **Webhook** — still a single entry point; `callback_query` routes to
  `OwnerTelegramService.handleCallback`, `/start <token>` tries the owner binding
  alongside the customer binding, and text messages route to
  `handleTextMessage` (which stays silent for unrelated chat).

## 8. Owner Telegram authentication / authorization model

- The owner connects from the dashboard: an authenticated owner-only endpoint
  issues a one-time token; the owner opens it as `/start <token>` in Telegram.
- `bindOwnerChat` hashes the token, requires a `PENDING` row, checks expiry
  (expired → `EXPIRED`, no rebind) and, on success, moves the row to `ACTIVE`
  with the Telegram-supplied `chat_id` (and `connectedAt`). A `P2002` from the
  `(user_id, chat_id)` unique index is rejected — one chat cannot hijack a
  second business of the same owner.
- **Action authorization never trusts identifiers in the callback.** A callback
  is valid only if the sha256 of its opaque token maps to an action row whose
  `kind` matches, whose `chat_id` equals the Telegram-authenticated sender, and
  whose `(business_id, user_id, chat_id)` is still an **ACTIVE**
  `business_owner_telegram_connection`. Revoked/disconnected identities are
  rejected even with a previously issued token.
- Telegram username/display name is never used as authentication.

## 9. Proof attachment delivery mechanism

- Chosen approach: server-side fetch of the proof bytes through the existing
  storage abstraction (`StorageService.get`) and direct multipart send by the
  provider (`sendPhoto` for images, `sendDocument` for PDFs).
- No public bucket, no storage credentials, no raw object keys and no permanent
  public URL ever leave the API. The owner dashboard uses the same storage
  abstraction through a 5-minute presigned URL.
- Telegram never receives a presigned URL for the proof in this implementation.

## 10. Notification / outbox flow

- The booking transaction continues to insert the outbox row — no synchronous
  external call from the booking transaction.
- The delivery worker/provider performs delivery asynchronously with the
  existing idempotency, retry/backoff and dead-letter lifecycle.
- `BOOKING_NEW_PROOF_OWNER` is no longer delivery-excluded; it fans out to every
  ACTIVE owner Telegram chat of the business. A business with no connected owner
  chat produces a single suppressed delivery (no error), so a disconnected owner
  never blocks booking.
- Retries/replays do not duplicate actions: each delivery's action rows are
  created once per successful attempt, and sends use the delivery record's
  existing idempotency.

## 11. Accept flow

`pv:accept:<token>` → parse (must be 43-char base64url) → rate limit per chat →
claim `ISSUED → CONSUMED` atomically (`updateMany ... WHERE status='ISSUED' AND
usedAt IS NULL AND expires_at > now()`) → then `BookingService.accept(actor,
businessId, bookingId)` with the owner's identity. On success the booking follows
the existing confirmation transition, the customer confirmation notification
follows existing behavior, and `prepaid_minor` is untouched. If the booking was
already accepted/rejected/cancelled elsewhere, `INVALID_TRANSITION` is caught and
the owner gets "The booking has already been processed." — no second transition.

## 12. Reject flow (two-step mandatory reason)

1. `pv:reject:<token>` claims `ISSUED → AWAITING_REASON`, sets `used_at` and a
   short (15 min) expiry window, replies with the reason prompt, and records the
   reject-intent event.
2. The **next text message from the same chat** is parsed by
   `parseOwnerRejectReason` (identical rule to the dashboard `parseRejectInput`:
   non-empty, trimmed, ≤ 500 chars). A too-long/blank reply re-prompts.
3. The pending row is re-checked for a live ACTIVE connection, claimed
   `AWAITING_REASON → CONSUMED` with the reason, and `BookingService.reject` is
   invoked. Empty/short/expired/replayed/wrong-chat attempts cannot complete.

The action row is owner-scoped, business/booking/payment/proof-scoped,
short-lived, single-use and invalidated after completion/expiry. There is no
permanent command that can reject arbitrary booking ids.

## 13. Rejection reason handling

Reused verbatim from the dashboard: mandatory, trimmed, 1..500 characters —
enforced both in the Telegram parser **and** by the DB CHECK on
`owner_telegram_action.reason`. The reason is preserved by the existing booking
payment rejection history model, and the existing rejected-proof resubmission
flow is unchanged.

## 14. Idempotency

- Action tokens: single-use via the atomic claim; a replayed callback returns a
  terminal "already used"/"expired" answer and cannot re-execute.
- Notifications: one submit creates one intent; worker/Telegram/webhook retries
  and duplicate deliveries are handled by the existing outbox/delivery
  mechanisms.
- Webhook updates are deduplicated on `update_id`.
- Repeated Accept/Reject against an already-finalized booking surfaces the
  idempotent "already processed" response.

## 15. Concurrency

Dashboard and Telegram are two writers into the same service, so both go through
`withOwnerBookingLock` + the existing transition chains. Covered by integration
tests: dashboard-Accept-then-Telegram-Accept,
Telegram-Accept-then-dashboard-Accept, dashboard-Reject-then-Telegram-Accept,
Telegram-Reject-then-dashboard-Accept, duplicate Telegram callback, and
simultaneous decisions. Result: one authoritative state transition, no double
confirmation, no duplicate side effects.

## 16. RLS / tenant isolation

Added (in the shared `rls.sql` policy block, applied idempotently by
`bootstrap-rls.ts`):

- `business_owner_telegram_connection` — owner may select/insert/update/delete
  only its own rows where `user_id = app.current_user_id()` **and** the business
  is one the user owns (`business_owner` membership); plus a superadmin policy.
  `FORCE ROW LEVEL SECURITY`.
- `owner_telegram_action` — **not tenant-addressable**: system/superadmin scope
  only (the owner never reads action tokens directly). `FORCE ROW LEVEL
SECURITY`.

Verified by explicit RLS tests in `rls-isolation.test.ts` (Owner A cannot read
or write Owner B's connection; owner app-role cannot read/write
`owner_telegram_action`; superadmin pipeline still works), plus
`owner-payment-verification.test.ts` (Owner A cannot view/accept/reject Owner B's
proof; Customer Telegram cannot invoke owner actions; revoked identity cannot
act; cross-business accept/reject fails).

## 17. Security / audit events

New security-event types: `TELEGRAM_OWNER_CONNECT_INITIATED`,
`TELEGRAM_OWNER_CONNECTED`, `TELEGRAM_OWNER_DISCONNECTED`,
`TELEGRAM_OWNER_TOKEN_EXPIRED`, `TELEGRAM_ACTION_ACCEPTED`,
`TELEGRAM_ACTION_REJECTED`, `TELEGRAM_ACTION_INVALID`,
`TELEGRAM_ACTION_EXPIRED`, `TELEGRAM_ACTION_REUSED`,
`TELEGRAM_ACTION_UNAUTHORIZED`, and `PAYMENT_PROOF_VIEWED` (proof read; metadata
limited to `{ proofId, bookingId }` through the metadata allow-list). No
passwords, bot tokens, storage credentials, raw proof contents or signed URLs
are logged.

## 18. Tests

| Suite                    | File                                                                                               | Tests        |
| ------------------------ | -------------------------------------------------------------------------------------------------- | ------------ |
| Unit                     | `test/unit/owner-telegram.test.ts`                                                                 | 11           |
| Integration              | `test/integration/owner-payment-verification.test.ts`                                              | 30           |
| RLS                      | `test/integration/rls-isolation.test.ts` (extended)                                                | +4 new cases |
| Unit (existing, updated) | `notification-providers.test.ts`, `notification-templates.test.ts`, `notification-helpers.test.ts` | —            |

Unit coverage: owner notification construction, Telegram owner
authorization/parsing, business-ownership validation, Accept/Reject action
parsing, rejection-reason validation (empty/too-long), expired action, replayed
action, revoked identity, customer-Telegram-cannot-invoke-owner-action, proof
attachment selection (image vs PDF), notification idempotency, provider failure
categories, current-state / already-processed responses.

Integration coverage (30): owner new-proof notification; dashboard proof
retrieval; Owner A cannot view Owner B proof; Admin/Super Admin cannot use the
owner proof endpoint; owner Telegram new-proof notification; required
booking/payment content present; image proof delivery; PDF proof delivery;
owner accepts from Telegram; Telegram Accept confirms via the existing service;
customer confirmation when connected; owner rejects from Telegram; Telegram
Reject requires a reason; customer rejection notification with reason; empty/
too-short reason rejected; expired rejection state unusable; replayed rejection
state unusable; revoked identity cannot act; wrong owner identity cannot act;
cross-business accept/reject fails; customer Telegram cannot perform owner
actions; concurrent Accept/Reject safety (both orders); duplicate callback
idempotency; duplicate delivery suppression; provider failure follows
retry/dead-letter; existing customer Telegram booking flow intact; existing
dashboard Accept/Reject intact.

Counts at gate: **unit 252** (api 243 / db 5 / shared 4), **integration 301**.

## 19. Known limitations

- Real Telegram transport is exercised only through `FakeTelegramProvider` in
  tests; the live Bot API path is implemented but not integration-tested against
  Telegram (no outbound network in CI).
- Dashboard and public apps still have no automated UI test framework (unchanged
  from prior prompts); new panels are manually verified and covered through the
  API integration suite.
- One owner chat binding is per (owner, business); changing chat requires
  disconnect + reconnect.
- `npm run db:migrate` was applied to the local dev DB during verification (all
  14 migrations); this is the normal developer workflow and not tracked.
- Test hardening: the existing delivery-pipeline retry test in
  `notifications-telegram.test.ts` used `next_attempt_at = now()` to re-arm a
  failed row; on this Windows host the DB clock runs a few ms ahead of the
  caller, so the claim query (compared against `new Date()`) never considered
  the row due. It was re-armed with `now() - interval '1 second'` (the same
  clock-skew-safe pattern the Prompt 23 owner verification test uses) so the
  retry assertion is deterministic — no assertion was weakened.

## 20. Explicit non-goals

REQ-022, REQ-032, REQ-083, REQ-088, REQ-098, REQ-099, REQ-135, REQ-138,
REQ-139, REQ-140, REQ-141, REQ-149, REQ-158, REQ-160, REQ-165, REQ-171,
REQ-225, REQ-226, plus subscription Telegram reminders, new subscription payment
workflows, scheduling/booking-interval UI, Redis rate limiting, DB role-count
constraints, customer accounts, payment gateways, automatic verification/refunds,
new payment statuses/identifiers, and booking creation through Telegram.

## 21. Traceability

Formal REQ IDs only: REQ-065, REQ-066, REQ-067, REQ-068, REQ-119, REQ-120.
**No `DEC-001…DEC-250` source-word mapping is claimed or fabricated** — the
original 250-decision register has no verbatim source wording in this
repository. No requirement was silently invented.

## 22. Section 38 close-out

| Gate                             | Result                               |
| -------------------------------- | ------------------------------------ |
| `format:check`                   | PASS                                 |
| `lint`                           | PASS                                 |
| `typecheck`                      | PASS                                 |
| `build`                          | PASS                                 |
| unit tests                       | PASS — 252 (api 243, db 5, shared 4) |
| integration                      | PASS — 301                           |
| DB/RLS tests                     | PASS (included above)                |
| startup smoke                    | PASS — `{"status":"ok","db":"up"}`   |
| `git diff --check`               | clean (only LF→CRLF notices)         |
| `.only/.skip/.todo` bypasses     | none                                 |
| debug files / secrets / temp env | none tracked                         |

Left **uncommitted** for review, per the Prompt 23 commit rule.
