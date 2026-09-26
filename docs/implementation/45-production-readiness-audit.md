# 45 — Werefa Production Readiness & End-to-End Integration Audit

Prompt: **Prompt 61 — Werefa Production Readiness & End-to-End Integration Audit**
Status: **COMPLETE** — audit + a small set of safe, fully-specified gap-hardening fixes
Report date: 2026-09-26
Repository: Werefa (`master`, uncommitted working tree; no commit made)

---

## 1. Objective

Determine whether the currently implemented Werefa system is internally coherent
and technically prepared for real deployment, and close only safe, fully-specified
engineering gaps required for production readiness — without inventing product
features, resolving unresolved product decisions, or redesigning the architecture.

The audit answers: **"Given the current implementation, what prevents Werefa from
being safely deployed and operated as a real system?"**

## 2. Starting specification SHA-256

```
5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b  docs/WEREFA-COMPLETE-SPECIFICATION.md
```

Verified at the start of this prompt and equal to the required digest.

## 3. Ending specification SHA-256

```
5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b  docs/WEREFA-COMPLETE-SPECIFICATION.md
```

Identical to the starting digest. The canonical specification was **not modified**.

## 4. Repository / architecture inventory (Phase 1)

| Area | Present | Notes |
| --- | --- | --- |
| One backend application | Yes | NestJS modular monolith (`backend/`) |
| One frontend application | Yes | React + Vite SPA (`frontend/`) |
| One PostgreSQL database | Yes | Prisma + PostgreSQL 16; roles `werefa_app` (RLS-intent) / `werefa_migrator` (DDL) |
| One lifecycle worker | Yes | `BusinessLifecycleWorker` (completion sweep + scheduled resume) |
| One notification/outbox mechanism | Yes | `NotificationOutboxEventBus` → `NotificationDelivery` rows → `NotificationDeliveryService` sweep |
| One Telegram provider boundary | Yes | `TelegramProvider` port; `HttpTelegramProvider` / `DisabledTelegramProvider` |
| One email provider boundary | Yes | `EmailProvider` port; `DisabledEmailProvider` (no real provider bound) |
| One payment-proof storage boundary | Yes | `PaymentProofStorage` port; `LocalProofStorage` adapter |
| One auth/session mechanism | Yes | Server-side opaque session cookie; `SessionAuthContextResolver`; test bridge gated |

No duplicate schedulers, queues, storage systems, auth systems, or configuration
systems were found. The only production source that imports the demo seam is
`BusinessProfilePage.tsx` (branding) — a documented, deferred-by-design slice (see §23).

Inventory anchors: `backend/src/{app.module.ts,app.setup.ts,main.ts}`,
`backend/src/domain/**`, `backend/src/api/**`, `backend/prisma/migrations/**`,
`backend/scripts/**`, `frontend/src/{api/**,mock/**}`.

## 5. Configuration audit (Phase 2)

Central env parsing: `backend/src/config/app-config.ts` (zod, fail-fast, value-free
errors). Cross-field invariants: `assertConfigInvariants`.

- Required in production: `DATABASE_URL` (enforced). `MIGRATOR_DATABASE_URL`
  required by migration scripts (not by runtime).
- `CORS_ORIGINS`, `BODY_LIMIT`, `TRUST_PROXY`, `AUTH_SESSION_TTL_HOURS`,
  `AUTH_COOKIE_NAME` all validated with safe defaults.
- Telegram: `TELEGRAM_ENABLED` fail-safe false; if true, token/handle/webhook secret
  are required (enforced). Never silently sends.
- Email: no `EMAIL_PROVIDER` credentials supported yet → `DisabledEmailProvider`;
  the boundary is honest (never reports delivered).
- Worker intervals: `BUSINESS_LIFECYCLE_INTERVAL_MS`, `TELEGRAM_DELIVERY_INTERVAL_MS`.
- Storage: `PROOF_STORAGE_DIR` (was **absent** from `.env.example`; fixed — see §27).
- Frontend: only `VITE_API_BASE_URL`; production has no localhost fallback
  (`resolveApiBaseUrl` throws outside dev).
- Six §46 product parameters are exposed as configuration only; no values invented.

**Defects found and fixed:** `CORS_ORIGINS='*'` guard was gated on an unrelated
product flag; production did not fail fast on `AUTH_TEST_ENABLED=true`. See §27.

## 6. Authentication audit (Phase 3)

- Production selector is `SessionAuthContextResolver`: httpOnly cookie → SHA-256
  token hash → valid (non-revoked, non-expired) session row → live, non-deactivated
  user. All failures collapse to a single `UNAUTHENTICATED`.
