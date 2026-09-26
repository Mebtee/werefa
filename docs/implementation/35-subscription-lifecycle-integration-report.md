# 35 — Real Subscription Lifecycle & Business-Access Integration Report (Prompt 52; spec §17/§40.12–40.14, REQ-125 … REQ-141, REQ-143 … REQ-158, REQ-231)

> **Nature of this pass.** The subscription vertical was already substantially implemented in the
> committed tree (`b8c3b0c` backend, `4504921` frontend; documented at `18b15bf`). Prompt 52 was
> therefore executed as an **audit + gap-hardening** task, not a rebuild. Three real gaps were found
> and closed, and the whole vertical was verified against the canonical specification. No product
> decision was invented and no existing behavior was duplicated.

## 1. Objective

Ensure Werefa's subscription/trial/grace/expiration behavior — and the business-access gating that
depends on it — is backed by the real backend and frontend rather than mock-only state, preserving
the exact approved requirements and leaving the unresolved product decisions untouched.

## 2. Starting specification SHA-256

`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`

## 3. Ending specification SHA-256

`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b` (re-hashed with `certutil` at the
end; unchanged).

## 4. Existing subscription implementation audited

Audited in full before changing anything:

- **Lifecycle derivation (pure):** `domain/lib/subscription-lifecycle.ts` — `deriveCanonicalStatus`
  resolves the paid band first, then trial band, then `EXPIRED`; `ELIGIBLE_FOR_BOOKINGS =
  {TRIAL, TRIAL_GRACE, ACTIVE, PAID_GRACE}`; `nextPeriodEndsAt` extends from `max(periodEndsAt,
  paidGraceEndsAt)`; `paidGraceEndsAfter` = period end + 5 days. `subscription-lifecycle.spec.ts` (8).
- **Gate + pause/resume service:** `domain/services/subscription.service.ts` — `reconcileStatus`,
  `bookingGate`, `isEligibleNow`, `manualResume`, `attemptAutoResume`, schedule-version promotion.
- **Billing workflow:** `domain/services/subscription-billing.service.ts` — owner view, proof
  submission (magic-byte validation, idempotent `submissionKey`), admin queue, approve/reject.
- **Persistence:** `repositories/subscription.repository.port.ts`,
  `prisma-subscription.repository.ts`; models `Subscription`, `SubscriptionProof`,
  `SubscriptionStatusHistory`, `SubscriptionReminder`; enums `SubscriptionStatus`,
  `SubscriptionReviewState`, `ActorType`.
- **HTTP:** `api/owner/business.controller.ts` (`GET :id/subscription`, `POST :id/subscription/proof`,
  `POST :id/pause`, `POST :id/resume`), `api/admin/subscription.controller.ts`
  (`GET admin/subscription/proofs`, approve/reject), projections/payloads DTOs.
- **Trial seeding:** `business.service.ts` → `ensureTrialAtCreation` (30-day trial + 3-day grace).
- **Access gating:** `availability.service.ts` (paused/expired/deactivated ⇒ no slots),
  `booking.service.ts` (`bookingGate` before creating a booking).
- **Notifications:** `domain/events/domain-events.ts` (`SubscriptionNotificationEvent`),
  `notification-outbox-event-bus.ts` (`writeSubscriptionEvent` → N17 admins, N15 owner),
  `notification-delivery.service.ts` (Telegram rendering of N15).
- **Frontend:** `api/subscription.ts`, `api/admin.ts`, `features/owner-portal/components/SubscriptionCard.tsx`,
  `features/admin/SubscriptionReviewPage.tsx`, `features/owner-portal/lib/labels.ts`.
- **Tests:** `http-subscription.db.spec.ts` (9 at audit), `subscription-lifecycle.spec.ts`,
  pause/resume and schedule-version DB tests in `domain-services.db.spec.ts`.

## 5. Files changed

