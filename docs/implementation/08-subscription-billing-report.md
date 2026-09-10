# 08 — Subscription & Billing (Prompt 14) — Section 54 Final Report

Status: **IMPLEMENTED** (core) · Final quality-gate run: **all green** · This report is the
Prompt 14 §54 close-out (`docs/01-master-specification.md` REQ-125..141, `docs/architecture/15-subscription-architecture.md`).
Payments are manual bank-transfer with proof review (REQ-135/136); no payment gateway is
integrated and the monthly price is a placeholder awaiting a decision (recorded below).

## 1. Conformance summary

| Dimension        | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Requirement coverage | Derived status machine `TRIAL → ACTIVE → GRACE → EXPIRED` computed at query time from authoritative date columns (**REQ-127/128/129/130/131**); booking gate `canAcceptBookings` (blocks at EXPIRED, **REQ-133/154/157**) while the public page stays visible (**REQ-134**) and the owner keeps full dashboard/data access (**REQ-141**); manual payment requests with proof upload (image/PDF, **REQ-135/136**) submitted against a single monthly price (**REQ-125/126**); Admin/Super Admin review queue with approve (+30d, **REQ-137**) and reject-with-reason (**REQ-138**); emails to the exactly-two Admin accounts and to the owner (**REQ-139/140**); status-refresh job + auto-resume gate (**REQ-153**). |
| Partial           | REQ-139's "business Telegram" owner-facing reminder channel remains out of scope exactly as established in Prompt 13 (owner → dashboard + EMAIL); all subscription notifications therefore dispatch over **EMAIL**. The review UI is dashboard-only; the API surface is complete.                                                                                                                                                                                                                                                                                                                                 |
| Deferred (out of scope) | Payment gateway / online payment (**REQ-135** is manual transfer + proof); **REQ-125 price value is a placeholder** (`SUBSCRIPTION_PRICE_MINOR = 150_000n` → "ETB 1,500") — decision register mapping pending, no tiering (**REQ-126**) until then. No subscription analytics or dunning automation beyond the email reminders.                                                              |
| Explicitly omitted | No invented statuses/channels; no silent scheduled writes during review (approve/reject claims atomically and every mutation is security-audited); no soft-delete of payments (append-only `subscription_status_history`); reviewer can never review a business they own (**REQ-137 note**).                                                                                                                                                                                                                                                  |

## 2. Quality gate (final, this session)

| Step              | Command                                                                                                    | Result                                                                                                                                                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Format         | `npm run format:check` (root)                                                                              | PASS (0 files flagged)                                                                                                                                                                                                                                                |
| 2. Lint           | `npm run lint` (api, dashboard, db, shared)                                                                | PASS (0 errors)                                                                                                                                                                                                                                                       |
| 3. Typecheck      | `npm run typecheck` (api, dashboard, db, shared)                                                           | PASS (0 errors)                                                                                                                                                                                                                                                       |
| 4. DB bootstrap   | `node --env-file=.env node_modules/tsx/dist/cli.mjs packages/db/src/test-setup.ts`                         | PASS — clean `werefa_test` build; migrations incl. `20260905_000900_subscription_billing` + RLS bootstrap applied (the `npm`-level `db:test:setup` script needs `.env` exported in the shell; the `--env-file` invocation is the reproducible form on this Windows workspace) |
| 5. Builds         | `npm run build` (api `nest build`, dashboard `vite build`, db + shared `tsc`)                              | PASS                                                                                                                                                                                                                                                                  |
| 6. Unit tests     | `npm run test:unit` (api) + db + shared                                                                     | PASS — API **162** (17 files, incl. new `subscription-lifecycle` 19 + `subscription-notifications` 12), DB **5**, Shared **4**                                                                                                                                           |
| 7. Integration    | `npx vitest run test/integration` (api)                                                                    | PASS — **195** tests, 11 files. New `subscription-billing.test.ts` (18) blocks A–G. (One strapped run reported a single 194/195 transient that did not reproduce on two consecutive re-runs; all green.)                                                                 |
| 8. Startup smoke  | `node --env-file=.env dist/main.js` → `GET /api/v1/health/ready`                                           | PASS — `{"status":"ok","db":"up"}` on :3000; liveness 200; all 12 subscription routes mapped (owner, admin, super-admin); secret masking confirmed. Note: running the source via `tsx` trips NestJS DI metadata for one job registrar on this workspace — the compiled `dist` entrypoint is the verified run path. |

Numeric deltas vs the Prompt 13 close-out: API unit **131 → 162** (+31), integration
**177 → 195** (+18 `subscription-billing`).

## 3. What was implemented this session

**Data model** (`packages/db/prisma/migrations/20260905_000900_subscription_billing`, + `rls.sql` / `bootstrap-rls.ts`):

