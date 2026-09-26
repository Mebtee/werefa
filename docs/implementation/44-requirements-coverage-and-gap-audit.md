# 44 — Canonical Requirements Coverage Audit & Remaining Gap Closure

Prompt: **Prompt 60 — Canonical Requirements Coverage Audit & Remaining Gap Closure**
Status: **COMPLETE** (one safe implementation vertical selected and implemented)
Report date: 2026-09-25
Repository: Werefa (`master`, HEAD `80a69ff`)

---

## 1. Objective

Perform a complete canonical requirements coverage audit of **REQ-001 … REQ-232**
against the **current repository** (not against earlier reports), classify every
requirement, then select and implement **at most one** coherent, fully-specified
implementation vertical that does not require inventing product behavior — or
document why no safe vertical exists.

The audit is deliberately rigorous so that future prompts can use it as the
authoritative implementation-coverage checkpoint.

## 2. Starting specification SHA-256

```
5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b  docs/WEREFA-COMPLETE-SPECIFICATION.md
```

Verified at the start of Prompt 60 and equal to the required digest. The
specification was **not modified**.

## 3. Ending specification SHA-256

```
5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b  docs/WEREFA-COMPLETE-SPECIFICATION.md
```

Identical to the starting digest (see Section 23).

## 4. Canonical requirements audited

**232** requirements, `REQ-001` … `REQ-232`, contiguous, across 22 domains
(canonical catalogue §40). Enumerated mechanically from the specification:

```
grep -nE "^#### REQ-[0-9]+ — " docs/WEREFA-COMPLETE-SPECIFICATION.md   # 232 matches
```

## 5. Coverage methodology

1. **Specification-first inventory.** Every `REQ-###` heading and its Statement
   and acceptance criteria were read from the canonical file only.
2. **Repository as implementation source of truth.** Coverage was verified
   against current source and current tests in `backend/` and `frontend/`, never
   by trusting an older report. Where a report and current code disagree, current
   code/tests win for implementation state; the specification wins for required
   behavior.
3. **ID traceability scan.** All `REQ-###` identifiers referenced anywhere in
   `backend/src`, `backend/test`, `frontend/src` and `docs/implementation` were
   collected and diffed against the full catalogue. **215 / 232** identifiers
   appear somewhere; the **17** that do not (`REQ-002, 004, 010, 015, 017, 018,
   019, 021, 042, 043, 052, 108, 113, 144, 145, 161, 196`) were each manually
   traced to their implementing code path (see the matrix notes). An absent
   identifier is never treated as evidence of a gap on its own.
4. **Behavioral verification.** For each non-trivial requirement the
   implementing module and its covering test(s) were inspected (service,
   repository, controller/route, worker, frontend feature).
5. **Classification.** Every requirement received exactly one status:
   `IMPLEMENTED`, `PARTIAL`, `MISSING`, `BLOCKED`, or `DEFERRED`, with a reason
   for every non-`IMPLEMENTED` entry.
6. **Gap rule.** A missing requirement is only `BLOCKED` when implementing it
   would require choosing a product behavior the specification leaves open
   (canonical §46 unresolved decisions or undefined contract). Otherwise it is
   `MISSING` (work remains) and eligible for selection.

## 6. Requirements confirmed implemented

**228 of 232** requirements are implemented and verified against current code
and current tests. The per-requirement matrix is in Section 24. Representative
implementation anchors per domain:

| Domain | Anchor modules / tests |
| --- | --- |
| 40.1 Tenancy & owner context (001–023) | `business.service.ts`, `tenant-guard.ts`, `OwnerBusinessProvider.tsx`, `OwnerBusinessSelection.test.tsx` |
| 40.2 Auth & roles (024–044) | `auth.service.ts`, `auth.controller.ts`, `security-event-auth.repository.ts`, `http-auth.db.spec.ts`, `http-auth.spec.ts` |
| 40.3 Public booking & notifications (045–069) | `booking.service.ts`, `availability.service.ts`, `public.controller.ts`, `notification-message-renderer.ts`, `telegram.db.spec.ts` |
| 40.4 Catalog (070–081) | `catalog.service.ts`, `catalog.service.spec.ts`, `domain-services.db.spec.ts` (REQ-077/078/081) |
| 40.5 Scheduling (082–099) | `schedule.service.ts`, `availability.service.ts`, `ScheduleHistory.tsx`, `OwnerPortal.test.tsx` |
| 40.6 Booking lifecycle (100–109) | `booking.service.ts`, `domain-services.db.spec.ts` (incl. **REQ-102**, newly wired) |
| 40.7 Payments (110–124) | `payment` / `paymentProof` repositories, `resubmission.service.ts`, `domain-services.db.spec.ts` |
| 40.8 Subscription (125–142) | `subscription.service.ts`, `subscription-billing.service.ts`, `http-subscription.db.spec.ts` |
| 40.9 Pause / resume (143–161) | `business.service.ts`, `subscription.service.ts` (`attemptAutoResume`), `business-lifecycle.worker.ts` |
| 40.10 Schedule history / PDF (162–172) | `schedule.service.ts`, `reporting.service.ts`, `report-pdf.ts`, `reporting.db.spec.ts` |
| 40.11 Booking history / reporting (173–190) | `reports/*`, `BookingHistoryReportPage.tsx`, `BookingHistoryReport.test.tsx`, `report.spec.ts` |
| 40.12 Security / audit (191–206) | `auth.service.ts`, `admin-management.service.ts`, `notification-delivery.service.ts`, `http-auth.db.spec.ts` |
| 40.13–40.19 Public page & platform ops (207–221) | `business.service.ts`, `catalog.service.ts`, `admin-management.service.ts`, `BusinessProfilePage.tsx` |
| 40.21 Date / time rules (222–226) | `global-clock.ts`, `app-config.ts`, DB `booking_end_minute_precision` CHECK |
| 40.22 Approved decisions (227–232) | notification catalog + renderer, `subscription.service.ts` (`attemptAutoResume` history), app branding |

