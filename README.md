# Werefa

**Werefa** is a **multi-tenant SaaS scheduling / queue platform**.

The canonical product specification is:

[`docs/WEREFA-COMPLETE-SPECIFICATION.md`](docs/WEREFA-COMPLETE-SPECIFICATION.md)

> The specification remains **DRAFT — PENDING PRODUCT OWNER APPROVAL** (`v1.0.0-DRAFT`).
> Six product decisions in §46 are still open; the implementation exposes them as
> configuration boundaries only and never invents values.

## Repository structure

```
werefa/
├── backend/         NestJS API (modular monolith) + Prisma schema/migrations
├── frontend/        React + Vite single-page app
├── scripts/         Repository-root orchestration (acceptance gate; no dependencies)
└── docs/            Product specification, architecture and implementation reports
```

The root `package.json` is orchestration-only (it declares the acceptance gate and
no dependencies); `backend/` and `frontend/` are installed independently.

There is no `infrastructure/` directory yet: production packaging/topology has not
been chosen (see "Remaining deployment inputs").

## Prerequisites

- **Node.js** `>=20 <25` (backend `engines` constraint; frontend targets Node 20+).
- **PostgreSQL 16** — either the local Docker dev database or a provisioned instance.
- **Docker** (optional) — only for the local development database
  (`backend/docker-compose.dev.yml`).

## Local development

### 1. Database (Docker, port 5433)

```bash
cd backend
cp .env.example .env          # then adjust values for your machine
npm install                   # runs `prisma generate`
npm run db:up                 # start + wait for healthy
npm run db:provision          # create roles werefa_app/werefa_migrator + dev/test DBs
npm run prisma:dev            # apply migrations (dev)
```

`db:reset` drops and recreates the local dev/test databases — **development only**.

### 2. Backend

```bash
cd backend
npm run start:dev             # watch mode
# or
npm run build && npm run start:prod
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local    # set VITE_API_BASE_URL
npm install
npm run dev
```

## Configuration contract

Configuration is validated fail-fast at backend startup (`src/config/app-config.ts`).
The authoritative list of variables, defaults and comments is
[`backend/.env.example`](backend/.env.example); the frontend template is
[`frontend/.env.example`](frontend/.env.example).

Key rules:

- `DATABASE_URL` is **required** when `NODE_ENV=production`.
- `CORS_ORIGINS` must list explicit origins; `*` is rejected.
- `AUTH_TEST_ENABLED=true` is rejected in production (the header-based test actor
  bridge is otherwise unreachable in production regardless).
- `TELEGRAM_ENABLED=true` requires `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_HANDLE` and
  `TELEGRAM_BOT_WEBHOOK_SECRET`; leaving it `false` is a safe, fully-supported mode.
- `VITE_API_BASE_URL` is the **only** frontend variable. Production builds have no
  localhost fallback: an unset value throws at runtime instead of pointing at a dev
  machine.
- Inject configuration through the environment in production. A `.env` file in the
  working directory is loaded but never overrides already-set process variables.

## Database & migrations

- Migrations live in `backend/prisma/migrations/` and are applied as the
  `werefa_migrator` role (`MIGRATOR_DATABASE_URL`): DDL owner, `CREATEDB` for the
  Prisma shadow database.
- The runtime application connects as `werefa_app` (`DATABASE_URL`), a non-privileged
  role with table DML grants only. Tenant isolation is enforced in the application
  layer (`TenantGuard`); the current migrations do **not** create row-level security
  policies.
- `prisma:deploy` applies committed migrations without creating new ones and is the
  intended production migration command. Ordinary application startup does **not**
  run migrations.
- Seed/fixture data lives only in `*.db.spec.ts` tests and is not part of the
  production migration path.