- The `TestAuthContextResolver` (`X-Actor-Role`/`X-Actor-Id`) is constructed **only**
  when `AUTH_TEST_ENABLED=true` **and** `nodeEnv !== 'production'`, and its
  constructor hard-fails in production. The factory additionally returns the session
  resolver in production even if the flag is set.
- Owner/Admin/Super Admin authentication is server-side; sessions cannot be forged
  from frontend state.
- Logout revokes the session and clears the cookie (idempotent). Password change
  revokes every session (REQ-035); Admins cannot change their own (REQ-218).
  Forced logout/recovery revoke all sessions. Lockout: 5 consecutive failures →
  15 min; recovery codes single-use, hashed, TTL- and attempt-capped. Security
  events persisted (including IP/device/browser). Cookies: httpOnly, SameSite=Lax,
  Secure in production.

Result: **correct**; production cannot select the test resolver. One hardening added
(fail-fast on production `AUTH_TEST_ENABLED=true`).

## 7. Authorization / tenant-isolation audit (Phase 4)

`TenantGuard.requireOwnedBusiness` resolves ownership inside the query path and
returns `NOT_FOUND` for non-members, so existence is not leaked. Owner-scoped
controllers are guarded by `ApiAuthGuard`. Reviewed domains: businesses, services,
schedules, bookings, payment proofs (appointment + subscription), subscriptions,
customer status lookup, Telegram connections, notifications, reports, schedule
conflicts. No client-supplied business id bypasses ownership; notification
recipients are server-derived correlation, not client input. No parallel
authorization introduced.

Residual note: the architecture documents claim DB-level RLS for the `app` role,
but no `ENABLE ROW LEVEL SECURITY` / `CREATE POLICY` statements exist in any
migration — isolation is enforced at the application layer (see §8, §33).

## 8. Database / migration audit (Phase 5)

- 7 migrations under `backend/prisma/migrations/`, plain deterministic SQL
  (portable DDL + app-role grants). No application runtime imports.
- `db:up` / `db:provision` / `prisma:deploy` provision the schema; seed/test
  fixtures are separate (`src/**/*.db.spec.ts` reset their own data).
- `db:reset` is dev-only and never invoked by production code or startup.
- `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES … TO werefa_app` and default
  privileges present; FK/unique/partial indexes preserved in migrations.
- Historical migrations were not modified.

Finding (documented, not modified): two migrations share the timestamp prefix
`20260923120000` (`subscription_proof_submission_key`, `telegram_code_hash_unique`),
making relative ordering ambiguous. Renaming an applied migration would rewrite
history, so this is recorded as an accepted limitation, not changed.

## 9. Payment-proof storage audit (Phase 6)

Two distinct domains (appointment proof and subscription proof) share the storage
boundary but not authorization: each enforces its own tenant/ownership path.
`LocalProofStorage` namespaces keys per business (`<businessId>/<uuid>.<ext>`),
validates key shape (`isSafeKey`) to prevent path traversal, and stages/commits
through the domain. Authoritative file validation is magic-byte sniffing in
`proof-file.ts` (allowed images + PDF, 5 MB cap) — the declared MIME is not trusted.
Proof bytes are never logged; storage keys are opaque and never exposed. The
provider boundary is provider-agnostic and swap-in-able.

Residual: local filesystem storage is durable only if the deployment mounts a
persistent shared volume; this is a deployment-configuration dependency (§35).

## 10. Telegram audit (Phase 7)

- Single `TelegramProvider` port; real `HttpTelegramProvider` and safe
  `DisabledTelegramProvider`. Bot token injected at construction, never logged.
- Webhook secret verified in constant time; mismatches recorded.
- `update_id` exactly-once via `telegram_update` (P2002 = duplicate).
- Connection codes are SHA-256-hashed at rest, 10-minute TTL, single-use,
  bound per business/recipient; redemption is transactional (P2002 → conflict).
- Owner Accept/Reject via structured callback tokens bound to a connection; chat
  binding enforced by the T-09 claim. Customer reminders/notifications flow through
  the outbox; unconnected recipients are SUPPRESSED; failures isolated.
- Production cannot select mock Telegram behavior (mock only via test injection).

## 11. Email audit (Phase 8)

- Single `EmailProvider` boundary + honest `DisabledEmailProvider`
  (`isConfigured()=false`, never reports accepted/delivered).
- No credentials in source; no secrets in logs.
- Outbox integration with retry/backoff, `DEAD_LETTERED` after bounded attempts,
  stale-`SENDING` recovery, idempotency keys, and delivery failure never rolling
  back domain state.