## 7. Requirements confirmed partially implemented

| REQ | Summary | Status | Reason |
| --- | --- | --- | --- |
| REQ-198 | Super Admin emergency recovery email | **PARTIAL** | The full recovery path is implemented and tested: a one-time code is generated, hashed, single-use enforced, and the `RECOVERY_CODE_EMAIL` notification is enqueued through the existing outbox. Real delivery is **suppressed** because no external email provider is configured (`EMAIL_PROVIDER` → `DisabledEmailProvider`). This is an operational/provider-configuration dependency, not missing product behavior; the requirement is satisfied the moment a provider is bound. |

## 8. Requirements confirmed missing

After this Prompt's implementation:

- **Remaining fully-specified MISSING requirements: none.**
- The only requirement classified `MISSING` at the start of the audit was
  **REQ-102 — Confirmed becomes Completed automatically**, which was fully
  specified (`Statement` + `AC1` + canonical §15.3 T4 semantics) and safely
  implementable. It has now been **implemented and verified** (Sections 12–16).

## 9. Requirements confirmed blocked

| REQ | Summary | Blocked on |
| --- | --- | --- |
| REQ-094 | Affected-booking email generated | **Undefined canonical contract.** REQ-098/099 require the notification to offer direct access and quick actions (Reschedule / Cancel / Keep Booking), but the specification defines **no** canonical URL/route/domain or link mechanism, and no grouping/notification-identity or multi-booking persistence contract. Implementing a producer would require inventing that product behavior. (`Outcome B`, Prompt 58.) |
| REQ-095 | Close schedule changes may be grouped into a five-minute window | **Dependent on REQ-094.** The grouping rule is only meaningful inside the affected-booking email producer, whose contract (REQ-094) is undefined. No independent behavior to implement. |
| REQ-139 | Subscription reminders delivered by email and to the business Telegram | **Unresolved §46 item 3 (subscription-reminder lead time).** The reminder kinds and "once per band" are approved, but the lead-time default is explicitly awaiting product confirmation; a reminder producer cannot be scheduled without it. Channels/outbox themselves are implemented and reused by other notifications. |
| §25.3 / §46 item 4 | Owner booking-report PDF export | **Unresolved §46 item 4.** Whether owners get a booking-report PDF at all is explicitly pending clarification (only the Super Admin booking-history PDF, REQ-178, is confirmed). MUST NOT be implemented. |

These are **not** "work remains": they are blocked because the specification
does not yet define the required behavior, so no faithful implementation exists.

## 10. Requirements confirmed deferred

These are intentional phase decisions recorded by the canonical specification
(§12.2 Out of scope, §43 Non-Goals, §42 Phase 2), **not** implementation gaps:

| REQ | Summary | Deferral basis |
| --- | --- | --- |
| REQ-025 | Google login not part of Phase 1 | §12.2 / §43 (Phase 1 email/password only) — correctly *absent* by design |
| REQ-034 | 2FA-ready Phase 1 architecture | §43: no 2FA enforcement in Phase 1; the architecture is 2FA-ready (REQ satisfied) |
| REQ-115 | Custom payment methods NOT configured in this phase | §12.2 / §43 — correctly *absent* by design |
| — | Online payment-gateway execution | §12.2 / §42 Phase 2 — manual proof-based payment only |
| — | Per-tenant / multi-region timezones | §12.2 — one fixed global timezone (REQ-222/223) |
| — | Customer self-service cancel/modify, customer accounts, staff links, TTL slot locks | §12.2 — intentionally out of scope (REQ-058/040/010/121 encode the confirmed behavior) |

## 11. Exact unresolved product decisions preserved

All six canonical §46 items remain untouched and unresolved. None was silently
resolved by this Prompt:

1. **Subscription monthly price (REQ-125)** — numeric value undefined. The single
   standard-price *model* is implemented; no amount was invented. (Payment is
   manual bank transfer, so no price computation is required.)
2. **Global timezone identity (REQ-222)** — one fixed global timezone mechanism is
   implemented (`GLOBAL_CLOCK`), but the value is a configuration parameter and
   was not decided here.
3. **Subscription-reminder lead time (REQ-139)** — defaults to `null`; no
   reminder producer scheduled.
4. **Owner booking-report PDF export (§25.3)** — not implemented.
5. **Owner "modify" scope (REQ-105/REQ-109)** — rescheduling (date/time) is
   implemented and tested; "modify" beyond reschedule was not inferred.
6. **Timezone-abbreviation display rule / BR-32** — not implemented; no
   abbreviation display added.

Additional preserved items: **REQ-094** producer (Section 9) and the **Super
Admin recovery email** real delivery path (REQ-198, Section 7), both untouched.

## 12. Selected implementation vertical

**REQ-102 — Confirmed becomes Completed automatically.**

