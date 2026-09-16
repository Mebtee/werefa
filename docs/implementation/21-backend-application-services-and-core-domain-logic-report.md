# Implementation Report 21 — Backend Application Services & Core Domain Logic

Prompt 41: backend application services and core domain logic built on the Prompt 40
repositories. Owner lifecycle, service catalog, versioned schedules, availability,
booking creation with advisory-lock concurrency, payment-proof acceptance/rejection,
resubmission workflow, booking lifecycle (cancel / no-show / reschedule / completion),
subscription eligibility gate, safe customer status lookup, and the typed notification
event boundary — with unit tests and live-PostgreSQL integration tests.

The authoritative spec (`docs/WEREFA-COMPLETE-SPECIFICATION.md`) is byte-unchanged.

---

## 1. Objective

Implement the backend application/domain service layer (Prompt 41) on top of the
Prompt 40 repository boundaries, wiring every module in the Nest application, and
prove the business rules with substantial deterministic unit tests plus live
PostgreSQL 16 integration tests. Scope strictly follows Prompt 41: HTTP controllers,
authentication/authorization tokens, Telegram delivery, external payments, real file
storage, billing/approval, the HTTP API, frontend integration, deployment and
infrastructure work are all deliberately deferred to later prompts. The global timezone
and pricing decisions remain unchanged as spec §46 unresolved items.

## 2. Work Completed

- **Supporting infrastructure** — domain error factories mapped onto the existing
  taxonomy; explicit `ActorContext`; `TenantGuard` owner-scoped authorization;
  `GLOBAL_CLOCK` (Intl-based global timezone abstraction); `InMemoryEventBus`
  implementing the `DomainEventBus` port; per-business advisory-lock transaction helper.
- **Repository boundaries extended/new** — booking (overlap, transitions, slot locks,
  status history, due-for-completion, per-phone lookup, service future bookings);
  payment (submission-key idempotency, transitions, proofs + lineage); resubmission
  verification; subscription (trial seed + eligibility + status history); business
  (settings/profile/slug/pause/deactivate); schedule (versions, demotion, guarded
  promotion, active-version pointer, exceptions).
- **Application services** — `BusinessService`, `CatalogService`, `ScheduleService`,
  `AvailabilityService`, `BookingService`, `ResubmissionService`, `SubscriptionService`,
  `CustomerStatusService`; pure availability engine `availability.ts`.
- **Module wiring** — `DomainServicesModule` (clock/event-bus factories, guard,
  services) imported by `AppModule`; all six repository tokens registered in
  `DomainModule`.
- **Tests** — 27 new unit tests (availability engine, global clock incl.
  Africa/Addis_Ababa, slug + template validation) and 25 new DB-gated service
  integration tests; DB test runner made deterministic across spec files.
- **Verification** — backend lint/typecheck/build/unit + live-DB suite ×3, frontend
  regression suite (untouched), Prisma generate + migrate status, spec diff empty.

## 3. Decisions Made and Their Rationale

| Decision | Rationale |
|---|---|
| Every booking mutation runs inside `withBusinessAdvisoryLock` (pg_advisory_xact_lock on `hashtext(businessId)`) and re-checks overlap authoritatively in-transaction before persisting | doc 08 §5, ADR-004; OQ-SLOT-001 forbids TTL-based locks |
| Rows written in an interactive transaction are read back only AFTER commit | the outer Prisma client cannot see uncommitted rows; read-backs/publications were moved out of the tx (fix surfaced by the live tests) |
| Schedule saves create a new immutable version; running business demotes active → PENDING (replaced_at) then promotes the new version ACTIVE inside one lock-tx | doc 07 (enum only PENDING/ACTIVE) + R162/163; partial unique index `uq_active_schedule_version` is the defense-in-depth |
| Paused business keeps saves PENDING; resume promotes latest PENDING | R151/R157/R158 |
| `validateCombination` writes VARIATION/ADD_ON component snapshots with `service_id = null` | `booking_component.service_id` is a FK to `service` only; snapshots must not reference other tables |
| Reschedule writes NO `booking_status_history` row | status stays CONFIRMED and the `booking_status_history_noop` constraint forbids from == to; trace = released+new ALLOCATED lock, `updatedAt`, BOOKING_RESCHEDULED event |
| Slot release recipient is nullable (never the literal `'system'`) | `slot_lock.released_by` is a UUID column; the SYSTEM actor has no user id |
| Backend DB specs run with `--fileParallelism=false` | two populated DB specs share one `werefa_test` DB; parallel workers raced each other's reset/insert loops |
| Slug conflicts, idempotency conflicts and row-lock races map to existing taxonomy codes | no Prisma internals leak (P2002 → CONFLICT / SLOT_UNAVAILABLE) |
| Component snapshots for variations/addons carry their own names/prices/durations | REQ-074/076 immutable snapshots |

