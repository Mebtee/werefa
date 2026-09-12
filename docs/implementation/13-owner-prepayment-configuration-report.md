# 13 — Owner Prepayment Configuration (Prompt 21) — Section 38 Final Report

Status: **IMPLEMENTED** · Final quality-gate run: **all green**.

This report closes out Prompt 21: Owner Prepayment Configuration,
`docs/01-master-specification.md` §18 REQ-110 (business configured for
prepayment shows a prepayment requirement in booking) and REQ-111 (owner
configures **either** a percentage **or** a fixed amount prepayment; mixing is
rejected).

An owner enables prepayment for a business in one of exactly two forms
(percentage of the booking total, or a fixed minor-unit amount). Availability
responses and freshly created bookings show the derived deposit; the deposit is
snapshotted onto `payment.prepaid_minor` at booking creation so later config
changes never mutate already-created bookings. Disabled is the safe default for
every existing business.

## 1. Conformance summary

| Dimension               | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement coverage    | **REQ-110** — a business configured for prepayment shows a prepayment requirement in booking: the public availability payload exposes `prepaidMinor` (derived from the current config and the quoted total); a created booking returns `booking.prepaidMinor`; the value is snapshotted onto `payment.prepaid_minor` in the same transaction; the public booking page displays the deposit as part of the payment ask. **REQ-111** — the owner configures exactly one form: `PERCENTAGE` (`percentage` 1..100) or `FIXED` (`fixedMinor` positive), both enforced at parse time **and** by DB CHECK constraints; mixing the two forms is rejected with `VALIDATION_ERROR` (AC1). |
| Partial                 | None. No requirement remains partially met.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Deferred (out of scope) | Withdrawal/refund lifecycle for deposits (booking cancellation semantics are outside this prompt). Multi-payment / split payment. Deposit display localisation. Dashboard UI automation (the dashboard has no vitest/testing-library infrastructure; per prior prompts no framework was added — the panel is manually verified and logically covered by the API integration suite). Requirement-traceability rows remain `TRACED`/`TEST-PENDING`: traceability docs are versioned at `docs/requirements-traceability.md` only in the initial commit, and the established per-prompt process is to index reports in `docs/implementation/README.md` (§15 below).                 |
| Explicitly omitted      | No migration of the (nonexistent) `business_settings` table; no `business_settings.booking_interval_minutes` handling; no change to payment verification policy; no auto-reject/policy on top of the deposit; no employee/other-role config surface (owner-only); no sharing the prepayment config through the public API.                                                                                                                                                                                                                                                                                                                                                      |

## 2. Product decisions (Prompt 21 §15)

- **Storage location — reconciled with architecture.** Architecture doc 11-Payment §A.2
  ("Stored in `business_settings.prepaid_percent`/`prepaid_fixed`") references a
  `business_settings` table that **does not exist** in this repository. The actual
  schema keeps per-business operational settings on the `business` row (e.g. pause state,
  `trial_ends_at`), so the four prepayment columns live on `business` as well. This is the
  same reconciliation documented for pause/subscription state and keeps a single row per
  business; it is noted here rather than asserted to have pre-existed.
- **Money stays integer minor units.** No floats enter the deposit path. `percentage` is an
  integer 1..100 and derivation is exact BigInt arithmetic: `floor(total * pct / 100)`.
  There is no rounding convention elsewhere in the codebase, so floor division is the
  chosen, documented convention.
- **Fixed amount vs. total.** A `FIXED` deposit larger than the booking total is snapshotted
  as-is (no clamp). No rule was invented here; the behaviour is documented and tested.
- **Default = disabled.** `prepayment_enabled` defaults to `false`; the migration leaves every
  existing business disabled, so booking behaviour is unchanged until an owner opts in.
- **Snapshot at creation.** The deposit is derived inside the same transaction that creates
  the booking/payment (re-using the existing advisory-locked creation context), so
  reconfiguration affects only _new_ bookings.