| File | Change |
| --- | --- |
| `backend/src/domain/services/business.service.ts` | Inject `GLOBAL_CLOCK`; trial seeded from the clock instead of `new Date()`. |
| `backend/src/domain/repositories/business.repository.port.ts` | Add `listDueForResume(now)`. |
| `backend/src/domain/repositories/prisma-business.repository.ts` | Implement `listDueForResume`. |
| `backend/src/domain/services/subscription.service.ts` | Record the auto-resume **success** outcome in history (REQ-231); use the clock for schedule-version promotion. |
| `backend/src/domain/services/business-lifecycle.worker.ts` | **New** always-on scheduled auto-resume sweep (REQ-153/154/155/231). |
| `backend/src/domain/domain-services.module.ts` | Register the worker. |
| `backend/src/domain/services/subscription-billing.service.ts` | Trigger auto-resume after approval (REQ-155). |
| `backend/src/config/app-config.ts` | Add `businessLifecycleIntervalMs` (default 60000). |
| `backend/.env.example` | Document `BUSINESS_LIFECYCLE_INTERVAL_MS`. |
| `backend/src/domain/services/business-lifecycle.worker.spec.ts` | **New** unit tests (2). |
| `backend/src/domain/domain-services.db.spec.ts` | +3 auto-resume DB tests; updated constructor call. |
| `backend/src/api/http-subscription.db.spec.ts` | +1 REQ-155 renewal-after-pause DB test. |
| `backend/src/domain/notifications/telegram.db.spec.ts` | Updated constructor call (clock). |
| `frontend/src/features/owner-portal/components/SubscriptionCard.tsx` | Fix product-name typo ("arefa" → "Werefa", REQ-232). |

`frontend/src/features/owner-portal/OwnerPortal.test.tsx` also appears modified from the Prompt 51
test-stability fix; it is unrelated to this prompt and was not touched here.

## 6. Trial behavior

New business ⇒ `ensureTrialAtCreation` writes `TRIAL` with `trialStartedAt = now`, `trialEndsAt =
now + 30d`, `trialGraceEndsAt = now + 33d`. **Gap fixed:** `now` now comes from the injected
`GlobalClock` (was `new Date()`), so trial dates are deterministic and honour the canonical timezone
model. Dates are never owner-editable and the write is an upsert keyed by the unique `businessId`, so
a duplicate/retried creation cannot create a second trial. Trial boundaries are covered by
`subscription-lifecycle.spec.ts` (pure) and `domain-services.db.spec.ts`.

## 7. Trial grace behavior

`TRIAL_GRACE` is derived (not stored) between `trialEndsAt` and `trialGraceEndsAt` (exactly 3 days),
and remains booking-eligible (REQ-132). After `trialGraceEndsAt` the derived status is `EXPIRED`.
Distinct from paid grace.

## 8. Paid subscription behavior

Approval sets `periodEndsAt = nextPeriodEndsAt(...)` (max of current coverage/now + 30 days) and
`paidGraceEndsAt = periodEndsAt + 5d`, and the paid band supersedes the trial band immediately
(REQ-130). `nextPeriodEndsAt` extends from existing coverage so renewals never double-count or create
overlapping periods. No price value is stored or served (see §27).

## 9. Paid grace behavior

After `periodEndsAt`, `PAID_GRACE` is derived for exactly 5 days (`paidGraceEndsAt`), still
booking-eligible (REQ-132); after it, `EXPIRED` and new bookings close (REQ-133). `PAID_GRACE` and
`TRIAL_GRACE` are separate derivation branches.

## 10. Access-gating behavior

Server-side, not a frontend guard:

- **Owner:** retains dashboard/business/customer data after expiry (REQ-141); the subscription
  endpoint returns status + `bookingsEnabled` + proof history.
- **Booking creation:** `booking.service.ts` calls `subscriptionService.bookingGate` (time-aware
  `reconcileStatus`) and throws `SUBSCRIPTION_EXPIRED` (422) when ineligible.
- **Availability:** `availability.service.ts` returns `[]` for paused/expired/deactivated businesses —
  no fabricated "available" slots (REQ-133).
- **Public page:** `public.controller.ts` serves the business profile regardless of subscription state
  (REQ-134); only booking/availability are gated.
- Customer-facing endpoints never expose administrative subscription/payment internals.

## 11. Pause/resume interaction

