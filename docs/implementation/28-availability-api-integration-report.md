# 28 — Availability API Integration Report (Prompt 48; REQ-070/074/083–090/088/089/090)

## Scope

Public availability becomes a real, multi-service read path end to end. The backend adds
`POST /api/v1/public/businesses/:slug/availability` — the body carries only the *selections*
(`serviceId`/`variationId`/`addOnIds`) and the backend sums duration/price and returns the
resulting slot starts, so the client never sends a computed duration (REQ-070/074). The
frontend date & time step is migrated from the `@/mock` availability seam to the real API
client: one parallel availability call per booking-window date (no mock fallback), slots for
the picked date refetched from the same endpoint. Booking creation/proof/locking stays on the
mock seam (Prompt 49), so nothing reserved by asking is newly committed; availability remains
read-side (no locks). Backend reuse: the existing availability engine and its gates
(deactivated/missing service, paused business, missing settings, missing subscription,
expired, no active schedule version, lock occupancy) are unchanged and only re-invoked
through the new POST path.

## Verification results (final, run locally)

| Layer | Command | Result |
|---|---|---|
| Backend | `npm run build` | PASS |
| Backend | `npm run typecheck` | PASS |
| Backend | `npm run lint` | PASS |
| Backend | `npm test` (no DB) | 127 passed / 172 skipped (DB suites self-skip w/o `RUN_DB_TESTS`) |
| Backend | `npm run db:up && npm run db:provision && npm run test:db` | **246 passed (14 files)** — live Postgres. `http-api.db.spec.ts`: **26 passed** incl. the 8 new POST-availability cases |
| Frontend | `npx vitest run` | **382 passed / 29 files, exit 0** (5 consecutive clean full runs at close) |
| Frontend | `npx tsc -b --pretty false` | PASS |
| Frontend | `npm run lint` | PASS |
| Spec | `docs/WEREFA-COMPLETE-SPECIFICATION.md` | unchanged — working tree hash `5494658e…` equals `git show HEAD:` hash (`c9a6c92`) |

Docker was down when this task resumed; the DB verification was completed at close
(`db:up` + `db:provision` + `test:db`).

## What changed

### Backend
- `catalog.service.ts` — `validateCombinations(businessId, selections)`: one `service.findMany`
  scoped to the business + `isActive` (variations/addOns filtered to active). Rejects a
  missing/inactive service; rejects a service duplicated **within** one selection; allows the
  same service across distinct selections; returns a comparable breakdown
  (`computedDurationMinutes`/`computedTotalPriceMinor` + per-selection details).
  `validateCombination` now delegates to it with the same public behavior (zero-duration
  defensive check preserved).
- `public.controller.ts` — new `POST :slug/availability` (`@HttpCode(200)`), sharing a private
  `buildAvailability(slug, date, selections)` with the existing GET. Invalid selection →
  `inactiveService` (VALIDATION_ERROR/400); unknown slug → NOT_FOUND/404.
- `payloads.ts` — `AvailabilitySelectionBody` (`serviceId` UUID, optional `variationId` UUID,
  optional `addOnIds` UUID[] `@ArrayMaxSize(5)`) and `AvailabilityQueryBody` (date
  `@Matches(/^\d{4}-\d{2}-\d{2}$/)`, selections `@ArrayMinSize(1)`/`@ArrayMaxSize(8)`,
  `@ValidateNested({ each: true })` + `@Type`), flattened `property.nestedField` errors via the
  existing validation setup.
- `availability.spec.ts` `+5` (from/until bounds, two working periods same day with no
  gap-bridging, CUSTOM special day vs blocked day precedence, exact-fit single slot,
  duration>window and full-window occupancy → none).
- New `availability.service.spec.ts` (10 tests) — all eight readiness gates + occupancy
  (touching starts kept, overlapping removed) on a fake prisma + real UTC clock.
- New `catalog.service.spec.ts` (9 tests) — totals/components, multi-selection sum, duplicate
  across selections allowed, duplicate-in-selection rejected, inactive/missing/variation-not-
  in-active-list/cross-business rejected, `validateCombination ≡ validateCombinations`.
- `http-api.db.spec.ts` `+8` — owner B creates `happy-salons-test-2`; `POST availability` for
  multi-service selections (single=30/6000, svc+variation+addOn=60/11000, duplicated
  svc+svc=60/12000); cross-tenant A-slug + B-service → 400 VALIDATION_ERROR `fields.serviceId`;
  unknown service → 400; unknown slug → 404; malformed bodies (empty/gone selections, ISO
  date like `2026-11-20T00:00:00.000Z`, `not-a-uuid`, 9 selections) → 400; CLOSED special
  date → `slots: []`; occupancy — a booking at `2026-11-27T13:00` removes that start from the
  POST response while `11:00`/`09:00`/`15:00` remain.

