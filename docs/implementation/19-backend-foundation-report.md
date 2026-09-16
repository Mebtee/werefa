# 19 — Backend Foundation and Real Application Boundary (Prompt 39) — Completion Report

Status: **DONE** · Backend quality gate **green** (`vitest` 38 passed / 41, lint
clean, `tsc` clean, `nest build` succeeded) · Live-DB integration **5 passed**
against Dockerized PostgreSQL 16 · Frontend regression gate **green** (275
passed, typecheck/lint/build clean) · Canonical spec **not touched** · No
commits created.

This report closes out Prompt 39: the first real backend foundation for Werefa
under the approved architecture, while keeping the frontend mock workflow as
the explicit application boundary for the product demo until real APIs replace
it. The canonical product source of truth
(`docs/WEREFA-COMPLETE-SPECIFICATION.md`) was **not modified**, **no commits
were created**, and no new product decisions were made — the six unresolved spec
decisions remain unresolved and are exposed only as configuration boundaries (§19).

## 1. Conformance summary

| Dimension | Result |
| --------- | ------ |
| Backend technology | Conforms to the **canonical spec §28 (lines 940/1087)** and **ADR-001/002/010**: Node 20+ / **NestJS modular monolith**, TypeScript strict, **PostgreSQL 16 + Prisma**, REST/JSON under `api/v1`, envelope errors, test stack Vitest/Supertest. Preserved, not re-litigated (§3). |
| Repository layout | Conforms to **spec §26.1**: `backend/`, `frontend/`, `docs/`; `shared/` and `infrastructure/` not created (not genuinely required yet). Stale `.gitignore` refs to `apps/`/`packages/` are historical leftovers (§4). |
| Database / roles | Conforms to **doc 07 §1** and **ADR-002/003**: runtime role `werefa_app` (RLS-enforced) + DDL role `werefa_migrator` (owns DBs, CREATEDB for shadow DB); PostgreSQL 16 via Docker (`postgres:16-alpine`, host port **5433**) per the decided dev approach (§7). |
| Tenancy boundary | Tenancy mechanism (shared-schema + `business_id` + RLS, ADR-003) is **documented and reserved**, not implemented: no business schema yet; the configuration/DI seam (`DATABASE` port) keeps the boundary ready (§8). |
| API foundation | REST/JSON under `api/v1` with envelope-shaped errors and versioned base path (doc 10 / ADR-010); system endpoints only at this stage (§11). |
| Error model | Conforms to **doc 23**: envelope `{ error: { code, title, detail, fields } }`, 21-code taxonomy sourced from the architecture, no invented codes, mapped HTTP statuses (§12). |
| Validation | Global `ValidationPipe` (class-validator/class-transformer) mapped to `VALIDATION_ERROR` envelopes (doc 23) (§13). |
| Logging | Conforms to **doc 24**: pino + pino-http, redaction of secrets, request-id correlation via AsyncLocalStorage, 4xx<500 log levels (§14). |
| Security defaults | helmet, opt-in CORS, opt-in trust-proxy, body-size limit with a 413 envelope mapping, no secrets echoed in config errors (§15). |
| Observability | `GET /api/v1/system/health` (liveness), `GET /api/v1/system/ready` (readiness, 503 on DB down/disabled), `GET /api/v1/system/meta` (server metadata + pending product clarifications) (§16). |
| Frontend boundary | Frontend production code **untouched** (Prompt 39 §1/§2/§15); boundary documented (§18). 275-test regression re-passed untouched. |
| Pending product decisions | Conforms to **spec §46**: six genuinely unresolved decisions surfaced only as config keys with a structured registry, never invented values (§19). |
| Verification | Backend deterministic suite + live-DB integration + frontend regression all green (§17). No commit, spec untouched (§20). |

## 2. Baseline and delta