Pause and subscription are distinct states (`businessSettings.isPaused/reopenAt` vs
`Subscription.status`). Manual resume reconciles first and refuses when expired (REQ-157). Scheduled
resume is now actually wired: `BusinessLifecycleWorker` sweeps businesses where `isPaused` and
`reopenAt <= now` and calls the authoritative `attemptAutoResume`. Auto-resume fires only when
eligible (REQ-153); an expired subscription keeps bookings closed and records the refusal
(REQ-154/REQ-231); indefinite pause (`reopenAt = null`) is never swept (REQ-156); renewal after the
pause window ended reopens via the approval path (REQ-155).

## 12. Schedule interaction

Schedule edits while paused are stored `PENDING` (REQ-150) and retained in history (REQ-152). On
resume the latest pending version is promoted and the previous active version demoted
(REQ-151), with `replacedAt` now taken from the global clock. No schedule policy or history semantics
were changed. Covered by the existing paused-save/promote DB test and the new auto-resume tests.

## 13. Subscription payment-proof behavior

Owner uploads an image/PDF proof through the **shared Prompt 50 proof-storage abstraction**
(`PROOF_STORAGE`, magic-byte sniffing, `PROOF_MAX_BYTES`) — no duplicate storage. Proof rows are
idempotent by the REQ-121 `submissionKey`; reusing a key for another business is a conflict (409).
Payment review state (`PENDING/APPROVED/REJECTED`) is separate from subscription status. No bank API,
Telebirr API, gateway, reconciliation or refunds were implemented.

## 14. Admin / Super Admin review behavior

`requireAdminOrSuperAdmin` gates the queue and both mutations; the roles/counts (1 Super Admin, 2
Admins) were not changed and no new role was added. Owners cannot reach or approve the admin queue
(403). N17 notifies exactly the active `ADMIN` accounts (Super Admin excluded), matching REQ-140.

## 15. Approval / rejection behavior

Approval is atomic and idempotent: inside the per-business advisory lock the proof is guarded
`PENDING → APPROVED`, the paid band is written, status set `ACTIVE`, and history appended; a duplicate
or concurrent second approval gets 409 and never extends twice (verified against the real DB). The
server derives business/subscription/period authoritatively. Rejection requires a reason (≤800 chars),
records it, does not activate/extend, and publishes N15 to the owner; a replay is 409. No refund
behavior.

## 16. Notification integration

Reuses the Prompt 51 infrastructure only. N17 `SUBSCRIPTION_PROOF_SUBMITTED` → two Admin email
outbox rows (suppressed; email sender deferred). N15 `SUBSCRIPTION_PROOF_REJECTED` → owner email
(suppressed) + business-Telegram delivery (PENDING when enabled) rendered by the existing renderer.
No second notification system was created.

## 17. Reminder behavior and unresolved lead-time limitation

The four reminder kinds and "once per band" are approved, but the **numeric lead time is unresolved
(spec §46 item 3)**. N16 remains **deferred**: no reminder is scheduled and no default lead time was
invented. The `SubscriptionReminder` model and the event boundary are preserved as the future seam.
The customer appointment 24h/1h reminders from Prompt 51 are unaffected.

## 18. Frontend changes

Owner `SubscriptionCard` and admin `SubscriptionReviewPage` already consume the real API. This pass
changed only the product-name typo in the expired-state banner (REQ-232). No fabricated price is
displayed anywhere; the proof history shows review state and the rejection reason.

## 19. Mock code removed from production paths

No new mock removal was required: production subscription pages call the real `api/subscription.ts` /
`api/admin.ts`. Test seams (`mock/api.ts`, `test/businessApi.ts`) remain test-only. No silent
production fallback exists.

## 20. Security / authorization

Owner actions go through `TenantGuard.requireOwnedBusiness`; admin actions through
`requireAdminOrSuperAdmin`; cross-tenant reads return 404. The server derives the business,
subscription, period and amount configuration — no client-supplied price/business identity is
trusted. Payment-proof contents are never logged; only review state and datetimes are exposed.

## 21. Concurrency / idempotency