### Frontend
- `api/types.ts` — `AvailabilitySelectionInput`, `AvailabilityQueryPayload`,
  `PublicAvailabilitySlot`, `PublicAvailabilityView` (wire authoritatives).
- `api/availability.ts` — `getPublicAvailability(slug, { date, selections }, signal?)` → POST
  via `apiRequest` (error envelope → `validation`/`conflict`/`not-found` ApiError kinds).
- `api/availability.mapper.ts` — `slotTimesFromView` (ISO slot instants → ordered local
  `HH:MM`, REQ-224/225) and `bookingDatesFromViews` (window strip `hasTimes`). The mapper
  also drops already-past slots for *today*: a front-end presentation rule kept from the mock
  (the still-mock booking submission re-checks the picked time with the same `isPastSlot`
  rule, so offering them would make submit fail). Backend has no past-time rule yet (whistled
  in this report under deferred decisions).
- `DateTimeStep.tsx` — gains `selections`; keeps `durationMinutes` (prop) only for the "Your
  booking needs X minutes" copy. `Promise.allSettled` over `nextDateStrings(bookingWindowDays)`
  with one `getPublicAvailability` per date; ANY rejection → datesError (retry re-runs the
  whole batch); picked date re-fetched for slots. No `@/mock` imports remain.
- `BookingWizard.tsx` — passes `selections={flow.selections}`.
- `test/businessApi.ts` — `POST /public/businesses/:slug/availability` route: `YYYY-MM-DD`
  check, per-selection validation against the active catalog (`serviceFromOwnerView`),
  totals derived exactly like the backend (duration+price), slots via the shared
  `computeAvailableTimes(business, date, totalDuration, getOccupiedBlocks(slug, date))`
  (ISO instants built from local wall clock + duration), unknown slug → 404. A controlled
  `failAvailabilityFor(date)` knob lets tests fail specific dates at request time for the
  datesError/slotsError paths.
- New tests: `api/availability.test.ts` (4 — wire contract: method/URL/body carry selections,
  no duration; 200 view passthrough; validation/404 mapping), `api/availability.mapper.test.ts`
  (5 — local-time conversion, ordering, non-today keeps all, today-past dropped, hasTimes
  expiry), `features/public-booking/AvailabilityApi.test.tsx` (5 — one POST per window date
  with the wire selections and no duration key; re-query with the fuller selection after a
  second service is added; disabled chip exactly for empty dates cross-checked against the
  shared time projection; whole-batch and per-date retryable error states),
  `test/availabilityNoMock.test.ts` (2 — DateTimeStep imports `@/api/availability`, no
  `@/mock`, no `totalDurationMinutes`; BookingWizard forwards selections).

## Seam audit

- **HTTP+DB seam (http-api.db.spec.ts, RUN_DB_TESTS-gated)** — the new POST route is asserted
  against live Postgres at the real HTTP boundary (26/26 in the file pass), including
  cross-tenant isolation, malformed bodies and occupancy.
- **Read-side gates/engine (availability.service.ts)** — unchanged; only re-entered via the
  POST path (10 new unit tests on the gates + occupancy).
- **Frontend fetch seam** — DateTimeStep/BookingWizard go through `api/availability.ts` only;
  `test/businessApi.ts` supplies the same wire contract for render tests. The mock seam
  (`mock/api.ts`, `mock/availability.ts`) is untouched and still backs booking submission
  (Prompt 49).
- **Time conversion** — backend returns ISO instants on the global clock; the mapper renders
  local `HH:MM`. Tests build ISO from local wall clock and assert `localOf(iso)` so they are
  TZ-independent (host is UTC+3).

## Req trace

- REQ-070/074 (multi-service availability, totals computed server-side, no client duration):
  POST route + `catalog.service.validateCombinations` + DB + component contract tests.
- REQ-083/084/085/086/088/089/090 (workday/blocked/special-day/interval slot shaping):
  reused, unchanged engine; highlights re-asserted in `availability.spec.ts` `+5` and the
  DB CLOSED-date + occupancy cases.
- REQ-224/225 (24-hour local times, `YYYY-MM-DD` keys): `availability.mapper.ts`.

## Notes / knowns

- **Existing-test hardening (load flakes)** — two long assertions in pre-existing tests were
  made load-robust, both verified passing in isolation and in all final full runs:
  `BookingManagement.test.tsx` "rejects a pending booking…" now awaits `findByText(
  'Invalid receipt')` instead of a synchronous read right after the click; the `BookingFlow`
  end-to-end happy path got a dedicated 20s timeout (it walks services → 14-date availability
  window → times → details → review → payment → upload → submit).
