# 05 — Booking Management (Prompt 11) — Section 38 Final Report

Status: **IMPLEMENTED** (core) · Final quality-gate run: **all green** · This report is the
Prompt 11 §38 close-out. Scheduling-tables features (working hours / recurring weekly
schedule / special dates / blocked periods) are **DEFERRED** and recorded honestly below.

## 1. Conformance summary

| Dimension               | Result                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Requirement coverage    | REQ-045/047/050/052/053, REQ-054/055/057/058/059, REQ-060–065/069, REQ-070/073/074/075/076/077/080, REQ-100/101/104/105/106/107/109, REQ-116/117/118/119/121/123/124, REQ-142 (outbox), REQ-173/174/177, REQ-226/227/228/229/230 implemented                                                                                                                                                                             |
| Deferred (out of scope) | Working-hours / recurring weekly-schedule / special-date / blocked-period slot math (REQ-050 schedule part, REQ-086/088/090–098): no scheduling tables yet — availability derives from live bookings + advisory-lock serialization; Telegram + notification-provider delivery (outbox rows are written; provider dispatch deferred); prepaid configuration (REQ-110/111); customer accounts / Telegram-connect (REQ-056) |
| Explicitly omitted      | Public cancel/never book via Telegram (REQ-058/059 — enforced, not omitted as a feature builder); no invented statuses; payment states exactly PENDING/ACCEPTED/REJECTED (REQ-100/SM-12)                                                                                                                                                                                                                                 |

## 2. Quality gate (final, this session)

| Step                 | Command                                        | Result                                                                                                                                                                                        |
| -------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Format            | `npm run format:check`                         | PASS (0 files flagged after `npm run format`)                                                                                                                                                 |
| 2. Lint              | `npm run lint` (all workspaces)                | PASS (0 errors)                                                                                                                                                                               |
| 3. Typecheck         | `npm run typecheck` (all workspaces)           | PASS (0 errors)                                                                                                                                                                               |
| 4. DB bootstrap      | `npm run db:test:setup`                        | PASS — clean `werefa_test` build with the booking migration + RLS                                                                                                                             |
| 5. Builds            | `npm run build` (all workspaces)               | PASS — API `nest build`, dashboard + public `vite build`, db + shared `tsc`                                                                                                                   |
| 6. Unit tests        | `npm run test:unit`                            | PASS — API **54** (9 files, incl. 4 new booking logic files), DB **5**, Shared **4**                                                                                                          |
| 7. Integration tests | `npm run test:integration`                     | PASS — **136** tests, 8 files, fileParallelism=false (each file bootstraps its own Nest app)                                                                                                  |
| 8. Startup smoke     | `node apps/api/dist/main.js` → `/health/ready` | PASS — `{"status":"ok","db":"up"}`; all booking routes mapped; secret masking confirmed: `DATABASE_URL:"***"`, `DATABASE_MIGRATOR_URL:"***"`, `REDIS_URL:"***"`, `S3_SECRET_ACCESS_KEY:"***"` |

Numeric deltas vs the Prompt 10 close-out: API unit **24 → 54** (+30 booking logic),
integration **97 → 136** (+39: +27 booking-management advances… exact: booking-management
now **33** tests incl. the new Prompt-11 H block, +rls-isolation extension to 15).

## 3. What was implemented this session

**Backend fixes (concurrency correctness):**

1. `booking-public.service.ts` — the `newProofOwner` notification now carries the
   **newly created** `proof.id` (previously `existing?.id ?? null`, which produced a
   `null` proof id on the second submission path).
2. `booking-admin.service.ts` `confirmCompleted` — now runs under an elevated
   `$transaction` with `pg_advisory_xact_lock(hashtext(businessId))`, guarded
   `updateMany({ where: { id, status: 'CONFIRMED' } })`, `ConflictException` on a
   concurrent-race loser, and status history + slot release inside the same lock.

**New coverage (all green):**