## 4. Scope Guard Rails (verified)

Not implemented (as instructed): authentication/JWT/sessions, Telegram integration
(events only), external payment/file/billing integrations, HTTP API, frontend
integration, deployment/CI-CD overhaul, spec §46 unresolved decisions (price
REQ-125, timezone REQ-222, reminder lead REQ-139, PDF export, owner-modify scope,
TZ display), Prompt 38 Item 6, customer platform accounts.

## 5. Backend Implementation Summary

No HTTP/controller layer (deferred). Services are Nest `@Injectable()` classes that
depend on tokens (`BOOKING_REPOSITORY`, `PAYMENT_REPOSITORY`, …), the Prisma client,
`GLOBAL_CLOCK` and `DOMAIN_EVENT_BUS`. They never accept an arbitrary business id
without the tenant guard; platform-admin and system paths are separate. All booking
mutations wrap the per-business advisory lock.

## 6. Domain/Application Service Layer

- **BusinessService** — `createBusiness` (slug rules + reserved set, TRIAL subscription
  seed, settings default, P2002 → CONFLICT), `updateProfile`, `changeSlug`,
  `updateSettings` (validation incl. prepayment modes), `pause`/`resumeManual`
  (promotes latest PENDING), `deactivate`/`reactivate`, `getBySlug`/`getById`/
  `listByOwner`.
- **CatalogService** — `createService`/`createVariation`/`createAddOn` with delta
  validation, `updateService`, `deactivateService` (guarded by REQ-077 future
  bookings) /`reactivateService`, `listActiveServices` (inactive hidden, REQ-079),
  `validateCombination` (immutable snapshots + totals, inactive rejected).
- **ScheduleService** — `saveTemplate` (validate → new immutable version →
  promote-or-keep-PENDING per pause state), `getActiveVersion`/`listVersions`/
  `getVersion`, `recordScheduleException` (only recorded where a REAL conflict
  exists; never a release valve).
- **AvailabilityService + availability.ts** — gates (paused → [], ineligible
  subscription → [], no active version → []), resolved working windows/special
  dates/blocked periods, absolute-midnight interval grid (R088), window-contained
  slots (R089), overlap filter over active bookings (PAYMENT_PENDING/CONFIRMED) and
  active locks (LOCKED/ALLOCATED). Pure engine is framework-free and unit-tested.
- **BookingService** — `createBooking` (gates → `validateCombination` → idempotency
  pre-check → advisory-lock overlap re-check → atomic aggregate persist →
  P2002 mapping), `acceptProof` (T2, ALLOCATED, BOOKING_CONFIRMED), `rejectProof`
  (reason required, REQ-123 slot stays LOCKED, PAYMENT_REJECTED), `cancelBooking`
  (T6 release / T8 no-release / T9 release), `markNoShow` (release), `releaseSlot`,
  `reschedule` (CONFIRMED only, preserved payment, released + new ALLOCATED lock,
  BOOKING_RESCHEDULED), `completeBooking`/`autoCompleteDueBookings` (idempotent
  guarded), `getCustomerBookings`.
