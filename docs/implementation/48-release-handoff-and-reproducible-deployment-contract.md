# 48 — Release Handoff & Reproducible Deployment Contract

Prompt: **Prompt 64 — Werefa Release Handoff Package & Reproducible Deployment Contract**
Status: **COMPLETE** — provider-neutral release/handoff documentation + one safe README correction
Report date: 2026-09-26
Repository: Werefa (`master`, uncommitted working tree; no commit made)

> **Provider-neutral by design.** This document describes the current
> implementation's build/configure/provision/start/verify/operate contract. It does
> **not** choose or prescribe any cloud, database-hosting, storage, email or Telegram
> hosting provider, nor invent domains, secrets or TLS topology.

---

## 1. Purpose

Answer, for an engineer receiving this repository today: **"What exactly do I need
to know to build, configure, provision, start, verify and operate the current
implementation — without guessing?"**

This is documentation and reproducibility work. No product feature was added, no
§46 decision resolved, and no provider/infrastructure choice made.

## 2. Repository baseline

- Branch `master`; HEAD `80a69ff1aefcb06e5336547dd85bf23dbadf75d0` (unchanged).
- Two applications: `backend/` (NestJS 11 modular monolith + Prisma/PostgreSQL) and
  `frontend/` (React 19 + Vite 6 SPA).
- No `infrastructure/` directory, no Dockerfiles, no production compose/topology.
  Only `backend/docker-compose.dev.yml` (PostgreSQL 16 for local development, host
  port 5433).
- 7 migrations under `backend/prisma/migrations/`; the last two share the timestamp
  prefix `20260923120000` (accepted limitation).
- Working tree: uncommitted by design (see Section 26).

## 3. Canonical specification identity

```
5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b  docs/WEREFA-COMPLETE-SPECIFICATION.md
```

Verified before and after this task. The specification is read-only; 232 requirement
headings (`REQ-001` … `REQ-232`). It remains **DRAFT — PENDING PRODUCT OWNER
APPROVAL** (`v1.0.0-DRAFT`).

## 4. Current implementation classification

From Prompt 63's corrected, independently derived audit (report 48 — Final Canonical
Traceability Audit). **This is authoritative; Prompt 44's obsolete claims are not.**

| Class | Count | Requirements |
| --- | --- | --- |
| A — IMPLEMENTED | 214 | all others |
| B — PARTIAL / DEPLOYMENT-PROVIDER INPUT REQUIRED | 12 | REQ-026, 027, 028, 029, 030, 031, 032, 033, 195, 196, 198, 221 |
| C — BLOCKED / SPECIFICATION INSUFFICIENT | 3 | REQ-094, 095, 139 |
| D — DEFERRED BY DESIGN | 3 | REQ-025, 034, 115 |
| Total | 232 | |

Additional blocked product/reporting item: **owner booking-report PDF export**
(§25.3 / §46-4; no dedicated REQ number).

Explicit correction policy (Section 13): the release documentation must NOT repeat
the obsolete Prompt 44 claims that REQ-026–031, REQ-033 or REQ-195/196/221 are fully
implemented. REQ-196 in particular remains partial because the current
`LOCKOUT_EMAIL` event carries no IP/device/browser and no email body renderer/provider
delivery is configured.

## 5. Build prerequisites

| Requirement | Value | Source |
| --- | --- | --- |
| Node.js | `>=20 <25` (backend `engines`); frontend targets Node 20+ | `backend/package.json` |
| Package manager | npm (lockfiles present per package) | repo |
| PostgreSQL | 16 (dev compose uses `postgres:16-alpine`) | `backend/docker-compose.dev.yml` |
| Docker | optional — only for the local dev database | same |
| OS | cross-platform; all repo scripts are Windows-safe (`scripts/*.mjs`) | repo scripts |

Each application is installed independently (`backend/` and `frontend/` have their own
`package.json`).

## 6. Installation commands

Existing, verified commands only (no invented commands):

```bash
# Backend
cd backend
cp .env.example .env      # then adjust; real credentials never committed
npm install               # postinstall runs `prisma generate`

# Frontend
cd frontend
cp .env.example .env.local   # set VITE_API_BASE_URL
npm install
```