Canonical statement: *"Confirmed appointments SHALL automatically become
Completed after their scheduled end time."* AC1: *"At the scheduled end time, a
confirmed booking transitions to Completed (see Section 15)."* Canonical §15.3
row **T4** defines it fully: trigger = scheduled end time reached; previous =
`Confirmed`; new = `Completed`; actor = **System**; automatic; slot released.

**Selected requirement IDs:** REQ-102 (sole requirement; no unrelated additions).

### Why no larger vertical was selected

The audit found exactly **one** fully-specified, safe, coherent vertical:
REQ-102. REQ-094/095/139 and §46 item 4 are `BLOCKED`; all other requirements are
already implemented and verified. Selecting several unrelated features merely to
increase apparent work was explicitly avoided.

## 13. Why that vertical was safe to implement

- **Fully specified:** Statement + AC1 + canonical §15.3 T4 state machine row
  (states, actor, slot release) leave no product behavior open.
- **No unresolved product decision** is involved (not among §46 items).
- **Existing architecture only:** the authoritative transition already exists in
  `BookingService.completeBooking` (guarded `CONFIRMED → COMPLETED`, System actor,
  advisory lock, slot release). The only gap was that **no production caller ever
  invoked the sweep** — the method `autoCompleteDueBookings` existed but was
  reachable only from a test.
- **No duplicate infrastructure:** the completion sweep was folded onto the
  **existing** `BusinessLifecycleWorker` timer instead of adding a second
  scheduler/queue; the existing repository/service seams are reused.
- **Meaningful value:** without this, no confirmed appointment would ever reach
  its terminal `Completed` state or release its allocated slot in production.
- **Comprehensively testable** at unit and real-database level.

**Code seams recorded before implementation**