- Absence of an external provider yields SUPPRESSED rows, never false "delivered".

`REQ-198` real recovery-email delivery remains **PARTIAL** pending an external
provider binding. No provider was invented.

## 12. Notification / outbox audit (Phase 9)

`NotificationOutboxEventBus.publish` persists `Notification` + `NotificationDelivery`
inside a transaction with a unique idempotency key; duplicate publishes are P2002
and silently skipped. Domain transaction → outbox persistence → delivery is the
enforced order (no external API inside the domain transaction). Delivery failures are
recorded (bounded retries, dead-lettering, stale-SENDING reclaim) and cannot corrupt
bookings, subscriptions, security state, or schedule state. A disabled channel is
SUPPRESSED at write time. No second queue introduced.

## 13. BusinessLifecycleWorker audit (Phase 10)

- Exactly one worker; starts on `onApplicationBootstrap`, disabled in `test`.
- Timer is `unref()`d and cleared in `onModuleDestroy`.
- Two duties (REQ-102 completion sweep; REQ-153/154/155/231 scheduled resume) run
  on isolated `safeRun` paths so one failure never suppresses the other.
- Rely on the authoritative idempotent, advisory-locked service transitions, so
  concurrent/overlapping sweeps are safe.

**Defect fixed:** `safeRun` previously swallowed every error with no observability.
A minimal, value-free `logger.warn` was added (see §27). No second scheduler created.

## 14. API / error-handling audit (Phase 11)

- Global validation pipe, single error envelope, request IDs (AsyncLocalStorage +
  `X-Request-Id`), helmet security headers, explicit CORS (credentials true).
- `AllExceptionsFilter` maps Prisma/unknown errors to a safe `INTERNAL_ERROR`
  envelope; 5xx logged with correlation, response body never leaks stack traces,
  SQL, tenant data, or internal IDs. Multer/oversize mapped to safe codes.
- Swagger/OpenAPI is enabled only outside production and test.
- `/health` (liveness), `/ready` (reads DB ping; 503 when configured-but-unreachable,
  `disabled` when unconfigured), `/meta` (product metadata + pending clarifications).

## 15. Logging / secrets audit (Phase 12)

Pino structured logging with strict redaction (`authorization`, `cookie`,
`x-api-key`, `x-webhook-secret`, `password`, `passwordHash`, `sessionToken`,
`token`, `set-cookie`). Config errors report field names only (never values).
Reviewed likely-leak sites (session tokens, bot token, recovery codes, DB URL,
proof contents): no sensitive value reaches logs, error responses, or reports.
The new worker logging emits only the error message. No leaks found requiring a fix.

## 16. Frontend production audit (Phase 13)

- Real API client (`frontend/src/api/http.ts`) is used; auth/owner/customer/admin/
  subscription/Telegram paths call real routes. No production fallback to mock APIs
  except the documented branding slice.
- API base URL is environment-driven; production has **no** localhost fallback.
- Requests always send the session cookie (`credentials: 'include'`); a global 401
  handler triggers session-expiry handling; no hard-coded tokens.
- No development-only credentials are bundled (`VITE_*` only, and only the API URL).

## 17. Upload / input hardening (Phase 15)

- Payment proofs: declared-MIME screen + authoritative magic-byte sniff, 5 MB cap,
  opaque server-generated filenames, per-business namespace, path-traversal-guarded
  keys, authorization on read/download, staged vs committed handling.
- No arbitrary client-supplied filesystem paths. Branding image upload remains a
  demo-only, in-memory slice (no backend storage yet).

## 18. Public customer security (Phase 17)

- Public endpoints are scoped under the resolved business slug; customer phone is
  validated against actual business activity for Telegram connect.
- Status lookup does not enumerate unrelated customers/bookings; internal booking
  ids are not used as customer-facing identifiers; errors do not leak internal ids.
- No customer accounts, passwords, or login were introduced.

## 19. Admin / Super Admin security (Phase 18)

Role separation enforced by `TenantGuard.requireAdminOrSuperAdmin` /
`requireSuperAdmin`. Super Admin retains Admin management and privileged
recovery/security operations; Admin cannot access Super-Admin-only data/actions.
Owner booking-report PDF (blocked §46 item 4) was not implemented.

## 20. Docker / deployment audit (Phase 19)

Only `backend/docker-compose.dev.yml` (PostgreSQL 16 for local dev) exists. There are
**no Dockerfiles** for backend/frontend and **no production compose/topology**. This
is a deployment-configuration dependency, not an implementation defect; the report
records the required deployment inputs (§35) rather than fabricating infrastructure.