- **Authorization model.** Routes are on `BusinessController` (`@RolesExact(Role.Owner)` class
  level) and add `TenantGuard` so the URL `businessId` must be in `actor.ownedBusinessIds`
  (RLS-pinned read/update, consistent with every other business-scoped route). Admin/Super
  Admin get 403; anonymous gets 401.

## 3. What was implemented

### Backend (`apps/api/src/business`, `apps/api/src/booking`, `apps/api/src/iam`)

- **`prepayment-config.service.ts`** (new) — `PrepaymentConfigService`:
  - `getForOwner(userId, businessId)` / `updateForOwner(userId, businessId, body)` — both wrap
    the access in `withOwnerBusinessContext` (RLS + owner scoping); update records a
    `BUSINESS_PREPAYMENT_CONFIG_UPDATE` security event (result/payload audited) in the same
    transaction.
  - `getForBooking(tx, businessId)` — read used inside the booking-creation transaction.
  - `toPrepaymentConfig(row)` — row → DTO; the DTO `fixedMinor` is a **number** (minor units),
    converted with `toMinorUnits()` because `bigint` cannot be `JSON.stringify`'d (Nest's
    response serialization). This was caught by a failing unit/integration expectation and fixed
    before the gate runs.
  - `derivePrepaidMinor(row, totalPriceMinor)` — pure, exported for unit tests; DISABLED → `0n`,
    PERCENTAGE → `floor(total*pct/100)`, FIXED → configured amount.
- **`prepayment-input.ts`** (new) — `parsePrepaymentConfigInput`: `enabled` is required
  (`false` resets the mode); `true` requires exactly one of `PERCENTAGE`/`FIXED`; out-of-range
  percentage (not 1..100) and non-positive `fixedMinor` are rejected; providing the other
  form's field alongside a form is **rejected** (`VALIDATION_ERROR` / `Autocomplete...` →
  standard `ValidationException`), implementing REQ-111 AC1 in the API layer.
- **`business.controller.ts`** — `GET/PATCH /api/v1/businesses/:businessId/prepayment-config`
  (owner + tenant-guarded; 200 on update).
- **`business.module.ts`** — wires + exports `PrepaymentConfigService`.
- **`booking-public.service.ts`** — availability (`checkAvailability`) and create both call
  `getForBooking(tx, businessId)` then `derivePrepaidMinor`; create writes the derived value as
  `payment.prepaidMinor` (previously hard-coded `0n`).
- **`booking.serializer.ts`** — `AvailabilityDto` gains `prepaidMinor`; booking response already
  carried the payment amount through `payment.prepaidMinor` → now populated.
- **`security-events.service.ts`** — added `BUSINESS_PREPAYMENT_CONFIG_UPDATE` to the allowed
  event-type set (rides the existing `String` enum-style column, no migration needed).

### Database (`packages/db`, migration `20260911_000010_owner_prepayment_config`)

- `business` gains four **additive** columns: `prepayment_enabled` (`bool default false`),
  `prepayment_type` (`varchar(20)`), `prepayment_percentage` (`int`), `prepayment_fixed_minor`
  (`bigint`) + CHECK constraints: enabled → type ∈ `{PERCENTAGE,FIXED}`; PERCENTAGE →
  percentage 1..100; FIXED → `fixed_minor > 0`; and a mutually-exclusive CHECK that exactly the
  matching column is set. RLS needs no new policies — `business` row policies already cover the
  new columns. Schema model updated in `schema.prisma`.
- Verified end-to-end: `db:test:setup` applied the migration over the bootstrapped test DB and
  the pre-existing dev `werefa` DB shows the migration in its pending list.

### Dashboard (`apps/dashboard`)

- **`PrepaymentConfigPanel.tsx`** (new) — owner panel: enable checkbox, mode select
  (PERCENTAGE/FIXED), percentage / ETB amount inputs, client-side range validation matching the
  API, save/load via the new client. Exact-one-form enforced in the UI.
- **`lib/prepayment-api.ts`** (new) — typed client for
  `/api/v1/businesses/:id/prepayment-config`.