## 7. Environment-variable contract

The authoritative list is `backend/.env.example` and `frontend/.env.example`;
cross-checked against `src/config/app-config.ts`, the `scripts/*.mjs` and frontend
`import.meta.env` usage. No variable consumed by the code was found missing from the
templates (`POSTGRES_*`, `APP_DB_PASSWORD`, `MIGRATOR_PASSWORD` are dev-provisioning
only). No placeholder value was invented.

### 7.1 Backend — runtime

| Variable | Required | Dev behavior | Test behavior | Prod behavior | Safe/default | Secret? | Consumed by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | optional | `development` | `test` | `production` | `development` | no | `app-config.ts` |
| `HOST` | optional | `0.0.0.0` | inherited | deploy-set | `0.0.0.0` | no | `app-config.ts`, `main.ts` |
| `PORT` | optional | `3000` | inherited | deploy-set | `3000` | no | `app-config.ts`, `main.ts` |
| `LOG_LEVEL` | optional | `info` | inherited | deploy-set | `info` | no | pino factory |
| `LOG_PRETTY` | optional | `false` | inherited | keep `false` | `false` | no | pino factory |
| `CORS_ORIGINS` | optional | explicit origins | inherited | explicit prod origin | `''` (CORS disabled) | no | `app.setup.ts` |
| `BODY_LIMIT` | optional | `1mb` | inherited | deploy-set | `1mb` | no | `app.setup.ts` |
| `TRUST_PROXY` | optional | `false` | `false` | set when behind proxy | `false` | no | `app.setup.ts` |
| `AUTH_TEST_ENABLED` | optional | `false` | may be `true` in tests | **must be `false` (fail-fast)** | `false` | no | resolver factory |

### 7.2 Backend — database & provisioning

| Variable | Required | Notes | Secret? |
| --- | --- | --- | --- |
| `DATABASE_URL` | **yes in production** | runtime `werefa_app` (DML only) | yes |
| `MIGRATOR_DATABASE_URL` | required to migrate | `werefa_migrator` (DDL, `CREATEDB` for shadow DB) | yes |
| `TEST_DATABASE_URL` | required for `test:db` | `werefa_test` | yes |
| `RUN_DB_TESTS` | optional | gates the DB suite (set by `run-db-tests.mjs`) | no |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` | dev only | dev compose superuser | yes |
| `APP_DB_PASSWORD` / `MIGRATOR_PASSWORD` | dev only | assigned by `db-provision.mjs` | yes |

### 7.3 Backend — auth / sessions / recovery

| Variable | Default | Notes | Secret? |
| --- | --- | --- | --- |
| `AUTH_SESSION_TTL_HOURS` | `12` (max 720) | server-side session TTL | no |
| `AUTH_RECOVERY_TTL_MINUTES` | `15` | recovery code TTL | no |
| `AUTH_RECOVERY_MAX_ATTEMPTS` | `5` | attempt cap | no |
| `AUTH_RECOVERY_CODE_LENGTH` | `6` (6–8) | code digits | no |
| `AUTH_COOKIE_NAME` | `werefa_session` | httpOnly cookie name | no |

### 7.4 Backend — storage / Telegram / workers

| Variable | Default | Notes | Secret? |
| --- | --- | --- | --- |
| `PROOF_STORAGE_DIR` | `./storage/proofs` | local proof-storage adapter root | no |
| `TELEGRAM_ENABLED` | `false` | channel off = fully supported | no |
| `TELEGRAM_BOT_TOKEN` | — | required when enabled | **yes** |
| `TELEGRAM_BOT_HANDLE` | — | required when enabled | no |
| `TELEGRAM_BOT_WEBHOOK_SECRET` | — | required when enabled | **yes** |
| `TELEGRAM_BOT_WEBHOOK_URL` | — | public URL for webhook registration | no |
| `TELEGRAM_DELIVERY_INTERVAL_MS` | `5000` | outbox sweep cadence | no |
| `TELEGRAM_DELIVERY_MAX_ATTEMPTS` | `5` | dead-letter threshold | no |
| `BUSINESS_LIFECYCLE_INTERVAL_MS` | `60000` | completion + auto-resume sweep | no |

### 7.5 Backend — product parameters (§46, PENDING)

All six are exposed as configuration only; values must not be invented. They default
to unset/default so the implementation runs without them.

| Variable | §46 item | Default |
| --- | --- | --- |
| `PRODUCT_SUBSCRIPTION_MONTHLY_PRICE_MINOR` | 1 (REQ-125) | unset (`null`) |
| `PRODUCT_APP_TIMEZONE` | 2 (REQ-222) | `Africa/Addis_Ababa` (design default, not a product fact) |
| `PRODUCT_REMINDER_LEAD_DAYS` | 3 (REQ-139) | unset (`null`) |
| `PRODUCT_OWNER_BOOKING_REPORT_PDF_ENABLED` | 4 (§25.3) | unset (`null`) |
| `PRODUCT_OWNER_BOOKING_MODIFY_COMPONENTS` | 5 (REQ-105) | unset (`null`) |
| `PRODUCT_SHOW_TIMEZONE_ABBREVIATION` | 6 (BR-32) | unset (`null`) |

### 7.6 Frontend

| Variable | Required | Dev | Prod | Secret? |
| --- | --- | --- | --- | --- |
| `VITE_API_BASE_URL` | **yes in production** | falls back to `http://localhost:3000/api/v1` | **no localhost fallback — throws if unset** | no (public) |