## 21. Startup / shutdown audit (Phase 20)

Deterministic bootstrap: `loadConfigFromFileSystem` validates config first; Prisma
`$connect` is fail-fast when `DATABASE_URL` is set (redacted, actionable error).
`enableShutdownHooks()`; Prisma disconnects on `OnApplicationShutdown`; both workers
clear timers on destroy; `unref()` prevents timers from holding the process open.
Already-persisted outbox events are never lost by shutdown (durable rows).

## 22. Health / readiness audit (Phase 21)

Liveness (`/health`) is process health only. Readiness (`/ready`) reflects the
required infrastructure (database) and reports `disabled`/503 when the DB is not
configured. It does not depend on optional external providers (Telegram/email), as
the architecture intentionally permits operation without them — e.g. a disabled
email provider does not make the application unready.

## 23. Production mock audit (Phase 22)

Classified all `mock`/`demo`/`fake`/`stub` occurrences:

- **A. Legitimate test-only** — `frontend/src/mock/**` is consumed by tests and
  test fixtures; `@/test/**` fetch stubs. Not production leakage. Retained.
- **B. Development-only** — `TestAuthContextResolver` (gated), dev compose.
- **C. Production fallback** — one: `BusinessProfilePage.tsx` imports `mockOwnerApi`
  for branding (logo/cover). It is explicitly labelled "Demo-only previews" and
  deferred by design (no backend image storage). Recorded as an accepted limitation
  (requires a product/storage decision), not silently removed.
- **D. Dead code** — the legacy `mock/ownerSession` module is proven absent by
  `mockBoundary.test.tsx`. `DisabledEmailProvider`/`DisabledTelegramProvider` are
  intentional safe boundaries, not leakage.

## 24. Transaction / idempotency audit (Phase 23 / 24)

- Booking lifecycle (create, proof submit/accept/reject/resubmit/cancel/reschedule/
  complete/no-show), subscription lifecycle (submit/approve/reject/expire/grace/
  resume), schedule changes/conflicts/Keep Booking, and security flows (login
  failure, lockout, recovery, forced logout) were reviewed.
- External side effects are performed only after the required DB transaction is
  persisted; notifications go through the outbox, never inside the domain commit.
- Idempotency: booking creation, subscription proof submission, subscription
  approval, Telegram webhook (`update_id`), and notification delivery all use
  deterministic, appropriately-scoped, tenant-safe keys (unique constraints), so
  duplicate requests cannot create duplicate business effects. No working mechanism
  was replaced.

## 25. Observability audit (Phase 25)

Request IDs propagate end-to-end; security events, notification delivery state,
and DB failures are logged/recorded; provider failures are surfaced as recorded
delivery states. **Gap fixed:** both background workers previously swallowed sweep
failures with zero observability; a minimal value-free `warn` log was added.

## 26. Findings classified

**Category 1 — SAFE TO FIX NOW (implemented):**
1. `CORS_ORIGINS='*'` invariant was gated on an unrelated product flag → made
   unconditional.
2. Production boot did not fail fast when `AUTH_TEST_ENABLED=true` → invariant added.
3. `BusinessLifecycleWorker` / `NotificationBackgroundWorker` swallowed sweep
   failures with no observability → minimal value-free `warn` logging added.
4. `PROOF_STORAGE_DIR` was used by production code but undocumented in
   `.env.example` → documented.

**Category 2 — REQUIRES PRODUCT DECISION (not implemented):**
- §46 items 1–6 (price, global timezone, reminder lead time, owner booking-report
  PDF, owner "modify" scope, timezone-abbreviation display).
- REQ-094 (affected-booking email), REQ-095 (five-minute grouping, dependent on
  094), REQ-139 (subscription reminders, lead time unresolved).

**Category 3 — DEPLOYMENT CONFIGURATION (documented, not faked):**
- External email provider binding (REQ-198); Telegram credentials + webhook URL;
  explicit `CORS_ORIGINS`; production `VITE_API_BASE_URL`; production DB
  credentials; durable shared proof storage; reverse proxy + TLS / `TRUST_PROXY`;
  Docker/production topology (no Dockerfiles exist yet).

**Category 4 — ACCEPTED LIMITATION:**
- DB-level RLS is documented but not implemented; isolation is application-enforced.
- Branding image upload remains a demo/in-memory slice.
- No general server-side rate limiting beyond lockout/recovery-cap/resubmission-code
  throttling (spec defines none for general API traffic).
- Two migrations share a timestamp prefix (ordering ambiguity).
- Frontend bundle chunk-size warning (527 kB) remains.
- Browser QA harness absent.