- **Unit** (`apps/api/test/unit/`): `booking-transitions.test.ts` (7), `booking-pricing.test.ts`
  (7), `booking-availability.test.ts` (8), `booking-lock.test.ts` (8). The retry helpers are
  driven through a fake Prisma `$transaction` that throws `40001`/`40P01` then succeeds; the
  mock tx exposes `$executeRawUnsafe`/`$executeRaw` for the advisory-lock calls.
- **RLS** (`apps/api/test/integration/rls-isolation.test.ts`, suite now 15): booking, payment,
  payment_proof, slot_lock, booking_status_history, payment_status_history, notifications —
  owner-window reads, cross-tenant read/update/delete/insert denial with spoofed GUCs, no-context
  rejection, public slot-window marker, `customer_phone` reinstatement corridor, SUPER_ADMIN
  cross-tenant view. Fixture timestamps use `date_trunc('minute', …)` and `code_hash` is passed
  as a bound parameter.
- **Integration** (`apps/api/test/integration/booking-management.test.ts`, suite now 33):
  describe H adds — multi-service booking with immutable snapshots (REQ-074/075/076/080);
  parallel overlapping-window creates serializing to exactly one winner; concurrent
  reschedule-vs-booking on an occupied target; concurrent explicit release-vs-booking;
  proof variants (JPEG/PDF accepted, unsupported MIME + oversize + missing file rejected);
  terminal-status transition enforcement via the lifecycle `autoCompleteDue()` job.

**Frontend:**

- `apps/public` — booking panel on the business page (`BookingPanel.tsx`): service
  multi-select with variations + add-ons, live price/duration totals (integer-minor),
  date/time (whole-minute), name/phone (same regex as the API), payment method, optional
  proof upload (PNG/JPEG/PDF ≤10 MB), availability pre-check, idempotent submit
  (`submissionKey`), friendly `SLOT_UNAVAILABLE` handling, replay detection. Hash routing
  unchanged (`#/b/<slug>`).
- `apps/dashboard` — owner "Manage bookings" panel (`business/BookingsManager.tsx`):
  paginated list with status filter + RECENT/UPCOMING sort, detail view with service lines,
  payment/status histories, proof count, and lifecycle actions (Accept & confirm, Reject with
  mandatory reason, Cancel, Reschedule to a new whole-minute time, No-show, Release slot when
  status is non-active and the lock is still held). No manual owner "complete" — completion is
  lifecycle-job / super-admin only.

**Seed fixtures** (`apps/api/src/seed/dev-seed.ts`): seven bookings across every status
(PAYMENT_PENDING ×2, CONFIRMED, REJECTED, COMPLETED, NO_SHOW, CANCELLED) with payments,
slot locks, status/payment history, one payment proof, reminder/create notifications, and a
multi-service line. Deterministic ids + a first-run guard keep the seed idempotent.

## 4. Feature completeness (honest status)

- **IMPLEMENTED:** public create + availability + idempotency (`submission_key`, replay
  returns `created:false`); multi-service composition with immutable snapshots
  (REQ-074/075/076/080); atomic slot claim (`pg_advisory_xact_lock(hashtext(business_id))`
  - in-transaction overlap re-check, REQ-121) with a defense-in-depth partial unique index on
    the exact-slot identity; whole-minute timing (REQ-226, `booking_minute_precision_ck`);
    proof upload PNG/JPEG/PDF with size cap; exactly one payment per booking with
    PENDING/ACCEPTED/REJECTED only (REQ-100/SM-12); rejection reason recorded
    (`payment_rejection_event`, REQ-068/124); owner lifecycle accept / reject / cancel /
    reschedule (old slot freed, new slot allocated, payment kept — REQ-107) / no-show /
    explicit release-slot; SM-08 semantics (pending cancel and rejected keep the slot LOCKED);
    terminal statuses block further transitions; append-only status history (REQ-163/173/174)
  - payment history; reminder sweep (24h/1h) queuing outbox rows; super-admin manual
    complete + full audit view; booking-table RLS incl. the public slot-marking policy and the
    `customer_phone` reinstatement corridor (REQ-109).