- **ResubmissionService** — `requestCode` + `resubmit` (hashed single-use expiring
  codes, MAX_ATTEMPTS=5, MAX_ACTIVE_CODES=5, security events, proof lineage,
  idempotent submission short-circuit, PAYMENT_PROOF_RECEIVED).
- **SubscriptionService** — `bookingGate`, `manualResume` (owner, refuses EXPIRED),
  `attemptAutoResume` (idempotent scheduled resume, R153/154/231).
- **CustomerStatusService** — read-only, business-slug + normalized phone, newest
  first, safe projection (times + public status string only, no ids/history).

## 7. Transcripts: Transactions and Concurrency

- `withBusinessAdvisoryLock` = `prisma.$transaction` + `SELECT
  pg_advisory_xact_lock(hashtext(${businessId}))` (doc 08 §5).
- Booking create: pre-checks (idempotency via `findBySubmissionKey`, availability)
  → advisory lock → authoritative `hasActiveOverlap` re-check → single-tx persist of
  booking + component snapshots + status history + payment (PENDING) + proof
  (submission_key unique) + LOCKED slot lock → commit → read-back + publish.
- Accept: payment PENDING→ACCEPTED + booking PAYMENT_PENDING→CONFIRMED + locks
  LOCKED→ALLOCATED in one lock-tx.
- Schedule promote path demotes active→PENDING and promotes guarded
  (PENDING→ACTIVE, count=1) inside one lock-tx; the partial index is the backstop.
- Idempotency: repeated submission keys return the original booking without side
  effects; concurrent same-key races map to CONFLICT.

## 8. Booking Lifecycle

States: PAYMENT_PENDING → (accept) CONFIRMED → COMPLETED / NO_SHOW / CANCELLED(t6);
PAYMENT_PENDING → REJECTED → resubmission → PAYMENT_PENDING; REJECTED → CANCELLED(t9);
PAYMENT_PENDING → CANCELLED(t8, slot stays blocked). Slot locks: LOCKED (claim) →
ALLOCATED (accept / reschedule) → RELEASED (release paths). No TTL (OQ-SLOT-001).

## 9. Payments and Idempotency

Payment row is created PAYMENT_PENDING/PENDING at booking creation (BANK_TRANSFER for
now). Submission keys unique; single-flight handling: pre-check short-circuits, DB
unique index + P2002 mapping backstop. Payments never leak statement/ledger internals.

## 10. Tenant Authorization Boundary

`TenantGuard.requireOwnedBusiness` resolves ownership inside the query (join on
`business_owner`) and returns NOT_FOUND for any non-owner/non-member request —
existence is never leaked. `requireAdminOrSuperAdmin` / `requireSystem` provide
separate platform paths. Customer-facing lookups are read-only and use business slug
+ phone only.

## 11. Subscription Eligibility Boundary

TRIAL (30 d) / TRIAL_GRACE (3 d) / ACTIVE / PAID_GRACE are booking-eligible;
EXPIRED is not. Business creation seeds TRIAL + history. No price, no reminder
timing (spec §46 items 1 & 3 unchanged).

## 12. Tests Written

- **Unit (deterministic, no DB):**
  - `availability.spec.ts` — 12 tests: window containment, grid alignment, CLOSED/
    CUSTOM special dates, blocked-period subtraction incl. day-of-week scoping,
    occupied-span filtering, from/until bounds, invalid params, `toDayMinuteSpans`
    clipping.
  - `global-clock.spec.ts` — 8 tests: datetime partition, ISO weekday, slotDate/
    dateKey, `atTimeOn` across midnight, deterministic `now()`, Africa/Addis_Ababa
    wall-clock/day-key/atTimeOn (non-normative design default).
  - `service-rules.spec.ts` — 7 tests: slug normalization/reserved/bad-character
    rejection, template window/weekday/CUSTOM validation.