| Metric | Value |
| ------ | ----- |
| Existing backend code | None — `backend/` held only `package.json` scaffolding + `.gitkeep` |
| New source files (src) | **23** (`src/config`, `src/common/errors`, `src/common/context`, `src/common/logging`, `src/common/validation`, `src/database`, `src/system`, `app.module.ts`, `app.setup.ts`, `main.ts`) |
| New tests | **41** deterministic tests across 10 files (+ **5** DB-gated integration tests) |
| New tooling/scripts | `docker-compose.dev.yml`, `prisma/schema.prisma`, 5 dev scripts under `scripts/`, `.env.example`, vitest/eslint/tsconfig/nest-cli configs |
| Backend gates | `npm test` → 38 passed + 3 skipped (DB-gated) · `npm run lint` clean · `npm run typecheck` clean · `npm run build` succeeds (dist emitted) |
| Live-DB integration | `npm run test:db` → **5 passed** against Dockerized PostgreSQL 16 (`werefa_test`) |
| Frontend regression | `frontend/` untouched: **275 passed** · typecheck/lint/build clean |
| Spec / git | `WEREFA-COMPLETE-SPECIFICATION.md` unchanged, no commits created |

## 3. Technology decision — preserved, not re-litigated

Prompt 39 does not open the stack for debate. The approved source of truth is:

- **Canonical spec §28** (and line 940 / general architecture notes): the
  platform is a **NestJS modular monolith** on Node, TypeScript overall strict.
- **ADR-001 (ACCEPTED)** — Node 20 LTS, NestJS modular monolith, TypeScript
  strict, PostgreSQL 16 + Prisma, Vitest/Supertest/Testcontainers/Playwright.
- **ADR-002 (ACCEPTED)** — PostgreSQL 16 + Prisma; `app` (runtime, RLS) and
  `migrator` (DDL) roles.
- **ADR-003 (ACCEPTED)** — shared-schema tenancy + row-level security keyed on
  `business_id`.
- **ADR-010 (ACCEPTED)** — REST/JSON under `api/v1`, OpenAPI 3.1, envelope
  errors, modular monolith.

The foundation implements these decisions as the scaffolding and seams for
real APIs. `@nestjs/common` resolved to 11.2.5 and Prisma to **6.19.3** (the
`~6.9` range installed 6.19.3; `prisma generate` ran clean via `postinstall`).

## 4. Repository layout (spec §26.1)

Approved layout is `backend/` + `frontend/` (+ `shared/`/`infrastructure/`
only if genuinely required). This repo already follows it; nothing was
restructured. `shared/` and `infrastructure/` were **not** created — no genuine
shared code or infrastructure config is required yet, so they stay out. The
stale `apps/` and `packages/` entries in the root `.gitignore` are historical
leftovers and were left as-is (out of scope).

```
backend/        new backend foundation (this item)
frontend/       existing React/Vite app — untouched, real-API boundary
docs/           canonical spec + architecture + implementation reports
```

## 5. Backend foundation scope

Deliberately **no** business functionality was built (Prompt 39 §10 hard
boundary). The foundation provides the production-shaped skeleton every future
module will use:

- Bootstrap + global setup (`main.ts`, `app.setup.ts`, `AppModule.forRoot`).
- Fail-fast typed config (zod) — `src/config`.
- Error taxonomy, `AppError`, global filter — `src/common/errors`.
- Request context carrier (`AsyncLocalStorage`, request id) — `src/common/context`.
- Structured logging (pino) — `src/common/logging`.
- Global validation seam — `src/common/validation`.
- Database port + Prisma implementation — `src/database`.
- System observability endpoints — `src/system`.

Because there are no business models, `prisma/schema.prisma` contains only the
datasource + generator. Prisma migrate therefore records an **empty baseline**:
`_prisma_migrations` exists in both dev and test databases, with zero migration
files, until the first business migration phase adds real schema (§9).

## 6. Configuration