- `Subscription` — exactly one row per business (`businessId` PK), status persisted as a write-back cache of the derived machine, minute-precision date columns enforced by CHECK (`subscription_minute_precision_ck`), `priceMinor` single monthly price (REQ-125/126).
- `SubscriptionPayment` — manual request rows: `PENDING | APPROVED | REJECTED`, `amountMinor`, storage key + mime/size of the proof object, `submission_key` UNIQUE (idempotency), `note`, review metadata (`reviewed_by_user_id`, `reviewed_at`, `rejection_reason`).
- `SubscriptionStatusHistory` — append-only transition ledger: `from_status → to_status`, `actor_type OWNER/ADMIN/SUPER_ADMIN/SYSTEM`, `actor_user_id`, `reason`, `occurred_at`.
- RLS windows: owner select/update over its own business subscription + payments; Admin/Super Admin cross-tenant reads ride the existing elevated `app_superadmin` role; jobs write via SUPER_ADMIN tenant scope; subscription rows follow the existing owner select+update policy set, payments inherit `business`-scoped windows.

**Derived lifecycle + booking gate** (`subscription-lifecycle.ts`, `subscription-availability.service.ts`):

- `derivedStatus()` computes `TRIAL → ACTIVE → GRACE → EXPIRED` purely from `trialStartedAt/trialEndsAt/paidPeriodStartAt/paidEndsAt/paidGraceEndsAt`; `extendPaidPeriod(dates, now)` anchors the extension at `max(paidEndsAt ?? now, now)` + 30d; `paidGraceEndsAtOf(paidEndsAt)` = +5d.
- Booking availability gate: `canAcceptBookings` is false only when the derived status is `EXPIRED` → create-booking returns **409 `SUBSCRIPTION_EXPIRED`**; existing public page and owner dashboard remain fully available (REQ-133/134/141).
- Legacy backfill: `ensureSubscription` materializes a missing subscription row from `business.trialEndsAt` (no state change, REQ backfill-safe) and is invoked on the owner subscription endpoints.

**Owner flows** (`subscription.controller.ts`, owner-only + TenantGuard):

- `GET …/subscription` – overview: derived status, `canAcceptBookings`, boundaries, price + recent 10 payments.
- `GET …/subscription/history` – REQ-141 warning/transition ledger (last 100).
- `POST …/subscription/payments` – multipart proof upload (image/PDF validated by `validateProofFile`), `submissionKey` + `note` as form fields; **idempotent replay** returns the existing request (`created:false`), staged object preserved; fans out the durable `SUBSCRIPTION_PAYMENT_SUBMITTED_ADMIN` outbox row **in the same transaction**; one `SUBSCRIPTION_PAYMENT_SUBMITTED` security event **per actual submission** (replays are not re-audited).
- `GET …/subscription/payments/:paymentId/proof` – owner-authorized presigned read (300 s) of their own proof.

**Admin / Super Admin review** (`subscription-admin.controller.ts` on the elevated `app_superadmin` connection):

- `GET /api/v1/admin/subscriptions/payments?status=` – pending queue with business + owner-email context; `GET …/:paymentId` adds the proof presign URL.
- `POST …/:paymentId/approve` – atomic claim `PENDING → APPROVED` (`updateMany`); a losing/duplicate claimant gets **409 Conflict**; extends paid period +30d (persisted status `ACTIVE`), writes the history row (actor `ADMIN`/`SUPER_ADMIN`), enqueues the owner approval email, records the security event. The response reflects the claimed state.
- `POST …/:paymentId/reject` – reason **required (≥5, ≤500)**; sends the rejection email; subscription state untouched (e.g. stays TRIAL).
- A reviewer can never review a payment of a business they own → **403 FORBIDDEN** (`assertNotBusinessOwner`).
- `GET /api/v1/super-admin/subscriptions/payments/:paymentId` – Super Admin-only full audit (payment + subscription + history).

**Notifications** (`subscription-notifications.ts` + existing catalog/dispatcher):

- `SUBSCRIPTION_PAYMENT_SUBMITTED_ADMIN` → EMAIL to the **exactly two** Admin accounts (first two by `createdAt`, take 2); `SUBSCRIPTION_PAYMENT_APPROVED_OWNER` / `_REJECTED_OWNER` → EMAIL to `business.contactEmail` (else SUPPRESSED with `'-'`); `SUBSCRIPTION_REMINDER_PAID_END` / `_GRACE_END` → EMAIL, re-validated at fan-out (stale → SUPPRESSED), 7-day dedup window. All names live in the notification catalog constants (`SUBSCRIPTION_NOTIFICATION_TYPE`).