Only `VITE_`-prefixed variables reach the browser bundle. Never place secrets there.

## 8. Database provisioning / migration contract

- **PostgreSQL 16** expected (dev compose pins `postgres:16-alpine`).
- **Two roles.** `werefa_migrator` owns DDL and may `CREATEDB` (Prisma shadow DB);
  `werefa_app` is non-privileged with `SELECT/INSERT/UPDATE/DELETE` grants only.
  Migrations always run as the migrator role.
- **Provision (dev):** `npm run db:up` → `npm run db:provision` (idempotent; creates
  `werefa_app`/`werefa_migrator` and `werefa_dev`/`werefa_test`, both owned by the
  migrator). Then `npm run prisma:dev` for the first migration.
- **Apply migrations:** `npm run prisma:dev` (dev, creates) / `npm run prisma:deploy`
  (applies committed migrations only — the intended production command) /
  `npm run prisma:status`.
- **Grants / default privileges:** `GRANT … ON ALL TABLES … TO werefa_app` and default
  privileges are part of the migrations.
- **No required extensions** beyond the standard PostgreSQL 16 catalog.
- **Schema ownership:** the migrator role owns the schema/database (PG15+
  public-schema defaults are tied to `pg_database_owner`).
- **Test DB:** `werefa_test`, gated by `RUN_DB_TESTS=true` + `TEST_DATABASE_URL`;
  10 `*.db.spec.ts` files reset their own data.
- **Startup does NOT run migrations** — run them separately, before deploying the app.
- **No DB-level RLS:** isolation is application-enforced (`TenantGuard`); the current
  migrations create no RLS policies.
- **Seed/fixtures** live only in `*.db.spec.ts` and are not part of the production
  path. `db:reset` is dev-only and never invoked by production code/startup.

## 9. Backend startup contract

```bash
cd backend
npm run start:dev                       # watch mode (development)
# or production:
npm run build && npm run start:prod     # node dist/main.js
```

Startup sequence: `loadConfigFromFileSystem()` validates the environment fail-fast
(value-free, aggregated error, non-zero exit); `AppModule.forRoot(config)` builds the
app (Prisma `$connect` is fail-fast when `DATABASE_URL` is set); `configureApp()` wires
pino logging, request context, helmet, optional CORS, body limit, `api/v1` global
prefix, validation pipe, exception filter, shutdown hooks, and (non-prod/test)
Swagger; then `app.listen(port, host)`. A boot failure prints `[SERVER BOOT FAILED]`
and sets a non-zero exit code.

## 10. Frontend build / runtime contract