`src/config/app-config.ts` defines a strict zod schema
(`NODE_ENV`, `HOST`, `PORT`, `LOG_LEVEL`, `LOG_PRETTY`, `CORS_ORIGINS`,
`BODY_LIMIT`, `TRUST_PROXY`, `DATABASE_URL`, `MIGRATOR_DATABASE_URL`,
`TEST_DATABASE_URL`, plus the six `PRODUCT_*` clarification keys).

- **Fail fast**: `loadAndValidateConfig` throws `ConfigValidationError` listing
  only field names — never values — so secrets are not echoed (doc 24 redaction
  invariant).
- `.env.example` documents every variable; real local values live in the
  gitignored `backend/.env`.
- The six unresolved product parameters are parsed as `null`/design-default
  only and surfaced through a register (§19).

## 7. Database approach — Dockerized PostgreSQL 16

Per the session decision (local machine PostgreSQL 18 on 5432 requires
credentials that are not available and would also violate ADR-002’s PG16
target), development uses a Docker container:

- `docker-compose.dev.yml` → `postgres:16-alpine`, host port **5433**, named
  volume `werefa_pgdata`, `pg_isready` healthcheck.
- Commands: `npm run db:up`, `npm run db:down`, `npm run db:provision`
  (idempotent), `npm run db:reset`.
- Verified against **live PostgreSQL 16** with the DB-gated integration suite
  (§17).

## 8. Roles and tenancy boundary (doc 07 / ADR-002 / ADR-003)

`db-provision.mjs` creates the two architecture role identities:

- **`werefa_app`** — non-privileged runtime role (LOGIN, no DDL). Intended to
  be RLS-enforced once business tables exist (ADR-003).
- **`werefa_migrator`** — DDL owner with `CREATEDB` (needed for Prisma’s shadow
  database), owner of `werefa_dev` and `werefa_test`. PG15+ public-schema
  ownership follows `pg_database_owner`, so migrations execute as `migrator`
  only; `app` never runs DDL (doc 07 §1/§4).

Tenancy (shared-schema + `business_id` + RLS) is **reserved, not implemented**:
no business tables exist yet. The `DATABASE` port and the migrator/app role
split mean the seam is ready without rework. The DB-gated suite proves the app
role can run against the provisioned test database while migrations are applied
by the migrator role.

## 9. Migration workflow

`prisma-migrate.mjs` wraps Prisma migrate so that migrations **always run as
`werefa_migrator`** via `MIGRATOR_DATABASE_URL` (verbs: `dev`, `deploy`,
`status`, `reset`; `deploy` is the non-destructive production verb).

Verified end-to-end against the live container:

- `npm run prisma:dev` — schema is in sync (empty baseline; no business models);
- `prisma migrate deploy` against both `werefa_dev` and `werefa_test` — pristine
  migration-history table created in each (`_prisma_migrations`), zero pending
  migrations;
- `prisma migrate status` — “ups to date”.

The DB-gated suite’s history assertion checks `_prisma_migrations` **exists**
(not count ≥ 1) because an empty baseline deliberately has zero migration rows
until the first business migration.

## 10. Concurrency and test-isolation strategy

Not applicable to business data yet (no tables). The foundation instead
establishes the strategy the business phase will use:

- Deterministic unit/e2e suites run with **no database** (default path);
- Live integration is gated behind `RUN_DB_TESTS=true` and
  `TEST_DATABASE_URL` via `npm run test:db` against the provisioned
  `werefa_test` database — the app role connects, migration history is checked,
  and the PG version ceiling/baseline is asserted.
- `test/helpers/test-app.ts` builds the app through the same
  `configureApp` used by `main.ts` and substitutes a `FakeDatabase`
  implementation of the `DATABASE` port, so e2e tests exercise the identical
  middleware stack (identical-stack requirement, Prompt 39 §14).

## 11. API foundation

