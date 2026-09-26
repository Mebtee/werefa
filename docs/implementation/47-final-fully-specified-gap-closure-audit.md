# 47 — Final Fully-Specified Gap-Closure Audit

Prompt: **Prompt 63 — Werefa Final Fully-Specified Gap Closure Audit**
Status: **COMPLETE** (one safe, fully-specified implementation vertical selected and implemented)
Report date: 2026-09-26
Repository: Werefa (`master`, HEAD `80a69ff`)

---

## 1. Executive summary

This Prompt performed a final, independent, requirement-level audit of
**REQ-001 … REQ-232** against the **current repository** (not against earlier
reports). It re-verified every previously *blocked*, *partial* and *deferred*
classification, swept the special-attention areas, the API/frontend contracts,
cross-tenant security, idempotency and database integrity, and then implemented
the **only** gap it found whose behavior is fully specified, requires no product
or provider decision, and is safely testable.

**One safe fix was implemented:** the rejected-booking resubmission
verification code (REQ-230) is now actually delivered through the approved
channel — the customer's connected Telegram chat — and voided when that channel
is absent, exactly as canonical **§23.3 / BR-35** requires.

The audit also **corrected the implementation-coverage baseline**. Prompt 44
recorded 228 IMPLEMENTED; this audit found that the current rebuild does **not**
implement the email-delivery-dependent authentication slice
(**REQ-026 … REQ-033**) and that **REQ-195** and **REQ-221** (like the already
known **REQ-198**) are mechanism-only pending an external email provider. These
are **not** "work remains that a safe fix could close": every one of them is
blocked on an **approved external email sender**, which is a deployment input.

- Fully-specified category-B gaps remaining after this Prompt: **none**.
- Safe fixes implemented: **1**.
- The canonical specification was **not modified** (hash unchanged).
- **No commit was created** (HEAD unchanged at `80a69ff`).

## 2. Starting repository state

- Branch `master`; HEAD `80a69ff1aefcb06e5336547dd85bf23dbadf75d0` (unchanged).
- Working tree: 115 uncommitted entries (the whole implementation is
  uncommitted by design). `backend/` (NestJS modular monolith + Prisma/PostgreSQL)
  and `frontend/` (React 19 + Vite 6). No `infrastructure/` directory, no
  Dockerfiles; `backend/docker-compose.dev.yml` runs PostgreSQL 16 on host port
  5433. `docs/implementation/46-…` was the latest report; `47` did not exist.
- Docker Desktop was already running; container `werefa-db-dev` was healthy.

## 3. Specification hash before work

```
5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b  docs/WEREFA-COMPLETE-SPECIFICATION.md
```

Verified at the start (and end — Section 23) and equal to the required digest.

## 4. REQ-001 … REQ-232 classification summary

Every requirement was classified into exactly one of the six permitted
categories. Totals:

