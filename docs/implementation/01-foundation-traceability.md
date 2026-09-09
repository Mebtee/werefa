# 01 — Implementation Foundation (Prompt 07) — Traceability report

Status: **implemented (foundation scope)** · Verified against the quality gate on the date of this doc.

## 1. Source-path mapping

Prompt 07 references `docs/requirements/*`; those paths DO NOT exist in this repository.

| Referenced path (Prompt 07) | Actual location                                                                                                                                                                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/requirements/`        | Requirements live flat: `docs/00-project-overview.md`, `docs/01-master-specification.md`, `docs/02-open-questions.md`, `docs/250-approved-decisions.md`; indexes & audits: `docs/requirements-traceability.md`, `docs/decision-traceability.md`, `docs/consistency-audit.md` |
| `docs/architecture/`        | Exists as `docs/architecture/` (01–30 + `adr/`)                                                                                                                                                                                                                              |

No approved requirement/architecture doc was renamed or restructured; this
mapping is documented here instead.

## 2. What was implemented

### Workspace & tooling

- npm workspaces (`apps/*`, `packages/*`), TS strict base, ESLint 9 flat config, Prettier, root scripts (`dev:*`, `db:*`, `bootstrap-dev-db`, quality-gate pieces), `engines.node >= 20` (dev machine runs Node 24; CI pins 20).

### Infrastructure (dev)

- `infra/docker-compose.yml`: PostgreSQL 16 (host **5433** — the local Windows Postgres 18 service owns 5432), Redis 7, MinIO (S3-compatible), MailHog.

### `packages/shared`

- `constants.ts`: `API_PREFIX=/api/v1`, `COOKIE_SESSION=wrf.sid`, session TTL, upload limit, slug pattern, `Role` (`Owner`/`Admin`/`SuperAdmin`), `Scope`, `roleRank` hierarchy (Owner=1, Admin=2, SuperAdmin=3).
- `errors.ts`: documented error codes (doc 23) — `VALIDATION_ERROR`, `UNAUTHENTICATED`, `ACCOUNT_LOCKED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `INTERNAL_ERROR`, …; `ErrorEnvelope`, `FieldError`, `isErrorCode`.

### `packages/db`

- Prisma schema (foundation tables only): `user`, `session`, `business`, `business_owner`, `security_event` (citext email, UUIDs, timestamps with server defaults).
- Migrations: `20260905_000000_foundation` (+ `rls.sql`) and `20260905_000200_foundation_defaults` (server-side `created_at`/`updated_at` defaults).
- DB roles (`bootstrap-roles.ts`): **`app`** (runtime, RLS-enforced, no bypass), **`app_superadmin`** (elevated audited reads), **`migrator`** (DDL, `LOGIN` + `BYPASSRLS`). Idempotent pass/fail-fast bootstrapping; passwords derived from `DATABASE_MIGRATOR_URL`/`DATABASE_URL`.
- RLS ($`bootstrap-rls.ts`): policies on `business` + `business_owner` keyed to GUCs `app.user_id`/`app.scope`/`app.business_id`, `FORCE ROW LEVEL SECURITY`; clients without context see zero rows.
- `tenant-context.ts` (GUC SQL builder), `tenant-repository.ts` (abstract `TenantRepository` with `getByBusinessId` convention: business-scoped keys, never bare `getById(id)`).
- `test-setup.ts` (clean `werefa_test` bootstrap) and `run-migrate.ts` (Prisma deploy as migrator; shell-safe on Windows).

### `apps/api` (foundation controllers only, no login/registration/domain)

- Config: typed `loadConfig`, fail-fast validation, `maskedEnv` never emits secret-bearing values (tested).
- Logging: pino JSON with redaction (doc 24); observability env map is masked.
- Errors: `AppException` hierarchy → documented error codes + HTTP statuses; `GlobalExceptionFilter` sanitizes unknown errors to `INTERNAL_ERROR` (doc 23).
- Guards: `SessionGuard` (opaque cookie token → SHA-256 lookup, doc 14), `RolesGuard` (hierarchy), `TenantGuard` (business-scoped via `ownedBusinessIds`, SuperAdmin bypass, doc 04); `@Public()`, `@Roles`, `@Actor` decorators.
- IAM: `PasswordService` (Argon2id, ADR-001), `SessionService` (opaque random token stored hashed; `createSession`/`resolveToken`/`revokeSession`; `ActorContext.ownedBusinessIds`), `SecurityEventsService`; endpoints `GET /api/v1/auth/me`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/ping`.
- Storage: `StorageProvider` interface + memory backend (dev/tests; forbidden in production) + S3/MinIO provider via `@aws-sdk/client-s3` + presigner (doc 16); tenant-scoped key convention.
- Jobs: BullMQ `Queue`+`Worker`, typed registry, `retention-security-events.job` (1-year purge, doc 22); worker skipped under `APP_ENV=test`.
- Health: `GET /api/v1/health/live`, `GET /api/v1/health/ready` (DB check).
- Seed (`src/seed/dev-seed.ts`): dev-only accounts + two businesses (runs as migrator to honor RLS; refuses production).

### Frontends (shells only)

- `apps/dashboard` and `apps/public`: React 18 + Vite, typed API client honoring the error envelope, `/api` dev proxy to the API, session store + `/auth/me` bootstrap. Feature UI deferred to later modules.

### CI

- `.github/workflows/ci.yml`: Node 20, services (Postgres 16, Redis 7), format check, lint, typecheck, unit tests, DB bootstrap (roles→migtate→RLS), integration tests, build, API startup smoke test.

## 3. Test A–F mapping

| Test | Requirement                                      | Coverage                                                                 | Location                                                                                        |
| ---- | ------------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| A    | Tenant A cannot access tenant B data             | RLS isolation at SQL level + `TenantGuard`/`TenantRepository` convention | `apps/api/test/integration/rls-isolation.test.ts`, `packages/db/test/tenant-context.test.ts`    |
| B    | Owner cannot access non-owned businesses         | `owner_select` policy + `ownedBusinessIds` guard                         | `rls-isolation.test.ts` (incl. spoofed `app.business_id`)                                       |
| C    | Admin ≠ SuperAdmin (role rules)                  | `RolesGuard` hierarchy incl. SuperAdmin passes Admin, Owner fails Admin  | `apps/api/test/unit/roles-guard.test.ts`                                                        |
| D    | RLS is actually active                           | `app` role with no context sees zero rows                                | `rls-isolation.test.ts`                                                                         |
| E    | Tenant context required for tenant-scoped access | GUC-gated policies (`current_setting('app.user_id', true)`)              | `rls-isolation.test.ts`, `packages/db/test/tenant-context.test.ts`                              |
| F    | Secrets never logged / never leaked              | `maskedEnv` unit test + error-envelope/response assertions               | `apps/api/test/unit/config-masking.test.ts`, `apps/api/test/integration/api-front-door.test.ts` |

Totals (last verified run): shared 4, db 4, api unit 22, api integration 11 — all passing.

## 4. Developer workflow

```bash
npm install
npm run dev:infra            # docker compose up (postgres:5433, redis, minio, mailhog)
npm run bootstrap-dev-db     # db:roles && db:migrate && db:rls
npm run seed:dev --workspace @werefa/api
npm run dev:api
npm run test:integration --workspace @werefa/api   # resets werefa_test (roles+migrations+RLS)
```

## 5. Known gaps / future work (out of foundation scope)

- **No login/register/verification** endpoints — the Identity module is a later prompt; `auth/me` + `logout` exist only to prove guard plumbing. Dev seed inserts sessions-free users.
- **No domain modules** (customers, bookings, payments…) — foundation structure only.
- `TenantGuard` sub-resource ownership enforcement is exercised via the repository convention; business-domain queries in later modules must use `TenantRepository.getByBusinessId`.
- Security-event writes are not yet wired from every guard decision (deliberate; completes with Identity/domain modules).
- MinIO upload wiring not end-to-end tested (memory provider covers storage abstraction; S3 provider is code-complete but exercised only manually).
- Production hardening (secret rotation, load-balanced workers, rate-limit backing, TLS, trusted proxy) is configuration for later deployment prompts, not code here.
- `.nvmrc` not yet added; CI pins Node 20 while local dev is on Node 24 (engines `>=20`).

## 6. Commands that prove the foundation

```bash
npm run lint && npm run typecheck && npm run build
npm run test:unit --workspaces --if-present && npm test --workspaces --if-present
npm run test:integration --workspace @werefa/api
npm run bootstrap-dev-db
```