All subscription mutations use the existing per-business advisory lock
(`withBusinessAdvisoryLock`) plus guarded conditional updates — no new external lock, no client-side
locking. Covered: simultaneous approval (exactly-once 30-day extension), duplicate proof submission,
duplicate approval/rejection, and retry-after-response-loss.

## 22. Tests added/changed

- `business-lifecycle.worker.spec.ts` (**new**, 2): sweep fans out and aggregates resumed/refused.
- `domain-services.db.spec.ts` (+3, real DB): auto-resume success + history; auto-resume refused when
  expired + history; indefinite pause never due and not reopened by an active subscription alone.
- `http-subscription.db.spec.ts` (+1, real HTTP+DB): REQ-155 renewal after an ended pause window
  reopens the business.
- Constructor-call updates in `domain-services.db.spec.ts` and `telegram.db.spec.ts` for the clock.

## 23. DB results

`npm run test:db` (real PostgreSQL 16, `RUN_DB_TESTS=true`): **345 passed / 22 files**, on **two
consecutive clean runs** (339/21 before this pass; +6 new tests).

## 24. Frontend results

`npx vitest run`: **430 passed / 35 files**. `npm run typecheck`, `npm run lint`, `npm run build`: PASS.

## 25. Browser-QA results or documented harness limitation

Not run. The repository has **no Playwright/Cypress/Puppeteer harness** (consistent with reports
#28–#34). No large browser framework was added for this prompt. Deterministic seam-level tests
(real-HTTP + real-DB) were used instead; the only UI change is a text typo fix, so there is no visual
regression surface.

## 26. Known limitations / deferred work

- Subscription reminders (N16) deferred behind the unresolved lead-time (§46 item 3).
- Email sender is out of scope; email deliveries are recorded `SUPPRESSED`.
- The auto-resume worker is in-process (`setInterval`, unref'd); a single-instance assumption matches
  the existing notification worker. Multi-instance deployments would need a distributed claim (out of
  scope; not part of the approved architecture).
- No payment gateway/reconciliation/refund by design.

## 27. Confirmation that the subscription-price decision was NOT resolved

No price, currency, monthly amount or default was chosen, hardcoded, inferred or served.
`PRODUCT_SUBSCRIPTION_MONTHLY_PRICE_MINOR` remains `null` and `productParameters(...)` still reports
it `PENDING_CLARIFICATION`. The billing workflow is bank-transfer instructions + proof upload only.

## 28. Confirmation that no other unresolved product decision was silently resolved

All six spec §46 items remain unresolved and untouched (price, global timezone, reminder lead time,
owner booking-report PDF, owner "modify" scope, timezone-abbreviation display). The timezone value
consumed by the clock is still only the configured design default, never a product decision. Prompt 38
Item 6 was not reconstructed.

## 29. Confirmation that the specification was not modified

The canonical specification was read-only throughout; the final full SHA-256 equals the checkpoint
`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`.

## 30. Confirmation that no commit was made

No `git add`/`commit`/`amend`/`push`/`reset` was run. Git history is untouched.

---

## Regression gate summary

| Layer | Command | Result |
| --- | --- | --- |
| Backend | `npm run typecheck` | PASS |
| Backend | `npm run lint` | PASS |
| Backend | `npm run build` | PASS |
| Backend | `npm test` (no DB) | **178 passed / 223 skipped** (34 files: 26 passed, 8 skipped) |
| Backend | `npm run test:db` | **345 passed / 22 files** × 2 consecutive clean runs |
| Frontend | `npx vitest run` | **430 passed / 35 files** |
| Frontend | `npm run typecheck` | PASS |
| Frontend | `npm run lint` | PASS |
| Frontend | `npm run build` | PASS |
| Spec | `docs/WEREFA-COMPLETE-SPECIFICATION.md` | unchanged |

## Close

- Task type: **audit + gap-hardening** of existing subscription infrastructure (not a rebuild).
- Gaps closed: clock-authoritative trial dates; scheduled auto-resume actually wired (worker +
  repository query); auto-resume success recorded in history; REQ-155 renewal triggers auto-resume;
  product-name typo.
- Subscription price: **unresolved** (unchanged). Subscription-reminder lead time: **deferred**
  (unchanged).
- **NO COMMIT MADE.**