- **DB-gated service integration (`domain-services.db.spec.ts`) — 25 tests:**
  business creation seeds settings + TRIAL; duplicate slug → CONFLICT; tenant
  isolation (NOT_FOUND, no leak); immutable versioned schedules (demote + promote);
  paused save stays PENDING and resume promotes; full booking aggregate persistence
  (payment/proof/lock/components/history); idempotent resubmission; occupied and
  overlapping slots → SLOT_UNAVAILABLE; paused → BUSINESS_PAUSED; availability
  reflects grid + shrink; accept/reject transitions incl. reasons + ALLOCATED/LOCKED;
  invalid stale transitions; cancel sm-08/t8 (no release) vs t6 (release); no-show;
  reschedule (locks, preserved payment, no-op history absent, events);
  reschedule into occupied → SLOT_UNAVAILABLE; completion idempotency + sweep;
  resubmission (hashed codes, attempts, audit, valid flow with lineage, refused for
  non-rejected); customer status safe projection; cross-business mutation denial;
  resume refused when subscription EXPIRED.
- The earlier repository suite (27 tests) and prisma.database DB spec (3 tests)
  keep passing within `test:db` (now sequential across files).

## 13. Run Command Transcripts (backend)

```
npm test        → 12 files passed + 3 DB files skipped | 65 passed, 55 skipped
npm run test:db → 7 files passed | 84 passed  (run 1 of 3)
npm run test:db → 7 files passed | 84 passed  (run 2 of 3)
npm run test:db → 7 files passed | 84 passed  (run 3 of 3)
npm run lint    → eslint "{src,test,prisma,scripts}/**/*.{ts,js}" --max-warnings=0  (clean)
npm run typecheck → tsc -p tsconfig.json --noEmit --pretty false  (clean)
npm run build   → nest build  (clean)
npx prisma generate → ok
npx prisma migrate status (dev werefa_dev) → Database schema is up to date!
```

## 14. Test Run Transcript (frontend regression — untouched)

```
npm test      → 15 files passed | 275 tests passed
npm run typecheck → tsc -b --pretty false (clean)
npm run lint  → eslint . (clean)
npm run build → vite build (clean)
```

## 15. Frontend Regression Summary

No frontend source changed (existing Prompt 38 mock/test files remain modified as
before). All four frontend gates green.

## 16. Documentation Written

- `docs/implementation/21-backend-application-services-and-core-domain-logic-report.md`
  (this file). Reports 19 and 20 remain the baseline summaries of the foundation and
  schema layers.

## 17. Concurrency / DB-Schema Interaction Notes

- Advisory locks serialize per business; the authoritative overlap query plus the
  partial unique indexes (`uq_slot_lock_active`, `uq_active_schedule_version`) are
  defense-in-depth.
- `booking_status_history_noop` and `payment_status_history_noop` constraints reject
  meaningless no-change rows; `subscription_status_history` intentionally has NO
  such constraint (EXPIRED→EXPIRED auto-resume-refusal record, R231).

## 18. Outstanding Spec §46 Decisions (unchanged)

1. Booking price (REQ-125). 2. Global timezone value (REQ-222) — `Africa/Addis_Ababa`
remains the non-normative design default; the system consumes the configured value.
3. Reminder lead times (REQ-139). 4. PDF export. 5. Owner modify scope. 6. TZ display.
7. Prompt 38 Item 6 (member/collaborator presence).

## 19. Risk Register

- **Lower** — no TTL on slot locks (OQ-SLOT-001, deliberate; later prompts may add
  expiry/cleanup).
- **Lower** — verification codes are not delivered (delivery adapter deferred); codes
  are stored hashed and never logged/returned.
- **Lower** — `security_event` write for resubmission success is inside the lock tx
  using the outer client (see §7); a rolled-back tx may leave an orphan audit row.
  Accepted for this prompt; an outbox/audit service arrives with the notification pipe.