- **`BusinessProfile.tsx`** — "Prepayment" section button (owner-only surface, `!isAdmin`),
  rendering `<PrepaymentConfigPanel>`.

### Public booking page (`apps/public`)

- **`BookingPanel.tsx`** — availability summary shows "Deposit required: …ETB" when
  `prepaidMinor > 0`; booking confirmation shows a deposit line, and the pending-payment copy
  differentiates deposit + total wording when a deposit applies.

## 4. RLS & security summary

- Reads/writes run through `withOwnerBusinessContext` → every statement is business-pinned by
  the existing `business` RLS policies; a cross-owner request is denied before any SQL mutates.
- `BUSINESS_PREPAYMENT_CONFIG_UPDATE` joins the audited security-event set (metadata records
  mode + value; existing audit/retention applies).
- Admin and Super Admin are rejected by `@RolesExact(Role.Owner)` (403) — tested.
- The public booking flow never reads the config directly; it derives through the same
  business-pinned Prisma path and only surfaces the derived amount on the business's own public
  page.

## 5. Tests

### Unit (`apps/api/src` — `npm run test:unit --workspace apps/api`)

- **`prepayment-config.test.ts`** (15 tests): `derivePrepaidMinor` DISABLED/PERCENTAGE/FIXED and
  floor-division edge cases; input validation — both forms accepted, **mixing rejected**,
  non-number / out-of-range percentage, non-positive fixed, string/number/bigint fixed input;
  `toPrepaymentConfig` row→DTO including the `fixedMinor` **number** conversion (bigint-input
  sanitisation regression guard).
- Full suite: **22 files / 219 tests PASS** (plus `@werefa/db` 5 and `@werefa/shared` 4 via the
  root `test:unit` → 24 files / 228 tests).

### Integration (`apps/api/test/integration/prepayment-config.test.ts` — 16 tests, HTTP end-to-end)

- **A: owner config CRUD + validation** — default DISABLED shape; enable PERCENTAGE 20; switch
  to FIXED (percentage cleared); mixing rejected (400 `VALIDATION_ERROR`, REQ-111 AC1);
  out-of-range percentage + non-positive fixed rejected; disable resets the stored mode.
- **B: booking derivation + snapshot isolation** — availability reflects the configured deposit;
  create snapshots `payment.prepaid_minor` (verify via superuser SQL); FIXED amount snapshot;
  **reconfiguration leaves existing bookings untouched** while a new booking sees the new value;
  DISABLED → `prepaidMinor` 0 on availability + create.
- **C: tenant isolation + authorization** — a business's config never leaks into another
  business's booking (cross-tenant isolation, business B defaults to no deposit); same-owner
  multi-business independent config; cross-owner read/write → 403; Admin/Super Admin → 403;
  anonymous → 401.
- Full suite: **14 files / 267 tests PASS** (re-run via the canonical
  `npm run test:integration --workspace apps/api`, which redis applies `db:test:setup` first).

## 6. Full quality gate (this session)

| #   | Gate                       | Command / result                                                                                                                                                                                                                    |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Format                     | `npm run format` then `npm run format:check` — **PASS (0 files flagged)**. Prettier rewrapped 4 pre-existing doc files (02, 09, 11, `implementation/README.md`) whose formatting had drifted; no semantic change.                   |
| 2   | Lint                       | `npm run lint` — **PASS** (0 errors/warnings).                                                                                                                                                                                      |
| 3   | Typecheck                  | `npm run typecheck` — **PASS** (api, db, shared, dashboard, public).                                                                                                                                                                |
| 4   | Unit tests                 | `npm run test:unit` — **PASS**: api 22 files/219, db 1/5, shared 1/4 (24 files / 228 tests).                                                                                                                                        |
| 5   | Integration (DB bootstrap) | `npm run test:integration --workspace apps/api` — **PASS**: `db:test:setup` applied all migrations incl. `20260911_000010_owner_prepayment_config`, then **14 files / 267 tests PASS**.                                             |
| 6   | Build                      | `npm run build` — **PASS** (API nest build, dashboard + public vite build, db + shared tsc).                                                                                                                                        |
| 7   | Startup smoke              | Built API booted against docked dev infra: `/api/v1/health/live` 200, `/api/v1/health/ready` 200, "Nest application successfully started", "API listening on :3000"; env secrets masked in boot logs; process stopped after checks. |
| 8   | Diff hygiene               | `git diff --check` clean (autocrlf LF→CRLF warnings only); no `.only`/`.skip` anywhere in test suites; no temp/scratch artifacts inside the repo.                                                                                   |
| 9   | No commits / pushes        | Repository left **uncommitted** — nothing staged, nothing pushed (per instructions).                                                                                                                                                |

