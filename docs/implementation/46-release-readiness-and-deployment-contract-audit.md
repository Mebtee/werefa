# 46 — Release Readiness & Deployment Contract Audit

Prompt: **Prompt 62 — Werefa Release Readiness, Deployment Contract & Final Repository Hardening**
Status: **COMPLETE** — audit + a small set of safe documentation/hygiene fixes
Report date: 2026-09-26
Repository: Werefa (`master`, uncommitted working tree; no commit made)

---

## 1. Executive summary

The repository is internally ready to be handed to a deployment/operations process:
configuration is validated fail-fast, production cannot silently enable any test/mock
bypass, migrations are deterministic and not run by ordinary startup, health/readiness
have distinct semantics, workers are single-instance and cleanly shut down, and the
outbox is durable and idempotent.

Three **safe, fully-specified** documentation/hygiene defects were fixed (README
release contract, `.env.example` completeness/accuracy, and a missing git-ignore for
runtime proof storage). Nothing about product behavior, providers, or topology was
changed or invented.

Deployment is **not** complete: this is an audit of *implementation/deployment-contract
readiness*, not a deployment. External deployment inputs (database, packaging/topology,
durable storage, optional email/Telegram providers, CORS/API origins) remain required.

## 2. Starting repository state

- Branch `master`; HEAD `80a69ff docs: report email notification integration` (unchanged
  from Prompt 61 — no commit was made in either prompt).
- Working tree carries the accumulated uncommitted work of Prompts ~41–61 plus the
  Prompt 61 fixes (verified present in `src/config/app-config.ts`).
- `docs/implementation/` contains reports `01`–`45`; report `46` did not exist.

## 3. Canonical specification hash before work

```
5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b  docs/WEREFA-COMPLETE-SPECIFICATION.md
```

Equal to the required digest. The specification was not modified.

## 4. Audit scope

Areas A–T from the prompt: configuration contract; env-var completeness; startup/
shutdown; database migration/provisioning; health/readiness; backend and frontend
production build/runtime; API/frontend origin configuration; auth production safety;
Telegram; email; payment-proof storage & durability; notification/outbox worker;
BusinessLifecycleWorker; logging/redaction; Docker/dev reproducibility; build artifact
& repository hygiene; documentation/runbook; test/release gates; dangerous test bypasses.

Evidence base: `docs/WEREFA-COMPLETE-SPECIFICATION.md`,
`docs/implementation/44-requirements-coverage-and-gap-audit.md`,
`docs/implementation/45-production-readiness-audit.md`, `README.md`, and current source
(`backend/src`, `backend/prisma`, `backend/scripts`, `frontend/src`) + `git status`.

## 5. Configuration inventory

Every environment variable consumed by production code, workers, migrations and the
frontend was inventoried against `backend/.env.example` / `frontend/.env.example`.