**Job** (`jobs/subscription-lifecycle.job.ts`) — `refreshStatuses`: sweeps subscriptions and persists derived TRIAL→ACTIVE→GRACE→EXPIRED write-backs as `SYSTEM`-actor history rows; integrates with the scheduled-resume sweep so **REQ-153/154** hold (`BUSINESS_AUTO_RESUME_DENIED` while EXPIRED). Runs every minute with the existing BullMQ wiring.

**Dashboard UI** (`apps/dashboard`):

- `SubscriptionPanel.tsx` – owner panel: status pill, boundaries + price, payment-request form (proof upload + note), payment history w/ presigned proof links, status-history table; mounted as a "Subscription & billing" section in `BusinessProfile`.
- `SubscriptionReviewPanel.tsx` – platform queue with status filter; detail shows business/owner/amount/note + proof link; approve / reject-with-reason; Super Admin gets the full audit trail; opened from `AdminPanel`.
- `lib/subscription-api.ts` – typed client for owner/admin/super-admin endpoints (multipart submit).

## 4. Bugs found and fixed this session

- **Minute-precision CHECK (critical):** `business.service.ts createWithUniqueSlug` wrote `new Date()` (ms precision) into the materialized `trialStartedAt/trialEndsAt`, tripping `subscription_minute_precision_ck` → every business create 500'd. Fixed with `minuteTrunc`; `ensureSubscription` and `seed:dev` also truncate. This also un-broke the pre-existing `notifications-telegram` integration suite (previous 500).
- **Review responses showed stale status:** `approve`/`reject` returned the pre-claim payment object (still `PENDING`) even after a 200; the response now reflects `APPROVED/REJECTED` + review metadata.
- **Security-event replay double-count:** idempotent payment replays re-recorded `SUBSCRIPTION_PAYMENT_SUBMITTED`; now recorded only for `created === true`.
- **Test-harness trap found & documented:** `TRUNCATE … business CASCADE` silently wiped every session (FK `session.active_business_id`), causing mysterious 401s; `beforeEach` now never cascades from `business`. Whole-minute availability input also fixed (REQ-226).

## 5. IMPLEMENTED / PARTIAL / DEFERRED summary

| Area                                                                   | Status       | Where / note                                                                                                            |
| ---------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Derived TRIAL/ACTIVE/GRACE/EXPIRED state machine (REQ-127…131)         | IMPLEMENTED  | `subscription-lifecycle.ts`; booking gate via `canAcceptBookings`                                                       |
| Booking disabled at EXPIRED; public page + owner access stay (133/134/141) | IMPLEMENTED  | 409 `SUBSCRIPTION_EXPIRED` at create / owner-resume; dashboard intact                                                   |
| Single monthly price, no tiers (REQ-125/126)                           | IMPLEMENTED  | `SUBSCRIPTION_PRICE_MINOR` — **value placeholder, DEC mapping pending**                                                  |
| Manual bank-transfer payment + proof upload (REQ-135/136)              | IMPLEMENTED  | multipart submit, `validateProofFile`, presigned owner read                                                              |
| Idempotent submission (REQ-136)                                        | IMPLEMENTED  | UNIQUE `submission_key`, replay no-op, staged proof kept                                                                 |
| Admin/Super Admin review; approval +30d (REQ-137)                      | IMPLEMENTED  | atomic claim, 409 on double-review, concurrency-tested                                                                   |
| Rejection requires reason → owner email (REQ-138)                      | IMPLEMENTED  | validation + `paymentRejectedOwner` email payload                                                                        |
| Exactly-two-Admin + owner emails (REQ-139/140)                         | IMPLEMENTED  | EMAIL fan-out take-2, owner email, contact-email fallback SUPPRESSED                                                     |
| Reminder emails + dedup + stale re-validation (REQ-139)                | IMPLEMENTED  | dispatcher `subscriptionReminderKindOf` + 7-day dedup                                                                    |
| Owner-facing business-Telegram reminders                              | OUT OF SCOPE | Prompt 13 established owner → dashboard + EMAIL; reminder corpus is EMAIL                                               |
| Payment gateway / online payment                                      | OUT OF SCOPE | REQ-135 is manual transfer; review flow is the reconciliation                                                             |
| Observability counters / metrics for subscription jobs                 | DEFERRED     | joins the later observability prompt                                                                                    |

## 6. Prompt-15 boundary

Not started. Natural seams left for later prompts: `SUBSCRIPTION_PRICE_MINOR` decision-register mapping (single price value + optional tiering, REQ-125/126); an online payment gateway can slot into `submitPayment` behind the existing `storageKey/proof` model; reminder refill + dunning automation; subscription analytics. Requirements file and architecture doc were **not** modified.