```bash
cd frontend
npm run dev          # Vite dev server
npm run build        # tsc -b && vite build → dist/
npm run preview      # serve the production build locally
```

The built `dist/` is a static SPA; serve it over HTTPS behind the deployment's own
web server. The API base URL comes from `VITE_API_BASE_URL` at build time; production
builds have no localhost fallback. Requests always send the session cookie
(`credentials: 'include'`); a global 401 handler drives session-expiry handling.

## 11. Authentication production-safety checklist

- [ ] `NODE_ENV=production`.
- [ ] `AUTH_TEST_ENABLED` is unset or `false` **(startup fails fast if `true`)**.
- [ ] The test actor resolver (`X-Actor-Role`/`X-Actor-Id`) cannot be selected: it is
      constructed only when `AUTH_TEST_ENABLED=true` **and** `nodeEnv !== 'production'`.
- [ ] Session config intended: `AUTH_SESSION_TTL_HOURS`, `AUTH_COOKIE_NAME` set; cookie
      is httpOnly, SameSite=Lax, Secure in production.
- [ ] Recovery config intended: `AUTH_RECOVERY_TTL_MINUTES`, `AUTH_RECOVERY_MAX_ATTEMPTS`,
      `AUTH_RECOVERY_CODE_LENGTH` (codes are hashed, single-use, attempt-capped).
- [ ] Lockout behaviour (5 consecutive failures → 15 min) understood; lockout and
      forced-logout **emails are suppressed** until an email provider is configured.
- [ ] Session/credential material is server-side only; no tokens are exposed to the
      frontend state layer.

## 12. Telegram configuration checklist

- [ ] `TELEGRAM_ENABLED=false` is a fully supported mode: deliveries are recorded
      `SUPPRESSED`; nothing is sent (fail-safe).
- [ ] To enable: set `TELEGRAM_ENABLED=true` **and** `TELEGRAM_BOT_TOKEN`,
      `TELEGRAM_BOT_HANDLE`, `TELEGRAM_BOT_WEBHOOK_SECRET` (all required; startup
      fails fast if any is missing).
- [ ] Set `TELEGRAM_BOT_WEBHOOK_URL` to the public HTTPS endpoint Telegram posts to
      (used for webhook registration at startup).
- [ ] Webhook secret is verified in constant time; `update_id` is exactly-once
      (P2002).
- [ ] The provider boundary is `TelegramProvider` (`HttpTelegramProvider` when
      enabled, `DisabledTelegramProvider` otherwise). Production never selects a mock.
- [ ] REQ-230 resubmission codes are delivered to the customer's connected Telegram
      chat when present; otherwise the code is voided (no code path).

## 13. Email configuration checklist

- [ ] No external email provider is implemented or bound; `EMAIL_PROVIDER` resolves
      to `DisabledEmailProvider` (`isConfigured()=false`, never reports acceptance).
- [ ] Supplying an approved external `EmailProvider` is a **deployment input**, not a
      product decision — do not invent one during a deployment.
- [ ] While disabled, email deliveries are written `SUPPRESSED`; recovery codes are
      always suppressed. **Do not claim that any email is delivered.**
- [ ] Blocked on a provider: **REQ-026–033** (owner email verification and
      forgot-password reset; these flows are absent) and **REQ-195/196/198/221**
      (lockout, lockout IP/device content, recovery, forced-logout email delivery).

## 14. Payment-proof storage checklist

- [ ] `PROOF_STORAGE_DIR` points at a **durable, shared** volume (local disk is
      durable only if persisted across redeploys).
- [ ] Filesystem is writable by the app process; each business is namespaced into its
      own directory (`<businessId>/<uuid>.<ext>`).
- [ ] Keys are path-traversal-guarded; declared MIME is not trusted (magic-byte
      sniffing, images + PDF, 5 MB cap).
- [ ] Proof bytes and storage keys are never logged or committed; the runtime proof
      directory is git-ignored.
- [ ] Backup implications understood: losing the volume loses staged/committed proofs.
      The adapter (`PaymentProofStorage` → `LocalProofStorage`) is swap-in-able for
      object storage without domain changes.