| Variable | Consumer | Required? | Default | Production explicit value? | Documented | Validated |
| --- | --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | config, workers, cookies, Swagger | No | `development` | Yes (must be `production`) | Yes | enum |
| `HOST` / `PORT` | bootstrap | No | `0.0.0.0` / `3000` | No | Yes | yes |
| `LOG_LEVEL` / `LOG_PRETTY` | pino | No | `info` / `false` | No | Yes | enum / bool |
| `CORS_ORIGINS` | app.setup | No | `''` (CORS off) | Yes (frontend origin) | Yes | yes; `*` rejected |
| `BODY_LIMIT` | body parser | No | `1mb` | No | Yes | yes |
| `TRUST_PROXY` | express | No | `false` | Behind a proxy: yes | Yes | bool |
| `AUTH_TEST_ENABLED` | auth resolver selector | No | `false` | Must stay false in prod | Yes | rejected in prod |
| `DATABASE_URL` | Prisma runtime | Prod: yes | — | Yes | Yes | required in prod |
| `MIGRATOR_DATABASE_URL` | migration script | Migrations only | — | Yes | Yes | script-guarded |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` | provisioning | Dev only | dev defaults | N/A | Yes | n/a |
| `APP_DB_PASSWORD` | `db-provision.mjs` | Dev only | dev default | N/A | **was missing → fixed** | n/a |
| `MIGRATOR_PASSWORD` | provisioning | Dev only | dev default | N/A | Yes | n/a |
| `TEST_DATABASE_URL` | gated DB specs | Test only | — | No | Yes (stale ref → fixed) | n/a |
| `RUN_DB_TESTS` | gated DB specs | Test only | `false` | Must stay false | Yes | bool |
| `AUTH_SESSION_TTL_HOURS` | sessions | No | `12` | No | Yes | 1–720 |
| `AUTH_RECOVERY_*` (TTL/attempts/length) | recovery | No | `15/5/6` | No | Yes | ranges |
| `AUTH_COOKIE_NAME` | cookie | No | `werefa_session` | No | Yes | yes |
| `PROOF_STORAGE_DIR` | local proof storage | Durable prod: yes | `./storage/proofs` | Yes | Yes (added P61) | yes |
| `TELEGRAM_ENABLED` | Telegram channel | No | `false` | Only if enabling | Yes | bool |
| `TELEGRAM_BOT_TOKEN` / `_HANDLE` / `_WEBHOOK_SECRET` | Telegram | If enabled | null | Yes | Yes | required-if-enabled |
| `TELEGRAM_BOT_WEBHOOK_URL` | webhook registration | If registering | null | Yes | Yes | nullable |
| `TELEGRAM_DELIVERY_INTERVAL_MS` / `_MAX_ATTEMPTS` | delivery worker | No | `5000` / `5` | No | Yes | positive / 1–20 |
| `BUSINESS_LIFECYCLE_INTERVAL_MS` | lifecycle worker | No | `60000` | No | Yes | positive |
| `PRODUCT_*` (§46 ×6) | product parameters | No | unset/null | Pending product decision | Yes | nullable |
| `VITE_API_BASE_URL` | frontend HTTP client | Prod: yes | dev localhost (dev only) | Yes | Yes | throws if unset in prod |

No consumed variable is undocumented; only the two dev-provisioning/doc issues above
were found (both fixed). No unsafe development value can be selected by production
configuration (see §6).

## 6. Production safety findings

Verified: production cannot accidentally enable `AUTH_TEST_ENABLED`, the test
resolver, mock authentication, mock Telegram/email delivery, fake payment providers,
test-only authorization bypasses, localhost API fallback, wildcard CORS, or dev
credentials.

- **Test actor bridge** — factory returns the session resolver in production even if
  the flag is set; the `TestAuthContextResolver` constructor hard-fails in production;
  and (from Prompt 61) a production boot with `AUTH_TEST_ENABLED=true` now fails fast.
- **Wildcard CORS** — guard is unconditional (Prompt 61); `*` rejected.
- **Frontend API fallback** — `resolveApiBaseUrl` returns the dev localhost URL only
  when `import.meta.env.DEV`; a production build with an unset value throws at runtime.
- **Test database** — `TEST_DATABASE_URL`/`RUN_DB_TESTS` are consumed only inside
  `*.db.spec.ts` (gated by `RUN_DB_TESTS=true`); no production path reads them.
- **Migrations** — ordinary application startup does not run migrations.
- **`.env` loading** — verified empirically that `process.loadEnvFile` does **not**
  override already-set process variables (a stray `.env` cannot flip `NODE_ENV`).

Result: **no unsafe production path found**; no production-safety code fix was required
in this prompt.

## 7. Database release findings

- 7 deterministic SQL migrations; no application-runtime dependencies.
- Two roles: `werefa_migrator` (DDL owner, `CREATEDB` for the shadow DB) and
  `werefa_app` (DML only). Table `GRANT`s and default privileges are present.
- Production migration command is `npm run prisma:deploy`; startup does not migrate.
- Seed/test fixtures live only in gated DB specs.
- Known accepted issue (unchanged): two migrations share the timestamp prefix
  `20260923120000` (ordering ambiguity); renaming applied migrations would rewrite
  history, so it is documented, not modified.
- Documentation accuracy fix: `.env.example` previously stated tenant isolation via
  DB-level RLS; the migrations create no RLS policies, so the comment was corrected
  (isolation is application-enforced via `TenantGuard`).

## 8. Startup / shutdown / worker findings

- Startup: config validated first → Prisma `$connect` fail-fast when `DATABASE_URL`
  is set → listen. Shutdown hooks enabled; Prisma disconnects on shutdown.
- `BusinessLifecycleWorker` and `NotificationBackgroundWorker`: single instances,
  `unref`'d timers, disabled under `NODE_ENV=test`, timers cleared on destroy,
  isolated best-effort duties, and (from Prompt 61) observable failure logging.
- No duplicate/competing scheduler or queue exists.

## 9. Health / readiness findings

- `/api/v1/system/health` — liveness only (uptime), no infrastructure dependency.
- `/api/v1/system/ready` — reflects the required database dependency; `503` when the
  DB is configured but unreachable, `disabled` when unset. Optional providers do not
  affect readiness. Responses use the existing conventions and leak no credentials.

## 10. Frontend release findings

- Production build succeeds; only `VITE_API_BASE_URL` is exposed; production has no
  localhost fallback; requests always send the session cookie (`credentials:'include'`).
- Non-test production source importing the demo seam: **one** — `BusinessProfilePage`
  (branding logo/cover only). Classified **ACCEPTED LIMITATION / DEFERRED** (an
  image-storage/product decision), consistent with Prompt 61. No other accidental
  mock imports found.
- The bundle-size warning (527 kB) is an existing accepted limitation.

## 11. Telegram findings

One `TelegramProvider` boundary; real HTTP adapter + fail-safe disabled adapter. Bot
token is constructor-injected and never logged; webhook secret compared in constant
time; `update_id` exactly-once; connection codes SHA-256-hashed, single-use, 10-minute
TTL, bound per business/recipient. Production cannot select mock Telegram behavior.
Credentials/webhook URL are **deployment inputs required** (see §21).

## 12. Email findings

`EmailProvider` boundary binds to `DisabledEmailProvider` when no provider is
configured; it never reports acceptance/delivery, so there are no false "delivered"
states. Suppressed rows are durable records. **REQ-198 remains PARTIAL** pending an
external provider — an explicit deployment dependency, not a product gap.

## 13. Payment-proof storage findings

`PaymentProofStorage` port with a local-filesystem adapter; keys namespaced per
business and shape-validated against traversal; authoritative magic-byte validation
and size cap; opaque keys never exposed; contents never logged. Durability requires a
persistent mounted volume at `PROOF_STORAGE_DIR` — a **DEPLOYMENT INPUT REQUIRED**.

## 14. Outbox / idempotency findings

Unique idempotency keys per delivery; duplicate publishes are silently skipped
(P2002). Domain transaction → outbox persistence → delivery ordering is preserved.
Bounded retries, stale-`SENDING` reclaim, and `DEAD_LETTERED` terminal state; delivery
failure never corrupts domain state. No second queue introduced.

## 15. Authentication / security findings

Server-side sessions only; httpOnly/SameSite=Lax/Secure cookies; password change,
recovery and forced-logout revoke sessions; 5-failure lockout with 15-minute window;
recovery codes single-use, hashed, TTL- and attempt-capped; security events record
IP/device/browser; authorization separates Owner/Admin/Super Admin and enforces tenant
ownership. No Phase-2 2FA implemented; no rate limiting added beyond what the spec
already requires.

## 16. Repository hygiene findings

- No tracked `dist/`, `node_modules/`, `coverage/`, `test-results/`, `*.tsbuildinfo`,
  or real `.env` files. Only `.env.example` templates are tracked (intended).
- `frontend/qa-shot/*.png` (20 files) are tracked **static QA evidence** referenced by
  implementation reports — retained intentionally (not accidental).
- Untracked entries under `backend/src`, `frontend/src` and `docs/implementation` are
  prior-prompt source/report files, not accidental artifacts.
- **Gap fixed:** runtime proof storage had no ignore rule, so customer proof uploads
  could be accidentally committed → added `/storage/` to `backend/.gitignore`.

## 17. Documentation findings

- `README.md` was stale/misleading: it claimed implementation "begins only after the
  Complete Specification is approved" and referenced a non-existent `infrastructure/`
  directory, while providing no runbook.
- Documentation that could be completed from existing code/spec without a deployment
  choice (prerequisites, DB provisioning/migration, backend/frontend build/start,
  required env vars, health/readiness, providers, storage durability, worker behavior,
  production-safety constraints, known blocked/partial/deferred, remaining deployment
  inputs) was missing → **fixed** (see §19).
- `.env.example` completeness: `APP_DB_PASSWORD` undocumented; `db-provision.sh`
  reference stale (script is `db-provision.mjs`); RLS wording inaccurate → **fixed**.

## 18. SAFE TO FIX NOW findings

1. Missing git-ignore for runtime proof storage (`backend/.gitignore`).
2. `.env.example` missing `APP_DB_PASSWORD` (consumed by `db-provision.mjs`).
3. `.env.example` stale script reference + inaccurate RLS wording.
4. `README.md` stale status + missing release/runbook contract.

All four meet the safe-fix rule: behavior already specified, no product decision,
no provider/architecture choice, objectively engineering/documentation defects, and no
change to intended product behavior.

## 19. Changes actually implemented

| # | File | Change |
| --- | --- | --- |
| 1 | `backend/.gitignore` | Added `/storage/` so runtime payment-proof uploads are never committed. |
| 2 | `backend/.env.example` | Added documented `APP_DB_PASSWORD`; corrected `db-provision.sh` → `db-provision.mjs`; corrected the RLS claim; added a note not to ship `.env` to production. |
| 3 | `README.md` | Rewrote as an accurate release/runbook contract (prerequisites, dev setup, configuration contract, migrations, health/readiness, workers, providers, production safety, test gates, known gaps, remaining deployment inputs). |

No backend/frontend source logic was changed.

## 20. REQUIRES PRODUCT DECISION findings

Unchanged and untouched:

- §46 items 1–6 (subscription price; global timezone identity; subscription-reminder
  lead time; owner booking-report PDF; owner "modify" scope; timezone-abbreviation
  display).
- **REQ-094** (affected-booking email) — canonical contract undefined.
- **REQ-095** (five-minute grouping) — dependent on REQ-094.
- **REQ-139** (subscription reminders) — blocked by §46 item 3.

## 21. DEPLOYMENT INPUT REQUIRED findings

- Production PostgreSQL instance + `DATABASE_URL` and `MIGRATOR_DATABASE_URL`; run
  `prisma migrate deploy`.
- Deployment packaging (Dockerfiles or process manager) and TLS/reverse-proxy
  topology; set `TRUST_PROXY` accordingly.
- Production frontend origin in `CORS_ORIGINS` and matching `VITE_API_BASE_URL`.
- Durable, shared storage mounted at `PROOF_STORAGE_DIR` (or a replacement adapter).
- An approved external `EmailProvider` implementation + credentials (lifts REQ-198).
- Telegram bot credentials + public webhook URL (only if the Telegram channel is
  enabled).
- A browser QA harness, if interactive release verification is required.

These are not invented here; each is precisely the value the code expects.

## 22. ACCEPTED LIMITATION / DEFERRED findings

- DB-level RLS is not implemented; tenant isolation is application-enforced (documented).
- Branding image upload remains a demo/in-memory slice (`BusinessProfilePage`).
- Two migrations share a timestamp prefix (ordering ambiguity; history preserved).
- Frontend bundle-size warning (527 kB).
- No browser QA harness exists.
- `frontend/qa-shot/` static screenshots remain tracked as QA evidence.
- Deferred-by-design requirements REQ-025, REQ-034, REQ-115 remain deferred.

## 23. Test results

Backend:
- `npm test`: **192 passed / 246 skipped**.
- `npm run test:db`: **380 passed / 26 files** — two consecutive clean runs.
- `npm run typecheck`: PASS. `npm run lint`: PASS. `npm run build`: PASS.

Frontend:
- `npm test`: **504 passed / 44 files**.
- `npm run typecheck`: PASS. `npm run lint`: PASS. `npm run build`: PASS
  (existing chunk-size warning remains).

No tests were weakened or removed.

## 24. Browser QA result

**Unavailable.** No Playwright/Cypress/Puppeteer dependency or config exists; only
static screenshots under `frontend/qa-shot/`. No harness was added for this task.

## 25. Final specification hash

```
5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b  docs/WEREFA-COMPLETE-SPECIFICATION.md
```

Unchanged before and after the audit.

## 26. Working-tree status

Files changed by this prompt: `README.md`, `backend/.env.example`, `backend/.gitignore`
(all modified, uncommitted) plus this report (`docs/implementation/46-…`). The broader
working tree still contains the accumulated uncommitted work of prior prompts. No
tracked build artifacts, secrets, or runtime storage were added.

## 27. Confirmation that no commit was created

Confirmed: no `git add`, `git commit`, history rewrite/reset/squash, or push was
performed. HEAD remains `80a69ff`.