- Global prefix `api/v1` (ADR-010), version decoupled from the product version.
- JSON request/response; envelope-shaped errors (doc 23).
- System surface only:
  - `GET /api/v1/system/health` — liveness (`status`, `service`, `uptimeSeconds`, `timestamp`);
  - `GET /api/v1/system/ready` — readiness with a `database` check; **503** with `checks.status: "disabled"` when DB is not configured, `"error"` when a configured DB is unreachable (must be resilient: liveness stays 200 while readiness is 503);
  - `GET /api/v1/system/meta` — product/spec references, API version, environment, DB configuration flag, and the pending product clarifications (§19).
- OpenAPI 3.1 surface is reserved for a later phase (docs infra planned but not materialized to stay in scope for Prompt 39).

## 12. Error model (doc 23)

`src/common/errors`:

- **21-code taxonomy** in `ErrorCode` with `ERROR_CODE_TO_HTTP` mapping —
  every code named in the architecture (VALIDATION_ERROR → 400,
  UNAUTHENTICATED → 401, ACCOUNT_LOCKED → 423, NOT_FOUND → 404,
  SLOT_UNAVAILABLE → 409, FILE_TOO_LARGE → 413, RATE_LIMITED → 429,
  INTERNAL_ERROR → 500, …). No codes are invented; codes not yet used by a
  module are contract placeholders so future modules share the same vocabulary.
- `AppError` — carry `code`, `title`, `status`, `detail`, `fields`, internal
  context; stable envelope shape `{ error: { code, title, detail, fields } }`.
- `AllExceptionsFilter` — maps `AppError`, `HttpException` (via safe `mapHttpStatus`,
  never leaking the internal message body), and unknown errors to the envelope;
  unknown errors are logged at `error` with the hidden detail retained in the
  log only; 4xx at `warn`, 5xx at `error`.
- `ValidationRejectedException` — never leaks validator internals or secret
  values; field-level errors mapped to the envelope’s `fields`.

## 13. Validation

`buildGlobalValidationPipe` (with `whitelist`, `forbidNonWhitelisted`,
`transform`) is applied globally in `configureApp`, so both bootstrap and e2e
tests share the identical pipe. Out-of-contract body properties are rejected,
and validation failures surface as `VALIDATION_ERROR` envelopes — consistent
with doc 23. The Filter/pipes ordering is explicit: pipes run before the global
filter so validation errors are caught as envelopes.

## 14. Structured logging (doc 24)

`src/common/logging`:

- pino logger factory with `redact` paths for
  `req.headers.authorization`, `req.headers.cookie`, `req.body.password`,
  `req.body.passwordHash`, etc. — redaction verified by test at the serializer
  level (password/authorization/api-key never reach output; non-secret values
  like a customer email remain visible).
- `pino-http` access logging with custom intent levels (4xx → `warn`,
  ≥5xx → `error`), health requests excluded from auto-logging, `env` tag, and a
  custom `genReqId` that honors an inbound `X-Request-Id`.
- Request context middleware seeds an `AsyncLocalStorage` context with
  `requestId` (log correlation across a request).
- Replaceable destinations (writable sink) so tests capture output precisely.
- Config errors never echo values (secrets-in-logs invariant, §6).

## 15. Security defaults

- `helmet` with CSP/COEP disabled for the API-only surface (no HTML), all other
  security headers active; optional `trust proxy` off by default.
- CORS **opt-in** (empty `CORS_ORIGINS` = no CORS headers); when enabled,
  explicit origin allow-list, `credentials: true` reserved for future httpOnly
  session cookies, methods/allowed-and-exposed headers pinned to what the API
  uses.
- Body-size limit (`BODY_LIMIT`, default `1mb`) with a dedicated Express
  error-handler mapping `entity.too.large` to the `FILE_TOO_LARGE` 413 envelope
  (Nest filters do not see Express middleware parse errors; verified by e2e).
- No secrets, credentials, or internal detail appear in any client-facing payload
  (verified by tests and the 404/413 leak checks).

## 16. Observability endpoints

Covered by §11. Endpoints are exercised in the e2e suite (§17), including the
readiness disabled-state (503 + `disabled`), healthy DB path via `FakeDatabase`,
and the 413 body-limit path.

