# Implementation Report 22 — Backend HTTP API & Contract Layer

Prompt 42: the Prompt 41 application services are exposed as a clean, versioned HTTP API
at `/api/v1`. Thin controllers, class-validator DTOs, deliberate customer-safe/owner
projections, TenantGuard enforcement at service level, the reused Prompt 39 validation
pipeline and single error envelope, dev-only Swagger/OpenAPI, and HTTP integration tests
(non-DB + live-PostgreSQL DB-gated) that assert firewall-efficiency, tenant isolation and
full customer/owner workflows end-to-end.

The authoritative spec (`docs/WEREFA-COMPLETE-SPECIFICATION.md`) is byte-unchanged.

---

## 1. Objective

Expose the Prompt 41 application services through a clean, versioned HTTP API at
`/api/v1` (`public`, `customer`, `owner` scopes) and prove it with automated HTTP tests.
Controllers are thin: receive → validate via the reused Prompt 39 pipe → resolve auth
context → delegate to the Prompt 41 service → project the response. No domain logic
lives in controllers; the business rules, transactions and tenant checks stay in the
service layer and are re-verified through the HTTP boundary. Scope strictly follows
Prompt 42: Swagger for humans (dev/staging only), a generated OpenAPI JSON document, an
error-envelope contract, and both non-DB firewall tests and live-DB end-to-end tests.
Frontend integration, real authentication and deployments remain deferred.

## 2. Work Completed

- **API module + route surface** — `ApiModule` registers six controllers (public page /
  services / availability; customer booking / status / resubmission; owner business /
  catalog / schedule / booking management). Global prefix `api/v1` is applied in
  `configureApp`.
- **DTO validation layer** — every `@Body`/`@Query`/`@Param` is a class-validator DTO
  (slugs, UUID v4 combos, Ethiopian phone numbers, ISO-8601 instants, date strings,
  min/max ranges, enum membership, bounded arrays). The reused Prompt 39
  `buildGlobalValidationPipe` (whitelist + transform) turns violations into
  `ValidationRejectedException` → the single envelope with per-field messages.
- **Projection layer** — `customer`/`owner`/`public` views derived from the service
  results: customer payloads never leak internal ids, owner identity, subscription
  internals or full history; owner views carry raw `BookingState` + numeric `bookingId`;
  public views are branding/service/price only.
- **Auth boundary for HTTP** — `AUTH_CONTEXT_RESOLVER` symbol resolved at startup to
  `DeniedAuthContextResolver` (production default → UNAUTHENTICATED) or
  `TestAuthContextResolver` (test env + `AUTH_TEST_ENABLED=true`, telemetry headers).
  `ApiAuthGuard` + `@Actor()` hand the resolved `ActorContext` to owner controllers.