- **PARTIAL:** notification **outbox** is written transactionally (REQ-142); provider-based
  delivery (email/Telegram) is not yet dispatched. Resubmission endpoints
  (`request-code` / `resubmit`) exist but are exercised less than the core flow — noted, not
  claimed as fully QA'd.
- **DEFERRED:** working-hours / recurring weekly schedule / special dates / blocked periods
  (no scheduling tables exist; REQ-050 “computed from schedule” reduces to “computed from
  current future bookings”, which is exact today but must be re-examined when schedule
  tables land); prepaid configuration (REQ-110/111 — `prepaid_minor` is stored per booking,
  always 0 until a config source exists); Telegram connect + optional customer notifications
  (REQ-056, REQ-060–064, REQ-227–229); customer accounts / booking history on the public page
  (REQ-057 — deliberately absent).

## 5. Architectural consistency checks

- Money is integer **minor** units end-to-end (BIGINT columns, never floats); durations are
  whole minutes (REQ-226 DB check + DTO validation).
- All slot mutations serialize on the per-business advisory lock and re-verify overlap inside
  the locked transaction; the partial unique index covers only the **exact-slot** identity and
  never substitutes for the overlap re-check (documented in the migration header).
- Booking status and payment status are **separate** enums; no invented states; NO_SHOW /
  COMPLETED / CANCELLED are permanently terminal.
- RLS is FORCE-applied on every booking-domain table; cross-tenant reads/writes are denied by
  policy (asserted with spoofed GUCs); the migration cluster is empty of owner-visible
  `code_hash` (only the `resubmission_verification.code_hash` CHAR(64)).
- Public serialization exposes only curated fields (no internal keys, no payment/verification
  secrets); the public flow cannot cancel/modify (no endpoints exposed); bookings only
  originate from the public flow + QR (REQ-007/045/059).
- Service deletion respects REQ-077 via the `FutureBookingsSeam`; immutable snapshots keep
  past bookings replayable after a service is gone (SET NULL on `service_id`).
- Seed is dev-only (`APP_ENV=production` refuses) and idempotent.

## 6. Evidence / artifacts

- `apps/api/src/booking/*` — controllers (public/admin/super-admin/resubmission),
  `booking.service.ts` lifecycle, `booking-public.service.ts`, `booking-admin.service.ts`,
  pure logic seams (`booking-{transitions,pricing,availability,lock,proof}.ts`),
  `booking.serializer.ts`, notification outbox (`booking-notifications.ts`).
- `apps/api/src/jobs/booking-lifecycle.job.ts` — reminder + auto-complete sweeps.
- `packages/db/prisma/migrations/20260905_000600_booking_payment/migration.sql` + schema;
  `packages/db/src/bootstrap-rls.ts` (booking policies).
- Tests: `apps/api/test/unit/booking-*.test.ts` (4 files), `apps/api/test/integration/rls-isolation.test.ts`,
  `apps/api/test/integration/booking-management.test.ts`.
- Frontend: `apps/public/src/BookingPanel.tsx` (+ `lib/catalog.ts`, `lib/api.ts`),
  `apps/dashboard/src/business/BookingsManager.tsx` (+ `lib/booking-api.ts`,
  `BusinessProfile.tsx` wiring).
- Seed: `apps/api/src/seed/dev-seed.ts`.
- Reproducible gate: `set -a; . ./.env; set +a` then the commands in §2 (Postgres 5433 / Redis /
  MinIO / MailHog via `infra/docker-compose.yml`).

## 7. Deferred-boundary declaration

Scheduling-table features (working hours, weekly pattern, special dates, blocked periods,
booking interval) intentionally remain OUT of scope: no migration or endpoint implies their
existence, and availability today is a function of the live future-booking set under the
advisory lock. The notification outbox rows and the lifecycle sweeps prove the write side of
REQ-142/reminers; provider dispatch is the next module. Prepaid configuration and customer
Telegram integration are pending their own required tables/flows.