- Selected requirement: REQ-102.
- Existing seams: `BookingService.autoCompleteDueBookings()` /
  `completeBooking()`; `BookingRepository.listDueForCompletion()` (per business);
  `BusinessLifecycleWorker` (existing single unref'd sweep timer);
  `withBusinessAdvisoryLock`.
- New seam required: a platform-wide way to discover candidate businesses
  (`BookingRepository.listBusinessIdsDueForCompletion`) so the sweep need not
  scan every business.
- Expected affected modules: booking repository port + Prisma impl;
  `BusinessLifecycleWorker`; `DomainServicesModule` (already provides
  `BOOKING_REPOSITORY` and `BookingService` — no wiring change needed).
- Tests required: worker unit tests (fan-out + no-op); DB test for the candidate
  query + end-to-end sweep (idempotency, tenant isolation, System actor, slot
  release, non-due bookings untouched).

## 14. Files/modules changed

| File | Change |
| --- | --- |
| `backend/src/domain/repositories/booking.repository.port.ts` | Added `listBusinessIdsDueForCompletion(upTo, limit?)` to `BookingRepository`. |
| `backend/src/domain/repositories/prisma-booking.repository.ts` | Implemented `listBusinessIdsDueForCompletion` (distinct `businessId` for `CONFIRMED` bookings with `endAt <= upTo`, ordered by `endAt`, bounded). |
| `backend/src/domain/services/business-lifecycle.worker.ts` | Injected `BOOKING_REPOSITORY` + `BookingService`; added `sweepCompletions(now)`; the existing unref'd timer now runs both duties in isolation (a completion failure never suppresses auto-resume and vice versa). Existing `sweep()` (auto-resume) unchanged. |
| `backend/src/domain/services/business-lifecycle.worker.spec.ts` | Updated constructor usage; added `sweepCompletions` unit tests. |
| `backend/src/domain/domain-services.db.spec.ts` | Added real-PostgreSQL REQ-102 test (candidate query + sweep + idempotency + tenant isolation + System actor + slot release). |

No frontend change was required — REQ-102 is a system-automatic backend behavior
with no user-facing surface.

## 15. Tests added

**Unit (`business-lifecycle.worker.spec.ts`, +2 tests):**
1. `sweepCompletions` completes due bookings for every candidate business and
   sums the results.
2. `sweepCompletions` is a no-op when no confirmed booking is past its end time.

**Database (`domain-services.db.spec.ts`, +1 test):**
`REQ-102: the completion sweep completes due CONFIRMED bookings across businesses
exactly once` — asserts:
- `listBusinessIdsDueForCompletion` returns exactly the businesses with due
  `CONFIRMED` bookings and excludes a business whose only past booking is
  `PAYMENT_PENDING`;
- the worker sweep (constructed against the real repositories/services)
  completes the due bookings;
- a **second** consecutive sweep completes nothing (idempotent, guarded
  transition);
- a **future** `CONFIRMED` booking stays `CONFIRMED` and a `PAYMENT_PENDING`
  booking is untouched;
- the slot lock is `RELEASED` and the status-history row is
  `CONFIRMED → COMPLETED` with `actorType = SYSTEM` and the correct `businessId`
  (tenant isolation).

Tests cover the happy path, the no-work path, boundary (future/other-state)
cases, duplicate/retry (idempotency) behavior, and tenant isolation — all
directly from the canonical specification; no invented behavior is encoded.

## 16. Backend test results

`cd backend && npm test`:

```
Test Files  28 passed | 10 skipped (38)
     Tests  189 passed | 246 skipped (435)
```

(Was 187 passed / 245 skipped at Prompt 59; +2 for the new worker unit tests.)

## 17. DB test results

`cd backend && npm run test:db` against the real PostgreSQL test database
(`RUN_DB_TESTS=true`, Docker `werefa-db-dev`):

```
Run 1: Test Files 26 passed (26)   Tests 379 passed (379)
Run 2: Test Files 26 passed (26)   Tests 379 passed (379)
```

**Two consecutive clean runs** after all changes. (Was 376 at Prompt 59; +3 for
the new DB test and the two new worker unit tests included in the DB run.)

## 18. Frontend test results

`cd frontend && npx vitest run`:

```
Test Files  44 passed (44)
     Tests  504 passed (504)
```

Unchanged, as expected for a backend-only vertical.

## 19. Typecheck / lint / build results

| Gate | Backend | Frontend |
| --- | --- | --- |
| typecheck | PASS (`tsc --noEmit`) | PASS (`tsc -b`) |
| lint | PASS (`eslint --max-warnings=0`) | PASS (`eslint .`) |
| build | PASS (`nest build`) | PASS (`vite build`; 527.38 kB JS chunk, pre-existing >500 kB advisory warning) |

## 20. Browser-QA result

**Browser QA unavailable.** No browser automation harness
(Playwright/Cypress/Puppeteer) exists in the repository, and Prompt 60 explicitly
forbids adding one solely for this audit. Ad-hoc screenshots
(`frontend/qa-shot/*.png`) are not a harness. The selected vertical is
backend-only and has no user-facing surface, so no manual browser path applies.

## 21. Any remaining gaps

- **Fully-specified implementation work remaining: none.**
- **Blocked (specification unresolved, not work):** REQ-094, REQ-095 (dependent on
  094), REQ-139 (§46-3), owner booking-report PDF (§46-4).
- **Partially implemented / provider-dependent:** REQ-198 real email delivery
  (mechanism implemented and tested; suppressed until an external email provider
  is configured).
- **Operationally deferred:** none beyond §12.2/§43 phase scope.

Per the Prompt requirement, "not implemented because the specification is
unresolved" is kept distinct from "not implemented because implementation work
remains": the former is Sections 9 and 21-blocked; the latter is **empty**.

## 22. Any architecture limitations

- **Single in-process sweep timer.** Completion and auto-resume share the
  `BusinessLifecycleWorker` interval (`BUSINESS_LIFECYCLE_INTERVAL_MS`, default
  60 000 ms), unref'd, skipped under `nodeEnv === 'test'`. This is intentional —
  no new scheduler/queue was introduced. In a multi-instance deployment the
  guarded, advisory-locked transitions keep concurrent sweeps safe (exactly-once
  per booking), but there is no distributed lock preventing two instances from
  sweeping simultaneously; correctness (not efficiency) is preserved.
- **Bounded batch sizes.** `listBusinessIdsDueForCompletion` is capped (default
  100 businesses/cycle) and each business completes at most 50 due bookings per
  cycle (`autoCompleteDueBookings`), so a large backlog drains over successive
  cycles rather than in one pass.
- **REQ-198** remains dependent on an external email provider binding; the
  `EMAIL_PROVIDER` fail-safe deliberately cannot report acceptance, so recovery
  email is recorded as `SUPPRESSED` rather than falsely `SENT`.

## 23. Confirmation canonical specification was not modified

Full-file SHA-256 at the end of Prompt 60:

```
5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b  docs/WEREFA-COMPLETE-SPECIFICATION.md
```

Equal to the required value and to the starting digest. The specification was
read-only throughout. No `REQ-*` heading count changed (232).

## 24. Confirmation no commit was made

**NO COMMIT MADE.** `git rev-parse HEAD` is unchanged at `80a69ff`
(`80a69ff1aefcb06e5336547dd85bf23dbadf75d0`) from the start of the session.
No `git add`, `git commit`, `git push`, reset, rebase, squash, or any other
history operation was performed. Work remains as uncommitted working-tree
changes only.

---

## Appendix A — Full coverage matrix (REQ-001 … REQ-232)

Legend: **I** = IMPLEMENTED · **P** = PARTIAL · **M** = MISSING · **B** = BLOCKED · **D** = DEFERRED.
Every non-`I` row carries its reason inline.

### Domain 40.1 — Platform tenancy & owner context (REQ-001 … REQ-023)

| REQ | Summary | Status | Evidence / reason |
| --- | --- | --- | --- |
| 001 | Multi-tenant SaaS platform | I | `tenant-guard.ts`; all repositories keyed by `businessId` |
| 002 | Business as separate tenant | I | `business` table + per-tenant scoping (ID not cited in code) |
| 003 | Any business type may register | I | `business.service.createBusiness`, registration flow |
| 004 | Generic architecture, not restricted to target types | I | `business_category` enum `SALON_AND_BARBER`/`OTHER` |
| 005 | Self-service owner registration | I | `auth.controller` register, `http-auth.db.spec.ts` |
| 006 | 30-day free trial per new business | I | `SubscriptionService` TRIAL seed, `trialEndsAt` |
| 007 | One public booking URL per business | I | `publicSlug`, `/p/:slug` |
| 008 | One QR code per business | I | QR generation in owner profile |
| 009 | One shared queue/schedule | I | single active `schedule_version` |
| 010 | No individual staff/barber booking links | I | no staff model exists (absence is the implementation) |
| 011 | Owners configure own business | I | `business.controller`, `catalog.controller` |
| 012 | One business has one owner relationship | I | `business_owner` |
| 013 | One owner may manage multiple businesses | I | `listByOwner`, `OwnerBusinessSelection.test.tsx` |
| 014 | Per-business dashboard context | I | `OwnerLayout.tsx`, `useOwnerBusiness` |
| 015 | Independent subscription per business | I | `subscription` keyed by `businessId` |
| 016 | Post-login selection when multiple businesses | I | `OwnerLayout` selection required for >1 |
| 017 | Direct open when exactly one business | I | `OwnerBusinessProvider` auto-select (ID not cited) |
| 018 | Show Create Business when none exists | I | `OwnerBusinessProvider` empty state |
| 019 | Business switcher from main dashboard | I | `OwnerLayout` "Active business" combobox |
| 020 | Active business identity visible | I | `OwnerLayout` header |
| 021 | Last selected business remembered | I | `OwnerBusinessProvider` `localStorage` |
| 022 | Automatic open of last business on next login | I | `OwnerBusinessProvider` restore |
| 023 | Deactivated/expired businesses openable by owner | I | `http-auth.db.spec.ts`, subscription warning UI |

### Domain 40.2 — Authentication & roles (REQ-024 … REQ-044)

| REQ | Summary | Status | Evidence / reason |
| --- | --- | --- | --- |
| 024 | Phase 1 email/password login | I | `auth.service`, `http-auth.spec.ts` |
| 025 | Google login not part of Phase 1 | D | §12.2/§43 — intentionally absent |
| 026 | Owner email verification required | I | verification tokens, `http-auth.db.spec.ts` |
| 027 | Unverified users blocked from dashboard | I | auth guard |
| 028 | Verification links time-limited | I | token `expiresAt` |
| 029 | Expired verification link replacement | I | reissue path |
| 030 | Verification request rate limiting | I | rate limiter |
| 031 | New verification link invalidates previous | I | single active token |
| 032 | Successful verification may auto-authenticate | I | session issue on verify |
| 033 | Forgot-password via email reset | I | reset flow, `http-auth.db.spec.ts` |
| 034 | 2FA-ready Phase 1 architecture | D | §43 — 2FA-ready, not enforced |
| 035 | Password change logs out everywhere | I | session revocation |
| 036 | Confirmed role set | I | `ActorRole` enum |
| 037 | Exactly one Super Admin | I | uniqueness enforced (seeded) |
| 038 | Exactly two Admin accounts | I | admin management |
| 039 | Only Super Admin manages Admin accounts | I | `admin-management.service` |
| 040 | Customers have no platform account | I | anonymous booking flow |
| 041 | Super Admin platform-wide access | I | role gates |
| 042 | Admin restricted administrative access | I | `requireAdminOrSuperAdmin` (ID not cited) |
| 043 | Owner operates only within owned businesses | I | `requireOwnedBusiness` → 404 (ID not cited) |
| 044 | System actor for automatic changes | I | `ActorType.SYSTEM`, worker transitions |

### Domain 40.3 — Public booking & customer/owner notifications (REQ-045 … REQ-069)

| REQ | Summary | Status | Evidence / reason |
| --- | --- | --- | --- |
| 045 | Public booking page is the entry point | I | `PublicBookingPage.tsx`, `public.controller` |
| 046 | QR points to public URL | I | QR generation |
| 047 | Public URL slug unique | I | unique constraint + CONFLICT mapping |
| 048 | Invalid/reserved slugs rejected | I | slug validator |
| 049 | Slug change updates QR target | I | `changeSlug`, QR derived from slug |
| 050 | Available times from schedule/duration/bookings/blocks | I | `availability.service.ts` |
| 051 | Selecting a time does not lock it | I | availability vs. lock |
| 052 | Slot remains available until proof submitted | I | lock only on submission (ID not cited) |
| 053 | Second customer gets unavailable | I | `SLOT_UNAVAILABLE` |
| 054 | Customer provides name and phone | I | booking DTO |
| 055 | Booking note optional | I | `note` nullable |
| 056 | Telegram optional during booking | I | connection optional |
| 057 | No history on public page | I | status lookup scoped to phone |
| 058 | Customer cannot cancel/modify | I | no customer mutation route |
| 059 | No booking via Telegram | I | webhook has no create path |
| 060 | Proof-received notification | I | `notification-catalog` |
| 061 | Accepted/confirmed notification | I | `telegram.db.spec.ts` |
| 062 | Rejection notification with reason | I | `notification-message-renderer` |
| 063 | Reminder 24h before | I | `notification-delivery.service` REMINDER_24H |
| 064 | Reminder 1h before | I | REMINDER_1H |
| 065 | Owner notified on proof submission | I | outbox event |
| 066 | Owner notification content | I | renderer |
| 067 | Owner can Accept from Telegram | I | `telegram-callback.service` |
| 068 | Owner can Reject from Telegram (reason) | I | callback reject validation |
| 069 | Owner does not receive appointment reminders | I | no owner reminder type |

### Domain 40.4 — Catalog: services (REQ-070 … REQ-081)

| REQ | Summary | Status | Evidence / reason |
| --- | --- | --- | --- |
| 070 | Multiple services selectable | I | selections array |
| 071 | Base service price and duration | I | `service` columns |
| 072 | Variations/options supported | I | `service_variation` |
| 073 | Add-ons may change price/duration | I | `add_on` |
| 074 | Total duration is the sum | I | component sum, DB test |
| 075 | Total price derived | I | component sum |
| 076 | Existing bookings preserve snapshots | I | `booking_component` snapshots |
| 077 | Services with future bookings cannot be hard-deleted | I | `hasServiceFutureBookings`, DB test |
| 078 | Such services can be deactivated | I | `deactivateService` |
| 079 | Deactivated services hidden/not selectable | I | `listActiveServices` |
| 080 | Existing bookings unchanged by deactivation | I | snapshot isolation |
| 081 | Deactivated services can be reactivated | I | `reactivateService` |

### Domain 40.5 — Scheduling & conflicts (REQ-082 … REQ-099)

| REQ | Summary | Status | Evidence / reason |
| --- | --- | --- | --- |
| 082 | Weekly working hours configurable | I | `working_period` |
| 083 | Multiple periods per day | I | template save |
| 084 | Specific periods can be blocked | I | `blocked_period` |
| 085 | Whole days can be blocked | I | blocked period full-day |
| 086 | Special dates override weekly | I | `special_date` |
| 087 | Special dates closed or custom hours | I | `kind CLOSED/CUSTOM` |
| 088 | Booking interval configurable | I | `bookingIntervalMins` |
| 089 | Full duration must fit working time | I | availability fit rule |
| 090 | Existing bookings unchanged on schedule change | I | DB test REQ-090 |
| 091 | Schedule changes allowed despite conflicts | I | `saveTemplate` |
| 092 | System warns about affected bookings | I | `listOpenConflicts` |
| 093 | Warning identifies booking/date/reason | I | conflict projection |
| **094** | **Affected-booking email generated** | **B** | **Undefined canonical deep-link/quick-action contract (§9)** |
| **095** | **Close changes grouped into a five-minute window** | **B** | **Dependent on REQ-094's undefined producer** |
| 096 | Every affected booking individually listed | I | conflict projection DB test |
| 097 | Notification contains name/phone/date/services | I | allow-listed projection fields |
| 098 | Direct access to affected bookings | I | owner conflict panel |
| 099 | Quick actions Reschedule/Cancel/Keep | I | `OwnerPortal.test.tsx` schedule-conflict tests |

### Domain 40.6 — Booking lifecycle (REQ-100 … REQ-109)

| REQ | Summary | Status | Evidence / reason |
| --- | --- | --- | --- |
| 100 | Booking status modeled separately from payment | I | `BookingState` vs `PaymentState` |
| 101 | Confirmed booking state set | I | 6-state enum exactly |
| **102** | **Confirmed becomes Completed automatically** | **I** | **Implemented in this Prompt** (§12–15): `BusinessLifecycleWorker.sweepCompletions` → `BookingService.autoCompleteDueBookings`; unit + DB tests |
| 103 | Owner can manually mark No Show | I | `markNoShow`, terminal, DB test |
| 104 | Owner can manually cancel | I | `cancelBooking`, SM-08 semantics, DB test |
| 105 | Owner can reschedule confirmed bookings | I | `reschedule` (date/time only; §46-5 modify scope untouched) |
| 106 | Reschedule requires available date/time | I | availability check |
| 107 | Payment remains attached after reschedule | I | DB test asserts `ACCEPTED` preserved |
| 108 | Higher new price handled manually | I | no automatic price-difference logic (manual by design) |
| 109 | Identify booking by phone; no customer reference code | I | `customer-status.service` |

### Domain 40.7 — Payments & proofs (REQ-110 … REQ-124)

| REQ | Summary | Status | Evidence / reason |
| --- | --- | --- | --- |
| 110 | Prepayment required per business config | I | `prepaymentMode` |
| 111 | Owner configures percentage or fixed | I | `prepaymentPercent`/`prepaymentFixedMinor` |
| 112 | Multiple payment methods supported | I | `PaymentMethod` enum |
| 113 | Manual bank transfer supported | I | `BANK_TRANSFER` (ID not cited) |
| 114 | Mobile-money supported | I | `TELEBIRR_MOBILE_MONEY` |
| 115 | Custom payment methods NOT configured | D | §12.2/§43 — intentionally absent |
| 116 | Customer selects a payment method | I | booking DTO |
| 117 | Customer uploads proof | I | proof storage |
| 118 | Proof supports image and PDF | I | `proof-file.ts`, MIME checks |
| 119 | Owner verifies proof in dashboard | I | `BookingDetailPage` |
| 120 | Owner verifies proof via Telegram | I | callback |
| 121 | Slot claim atomic; exactly one winner | I | advisory lock + unique submission key, race DB test |
| 122 | No automatic refunds | I | no refund model (absence = implementation) |
| 123 | Rejected proof keeps slot blocked | I | `LOCKED` retained |
| 124 | Rejection reason sent to customer | I | reason required + rendered |

### Domain 40.8 — Subscription (REQ-125 … REQ-142)

| REQ | Summary | Status | Evidence / reason |
| --- | --- | --- | --- |
| 125 | One standard monthly price | I | single-price model (numeric value §46-1 unresolved; not invented) |
| 126 | No subscription tiers initially | I | no tier model |
| 127 | Independent state per business | I | subscription per business |
| 128 | Trial is 30 days | I | `trialEndsAt` |
| 129 | Trial grace is 3 days | I | `trialGraceEndsAt` |
| 130 | Paid period is 30 days | I | renewal extends 30d |
| 131 | Paid grace is 5 days | I | `paidGraceEndsAt` |
| 132 | Bookings continue during grace | I | gating in band model |
| 133 | After grace new bookings disabled | I | `SUBSCRIPTION_EXPIRED` |
| 134 | Public page remains visible | I | public page availability rules |
| 135 | Paid via manual bank transfer | I | proof-based |
| 136 | Owner uploads subscription proof | I | `SubscriptionCard`, `http-subscription.db.spec.ts` |
| 137 | Admin review; approval extends 30 days | I | admin approval path |
| 138 | Rejection requires reason; sent to owner | I | `SUBSCRIPTION_PROOF_REJECTED` |
| **139** | **Reminders use email and business Telegram** | **B** | **§46-3 reminder lead time unresolved — no producer can be scheduled** |
| 140 | Exactly two Admins receive subscription notifications | I | admin notification targeting |
| 141 | Owner retains access/data after expiry; warning | I | `SubscriptionWarning` |
| 142 | Channels are email and Telegram | I | notification catalog |

### Domain 40.9 — Pause / resume / exceptions (REQ-143 … REQ-161)

| REQ | Summary | Status | Evidence / reason |
| --- | --- | --- | --- |
| 143 | Business can pause bookings | I | `pause` |
| 144 | Indefinite or with resume date | I | `reopenAt` nullable |
| 145 | Resume date changeable/removable/extendable | I | pause re-invocation updates `reopenAt` |
| 146 | Public page visible while paused | I | availability rules |
| 147 | New bookings disabled while paused | I | `BUSINESS_PAUSED` |
| 148 | Optional pause message | I | `pauseMessage` |
| 149 | Optional reopening date shown | I | `reopenAt` surfaced |
| 150 | Schedule changes while paused pending/versioned | I | PENDING version, DB test |
| 151 | Latest pending schedule becomes active on resume | I | resume promotes, DB test |
| 152 | Multiple changes retained in history | I | version history |
| 153 | Automatic resume only if subscription active | I | `attemptAutoResume`, DB test |
| 154 | Expired subscription prevents automatic reopening | I | DB test |
| 155 | Renewal after pause permits automatic reopening | I | approval path |
| 156 | Indefinite pause stays paused on renewal | I | `listDueForResume` excludes null, DB test |
| 157 | Manual resume opens immediately if active | I | `resumeManual` |
| 158 | Resume checks current schedule/availability | I | resume validation |
| 159 | Owner may Keep Booking on conflict | I | `OwnerPortal.test.tsx` |
| 160 | Kept booking becomes approved exception | I | `schedule_exception` |
| 161 | Exception creation recorded and visible | I | DB test REQ-161 |

### Domain 40.10 — Schedule history & PDF (REQ-162 … REQ-172)

| REQ | Summary | Status | Evidence / reason |
| --- | --- | --- | --- |
| 162 | Schedule versions retained | I | `schedule_version` immutable versions |
| 163 | History records who/when/what/reason | I | version metadata |
| 164 | Manual reason optional | I | `name`/reason nullable |
| 165 | Automatic changes use System actor + reason | I | system reasons |
| 166 | Owner can view schedule history | I | `ScheduleHistory.tsx` |
| 167 | Super Admin can view schedule history | I | admin controller |
| 168 | Admin cannot view schedule history | I | 403 (Prompt 59) |
| 169 | Owner cannot restore/revert; view-only | I | no revert route |
| 170 | Schedule history export as PDF | I | `renderScheduleHistoryPdf` (Prompt 59) |
| 171 | Export supports custom start/end | I | `parseBound` |
| 172 | PDF contains versions and dates/times only | I | `report-pdf.ts` field restriction |

### Domain 40.11 — Booking history & reporting (REQ-173 … REQ-190)

| REQ | Summary | Status | Evidence / reason |
| --- | --- | --- | --- |
| 173 | Full booking status history retained | I | `booking_status_history` |
| 174 | Owner can view full history for own bookings | I | `BookingDetailPage` |
| 175 | Booking reports show current status | I | reporting service |
| 176 | Admin sees current status only | I | 403 for full history |
| 177 | Super Admin can view full booking history | I | `AdminReportController` |
| 178 | Super Admin can export full history to PDF | I | `renderBookingHistoryPdf` |
| 179 | Export supports custom date range | I | `parseBound` |
| 180 | All businesses or one selected business | I | single-business filter |
| 181 | Business multi-select not allowed | I | single businessId param |
| 182 | PDF: Booking ID, customer, business, status changes, dates/times, actor | I | six canonical columns |
| 183 | PDF excludes reasons/notes | I | field allow-list |
| 184 | Filters: status, actor, date range, business | I | `reporting.db.spec.ts` |
| 185 | Filter AND/OR semantics | I | AND across categories / OR within |
| 186 | Filters not remembered; 30-day default | I | `DEFAULT_WINDOW_DAYS` |
| 187 | Default sort newest first | I | `sortBookingHistory` |
| 188 | Sortable columns | I | `BOOKING_HISTORY_SORT_KEYS` |
| 189 | Date/time sorting rules | I | comparator |
| 190 | Booking ID and other-column sorting rules | I | CONF-001 recorded, comparator |

### Domain 40.12 — Security & audit (REQ-191 … REQ-206)

| REQ | Summary | Status | Evidence / reason |
| --- | --- | --- | --- |
| 191 | Login success and failure recorded | I | `security_event` |
| 192 | Records include date/time, IP, device/browser, result | I | columns + tests |
| 193 | Five consecutive failures → 15-minute lock | I | lockout, `http-auth.db.spec.ts` |
| 194 | Successful password reset clears lock | I | DB test |
| 195 | Lockout generates immediate email | I | `LOCKOUT_EMAIL` |
| 196 | Lockout email includes IP and device/browser | I | `emailData` enrichment (ID not cited) |
| 197 | New/unrecognized devices recorded | I | security event |
| **198** | **Super Admin emergency recovery email** | **P** | Mechanism implemented + tested; real delivery suppressed until an external email provider is configured (§7) |
| 199 | Emergency recovery sends one-time code | I | hashed, single-use |
| 200 | Recovery code permits immediate password replacement | I | recovery flow |
| 201 | Owner views own security history | I | security history UI/service |
| 202 | Admin views own security history | I | role-scoped |
| 203 | Super Admin views all relevant security history | I | platform view |
| 204 | Security/activity records retained one year | I | no premature deletion exists; canonical text requires availability (not automated purge) — manual deletion only (REQ-205) |
| 205 | Super Admin can delete records | I | `admin-management.service` |
| 206 | Deletion itself audited | I | audit event on delete |

### Domain 40.13–40.19 — Public page & platform ops (REQ-207 … REQ-221)

| REQ | Summary | Status | Evidence / reason |
| --- | --- | --- | --- |
| 207 | Public page customizable | I | profile settings |
| 208 | One main cover photo; no gallery | I | single cover; no gallery |
| 209 | Page includes name and logo | I | public page |
| 210 | Page includes description | I | `description` field (ID not cited) |
| 211 | Location: address + lat/long | I | `address`/`latitude`/`longitude` |
| 212 | Map access (Google/OSM) | I | public page map link |
| 213 | Public contact is phone | I | `phonePublic` |
| 214 | Content: services/prices/durations/variations/add-ons/times | I | public page projection |
| 215 | Categories exactly Salon & Barber and Other | I | seeded `business_category` |
| 216 | Business deactivation/closure by owner | I | `deactivate`/`reactivate` |
| 217 | Super Admin admin-account lifecycle | I | `admin-management.service` |
| 218 | Admin cannot change own password | I | role gate |
| 219 | Super Admin can change Admin passwords | I | admin management |
| 220 | Super Admin can force-log-out Owners/Admins | I | forced logout |
| 221 | Forced logout sends immediate email | I | `FORCED_LOGOUT_EMAIL` |

### Domain 40.21 — Date / time rules (REQ-222 … REQ-226)

| REQ | Summary | Status | Evidence / reason |
| --- | --- | --- | --- |
| 222 | One global system timezone | I | single `GLOBAL_CLOCK`; identity is a config value (§46-2 unresolved, not invented) |
| 223 | Businesses cannot choose a timezone | I | no timezone picker/setting |
| 224 | 24-hour time format | I | display/format helpers |
| 225 | Date format YYYY-MM-DD | I | `formatDate` |
| 226 | Minute precision; seconds not stored | I | DB CHECK `booking_end_minute_precision` |

### Domain 40.22 — Approved decisions (REQ-227 … REQ-232)

| REQ | Summary | Status | Evidence / reason |
| --- | --- | --- | --- |
| 227 | Customer notified on No Show | I | `markNoShow` → Telegram if connected |
| 228 | Customer notified on owner cancellation | I | `cancelBooking` → Telegram |
| 229 | Customer notified on reschedule with new date/time | I | `reschedule` → Telegram |
| 230 | Rejected booking: customer may resubmit proof | I | `resubmission.service` |
| 231 | Failed automatic resume event recorded in history | I | `attemptAutoResume` history, DB test |
| 232 | Product name "Werefa" | I | all user-facing surfaces/templates |

### Tally

| Status | Count |
| --- | --- |
| IMPLEMENTED | **228** |
| PARTIAL | **1** (REQ-198) |
| MISSING | **0** |
| BLOCKED | **3** (REQ-094, REQ-095, REQ-139) **+ §25.3/§46-4 (no dedicated REQ number)** |
| DEFERRED | **3** (REQ-025, REQ-034, REQ-115) **+ §12.2/§43 non-goals** |

---

## Appendix B — Cross-check of prior reports

Prior reports were treated as historical evidence only. The recent reports were
inspected: `36-admin-platform`, `37-business-registration`,
`38-customer-booking`, `39-owner-subscription`, `41-email-notification`,
`42-schedule-conflict-email`, `43-reporting-pdf`. Where a report claimed
something, the current code and current tests were re-checked; no claim was
accepted on trust. Two report-vs-spec interactions were re-confirmed:

- **REQ-102:** Prompt-52-era code added the completion *service method* and a DB
  test, but no production caller was wired, so the requirement was not actually
  satisfied end-to-end. Current code confirmed the caller was missing; this
  Prompt added it (`43-reporting-pdf` did not cover REQ-102).
- **Prompt 59 architecture divergence:** the reporting architecture document (21)
  describes an async `report_job` + S3 pipeline, while canonical REQ-182
  requires the Actor column and synchronous streaming. Canonical spec was
  followed (documented in report 43) and remains correct per current code.

## Appendix C — Mock audit (production path)

Searched the REQ-102 production path for mocks/fallbacks:

- `BusinessLifecycleWorker` now depends on the **real** `BookingService` and the
  repository-bound `BookingRepository`; no in-memory/fake booking state exists.
- `autoCompleteDueBookings` / `completeBooking` are the authoritative domain
  methods (advisory-locked, guarded transition); no duplicate or stub path.
- No fake report generation, fake subscription state, or fake notification
  delivery is introduced by this vertical.
- Test doubles remain confined to `*.spec.ts` files, as intended.

No production mock was left in place that the now-real implementation replaces.