| Category | Count |
| --- | --- |
| **A — IMPLEMENTED** | **215** |
| **B — PARTIAL, fully-specified remainder implementable now** | **0** (after this Prompt's fix) |
| **C — PARTIAL, remainder requires deployment/provider input** | **11** |
| **D — BLOCKED, canonical specification insufficient** | **3** (+ §25.3/§46-4 with no dedicated REQ number) |
| **E — DEFERRED BY DESIGN** | **3** |
| **F — PRODUCT DECISION REQUIRED** | **0** |
| **Total** | **232** |

Legend for the delta from report 44: report 44 recorded 228 A / 1 partial /
3 D / 3 E. This audit moved **11** requirements from A to C after verifying
against current source that their remaining behavior needs an external email
provider (Section 9), and **REQ-230** was completed to A by the fix in
Section 6.

### Category C — provider-dependent (11)

| REQ | Summary | Why C |
| --- | --- | --- |
| REQ-026 | Owner email verification required | Account is created `isEmailVerified=false`, but there is **no** verification flow/link and nothing gates the account. Completing it requires an approved email sender; gating without one would lock out every owner. |
| REQ-027 | Unverified users blocked from dashboard | Depends on REQ-026 (no verification state is ever changed). |
| REQ-028 | Verification links time-limited | No verification link exists. |
| REQ-029 | Expired link replacement | No verification link exists. |
| REQ-030 | Verification request rate limiting | No verification request endpoint exists. |
| REQ-031 | New link invalidates previous | No verification link exists. |
| REQ-032 | Successful verification may auto-authenticate | Depends on the absent verification slice (MAY). |
| REQ-033 | Forgot-password via email reset | No password-reset-by-email flow or endpoint exists; requires an email sender. |
| REQ-195 | Lockout generates immediate email | Mechanism enqueues `LOCKOUT_EMAIL`; delivery is `SUPPRESSED` because `EmailProvider` is `DisabledEmailProvider`. |
| REQ-198 | Super-Admin emergency recovery email | Same: mechanism implemented/tested, delivery suppressed (unchanged from report 44). |
| REQ-221 | Forced logout sends immediate email | Same: mechanism enqueues `FORCED_LOGOUT_EMAIL`, delivery suppressed. |

## 5. Every category-B finding

Exactly **one** requirement matched the category-B rule before implementation:

| REQ | Summary | Status before | Status after |
| --- | --- | --- | --- |
| REQ-230 | Rejected booking: customer may resubmit proof — protected by a one-time code delivered over the approved channel | B (fully specified, implementable; delivery missing) | A (implemented in this Prompt) |

**Why it is fully specified (not blocked/deferred/product):**

- The canonical specification fixes the behavior in **§23.3** verbatim: the code
  "SHALL be delivered through the approved code delivery channel: the customer's
  connected Telegram chat when present; otherwise the business-held email when
  one is held; otherwise no code is delivered and the code is voided (no code
  path)." **BR-35** repeats it. This is listed under *resolved* items in §46
  ("resolution per Section 23.3"), so it is **not** an unresolved §46 decision.
- The platform models **no customer email** (bookings carry name/phone only), so
  the "business-held email" branch is vacuous and the only real channel is the
  customer's connected Telegram chat. The failure branch ("otherwise void") is
  itself specified.
- The Telegram transport boundary (`TelegramProvider`), the connection model
  (`TelegramConnection`, `kind=CUSTOMER`, `state=CONNECTED`) and the security-event
  table **already exist** — no new architecture, table, migration or provider.
- Deterministically testable with a fake provider.

**Evidence that it was genuinely missing in the current rebuild:** the service
carried an explicit note — *"code delivery (Telegram/email) is out of scope. The
code itself is never returned or logged; a delivery adapter plugs in here."* — and
the frontend wire types stated *"code DELIVERY is out of scope."* A repository-wide
search found **no** delivery seam (`VerificationCodeChannel` and friends existed
only in an older, superseded codebase described by report 15, not in this tree).

## 6. Safe fixes implemented

### Fix 1 — REQ-230 resubmission code is delivered over the approved channel

Design (minimal, architecture-faithful):

1. **New port** `backend/src/domain/notifications/verification-code-channel.port.ts`:
   `VerificationCodeChannel` returning the three canonical outcomes
   `DELIVERED | NO_CHANNEL | CHANNEL_DISABLED`, plus a fail-safe
   `NoopVerificationCodeChannel` (default in direct unit construction).
2. **New adapter** `backend/src/domain/notifications/telegram-verification-code-channel.ts`:
   when `TELEGRAM_ENABLED`, find the booking customer's latest `CONNECTED`
   customer chat for the business + phone and send the plaintext code through the
   existing `TelegramProvider`; returns `CHANNEL_DISABLED` when the channel is
   off, `NO_CHANNEL` when there is no chat or the provider refuses. The plaintext
   code is never persisted or logged (the row still stores only its SHA-256 hash).
3. **`ResubmissionService.requestCode`** now calls the channel after issuing the
   code. On `NO_CHANNEL` it **voids** the code (guarded `markUsed`) and records the
   security event `BOOKING_VERIFICATION_CODE_NO_CHANNEL`, per §23.3. On
   `DELIVERED`/`CHANNEL_DISABLED` the code stays live until its TTL (previous
   behavior preserved when the Telegram channel is operationally disabled). The
   plaintext is still never returned or logged, and the API response shape is
   unchanged (uniform, anti-enumeration).
4. **`DomainServicesModule`** binds `VERIFICATION_CODE_CHANNEL` to the Telegram
   adapter.

### Documentation

- `frontend/src/api/types.ts`: corrected the stale comment that claimed delivery
  was out of scope (now: delivered to the connected Telegram chat).
- `README.md`: corrected the provider-dependent limitation list (Section 12) to
  include REQ-026–031/REQ-033 and REQ-195/REQ-221 alongside REQ-198.

## 7. Regression tests added

No existing tests were removed or weakened; tests were only added.

- `backend/src/domain/notifications/telegram-verification-code-channel.spec.ts`
  (**+4**): disabled → `CHANNEL_DISABLED` (no lookup, no send); no chat →
  `NO_CHANNEL` (no send); connected chat → `DELIVERED` with the plaintext code in
  the message; provider refusal → `NO_CHANNEL`.
- `backend/src/domain/services/resubmission.service.spec.ts` (**+3**):
  `NO_CHANNEL` → code voided (`markUsed` called with the right ids) and the
  `BOOKING_VERIFICATION_CODE_NO_CHANNEL` security event recorded; `DELIVERED` →
  code stays live and only the request event is recorded; `CHANNEL_DISABLED` →
  no void.

## 8. Requirements independently confirmed as blocked (D)

Re-verified against current code; each remains impossible to implement faithfully
because the canonical specification leaves the required behavior open:

| REQ | Summary | Blocked on (unchanged) |
| --- | --- | --- |
| REQ-094 | Affected-booking email generated | No canonical URL/route/link mechanism, grouping identity, or multi-booking persistence contract is defined. A repository-wide search found **no** affected-booking email producer. |
| REQ-095 | Close schedule changes grouped in a five-minute window | Dependent on REQ-094's undefined producer. |
| REQ-139 | Subscription reminders by email + business Telegram | §46 item 3 (reminder lead time) unresolved. The `SubscriptionReminder` model, `reminderLeadDays=null` config and reminder events exist, but **nothing schedules** a reminder — correct, since the lead time is a pending product confirmation. |
| §25.3 / §46-4 | Owner booking-report PDF export | §46 item 4 explicitly pending; no owner PDF route exists. |

## 9. Requirements independently confirmed as deployment-dependent (C)

See Section 4. All eleven require an **approved external email sender** (or the
verification/forgot-password flows it enables). The `EmailProvider` boundary
binds to `DisabledEmailProvider`, which deliberately never reports acceptance, so
no false "delivered" state can be produced. Supplying a provider is a deployment
input, not a product decision, and is intentionally not hard-coded.

## 10. Requirements independently confirmed as deferred (E)

Unchanged and canonical, **not** implementation gaps:

| REQ | Summary | Basis |
| --- | --- | --- |
| REQ-025 | Google login not part of Phase 1 | §12.2 / §43 — correctly absent |
| REQ-034 | 2FA-ready Phase 1 architecture | §43 — 2FA not enforced in Phase 1 |
| REQ-115 | Custom payment methods NOT configured | §12.2 / §43 — correctly absent |

Also still intentionally out of Phase-1 scope: online payment gateway,
customer accounts/self-service cancel/modify, per-tenant timezones, TTL slot
locks.

## 11. Requirements independently confirmed as product-decision-dependent (F)

**None** beyond the six §46 items, which remain untouched: subscription price
(§46-1), global timezone identity (§46-2), reminder lead time (§46-3), owner
booking-report PDF (§46-4), owner "modify" scope (§46-5), timezone-abbreviation
display / BR-32 (§46-6).

## 12. Cross-tenant security findings

- `TenantGuard.requireOwnedBusiness` resolves ownership from the repository
  inside the query path and returns `NOT_FOUND` (never leaks existence); every
  owner-scoped service call (bookings, catalog, schedule, subscription, telegram,
  proofs) goes through it. No client-supplied tenant id is trusted. **No bypass
  found.**
- Telegram callbacks are bound to `(business, connection, booking)` and verified
  against the originating `chatId` and the connection's current `businessId`;
  the OPEN→USED claim is atomic (`updateMany` guarded). **No bypass found.**
- Payment-proof downloads are scope-checked by business **and** booking before
  the storage read; storage keys stay internal. **No bypass found.**
- Admin/reporting routes use role gates; Admins receive `NOT_FOUND`/403 for
  platforms they do not own. **No bypass found.**
- The new verification-code channel looks up the connection by
  `businessId + customerPhone + kind=CUSTOMER + state=CONNECTED`, so it cannot
  deliver to another business's or another customer's chat. **No bypass.**

## 13. API contract findings

- 55 owner/admin/public/customer route handlers reviewed against the canonical
  endpoint list; no objectively specified endpoint is missing except the
  provider-dependent verification/forgot-password endpoints (Section 9).
- Authorization, tenant scoping, status transitions and the single error envelope
  match the specification; customer projections expose no internal ids or booking
  reference (REQ-109).
- The REQ-230 fix added **no** response field and did **not** change the uniform
  `{ expiresAt }` shape (anti-enumeration preserved).
- No non-specified discrepancy warranted a source change.

## 14. Frontend contract findings

- The only production mock import remains the documented demo branding seam
  (`BusinessProfilePage.tsx` → `mockOwnerApi.saveBranding`, logo/cover only).
  Left in place as an accepted limitation pending an image-storage decision.
- Status/telegram/subscription/payment-proof presentations were checked against
  the implemented API; no stale state transition or wire-mapping error was found.
- One stale **comment** (not behavior) claimed resubmission code delivery was out
  of scope; corrected (Section 6).

## 15. Idempotency/retry findings

- Booking creation: `submission_key` unique + in-transaction re-check inside the
  per-business advisory lock → exactly one winner; replays return the original
  booking; cross-business/different-request reuse is a canonical conflict.
- Resubmission: idempotent key short-circuit, single-use code (`markUsed` guarded),
  attempt cap, TTL, hashed storage.
- Subscription approval/rejection: guarded PENDING→APPROVED/REJECTED inside the
  advisory lock → the same proof can never extend twice.
- Outbox: unique delivery idempotency keys, P2002 duplicate skip, bounded
  backoff, stale-`SENDING` reclaim, `DEAD_LETTERED`.
- Telegram webhook: `update_id` exactly-once via P2002.
- The fix is idempotent: requesting a code twice yields independent one-time
  codes (capped by `MAX_ACTIVE_CODES`), each delivered/voided independently. No
  new duplicate path was introduced.

## 16. Database integrity findings

- Application invariants are also defended at the database layer where the spec
  requires it: `submission_key` uniqueness, partial unique active-slot index
  (`uq_slot_lock_active`), the `booking_end_minute_precision` CHECK, single-active
  schedule versions, notification/outbox identity, tenant-scoped foreign keys.
- No schema violation of a canonical requirement was found; no migration was
  written (the fix required **no** schema change).

## 17. Backend test result

`cd backend && npm test`:

```
Test Files  30 passed | 10 skipped (40)
     Tests  199 passed | 246 skipped (445)
```

(Was 192 passed / 246 skipped at the Prompt 62 checkpoint; **+7** for the new
tests.)

## 18. DB run 1 result

`cd backend && npm run test:db` (real PostgreSQL, `RUN_DB_TESTS=true`):

```
Test Files  28 passed (28)
     Tests  387 passed (387)
```

## 19. DB run 2 result

Second consecutive run:

```
Test Files  28 passed (28)
     Tests  387 passed (387)
```

(Was 380 at the Prompt 62 checkpoint; **+7** for the new unit tests included in
the DB-gated run. Both runs clean.)

## 20. Frontend test result

`cd frontend && npm test`:

```
Test Files  44 passed (44)
     Tests  504 passed (504)
```

One earlier run reported a single failure caused by a jsdom
`Not implemented: navigation (except hash changes)` limitation; it is
pre-existing, unrelated to this Prompt's changes, and passed on the two
subsequent full runs.

## 21. Typecheck / lint / build result

| Gate | Backend | Frontend |
| --- | --- | --- |
| typecheck | PASS (`tsc --noEmit`) | PASS (`tsc -b`) |
| lint | PASS (`eslint --max-warnings=0`) | PASS (`eslint .`) |
| build | PASS (`nest build`) | PASS (`vite build`; 527.38 kB JS chunk, pre-existing >500 kB advisory warning) |

## 22. Browser QA result

**Browser QA unavailable.** No browser-automation harness
(Playwright/Cypress/Puppeteer) exists in the repository and Prompt 63 forbids
adding one. Ad-hoc screenshots under `frontend/qa-shot/` are not a harness. The
implemented vertical is backend-only and has no new user-facing surface.

## 23. Final specification SHA

```
5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b  docs/WEREFA-COMPLETE-SPECIFICATION.md
```

Identical to the starting digest and to the required value. The canonical
specification was read-only throughout; the `REQ-###` heading count is still 232.

## 24. Git working-tree status

HEAD is unchanged at `80a69ff1aefcb06e5336547dd85bf23dbadf75d0`. The working tree
holds **120** uncommitted entries (the entire implementation remains uncommitted,
as at every prior checkpoint). Files touched by this Prompt:

| File | Change |
| --- | --- |
| `backend/src/domain/notifications/verification-code-channel.port.ts` | **new** — code-channel port + fail-safe noop |
| `backend/src/domain/notifications/telegram-verification-code-channel.ts` | **new** — Telegram adapter |
| `backend/src/domain/notifications/telegram-verification-code-channel.spec.ts` | **new** — 4 unit tests |
| `backend/src/domain/services/resubmission.service.spec.ts` | **new** — 3 unit tests |
| `backend/src/domain/services/resubmission.service.ts` | deliver + void-on-no-channel (REQ-230) |
| `backend/src/domain/domain-services.module.ts` | bind `VERIFICATION_CODE_CHANNEL` |
| `frontend/src/api/types.ts` | corrected stale delivery comment |
| `README.md` | corrected provider-dependent limitation list |

## 25. Explicit confirmation that no commit was created

**NO COMMIT MADE.** No `git add`, `git commit`, `git push`, reset, rebase, squash
or any other history operation was performed. HEAD remains `80a69ff`. Work
remains as uncommitted working-tree changes only.

---

## Appendix A — Distinguishing the categories

Per the Prompt's requirement, these states are kept distinct:

- **Not implemented (work remains, would be a category-B gap if any):** **none**
  after this Prompt. The single such gap (REQ-230 code delivery) was closed.
- **Blocked by insufficient specification (D):** REQ-094, REQ-095, REQ-139, and
  the owner booking-report PDF (§46-4). Not called "missing".
- **Requires deployment/provider input (C):** REQ-026–033 (email verification /
  forgot-password) and REQ-195/REQ-198/REQ-221 (real email delivery). Not called
  "missing" — the remaining behavior needs an approved external email sender.
- **Deferred by design (E):** REQ-025, REQ-034, REQ-115. Correctly absent.
- **Requires product decision (F):** none beyond §46.

## Appendix B — Independent verification notes

- P44 was treated as historical evidence only. Claims were re-checked against
  current source and current tests. REQ-026–033 were found to be **not**
  implemented in this rebuild despite being recorded as IMPLEMENTED; the
  supporting evidence cited by report 44 ("verification tokens") actually refers
  to the *resubmission* verification repository, not email verification.
- REQ-195/198/221 share one mechanism (the auth-email outbox path) whose only
  missing piece is the external sender; they are consistently classified C.
- REQ-102 (added in Prompt 60) was re-confirmed wired through
  `BusinessLifecycleWorker.sweepCompletions` → `BookingService.autoCompleteDueBookings`.
- No mock/fallback exists on any production path except the documented branding
  demo seam.