## 15. Worker / outbox operational contract

Two single-instance, in-process workers run alongside the API. Both use `unref`'d
`setInterval` timers, are disabled under `NODE_ENV=test`, are cleared on
`onModuleDestroy`, and log failures (message only, never values) without crashing:

- **`BusinessLifecycleWorker`** (`BUSINESS_LIFECYCLE_INTERVAL_MS`): booking completion
  (REQ-102, `sweepCompletions` → `BookingService.autoCompleteDueBookings`) and
  scheduled subscription auto-resume (REQ-153/154/155/231). The two duties run on
  isolated paths so one failure never suppresses the other; guarded, advisory-locked
  transitions make concurrent sweeps idempotent.
- **`NotificationBackgroundWorker`** (`TELEGRAM_DELIVERY_INTERVAL_MS`, only when
  `TELEGRAM_ENABLED=true`): registers the webhook then sweeps outbox + reminders.

Outbox contract (`NotificationOutboxEventBus` → `NotificationDeliveryService`):

- Domain transactions persist `Notification`/`NotificationDelivery` rows first;
  delivery happens afterwards (no external API inside a domain transaction; booking
  validity never depends on delivery — REQ-056).
- Stable idempotency keys (unique constraint); duplicate publishes are P2002 and are
  skipped.
- Reminders: `writeDueReminders` writes `REMINDER_24H`/`REMINDER_1H` for `CONFIRMED`
  bookings.
- Retry: bounded backoff (≈30 s → 10 min cap); stale-`SENDING` rows reclaimed after
  10 minutes; `DEAD_LETTERED` at `TELEGRAM_DELIVERY_MAX_ATTEMPTS`.
- Disabled channels are `SUPPRESSED` at write time. No second queue/scheduler exists.

## 16. Health / readiness contract