## 20. Non-Goals and Deferred Work

Full HTTP API + controllers + DTO/validation wiring, authentication, Telegram
outbox/sender, payment integration, file storage, reminder scheduling, subscription
billing/approval, PDF export, deployment, CI/CD overhaul.

## 21. Files Changed or Added

**Backend (`backend/src/`):** `domain/errors/domain-errors.ts` (alter);
`domain/authorization/actor-context.ts`, `domain/authorization/tenant-guard.ts`,
`domain/events/domain-events.ts`, `domain/time/global-clock.ts`,
`domain/transactions/business-advisory-lock.ts`, `domain/domain-services.module.ts`
(add); `domain/domain.module.ts` (alter); `domain/repositories/tokens.ts` (alter);
`domain/repositories/{booking.repository.port.ts, prisma-booking.repository.ts,
payment.repository.port.ts, prisma-payment.repository.ts, resubmission.repository.port.ts,
prisma-resubmission.repository.ts, subscription.repository.port.ts,
prisma-subscription.repository.ts, business.repository.port.ts, prisma-business.repository.ts,
schedule.repository.port.ts, prisma-schedule.repository.ts}` (extend/add);
`domain/services/{business.service.ts, catalog.service.ts, schedule.service.ts,
availability.ts, availability.service.ts, booking.service.ts, resubmission.service.ts,
subscription.service.ts, customer-status.service.ts}` (add); `app.module.ts` (alter).

**Tests:** `domain/services/availability.spec.ts`, `domain/time/global-clock.spec.ts`,
`domain/service-rules.spec.ts`, `domain/domain-services.db.spec.ts` (add).

**Other:** `scripts/run-db-tests.mjs` (alter: `--fileParallelism=false` for a shared
test DB).

## 22. Test Command Inventory (how to run)

- Unit only: `npm test` (skips DB-gated specs via `describe.skipIf`).
- Live PG: `npm run db:up && npm run db:provision && npm run test:db`.
- Frontend regression: `npm test && npm run typecheck && npm run lint && npm run build`.

## 23. Prisma / Migration Status

Ran `prisma generate`. `prisma migrate status` for `werefa_dev`
(`localhost:5433`) reports “Database schema is up to date!” — no migration drift. The
same migration set covers the provisioned `werefa_test` database used by `test:db`.

## 24. How Prompt 40 Baseline Was Preserved

All 27 repository/schema-invariant DB tests and the 3 prisma.database DB tests pass
within `test:db`; the `npm test` unit suite passes as before; the previous reports and
module structure are intact; the only runner change makes the shared-DB specs
deterministic.

## 25. Frontend Non-Regression Statement

Frontend source is untouched by this prompt; all frontend gates pass (275 tests +
typecheck + lint + build). Frontend/backend integration is explicitly deferred.

## 26. Spec-Conformance Statement

The canonical spec is byte-unchanged (empty `git diff`). All implemented behavior
maps to documented requirements (REQ-005/006/047/050-081/082-099/100-124/125-158/
159-163/173/216/222-226/230). Unresolved §46 items are unchanged and noted in §18.

## 27. Git State

- HEAD: `868e0718b78e98efe06488c9afc6c4d3e6742d74` (unchanged). No commits made.
- `backend/` and `docs/implementation/` remain untracked (normal for this repo).
- `frontend/` retains the pre-existing Prompt 38 working-tree changes.
- `git diff -- docs/WEREFA-COMPLETE-SPECIFICATION.md` → empty.

## 28. Final Verification Matrix

| Gate | Result |
|---|---|
| Backend unit suite | pass (65 passed, 55 skipped) |
| Backend live-PG suite (×3) | pass (84 passed each run) |
| Backend lint / typecheck / build | pass |
| Frontend test / typecheck / lint / build | pass |
| Prisma generate / migrate status | ok / dev up to date |
| Spec byte-unchanged | pass |
| HEAD unchanged / no commits | pass |