- **OpenAPI / Swagger** — `setupOpenApi(app)` registers `/api/v1/swagger` UI and the
  `api/v1/openapi-json` document. Enabled only when `nodeEnv` is neither `test` nor
  `production` (Swagger's createDocument trips on a projection circular reference).
- **Tests** — 5 non-DB HTTP contract tests (firewall/validation/auth) and 11 DB-gated
  end-to-end HTTP tests (create → catalog → schedule → public → book → owner list/
  detail → tenant isolation → accept → reschedule → cancel → reject → resubmission,
  plus the VALIDATION_ERROR envelope).
- **Verification** — backend lint/typecheck/build/unit + live-DB suite ×2, Swagger
  gated off in tests, Prisma generate + migrate status, spec diff empty, git clean at
  the same HEAD commit, no commit made.

## 3. Decisions Made and Their Rationale

| Decision | Rationale |
|---|---|
| Controllers delegate, projecting service results; business logic remains in services | keeps a single source of truth for rules/transactions; the HTTP layer is a thin contract adapter (Prompt 42 §3) |
| Use the existing Prompt 39 validation pipe and error envelope instead of a second system | Prompt 42 explicitly forbids a second validation/error system; reuse keeps `{ error: { code, title, detail, fields } }` consistent across boot, domain and HTTP layers |
| `AUTH_CONTEXT_RESOLVER` symbol with a denied-by-default production resolver and a test-only header resolver behind `AUTH_TEST_ENABLED` | real auth is deferred (Prompt 42 §6/§13); production can never be spoofed by headers, and tests stay deterministic without a login system |
| Every `@Body`/`@Query`/`@Param` is a dedicated DTO class validated by the global pipe | uniform 400 responses with structured `fields`, no hand-written validation in controllers |
| Owner tenant checks are delegated to the Prompt 41 `TenantGuard` services (not re-implemented in controllers) | one authorization boundary; HTTP tests prove isolation end-to-end (owner B gets 404 on every owner route of owner A's business) |
| Customer responses use `customerBookingProjection` (no `bookingId`, no `customerPhone`, no history) | spec §31/REQ-109 customer-facing projection; internal ids never cross the customer boundary |
| Owner responses keep raw booking state + numeric booking id; customer responses use `PUBLIC_STATUS` dispositions | owner has database fidelity; customers get a friendly, stable disposition vocabulary |
| Array-of-UUID inputs capped with `@ArrayMaxSize(5)` (not `@MaxLength(each)`) | `@MaxLength({each})` bounds each element's string length (36-char UUIDs always fail); the intended semantic is a 5-item array cap — caught by the live-DB spec |
| Resubmission is phone-scoped (`requestCodeForCustomer`/`resubmitForCustomer`) | REQ-109 end: customers carry no booking reference; the latest rejected booking for the phone is the unambiguous target |
| Swagger enabled only for dev/staging (`!test && !production`) | `SwaggerModule.createDocument` throws on a projection circular reference; the OpenAPI doc is a developer aid, not a test target |
| Vitest uses SWC as its TS transformer (`unplugin-swc`) | Vite's esbuild cannot emit `design:paramtypes` decorator metadata, so the ValidationPipe silently skipped DTO validation in tests (a prod/tsc/mismatch); SWC restores identical validation behavior in tests and production |
| Live-DB HTTP suite runs with `--fileParallelism=false` and an explicit DELETE-order reset | one shared `werefa_test` database; parallel spec files would race each other's reset/insert loops |

## 4. Scope Guard Rails (verified)

Not implemented (as instructed): JWT/real authentication, Telegram delivery, external
payments/file storage, billing/approval, frontend integration, deployment, automation
of owner photo uploads. Manual `COMPLETE` remains intentionally absent (lifecycle is
automatic). Client payloads never carry price or duration. Spec §46 unresolved
decisions (price REQ-125, global timezone REQ-222, reminder lead REQ-139, PDF export
REQ-142, owner-modify scope REQ-152, TZ display REQ-221) stay unresolved; there is no
per-user timezone. Prompt 38 Item 6 and customer platform accounts remain out of scope.

## 5. API Contract Surface (route map + status codes)

All under the global prefix `api/v1` (e.g. `/api/v1/public/businesses/{slug}`).

**public** (`/public/businesses`)
- `GET :slug` → 200 public business page projection (branding, category, pause, booking
  interval, prepayment mode; numeric prices; no internal id at business level)
- `GET :slug/services` → 200 active services with variations/add-ons, numeric prices
- `GET :slug/availability?date=YYYY-MM-DD&serviceId=&variationIds=&addOnIds=` → 200 slots,
  computed duration + price (deactivated businesses return no slots; invalid date/uuid →
  400)

**customer** (`/customer`)
- `POST bookings` → 201 `awaiting-verification` customer view (idempotent by
  `submissionKey`, REQ-121)
- `GET status?slug=&phone=` → 200 newest-first customer-safe status list
- `POST resubmission/request-code` → 200 `{ expiresAt }` (code delivered out-of-band,
  never returned)
- `POST resubmission/verify` → 200 `PROOF_RECEIVED` + customer booking view

**owner** (`/owner/businesses`) — all guarded
- `GET/POST` (list/create), `GET/PATCH :businessId`, `PATCH :businessId/slug`,
  `PATCH :businessId/settings`, `POST :businessId/pause|resume|deactivate|reactivate`
- `GET/POST :businessId/services`, `PATCH :businessId/services/:serviceId`,
  `POST .../variations`, `POST .../addons`, `POST .../deactivate|reactivate`
- `GET :businessId/schedule/current`, `GET :businessId/schedule/versions`,
  `PUT :businessId/schedule`, `POST :businessId/schedule/exceptions`
- `GET :businessId/bookings`, `GET :businessId/bookings/:bookingId`,
  `POST :businessId/bookings/:bookingId/accept|reject|cancel|no-show|reschedule`
  (200), `release-slot` (204)
- Owner `reschedule` requires `{ startAt }`; `reject` requires `{ reason }`

**HttpStatus rules**: 201 created, 200 ok, 204 release-slot, 400 validation envelope,
401 missing/spoofed actor, 404 unknown route or non-owned resource, 409/422/429/500 via
the shared taxonomy mapping (Prompt 39).

## 6. DTO Validation Layer

`src/api/dto/payloads.ts`. Every input is validated by the global `ValidationPipe`
(whitelist strips unknowns; `transform` coerces and emits the DTO instance) before any
controller runs. Highlights:
- slug `^[a-z0-9]+(?:-[a-z0-9]+)*$`, length 2–64; `@IsPhoneNumber('ET')` phones
- `@IsUUID('4')` for ids and combos; `@ArrayMaxSize(5)` for variation/add-on lists
- `@IsISO8601()` instants; `@Matches(/^\d{4}-\d{2}-\d{2}$/)` dates; enum membership
  (`BANK_TRANSFER`/`TELEBIRR_MOBILE_MONEY`, booking states, categories,
  prepayment modes)
- `limitValue` clamps `limit` to 1..200 (default 50); `@Type(() => Number)`
  numeric route params so `bookingId`/`businessId` are typed on arrival
- Validation failures map to `VALIDATION_ERROR` (400) with `fields` per property.

## 7. Projection Layer

`src/api/dto/projections.ts`.
- `customerBookingProjection` — business slug, start/end, service names, total+
  prepaid prices, payment method, note, and the `PUBLIC_STATUS` disposition
  (`awaiting-verification | confirmed | rejected | cancelled | completed | no-show`).
  Excludes internal booking/owner ids, customer phone, proofs and full history.
- `customerStatusProjection` — newest-first status list of the same customer view.
- `ownerBookingProjection` / `ownerBookingDetailProjection` — numeric `bookingId`,
  raw `BookingState`, customer name/phone, components with snapshots, payment
  summary, status history, proof submission timeline (`submittedAt`).
- `publicBusinessView` / business/catalog/schedule owner projections — numeric prices
  (BigInt → number), no internal ids at the public business level.

## 8. Auth Boundary for HTTP

- `AUTH_CONTEXT_RESOLVER` token (config.constants) is exported at module build from
  `ApiModule`/`AuthModule`: when `config.authTestEnabled && nodeEnv !== 'production'`
  → `TestAuthContextResolver` (reads `X-Actor-Role`/`X-Actor-Id`), otherwise
  `DeniedAuthContextResolver`.
- `DeniedAuthContextResolver.resolve()` throws UNAUTHENTICATED; its constructor
  hard-fails if reached in production. `TestAuthContextResolver` requires role `OWNER`
  and a UUID actor id; never registered in production.
- `ApiAuthGuard` runs on owner controllers and exposes `@Actor()` so guard + resolver
  are the only actor plumbing in controllers.

## 9. Booking Lifecycle Over HTTP

Owner accept/reject/cancel/no-show/reschedule/release-slot map to the Prompt 41
`BookingService` mutations (each tenant-checked via `getForOwner`/`requireOwnedBusiness`
inside the service). READ after mutation goes through `detailAfter` so the response
reflects committed state. No manual COMPLETE; history rows only on real transitions
(reschedule emits no noop `booking_status_history` — trace is `updatedAt` + lock rows +
`BOOKING_RESCHEDULED` event). The DB spec asserts exact history arrays
(`PAYMENT_PENDING → CONFIRMED → CANCELLED`).

## 10. Resubmission Customer Workflow Over HTTP

`request-code` → `resubmitForCustomer`/`requestCodeForCustomer` resolves the latest
rejected booking for `(business slug, phone)` with no booking reference (REQ-109).
Codes are 6-digit, hashed (sha-256) at rest, single-use, 10-minute TTL, 5-attempt cap,
max 5 active per booking; every request/failure/resubmission is recorded in
`security_event`. Verify with a valid code and a new `submissionKey` transitions
REJECTED → PAYMENT_PENDING + PENDING, replaces the old proof (lineage preserved), marks
the code used, keeps the slot LOCKED. The test stubs `Math.random` → 0 so the code is
deterministically `100000`.

## 11. Error Envelope and Mapping

One envelope everywhere: `{ error: { code, title, detail, fields } }`
- `AppError` (Prompt 39 taxonomy) → its own code/HTTP (VALIDATION_ERROR, NOT_FOUND,
  CONFLICT, SLOT_UNAVAILABLE, RATE_LIMITED, …).
- HTTP/pipe exceptions → mapped code (`400→VALIDATION_ERROR`, `401→UNAUTHENTICATED`,
  `404→NOT_FOUND`, …).
- Everything else → safe `INTERNAL_ERROR`; 5xx details are log-only with requestId,
  never returned.

## 12. OpenAPI / Swagger Generation (dev-only)

`setupOpenApi(app)` mounts `/api/v1/swagger` (SwaggerUI) and `api/v1/openapi-json`.
It runs only when `nodeEnv !== 'production' && nodeEnv !== 'test'`. The document is
built from `@ApiTags`/`@ApiOperation`/`@ApiProperty` metadata with DTO types. The
public server listing is omitted (`addServer` removed) so the generated JSON matches
the actual `api/v1` mount.

## 13. Test Infrastructure Notes

- Root cause fixed for the validation gap: Vite's esbuild cannot emit `design:paramtypes`
  decorator metadata, so Nest's ValidationPipe received no metatype and silently skipped
  DTO validation in vitest while production (tsc) validated. Adding `unplugin-swc` +
  `@swc/core` to `vitest.config.ts` makes test validation identical to production.
- The absence originally surfaced as 404/500 (requests sailed past validation into
  services). After the fix the two non-DB validation tests assert real 400s, and the
  DB suite exercised the full validation surface.
- `createTestApp` accepts `database: 'real'` to keep the Prisma port (default swaps in
  `FakeDatabase`); `app.init()` is performed inside the helper.
- DB-gated specs require `RUN_DB_TESTS=true` + `TEST_DATABASE_URL` (scripts/
  run-db-tests.mjs) and run with `--fileParallelism=false`; `http-api.db.spec.ts` resets
  via a deterministic DELETE_ORDER.

## 14. Tests Written

Non-DB `http-api.spec.ts` (5):
1. unknown route → 404 NOT_FOUND envelope
2. invalid customer booking body → 400 VALIDATION_ERROR with fields
3. invalid availability query → 400 VALIDATION_ERROR (before any service call)
4. owner route without auth test → 401 UNAUTHENTICATED (denied resolver)
5. owner route with `AUTH_TEST_ENABLED` but no headers → 401

DB-gated `http-api.db.spec.ts` (11): owner creates business (TRIAL) with category;
services/variations/add-ons created and listed; schedule version saved + activated;
public page/services/availability (computed duration 75, price 13500); customer booking
201 idempotent by `submissionKey` with customer-safe payload; customer status projection;
owner list/detail with history + proof timeline; tenant isolation (owner B → 404 on
detail/list/accept/schedule-current); accept → reschedule → cancel with exact history;
reject + request-code + verify-resubmission (history `PAYMENT_PENDING → REJECTED →
PAYMENT_PENDING`); VALIDATION_ERROR envelope for bad owner path input.

## 15. Test Run Transcripts (backend · non-DB)

`npm test` → Test Files 13 passed (4 skipped: the DB-gated files), Tests 70 passed /
66 skipped (domain unit, config, error mapping, validation-setup, system e2e, HTTP
contract). `npm run lint` clean (no warnings), `npm run typecheck` clean,
`npm run build` (nest build) succeeds.

## 16. Test Run Transcripts (backend · DB-gated)

`npm run db:up && npm run db:provision && npm run test:db`:
- Run 1 after fixes: Test Files 9 passed, Tests 100 passed (0 failed).
- Run 2 (repeatability): Test Files 9 passed, Tests 100 passed (0 failed) — including
  all 11 HTTP e2e tests and the domain/database DB integration suites.
- `prisma migrate status`: 1 migration found; database schema up to date. `prisma
  generate` succeeds.

## 17. Frontend Regression Summary (untouched)

No frontend files were modified. The frontend stack and its tests are untouched by this
prompt (Prompt 42 is backend-scoped). (Frontend suite registration itself was not
re-run here; nothing in the change set can affect it.)

## 18. Documentation Written

- `docs/implementation/22-backend-http-api-and-contract-layer-report.md` (this file).
- `.env.example` documents `AUTH_TEST_ENABLED` (config `authTestEnabled`).
- The authoritative spec is untouched (bytes unchanged).

## 19. Concurrency / DB-Schema Interaction Notes

- Advisory-lock transaction helper (`withBusinessAdvisoryLock`) is exercised through the
  HTTP boundary: idempotent `submissionKey` booking creation short-circuits inside the
  service; accept/reject/reschedule toggles slot/lock state and history atomically.
- Slot-release recipient is nullable (no literal `'system'` actor in a UUID column).
- Read-backs after mutation happen on the outer client only after commit — the live HTTP
  tests exercise this (accept returns CONFIRMED with history visible).
- No schema changes were made in this prompt; the existing Prisma schema and single
  migration remain authoritative (`migrate status` up to date).

## 20. Deployment / Production Build Notes

`nest build` (tsc) emits full decorator metadata so the ValidationPipe validates in
production exactly as in tests. In production the auth resolver is denied-by-default,
so all owner routes return 401 until real auth lands. Swagger/OpenAPI are compiled into
the artifact but only mounted in non-test, non-production environments. `PRISMA_CLIENT`
boot fails fast when `DATABASE_URL` is missing (existing Prompt 40 behavior).

## 21. Outstanding Spec §46 Decisions (unchanged)

Unresolved, tracked, unchanged: FINAL_SELF_PRICE REQ-125, global timezone REQ-222,
reminder lead REQ-139, PDF export REQ-142, owner modify scope REQ-152, timezone
abbreviations REQ-221. No per-user timezone was added. Real authentication, Telegram,
file storage, external payments and billing/approval remain deferred (owner photo
upload automation likewise).

## 22. Risk Register

| Risk | Status / mitigation |
|---|---|
| DTO validation silently skipped in test runs (esbuild metadata) | fixed: SWC transformer; non-DB + DB suites now assert real 400s |
| Validation/firewall not respected (requests reaching services) | addressed by firewall tests + swc fix |
| Tenant isolation regressions | covered by explicit owner B → 404 HTTP tests on all owner route shapes |
| Resubmission code delivery absent (out-of-band) | unchanged scope; adapter point documented in `ResubmissionService` |
| Swagger circular-reference crash in tests | Swagger gated to non-test/non-prod; OpenAPI verified as buildable in dev |
| `@MaxLength(each)` on UUID arrays rejected every combo | corrected to `@ArrayMaxSize(5)`; verified by the live suite |
| `resubmitForCustomer` passed the slug (not id) to a UUID column | fixed (find `biz.id` before `latestRejected`); regression covered by the resubmission e2e test |

## 23. Non-Goals and Deferred Work

Real authentication/JWT, Telegram delivery, external payments, file upload/dl,
billing/approval, owner photo upload automation, frontend integration, deployment/CI-CD,
customer platform accounts, per-user timezone. Manual COMPLETE intentionally absent.

## 24. Files Changed or Added

Added (new API layer):
- `src/api/api.module.ts`, `src/api/openapi.ts`
- `src/api/auth/auth-context.ts`, `src/api/auth/api-auth.guard.ts`
- `src/api/dto/payloads.ts` (all DTOs), `src/api/dto/projections.ts`
- `src/api/public/public.controller.ts`
- `src/api/customer/customer.controller.ts`
- `src/api/owner/business.controller.ts`, `owner/catalog.controller.ts`,
  `owner/schedule.controller.ts`, `owner/booking.controller.ts`
- `src/api/http-api.spec.ts`, `src/api/http-api.db.spec.ts`

Also:
- `src/app.setup.ts` (global prefix + env-gated swagger), `src/app.module.ts` (ApiModule)
- `src/config/app-config.ts` (`authTestEnabled`), `.env.example`
- `src/domain/services/resubmission.service.ts` (fix `resubmitForCustomer`
  `businessId` resolution)
- `src/api/dto/payloads.ts` (`@ArrayMaxSize` cap; `BusinessIdParamDto`/`VersionIdParamDto`
  reuse in catalog + schedule controllers)
- `src/domain/repositories/prisma-booking.repository.ts` (proofs timeline uses
  `submittedAt`)
- `test/helpers/test-app.ts` (`database: 'real'`, env passthrough)
- `scripts/run-db-tests.mjs` (includes `src/api`)
- `vitest.config.ts` (SWC decorator-metadata transformer), `package.json`,
  `tsconfig.json` (`strictPropertyInitialization: false`)

## 25. Test Command Inventory

- Non-DB: `npm test` (vitest; DB-gated files auto-skip).
- DB-gated: `npm run db:up`, `npm run db:provision`, then `npm run test:db`.
- Lint: `npm run lint`. Typecheck: `npm run typecheck`. Build: `npm run build`.
- Prisma: `npx prisma generate`, `npx prisma migrate status`.

## 26. Prisma / Migration Status

Schema unchanged; `prisma migrate status`: 1 migration found, up to date (werefa_dev at
localhost:5433). `prisma generate` succeeds. Live suite ran against werefa_test.

## 27. How Prompt 41 Baseline Was Preserved

All Prompt 41 service semantics were reused without behavioral change: booking
lifecycle (accept/reject/cancel/no-show/reschedule/release-slot), payment idempotency,
slot locks and advisory-lock transactions, tenant authorization, subscription
eligibility, availability engine and customer status. Controllers only marshal;
projection units convert BigInt → number and map `BookingState` → `PUBLIC_STATUS` for
customers. The one functional fix (`resubmitForCustomer` businessId) is a new wire
point, not a semantic change.

## 28. Spec-Conformance Statement

Routes, DTO constraints, projections, status vocabulary, idempotency (REQ-121),
phone-scoped resubmission without booking reference (REQ-109), firewalled validation,
the single error envelope, out-of-band code delivery (never returned), deferred auth
with no production spoof path, and the absence of client-supplied prices/durations all
follow the Prompt 42 instructions and the authoritative spec. No sections of the spec
were modified.

## 29. Git State

Working tree contains only this prompt's changes (new `backend/src/api/**`, plus the
edits listed in §24). HEAD is unchanged at `efc539d` ("docs: add backend application
services and core domain logic report"). **No commit was made**, per the standing
rule that the integration agent commits; the tree is left staged-plain for review.

## 30. Final Verification Matrix

| Gate | Result |
|---|---|
| `npm run lint` | pass (0 warnings) |
| `npm run typecheck` | pass |
| `npm run build` (nest build) | pass |
| `npm test` | 70 passed, 66 skipped (DB-gated) |
| `npm run test:db` (×2) | 100 passed / 0 failed each run |
| `prisma generate` / `migrate status` | pass / up to date |
| Spec diff | empty (byte-unchanged) |
| Git | HEAD `efc539d` unchanged; no commit |