## 17. Verification results

Backend — `D:\my project\scheduler\backend`:

| Gate | Command | Result |
| ---- | ------- | ------ |
| Deterministic tests | `npm test` | **38 passed, 3 skipped** (DB-gated) across 10 files |
| DB-gated integration (live PG16) | `npm run test:db` | **5 passed** (ping, migration-history exists, PG≥16) |
| Lint | `npm run lint` | clean, `--max-warnings=0` |
| Typecheck | `npm run typecheck` | clean |
| Build | `npm run build` | `nest build` emitted `dist/` |
| Migration status | `npm run prisma:status` | database up to date (baseline) |

Frontend — `untouched`, regression gate only:

| Gate | Command | Result |
| ---- | ------- | ------ |
| Tests | `npm test` | **275 passed** (15 files) |
| Typecheck | `npm run typecheck` | clean |
| Lint | `npm run lint` | clean |
| Build | `npm run build` | `vite build` succeeded |

A full 152/152 browser campaign was **not** re-run: Prompt 39 item 17 permits a
frontend regression gate instead of the browser campaign because no frontend
production code changed (only test/typecheck/lint/build gates apply).

Live-DB run-up used: `docker compose up -d --wait`, `npm run db:provision`
(roles + databases created idempotently, migrator owns both DBs), `npm run
prisma:dev` (baseline), deploy to `werefa_test`, then `npm run test:db`.

## 18. Frontend boundary — documented

The frontend (React + Vite, mock store) remains the **working application
boundary** for the product demo until real APIs replace it (Prompt 39 §1/§2).
The backend foundation deliberately does not:

- Replace or duplicate any frontend mock module;
- Change any frontend production code;
- Introduce a partial mock→real bridge.

Switching the frontend to real APIs is a separate, later phase driven by the
approved architecture. This foundation only guarantees the backend seams exist
(`api/v1`, envelope errors, versioned system surface) so the switch has a
stable contract target.

## 19. Protection of the six unresolved product decisions (spec §46)

The six items in “SPECIFICATION CLARIFICATION REQUIRED” are **not decided
anywhere**, including in this implementation:

1. `PRODUCT_SUBSCRIPTION_MONTHLY_PRICE_MINOR` — REQ-125 (price)
2. `PRODUCT_APP_TIMEZONE` — REQ-222 (global timezone; the doc-07 default
   `Africa/Addis_Ababa` is design-level only and remains unapproved)
3. `PRODUCT_REMINDER_LEAD_DAYS` — REQ-139 (reminder lead time)
4. `PRODUCT_OWNER_BOOKING_REPORT_PDF_ENABLED` — §25.3 (owner PDF export)
5. `PRODUCT_OWNER_BOOKING_MODIFY_COMPONENTS` — REQ-105/109 (owner “modify” scope)
6. `PRODUCT_SHOW_TIMEZONE_ABBREVIATION` — BR-32 (timezone-abbreviation display)

Each is exposed **only** as a configuration key in `PRODUCT_PENDING_CLARIFICATIONS`
with its spec reference and status `PENDING_CLARIFICATION`; no default value is
invented (all fields parse to `null`). The registry is surfaced read-only via
`GET /api/v1/system/meta` so reviewers can see the product boundary. The
canonical spec remains byte-for-byte untouched, and no mock/business code was
coerced around these gaps.

## 20. Next steps and closing statement

The foundation is ready for the next approved implementation phase — first
business migrations and a real vertical slice (e.g., business management) using
the migrator-role migration workflow, the app-role runtime connection, RLS
tenancy, and the established envelope/validation/logging seams.

Verification performed as part of this item: backend deterministic suite,
backend lint/typecheck/build, live-DB integration against Dockerized
PostgreSQL 16, frontend regression gate, and a `git status` confirming no
commits and an untouched canonical specification.

Prompt 39 is complete, **awaiting Product Owner approval before the next
implementation phase.**