## 27. Fixes actually made

| # | File | Change |
| --- | --- | --- |
| 1 | `backend/src/config/app-config.ts` | Made the wildcard-CORS guard unconditional (removed dependency on `ownerBookingReportPdfEnabled`). |
| 2 | `backend/src/config/app-config.ts` | Added production invariant rejecting `AUTH_TEST_ENABLED=true`. |
| 3 | `backend/src/domain/services/business-lifecycle.worker.ts` | Added optional pino `LOGGER`; `safeRun(label, task)` now logs a value-free `warn` on failure. |
| 4 | `backend/src/domain/notifications/notification-background.worker.ts` | Same optional logger + labelled, observable `safeRun`. |
| 5 | `backend/.env.example` | Documented `PROOF_STORAGE_DIR` and its durability requirement. |

## 28. Tests added / changed

- `backend/src/config/app-config.spec.ts`: +2 tests (wildcard CORS rejected
  unconditionally; `AUTH_TEST_ENABLED` rejected in production).
- `backend/src/domain/services/business-lifecycle.worker.spec.ts`: +1 test
  (`safeRun` swallows and logs a failing duty via a logger spy).
- No test was weakened to obtain green results.

## 29. Backend verification

- `npm test`: **192 passed / 246 skipped** (was 189/246; +3 new tests).
- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run build`: PASS.

## 30. DB verification

- `npm run test:db`: **380 passed / 26 files** — run **twice consecutively**, both
  clean (was 379; +1 worker test). Docker had to be started from its stopped state
  to run the suite; no DB verification was skipped.

## 31. Frontend verification

- `npx vitest run`: **504 passed / 44 files**.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run build`: PASS (existing chunk-size warning remains).

## 32. Browser-QA status

**Unavailable.** No Playwright/Cypress/Puppeteer dependency or config exists; only
static screenshots under `frontend/qa-shot/`. No harness was added for this prompt.

## 33. Remaining blockers

- **REQ-094** — affected-booking email producer (undefined canonical contract).
- **REQ-095** — five-minute grouping (dependent on REQ-094).
- **REQ-139** — subscription reminders (lead time unresolved, §46 item 3).
- **Owner booking-report PDF** — scope unresolved (§46 item 4 / §25.3).
- **REQ-198 PARTIAL** — real recovery email delivery pending an external provider.

## 34. Remaining deferred requirements

REQ-025, REQ-034, REQ-115 (correctly absent by design per §12.2/§43). No
reclassification: the report 44 counts (228 IMPLEMENTED, 1 PARTIAL, 3 BLOCKED,
3 DEFERRED) remain accurate against the current repository.

## 35. External deployment dependencies

- PostgreSQL instance + production `DATABASE_URL` (runtime) and
  `MIGRATOR_DATABASE_URL` (migrations); run `prisma migrate deploy`.
- A deployment model: Dockerfiles / production compose / process manager.
- Explicit `CORS_ORIGINS` (frontend origin) and matching `VITE_API_BASE_URL`.
- Durable, shared volume for `PROOF_STORAGE_DIR` (or a real object-storage adapter).
- An approved external `EmailProvider` implementation + credentials (REQ-198).
- Telegram bot token/handle/webhook secret + public webhook URL.
- Reverse-proxy/TLS termination and correct `TRUST_PROXY` setting.

## 36. Final production-readiness assessment

The **codebase production-readiness audit is complete**. The implementation is
internally coherent: authentication is server-side and unbypassable, tenant
isolation is enforced in the application layer, migrations are deterministic and
provisionable, the outbox is durable and idempotent, workers are single-instance,
observable, and cleanly shut down, and errors/secrets are handled safely.

This is an **implementation-correctness** statement, not a deployment-readiness
statement. **Deployment configuration remains required** (DB, storage durability,
CORS/API URLs, Docker topology, reverse proxy). **External provider configuration
remains required** (email; optionally Telegram). **REQ-198 remains partial pending
an external email provider**; **REQ-094/095 remain blocked**; **REQ-139 remains
blocked by the unresolved reminder lead time**; the owner booking-report PDF remains
blocked by unresolved scope. **Browser QA is unavailable.**

## 37. Canonical specification was not modified

Confirmed: `docs/WEREFA-COMPLETE-SPECIFICATION.md` SHA-256 is unchanged before and
after the audit (`5494658e…b0ff00b`).

## 38. No commit was made

Confirmed: no `git add`, `git commit`, history rewrite, reset, squash, or push was
performed. Only the five files in §27 were edited/added, plus this report.