## Health & readiness

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/system/health` | Liveness — process uptime; no infrastructure dependency. |
| `GET /api/v1/system/ready` | Readiness — pings PostgreSQL; `503` when the DB is configured but unreachable, `disabled` when unset. |
| `GET /api/v1/system/meta` | Product/runtime metadata and the pending §46 clarifications (no values). |

Readiness depends only on the required database dependency; optional external
providers (Telegram, email) do not make the application unready.

## Background workers

Two in-process, single-instance workers run alongside the API. Both use `unref`'d
timers, are disabled under `NODE_ENV=test`, are cleared on shutdown, and log
failures without crashing the process:

- **`BusinessLifecycleWorker`** (`BUSINESS_LIFECYCLE_INTERVAL_MS`) — booking
  completion (REQ-102) and scheduled subscription auto-resume (REQ-153/154/155/231).
- **`NotificationBackgroundWorker`** (`TELEGRAM_DELIVERY_INTERVAL_MS`, only when
  `TELEGRAM_ENABLED=true`) — outbox delivery sweep with bounded retries, stale
  `SENDING` recovery and dead-lettering.

The notification/outbox is the single delivery mechanism (no external queue): domain
transactions persist `Notification`/`NotificationDelivery` rows first, delivery
happens afterwards, and booking validity never depends on delivery (REQ-056).

## External providers

- **Email** — the `EmailProvider` boundary currently binds to `DisabledEmailProvider`.
  It never reports success, so it produces no false "delivered" states. Supplying an
  approved external provider is a deployment input; until then **REQ-198 (real
  recovery-email delivery) remains PARTIAL**.
- **Telegram** — optional and fail-safe. When disabled, Telegram deliveries are
  recorded as `SUPPRESSED` in the outbox.
- **Payment-proof storage** — `PaymentProofStorage` with a local-filesystem adapter
  keyed by `PROOF_STORAGE_DIR`. A deployment that cannot rely on a durable local
  filesystem must mount a persistent shared volume there (or swap the adapter);
  otherwise staged proofs are lost on redeploy. Runtime proof bytes are git-ignored
  and must never be committed.

## Production safety

- Server-side sessions only (opaque httpOnly cookie, hashed at rest). The test
  resolver cannot be selected in production.
- No mock/fake provider can be selected by production configuration. The only
  production source that imports the demo seam is the Business profile **branding**
  editor (logo/cover), which is an explicitly documented demo-only slice pending an
  image-storage decision.
- Errors use a single envelope with no stack traces, SQL or tenant identifiers;
  logs redact cookies, auth headers, tokens and passwords.
- Swagger/OpenAPI is served only outside production and test.

## Test & release gates

```bash
# Release-candidate acceptance gate (repository root) — the single command that
# verifies the audited baseline. The gate has no dependencies of its own.
# See docs/implementation/49-release-candidate-acceptance-gate.md
npm run acceptance        # static invariants + every gate below
npm run acceptance:static # static invariants only (fast)

# Backend
cd backend
npm run typecheck && npm run lint && npm test
npm run test:db          # requires the provisioned werefa_test DB; run twice
npm run build

# Frontend
cd frontend
npm run typecheck && npm run lint && npm test
npm run build
```

`npm run acceptance` fails if the canonical specification digest changes, if the
audited requirement classification drifts, if a production-safety invariant or the
environment contract regresses, or if any existing gate above fails. It never
treats a blocked, deferred or deployment-provider-dependent requirement as a
failure, and it resolves no product decision. There is **no browser QA harness**
in the repository (only static screenshots under `frontend/qa-shot/`).

## Known gaps

Blocked by unresolved specification decisions (must not be implemented speculatively):

- **REQ-094** (affected-booking email) and **REQ-095** (five-minute grouping).
- **REQ-139** (subscription reminders — lead time is §46 item 3).
- Owner booking-report PDF (§46 item 4).

Partial / provider-dependent (require an approved external email sender — a deployment input):

- **REQ-198** real recovery-email delivery; **REQ-195** lockout email,
  **REQ-196** lockout email IP/device content and **REQ-221** forced-logout email.
  The mechanisms enqueue the correct outbox events, but delivery is `SUPPRESSED`
  while `EmailProvider` is the `DisabledEmailProvider` (it never claims a false
  "delivered"). REQ-196 additionally has no IP/device in its event payload and no
  email body renderer, so it remains partial.
- **REQ-026–033** owner email verification / unverified-dashboard gating /
  time-limited, replaceable and invalidating links / verification rate limiting /
  auto-authentication, and **REQ-033** forgot-password reset. These flows are not
  present: they cannot be completed without an email sender, and gating unverified
  owners with no deliverable verification link would lock out every owner. The
  account is created `isEmailVerified=false` (REQ-026) and the network surface
  intentionally exposes no verification/reset link yet.

Deferred by design: **REQ-025, REQ-034, REQ-115**.

## Remaining deployment inputs

Supplying these is an operations decision and is intentionally **not** hard-coded:

- Production PostgreSQL instance + `DATABASE_URL` / `MIGRATOR_DATABASE_URL`.
- Deployment packaging (Dockerfiles / process manager) and TLS/reverse-proxy
  topology; set `TRUST_PROXY` accordingly.
- The production frontend origin in `CORS_ORIGINS` and its matching
  `VITE_API_BASE_URL`.
- Durable storage for `PROOF_STORAGE_DIR`.
- An approved external `EmailProvider` implementation and credentials.
- Telegram bot credentials + public webhook URL (only if the Telegram channel is
  enabled).
- A browser QA harness, if interactive release verification is required.