All paths are under the global `api/v1` prefix:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/system/health` | Liveness — process uptime only; no infrastructure dependency. |
| `GET /api/v1/system/ready` | Readiness — pings PostgreSQL; `200` when reachable, `503` when configured-but-unreachable, reports `disabled` when the DB is unconfigured. |
| `GET /api/v1/system/meta` | Product/runtime metadata + pending §46 clarifications (no values). |

Readiness depends only on the required database dependency; optional providers
(Telegram/email) never make the app unready.

## 17. Production configuration checklist

### API / frontend
- [ ] `CORS_ORIGINS` lists explicit production origin(s); `*` is rejected.
- [ ] `VITE_API_BASE_URL` set to the production API origin at frontend build time.
- [ ] Served over HTTPS/TLS (terminated by the deployment's reverse proxy).
- [ ] `TRUST_PROXY=true` only when genuinely behind a trusted proxy.

### Database
- [ ] Production PostgreSQL 16 reachable; `DATABASE_URL` (`werefa_app`) and
      `MIGRATOR_DATABASE_URL` (`werefa_migrator`) set and secret-managed.
- [ ] Migrations run separately via `prisma:deploy` before app rollout.

### Providers
- [ ] Telegram decided (enable with full credentials, or leave disabled).
- [ ] Email provider decided (leave `DisabledEmailProvider`, or bind an approved one).
- [ ] Durable `PROOF_STORAGE_DIR` provisioned.
- [ ] No mock/demo provider can be selected by production configuration.

## 18. Release verification checklist

Execute in order; each item is verifiable with existing tooling only.

1. [ ] **Canonical spec hash** = `5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`.
2. [ ] **Clean dependency install** — `npm install` in `backend/` and `frontend/`
   (backend `postinstall` runs `prisma generate`).
3. [ ] **DB provision/migration** — `npm run db:up && npm run db:provision &&
   npm run prisma:dev` (or `prisma:deploy` for a deployed DB).
4. [ ] **Backend test suite** — `npm test`.
5. [ ] **DB test suite** — `npm run test:db` (run twice).
6. [ ] **Frontend test suite** — `npm test`.
7. [ ] **Typechecks** — backend `npm run typecheck`; frontend `npm run typecheck`.
8. [ ] **Lint** — backend `npm run lint`; frontend `npm run lint`.
9. [ ] **Production builds** — backend `npm run build`; frontend `npm run build`.
10. [ ] **Production configuration safety** — `NODE_ENV=production`, `AUTH_TEST_ENABLED` off,
    `CORS_ORIGINS` explicit, `DATABASE_URL` set (startup fails fast otherwise).
11. [ ] **Health endpoint** — `GET /api/v1/system/health` returns `200`.
12. [ ] **Readiness endpoint** — `GET /api/v1/system/ready` returns `200` with the DB up.
13. [ ] **Authentication production mode** — session cookie auth works; the test-header
    resolver is unreachable.
14. [ ] **No mock providers accidentally active** — email = `DisabledEmailProvider`;
    Telegram = `Disabled` unless enabled; only the documented branding demo seam imports
    a mock on the frontend.
15. [ ] **Durable proof storage** — `PROOF_STORAGE_DIR` mounted on a persistent volume;
    a proof upload survives a restart.
16. [ ] **Worker startup/shutdown** — timers run, are unref'd, and clear on shutdown.
17. [ ] **Notification outbox operation** — rows are written; unsent/disabled channels are
    `SUPPRESSED`; there is no false "delivered".

> External provider delivery (email, Telegram) can only be tested when that provider is
> actually configured. Do not claim otherwise.

## 19. Deployment / provider inputs still required

Supplying these is an operations decision and is intentionally **not** hard-coded:

- Production PostgreSQL 16 + `DATABASE_URL` / `MIGRATOR_DATABASE_URL`.
- Deployment packaging (Dockerfiles / process manager) and TLS/reverse-proxy topology;
  set `TRUST_PROXY` accordingly.
- The production frontend origin in `CORS_ORIGINS` and matching `VITE_API_BASE_URL`.
- Durable storage for `PROOF_STORAGE_DIR`.
- An approved external `EmailProvider` implementation and credentials (unblocks the
  Class-B email requirements).
- Telegram bot credentials + public HTTPS webhook URL (only if Telegram is enabled).

## 20. Blocked requirements (Class C)

| REQ | Summary | Blocked on |
| --- | --- | --- |
| REQ-094 | Affected-booking email generated | No canonical deep-link/quick-action or grouping/multi-booking contract defined. |
| REQ-095 | Close schedule changes grouped into a five-minute window | Dependent on REQ-094's undefined producer. |
| REQ-139 | Subscription reminders by email + business Telegram | §46 item 3 (reminder lead time) unresolved; `reminderLeadDays` defaults `null`. |
| §25.3 / §46-4 | Owner booking-report PDF export | §46 item 4 pending; only the Super Admin PDF (REQ-178) is confirmed. |

Not implemented and must not be implemented speculatively.

## 21. Deferred requirements (Class D)

| REQ | Summary | Basis |
| --- | --- | --- |
| REQ-025 | Google login not part of Phase 1 | §12.2 / §43 — email/password only. |
| REQ-034 | 2FA-ready Phase 1 architecture | §43 — no 2FA enforcement in Phase 1. |
| REQ-115 | Custom payment methods NOT configured | §12.2 / §43 — correctly absent. |

Also out of Phase-1 scope by canonical decision: online payment gateway, customer
accounts/self-service cancel/modify, per-tenant timezones, TTL slot locks.

## 22. Unresolved §46 decisions (untouched)

All six remain open; none was resolved by this task:

1. Subscription monthly price (REQ-125) — model only; no amount invented.
2. Global timezone identity (REQ-222) — mechanism configurable; value unconfirmed.
3. Subscription-reminder lead time (REQ-139) — defaults `null`; no producer.
4. Owner booking-report PDF export (§25.3) — not implemented.
5. Owner "modify" scope (REQ-105/109) — rescheduling only; broader modify not inferred.
6. Timezone-abbreviation display / BR-32 — not implemented.

## 23. Known accepted limitations

- **No DB-level RLS.** Isolation is application-enforced by `TenantGuard`; no RLS
  policies exist in any migration (documented, not changed).
- **Branding demo seam.** `frontend/src/features/owner-portal/pages/BusinessProfilePage.tsx`
  imports `mockOwnerApi` for logo/cover previews only — a documented demo-only slice
  pending an image-storage decision.
- **Two migrations share the timestamp prefix** `20260923120000`
  (`subscription_proof_submission_key`, `telegram_code_hash_unique`); renaming an
  applied migration would rewrite history, so it is accepted as-is.
- **Frontend bundle** exceeds 500 kB (Vite advisory; ~527 kB JS chunk) — pre-existing,
  non-blocking.
- **No browser QA harness** exists (only static screenshots under `frontend/qa-shot/`);
  none was added.
- **Single in-process sweep timers**, no distributed lock; correctness (not efficiency)
  is preserved by guarded, advisory-locked transitions.
- **REQ-196** remains partial: the `LOCKOUT_EMAIL` event carries no IP/device and no
  body renderer exists (corrected from earlier reports).

## 24. Final test gates

Run after the one README correction (no behavior change):

| Gate | Result |
| --- | --- |
| Backend `npm test` | 30 passed | 10 skipped (40 files); 199 passed | 246 skipped (445) |
| Backend `npm run test:db` — run 1 | 28 passed (28); 387 passed (387) |
| Backend `npm run test:db` — run 2 | 28 passed (28); 387 passed (387) |
| Frontend `npm test` | 44 passed (44); 504 passed (504) |
| Backend typecheck / lint / build | PASS / PASS / PASS |
| Frontend typecheck / lint / build | PASS / PASS / PASS (`vite build` chunk advisory only) |
| Browser QA | unavailable — no harness; none added |

DB tests were run twice consecutively against the real PostgreSQL test database; both
runs clean. No test was weakened or deleted. No pre-existing flaky failure occurred.

## 25. Final specification hash

```
5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b  docs/WEREFA-COMPLETE-SPECIFICATION.md
```

Identical to the required value and to the starting digest; the specification was
read-only throughout (232 requirement headings unchanged).

## 26. Working-tree state & no-commit confirmation

- HEAD unchanged at `80a69ff1aefcb06e5336547dd85bf23dbadf75d0`.
- Files touched by this Prompt:

| File | Change |
| --- | --- |
| `docs/implementation/48-release-handoff-and-reproducible-deployment-contract.md` | **new** — this handoff document |
| `README.md` | safe correction: "Known gaps" provider-dependent list now includes REQ-032 and REQ-196 and matches Prompt 63's classification |

**NO COMMIT CREATED.** No `git add`, `git commit`, `git push`, reset, rebase, squash or
any other history operation was performed. Work remains as uncommitted working-tree
changes only.

---

## Appendix — Documentation changes & findings summary

- **Documentation changes:** this handoff document; one README "Known gaps" correction.
- **Environment-variable findings:** `backend/.env.example` and `frontend/.env.example`
  are complete relative to actual code usage; no missing variable, no invented value.
- **Build/release findings:** all documented commands verified against `package.json`;
  backend `postinstall` runs `prisma generate`; all scripts are Windows-safe.
- **Database findings:** PostgreSQL 16; migrator/app role split; no RLS; startup does
  not migrate; test DB `werefa_test`; two shared migration timestamps accepted.
- **Authentication findings:** session-only production auth; test resolver unreachable;
  lockout/recovery/forced-logout present; recovery email suppressed.
- **Telegram findings:** optional and fail-safe; credentials required only when enabled;
  webhook secret + `update_id` idempotency; REQ-230 delivered over the connected chat.
- **Email findings:** no provider bound; `DisabledEmailProvider` never reports success;
  REQ-026–033 and REQ-195/196/198/221 blocked on a provider (B).
- **Storage findings:** `LocalProofStorage`, business-namespaced, path-traversal-guarded,
  magic-byte validated, 5 MB cap; requires a durable volume.
- **Worker/outbox findings:** two single-instance unref'd workers; durable outbox with
  idempotency, bounded backoff, stale-`SENDING` reclaim, dead-lettering; no second queue.