Environment note: the machine's Windows-native Postgres (5432) is a service this session cannot
manage and WSL2 ran PostgreSQL unreliably on this host; the missing dev database is best served
by the repo's canonical stack, which is the docker-compose `infra/docker-compose.yml`
(postgres:16 on `127.0.0.1:5433`, matching `.env`). `db:test:setup` was executed against
`werefa_test` created fresh by the superuser DSN; the superuser password matched the compose
default. A local `DATABASE_MIGRATOR_URL` override (migrator role only) was supplied for the test
run because `.env` carries no migrator DSN — the role bootstrap requires one to give `migrator`
`LOGIN` privileges for `prisma migrate deploy`/RLS ownership.

## 7. Deferred against REQ-110/111

- Withdrawals/refunds of deposits (not part of the requirement text).
- Split / installments / other prepayment models (spec explicitly constrains to the two forms).
- Dashboard UI is manually verified; the dashboard has no automated test stack (established
  throughout the prompt series).

## 8. Source-path mapping

| Requirement / decision                      | Located at                                                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REQ-110 / REQ-111 config + derivation (API) | `apps/api/src/business/prepayment-config.service.ts`, `apps/api/src/business/prepayment-input.ts`                                                                                    |
| Endpoints                                   | `apps/api/src/business/business.controller.ts` (GET/PATCH `prepayment-config`)                                                                                                       |
| Booking integration                         | `apps/api/src/booking/booking-public.service.ts`, `apps/api/src/booking/booking.serializer.ts`                                                                                       |
| Audit event                                 | `apps/api/src/iam/security-events.service.ts` (`BUSINESS_PREPAYMENT_CONFIG_UPDATE`)                                                                                                  |
| Schema & migration                          | `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/20260911_000010_owner_prepayment_config/migration.sql`                                                            |
| Dashboard (owner UI)                        | `apps/dashboard/src/business/PrepaymentConfigPanel.tsx`, `apps/dashboard/src/lib/prepayment-api.ts`, `apps/dashboard/src/business/BusinessProfile.tsx`                               |
| Public booking page                         | `apps/public/src/BookingPanel.tsx`                                                                                                                                                   |
| Tests                                       | `apps/api/test/unit/prepayment-config.test.ts`, `apps/api/test/integration/prepayment-config.test.ts`                                                                                |
| Requirements / architecture context         | `docs/01-master-specification.md` §18 (REQ-110/111); `docs/architecture/11-payment-architecture.md` §A.2 (reconciled in §2); `docs/requirements-traceability.md` (rows remain as-is) |

## 9. Prompt 21 / next-prompt boundary

- This scope is limited to owner prepayment **configuration** and the booking-time deposit
  **snapshot/display**. Booking-status/verification flows, deposit refunds, and reporting over
  prepayment values are left to later prompts.

## 10. Verification notes

- Watch item captured: a `bigint` in the response DTO throws during `JSON.stringify`; the DTO
  now returns `fixedMinor` as `number` (mirroring the API's other minor-unit fields). Unit test
  `8_500n → 8_500` guards the conversion.
- The reconfiguration integration case books distinct time slots; same-slot booking is a
  separate (correct) 4xx path and is not exercised there.