- **One unidentified flake** appeared in a single full-suite run after that hardening
  (1/382); it was absent from the next 5 consecutive full runs (all exit 0) and never
  reappeared targeted. Same class as the Prompt 47 note (parallel-run timer race, unstable
  name). Not reproduced at close.
- **Deferred decisions**
  - *Past-time presentation:* the front-end mapper drops already-past slots for today
    (REQ-225 rendering); the backend has no past-time rule yet (spec §46 item 2) and would
    need a decision on whose clock/date should govern before the rule can move server-side.
  - *Timezone:* slots are emitted on the global clock; the UI converts to the viewer's local
    wall clock. A per-business timezone decision is not specified yet.
  - *Browser QA (1440/430/375 viewport, DB cleanup, `addis-beauty-lounge` intact):* no
    Playwright/Cypress tooling exists in this repo, so manual browser QA can't run in this
    environment; the deterministic plan is preserved here and covered at the seam level by
    `AvailabilityApi.test.tsx`.
- **Prompt 49 deferred** — booking creation/proof/slot locking stay mock-backed; nothing in
  this task reserves capacity.
- No commit was made (task rule: do not commit without explicit request).

## Addendum (Prompt 48 §8/§23 — impossible-date hardening)

A follow-up audit of the validation path exposed one genuine gap: the date key regex
(`@Matches(/^\d{4}-\d{2}-\d{2}$/)`) accepted *impossible* calendar days such as `2026-02-30`
or `2026-13-01`, and the engine would silently normalize them via `Date.UTC` — `2026-02-30`
answered for 2026-03-02, `2026-13-01` for 2027-01-01 — instead of returning the established
validation envelope. This violates Prompt 48 §8 ("do not silently normalize invalid dates;
return the established API error envelope") and §23 (invalid dates in the validation test
matrix).

### What changed (files)
- `common/validation/is-calendar-date.ts` (new) — `isCalendarDateKey()` + class-validator
  `@IsCalendarDateKey` constraint. Rejects strings matching `YYYY-MM-DD` that are not a real
  calendar day (round-trips through `Date.UTC` and compares year/month/day; rejects
  `2026-02-30`, `2027-02-29`, `2026-13-01`, `2026-00-10`, `2026-04-31`, and any non-key shape
  including ISO timestamps).
- `api/dto/payloads.ts` — `@IsCalendarDateKey` added to `AvailabilityQuery.date` and
  `AvailabilityQueryBody.date`; format check (`@Matches`) is retained and still runs first.
- `api/http-api.spec.ts` `+2` (no-DB) — GET `?date=2026-02-30` and POST body
  `date: '2026-13-01'` both return 400 `VALIDATION_ERROR` with `fields.date` present, asserted
  to happen before any service/DB call.
- `api/http-api.db.spec.ts` `+2` cases in the malformed-body bucket — `2026-02-30` and
  `2026-13-01` → 400.
- `common/validation/is-calendar-date.spec.ts` (new, 3 tests) — real days accepted, impossible
  days rejected, non-key shapes rejected.

### Re-verification (final, local)
| Layer | Command | Result |
|---|---|---|
| Backend | `npm run typecheck` / `npm run lint` | PASS / PASS |
| Backend | `npm test` (no DB) | 147 passed / 184 skipped; 22 files (DB suites self-skip) |
| Backend | `/api/v1/public/businesses/:slug/availability` GET+POST impossible-date cases | PASS (no-DB contract) |
| Frontend | `npx vitest run` | 418 passed / 34 files |
| Frontend | `npx tsc -b --pretty false` / `npm run lint` | PASS / PASS |
| Spec | `docs/WEREFA-COMPLETE-SPECIFICATION.md` | unchanged (`git hash-object` = `acb32c9b…`) |

The DB-gated `http-api.db.spec.ts` additions run with `npm test:db` against a live Postgres
(the environment's Docker was down for this addendum pass, so only the no-DB path executed);
both new impossible-date cases are pure validation and short-circuit before any DB read, so the
no-DB contract assertions fully exercise them.

## Close

- Repo status = expected working set only (backend: 3 modified + 2 untracked + DB spec;
  frontend: 5 modified + 9 untracked; reports #27/#28 untracked). No spec/doc/architecture
  file changed.
- Green command chain (all local, exit 0):
  backend `npm run build && npm run typecheck && npm run lint && npm test` and
  `npm run db:up && npm run db:provision && npm run test:db`;
  frontend `npx vitest run` (×5 consecutive) `&& npx tsc -b --pretty false && npm run lint`.