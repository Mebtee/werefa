# Implementation Report 23 — Backend Authentication, Authorization & Security Layer

Prompt 43: replace the Prompt 42 test-only authentication bridge with a real,
production-grade authentication, authorization and security layer for the Werefa
backend — identity, login/logout, server-side revocable sessions, role-based
authorization (Business Owner / Admin / Super Admin), tenant-context resolution,
account lockout, Super Admin emergency recovery, admin account lifecycle, security
event / audit history — wired into the existing Prompt 41 services and Prompt 42
HTTP API, and proven with non-DB contract tests plus live-PostgreSQL DB-gated tests.

The authoritative spec (`docs/WEREFA-COMPLETE-SPECIFICATION.md`) is byte-unchanged.

---

## 1. Objective

Give the backend a real authentication boundary. Prompt 42 deliberately deferred real
auth: the only actor source was the `TestAuthContextResolver` behind
`AUTH_TEST_ENABLED`. Prompt 43 removes that as the production path and introduces:

- credential verification (argon2 password hashing) and identity lookup;
- server-side, revocable, httpOnly-cookie sessions with opaque tokens hashed at rest;
- role authorization for Owner, Admin and Super Admin (Customers never authenticate);
- owner tenant-context resolution reusing the existing `TenantGuard` services;
- exactly-5-failures → 15-minute lockout (REQ-193) cleared on password reset (REQ-194);
- Super Admin only, one-time, hashed emergency recovery codes (REQ-198–200);
- exactly-two-Admin lifecycle with Super Admin management (REQ-037/038, 201–206);
- a security history / audit trail (REQ-203) and `DEVICE_FIRST_USE` detection.

Scope, tests and reporting follow Prompt 43 exactly. Frontend integration, real email,
Telegram, real payment/storage, billing and actual 2FA remain deferred (2FA is Phase 2,
architecture-ready only).

## 2. Work Completed

- **Auth module + controllers** — `AuthModule` provides the auth repositories, services
  and controllers; `ApiModule` imports it. Routes are versioned under the existing
  `api/v1` prefix.
- **Password hashing boundary** — `src/auth/password-hash.ts` wraps `argon2`; hashes are
  never logged or returned; DTO/response projections never include `passwordHash`.
- **Opaque tokens** — `src/auth/token-utils.ts` generates a cryptographically strong
  token and derives its sha-256 hex hash; only the hash is persisted (unique index
  `session_token_hash_key`). `src/auth/cookie-utils.ts` handles the `werefa_session`
  cookie (httpOnly, SameSite=Lax, `Secure` only in production).
- **Session repository** — `prisma-session.repository.ts`: create, `findValidByTokenHash`
  (rejects revoked/expired), revoke one, `revokeAllByUserId`, count active, delete
  expired/revoked, delete by user.
- **Identity repository** — `prisma-user-auth.repository.ts`: email lookup,
  `recordSuccess` (clears failed counter/lockout), `incrementFailedLoginAttempts`,
  `setLockedUntil`, `updatePassword` (clears lockout), `countByDevice`.
- **Auth service** — `auth.service.ts`: login (constant-time-ish generic failure,
  lockout window, `LOGIN_SUCCESS` / `LOGIN_FAILED` / `ACCOUNT_LOCKED` / `DEVICE_FIRST_USE`
  security events), logout (idempotent), password change (invalidates all sessions),
  `GET /auth/security` self history.
- **Recovery service + repository** — `recovery.service.ts` /
  `prisma-emergency-recovery.repository.ts`: Super-Admin-only request, hashed one-time
  code with TTL and attempt cap, atomic single-use `consume`, `incrementAttempts`, expiry.
- **Admin management service** — `admin-management.service.ts`: list, create (cap 2,
  serialized with a Postgres advisory lock inside a transaction), deactivate (frees a
  slot), reset password, self-protection (no self force-logout), Super Admin
  force-logout, `GET /admin/security-history` (REQ-203), audited deletions.
- **Authorization** — reused `src/domain/authorization/tenant-guard.ts` and
  `actor-context.ts` (`requireOwnedBusiness` → owner-only, 404 on non-membership;
  `requireAdminOrSuperAdmin`; `requireSystem`), plus role checks in the auth services.
- **DB-level defense-in-depth** — `user_one_super_admin_idx` partial unique index
  (REQ-037) and auth CHECK constraints (`session_expires_after_created`,
  `session_token_hash_hex`, `emergency_recovery_code_hash_hex`,
  `emergency_recovery_attempts_nonnegative`).
- **Tests** — 11 non-DB auth HTTP contract tests (`http-auth.spec.ts`), 53 DB-gated auth
  HTTP integration tests (`http-auth.db.spec.ts`), 28 DB-gated repository/schema
  invariant tests (`auth.db.spec.ts`), plus 3 small unit specs for cookie/token/hash
  helpers.
- **Verification** — backend lint/typecheck/build, non-DB suite, DB-gated suite ×2,
  `prisma migrate status`, spec diff empty, HEAD unchanged, no commit made.

## 3. Decisions Made and Their Rationale

| Decision | Rationale |
|---|---|
| Server-side sessions with opaque tokens (not JWT) | spec §20 requires revocable sessions; logout / force-logout / password change must invalidate immediately, which stateless JWT cannot do cleanly |
| Persist only the sha-256 token hash | a database read must not yield a usable session token; token is high-entropy so a fast hash is sufficient (no password-style KDF needed) |
| httpOnly, SameSite=Lax cookie; `Secure` only in production | prevents JS token theft and CSRF while keeping local http development usable |
| `AUTH_TEST_ENABLED` retained but strictly `nodeEnv !== 'production'` | keeps the Prompt 42 test bridge for deterministic tests; production cannot be spoofed by `X-Actor-*` headers (asserted by a test) |
| Exactly-5-failures / 15-minute lockout as named constants | REQ-193 values are specified; constants prevent drift and are asserted by DB tests |
| Admin creation serialized with `pg_advisory_xact_lock` in a transaction | the "exactly 2 Admins" cap is a cross-row invariant; a plain count-then-insert races, so creation takes a transaction-scoped advisory lock and re-counts inside |
| Super Admin uniqueness enforced by a partial unique index | REQ-037 is a hard invariant; a Prisma schema cannot express partial indexes, so it is a hand-augmented migration (DB-level defense-in-depth on top of the application rule) |
| Recovery codes: one-time, hashed at rest, TTL + attempt cap, atomic consume | REQ-198–200; `consume` is a single conditional `UPDATE ... WHERE used_at IS NULL`, so concurrent confirms cannot both succeed |
| Reuse Prompt 42 `AuthContextResolver` seam; add `SessionAuthContextResolver` | one auth boundary; HTTP layer and controllers stay resolver-agnostic, and the test bridge and real auth are disjoint |
| Thin controllers; all rules/transactions in services/repositories | matches Prompt 41/42 layering; HTTP tests re-verify rules through the boundary |

## 4. Scope Guard Rails (verified)

Not implemented (as instructed): frontend integration, real email delivery, Telegram,
external payment / file storage, subscription billing/approval, deployment/CI, and actual
two-factor authentication (2FA is Phase 2 — architecture readiness only). Customers never
authenticate. The six unresolved Product Owner decisions in spec §46 remain unresolved and
un-invented; Prompt 38 Item 6 remains dropped. No commit was made.

## 5. Authentication Model

- Credential = email + password. Email is normalized (trim + lowercase) on write and
  lookup; uniqueness is enforced at the database (`user_email_key`).
- Passwords are hashed with argon2 (`src/auth/password-hash.ts`); verification is the only
  read of a hash.
- A successful login mints a session: opaque token (returned only as a Set-Cookie),
  sha-256 hash persisted with ip/device/browser, `created_at`, `expires_at`
  (`AUTH_SESSION_TTL_HOURS`, default 12), `revoked_at` null.
- Every request resolves the cookie → token hash → valid session (not revoked, not
  expired) → `ActorContext` (role + user id) → controller/service authorization.

## 6. Login and Logout Flow

- `POST /auth/login` validates the body via the shared DTO pipe; on success it records a
  `LOGIN_SUCCESS` event (and `DEVICE_FIRST_USE` on a previously unseen device), resets the
  failed counter and sets the session cookie.
- Failure to authenticate (wrong password **or** unknown email) returns the same generic
  `UNAUTHENTICATED` 401 — no user enumeration. Deactivated users also fail 401.
- `POST /auth/logout` is idempotent and unguarded: it always returns 204 and revokes the
  presented session if any (no error when already logged out).

## 7. Account Lockout (REQ-193 / REQ-194)

- Five consecutive failures (`MAX_FAILED_LOGIN_ATTEMPTS`) set `locked_until = now + 15
  minutes` (`LOCKOUT_DURATION_MINUTES`). Each failure increments the counter and records a
  `LOGIN_FAILED` event; the lockout is recorded as `ACCOUNT_LOCKED` and returns 423.
- A correct password during the window still returns 423 until the window expires.
- A successful login after expiry resets counter and lockout (`recordSuccess`).
- A password reset/change clears the lockout and the failed counter (`updatePassword`).
- The failed-login increment is a single atomic SQL `UPDATE ... RETURNING`, so concurrent
  failures cannot lose increments (covered by the DB suite).

## 8. Password Change and Session Invalidation

- `POST /auth/password/change` requires the current password, stores the new argon2 hash,
  clears the lockout/counter, and revokes **all** sessions for the user (including the
  current one), so the client must log in again.
- Admins cannot change other users' passwords via this route (403); Admin/Super Admin
  password resets go through the admin lifecycle endpoints.

## 9. Super Admin Emergency Recovery (REQ-198–200)

- `POST /auth/recovery/request` — Super Admin only. Generates a code
  (`AUTH_RECOVERY_CODE_LENGTH`, default 6 digits), stores only its sha-256 hash with
  `expires_at` (`AUTH_RECOVERY_TTL_MINUTES`, default 15), and emits an event for
  out-of-band delivery. The code is never returned in the HTTP response.
- `POST /auth/recovery/confirm` — verifies a non-expired, unused, non-discarded code.
  Attempts increment atomically; exceeding `AUTH_RECOVERY_MAX_ATTEMPTS` (default 5)
  discards the code. A valid confirm is a single atomic consume, so concurrent confirms
  produce exactly one success (DB test).
- Success resets the account lockout (REQ-194) and allows setting a new password.

## 10. Admin Account Lifecycle (REQ-037 / REQ-038 / 201–206 / 217–221)

- `GET /admin/admins` lists Admin accounts with active-session counts (no hashes/secrets).
- `POST /admin/admins` creates an Admin; the platform allows exactly two
  (`MAX_ACTIVE_ADMINS`). A third is rejected 409; duplicate email is 400.
- `POST /admin/admins/:id/deactivate` deactivates an Admin and frees a slot.
- `POST /admin/admins/:id/password` resets an Admin password.
- `POST /admin/users/:id/force-logout` revokes a user's sessions; Admin may only target
  non-Super-Admin users; self force-logout is forbidden (403).
- All admin mutations are recorded in the audit trail.

## 11. Super Admin Uniqueness (REQ-037)

Enforced at two levels: the application never creates a second Super Admin, and migration
`20260917214731_add_super_admin_uniqueness` adds

```sql
CREATE UNIQUE INDEX "user_one_super_admin_idx" ON "user" ("role") WHERE "role" = 'SUPER_ADMIN';
```

so a second `SUPER_ADMIN` row cannot exist even via raw SQL. The DB suite asserts the
second insert is rejected.

## 12. Authorization / Role Matrix

| Capability | Owner | Admin | Super Admin | Customer |
|---|---|---|---|---|
| Authenticate (session) | yes | yes | yes | never |
| Own-business routes | own only (404 otherwise) | no | no | public routes only |
| Admin management / force-logout | no | limited (non-SA targets) | yes | no |
| Emergency recovery | no | no | yes | no |
| Security history (self) | yes | yes | yes | no |

Contract tests assert each cell (e.g. Admin receives 403 on admin-management mutations
that only the Super Admin may perform; Owner receives 404 — not 403 — on another owner's
business to avoid resource enumeration).

## 13. Tenant Guard and Tenant Context

Owner requests resolve an `ActorContext` (role + user id) from the session, then
`requireOwnedBusiness` resolves the owner's membership for the target business. A
non-member gets 404 (indistinguishable from a missing resource). `GET /owner/businesses`
returns only the caller's businesses (a bare array). The DB suite verifies membership
resolution and that a second owner sees none of the first owner's businesses.

## 14. Security Events and Audit Trail (REQ-203)

- `security_event` records actor (nullable for unauthenticated failures), event type,
  ip/device/browser, and `created_at`; the API lists newest-first with a stable ordering
  on `createdAt`.
- Event types include login success/failure, lockout, device first use, recovery request/
  failure/success, password change, session revocation and admin actions.
- `GET /auth/security` returns the caller's own history; `GET /admin/security-history`
  returns platform history (Super Admin). Retention constant
  `SECURITY_HISTORY_RETENTION_MONTHS = 12` with `deleteOlderThan` exercised by the DB
  suite.

## 15. Test-Only Bridge vs Production Boundary

`authContextResolverFactory` selects:
- `TestAuthContextResolver` only when `AUTH_TEST_ENABLED=true` **and**
  `nodeEnv !== 'production'` (reads `X-Actor-Role` / `X-Actor-Id`);
- `SessionAuthContextResolver` otherwise.

`new TestAuthContextResolver({ nodeEnv: 'production' })` throws
`/never be used in production/`. A non-DB contract test proves that with
`AUTH_TEST_ENABLED=false` a spoofed `X-Actor-*` header yields 401, i.e. the bridge and real
session auth are disjoint and production cannot be spoofed.

## 16. Error → HTTP Mapping

| Error | HTTP |
|---|---|
| `VALIDATION_ERROR` | 400 |
| `UNAUTHENTICATED` | 401 |
| `TOKEN_EXPIRED` | 401 |
| `FORBIDDEN` | 403 |
| `NOT_FOUND` | 404 |
| `CONFLICT` | 409 |
| `ACCOUNT_LOCKED` | 423 |

All responses use the existing single envelope
`{ error: { code, title, detail, fields } }` (Prompt 39/42). Login failures intentionally
collapse to generic `UNAUTHENTICATED` to avoid user enumeration.

## 17. Configuration

`.env.example` documents the auth block (`AUTH_SESSION_TTL_HOURS=12`,
`AUTH_RECOVERY_TTL_MINUTES=15`, `AUTH_RECOVERY_MAX_ATTEMPTS=5`,
`AUTH_RECOVERY_CODE_LENGTH=6`, `AUTH_COOKIE_NAME=werefa_session`, `AUTH_TEST_ENABLED=false`).
`app-config.ts` validates and exposes them; production requires `DATABASE_URL`. The six
spec §46 product parameters remain empty/unresolved.

## 18. Schema and Migration Changes

Two migrations added (both applied to `werefa_dev`; migration status up to date):

- `20260916162616_add_auth_session_recovery` — `session`, `emergency_recovery`,
  `security_event`, `audit_event` tables, indexes and CHECK constraints, plus grants.
- `20260917214731_add_super_admin_uniqueness` — the partial unique index for REQ-037.

The auth CHECK constraints are intentionally DB-enforced (e.g. `expires_at > created_at`,
64-hex hash formats, non-negative attempts) and are asserted by the DB suite.

## 19. Test Infrastructure Notes

- DB-gated specs live under `src/database`, `src/domain`, `src/api`; `npm run test:db` runs
  them with `RUN_DB_TESTS=true` and `--fileParallelism=false` (one shared `werefa_test`
  database).
- `createTestApp({ env, database })` boots a real Nest app against the real Prisma port
  (`bufferLogs: true`, `LOG_LEVEL=silent`) so HTTP tests exercise the genuine wiring.
- The **test database had to be brought up to date**: it only had the first auth
  migration and carried a stale failed-migration marker from an earlier app-role attempt.
  It was repaired and `prisma migrate deploy` was run against `TEST_DATABASE_URL` as the
  migrator role, applying `20260917214731_add_super_admin_uniqueness`. Without this the
  Super Admin uniqueness test silently passed the wrong way (second insert resolved).
- Expired-session fixtures must not insert `expires_at` in the past (the CHECK
  `expires_at > created_at` forbids it); the DB test helper instead creates a valid future
  session and shifts both `created_at` and `expires_at` into the past via raw SQL.

## 20. Tests Written — Non-DB

`src/api/http-auth.spec.ts` (11): login/recovery DTO validation → 400 `VALIDATION_ERROR`;
401 without a cookie; spoofed `X-Actor-*` headers rejected when `AUTH_TEST_ENABLED=false`;
and resolver-selection unit tests (`authContextResolverFactory` → session resolver in
production; `new TestAuthContextResolver({ nodeEnv: 'production' })` throws; the test
bridge is only used for non-production + enabled).

`src/auth/cookie-utils.spec.ts`, `src/auth/token-utils.spec.ts`,
`src/auth/password-hash.spec.ts`: cookie parsing/serialization, token generation +
sha-256 hashing, argon2 hash/verify round-trips.

## 21. Tests Written — DB-Gated HTTP (53)

`src/api/http-auth.db.spec.ts` covers, end to end against live PostgreSQL:
real login/logout per role; generic 401 (wrong password == unknown email); deactivated
401; `LOGIN_SUCCESS` events; lockout 1–5 + 15-minute window + expiry + race-safe
concurrency; password change + all-session invalidation + failed-attempt reset + admin
403; recovery request/confirm/expired/reused/attempt-cap/clears-lockout; admin
list/create(2)/409/duplicate-400/deactivate+slot/reset-password/self-403/
security-history-delete-audited; force logout (Super Admin ok; Admin/Owner/self 403);
tenancy isolation (`GET /owner/businesses` returns a bare array); role gating;
`DEVICE_FIRST_USE`; secret hygiene (no hashes/tokens in responses); and the dev-only test
bridge being disjoint from session auth.

## 22. Tests Written — DB-Gated Repository / Schema (28)

`src/domain/auth.db.spec.ts` asserts repository and schema invariants directly: identity
uniqueness and email normalization; single-`SUPER_ADMIN` partial index; multiple
admins/owners; argon2 hash metadata; `updatePassword` clears lockout; session
persistence/revocation/expiry/count/delete/count-active; `revokeAllByUserId` scope; atomic
attempt increment + `recordSuccess` reset + `setLockedUntil`; recovery create/
`findActive`/`incrementAttempts`/atomic single-use consume/concurrent consume/expired/
`expireAll`; admin cap + 5-way concurrent create serialized to exactly 2 + deactivate frees
slot + `setRecoveryEmail` normalization; security events list/count by device/null user/
`deleteOlderThan`; audit-event persistence; tenant membership resolution.

## 23. Bugs Found and Fixed by These Tests

1. **Failed-login / lockout path returned 500 (uuid vs text).**
   `prisma-user-auth.repository.ts` `incrementFailedLoginAttempts` compared a `@db.Uuid`
   column to an untyped parameter. Prisma binds JS strings as `text`, so PostgreSQL raised
   `operator does not exist: uuid = text`. Fixed with `WHERE "id" = ${userId}::uuid`.
   This broke the entire lockout feature; the DB suite now exercises it.
2. **Recovery confirm returned 500 (uuid/text and timestamptz).**
   `prisma-emergency-recovery.repository.ts` had the same cast gap in `incrementAttempts`
   and `consume`. Fixed with `::uuid` for the id and `::timestamptz` for `used_at`.
3. **`DEVICE_FIRST_USE` could never fire.**
   `auth.service.ts` counted prior logins for the device **after** inserting the current
   `LOGIN_SUCCESS` row, so the count was always ≥ 1. Fixed by counting before the insert:
   `const isNewDevice = !!input.client.device && (await this.securityRepo.countByDevice(...)) === 0;`

Additionally, the shared test database was found to be missing the second migration and
to carry a stale failed-migration row; both were repaired (see §19).

## 24. Test Run Transcripts — Backend (non-DB)

`npm test`:

```
Test Files  17 passed | 6 skipped (23)
Tests       98 passed | 147 skipped (245)
```

(The 6 skipped files are the DB-gated specs; the DB-gated test count is reported in §25.)
`npm run lint` → clean (0 warnings). `npm run typecheck` → clean. `npm run build`
(`nest build`) → success.

## 25. Test Run Transcripts — Backend (DB-gated ×2)

`RUN_DB_TESTS=true TEST_DATABASE_URL=.../werefa_test npx vitest run src/database src/domain src/api --fileParallelism=false`:

```
Run 1: Test Files 12 passed (12)   Tests 192 passed (192)
Run 2: Test Files 12 passed (12)   Tests 192 passed (192)
```

Deterministic across runs. `prisma migrate status` → 3 migrations found, database schema up
to date. `prisma generate` succeeds.

## 26. Frontend Regression Summary (untouched)

No frontend files were modified — `git status` lists no `frontend/**` entries, so the
frontend tree is byte-identical to HEAD. Gates: `npm run typecheck` pass, `npm run lint`
pass, `npm run build` pass. `npm test` → 14 files passed / 1 failed, 274 tests passed /
1 failed.

The single failure is **pre-existing and unrelated to Prompt 43**:
`src/features/owner-portal/OwnerPortal.test.tsx` › "schedule conflicts (…)" › "exceptions
are attributed to the schedule version that caused the conflict and are not re-flagged
later" — `expected [ { id: 'cnf-0q7lb2s1b', …(7) } ] to deeply equal []` (the assertion at
line 982). It reproduces deterministically, including when run in isolation, against the
unchanged HEAD file. It must be triaged as a separate owner-portal/scheduling issue; it is
out of scope for this backend-auth prompt, whose change set cannot affect it.

## 27. Documentation Written

- `docs/implementation/23-backend-authentication-authorization-and-security-report.md`
  (this file).
- `.env.example` documents the auth configuration block.
- The authoritative spec is untouched (bytes unchanged; see §31).

## 28. Concurrency / DB-Schema Interaction Notes

- Admin creation and the two-Admin cap rely on `pg_advisory_xact_lock` inside a
  `$transaction`, so N concurrent creates yield exactly 2 Admins (DB test asserts 5-way
  concurrency → exactly 2).
- Recovery code confirmation is a single conditional `UPDATE ... WHERE used_at IS NULL`
  returning a boolean; concurrent confirms cannot both succeed.
- Failed-login increment is atomic (`UPDATE ... RETURNING`), so concurrent failures are
  all counted, making the 5-attempt threshold reliable under races.
- DB CHECK constraints (`expires_at > created_at`, hex-hash formats, non-negative
  attempts) protect invariants even against non-application writers.

## 29. Deployment / Production Build Notes

`nest build` (tsc) emits full decorator metadata, so DTO validation behaves identically in
production and tests. In production the resolver factory returns the session resolver (the
test bridge is impossible), and requests without a valid session cookie receive 401.
`loadAndValidateConfig` requires `DATABASE_URL` when `NODE_ENV=production`. The auth
configuration is validated at boot. `scripts/prisma-migrate.mjs` spawns `npx` with
`shell: true` (required on Windows; emits a Node `DEP0190` deprecation warning, cosmetic).

## 30. Outstanding Spec §46 Decisions (unchanged)

Unresolved and un-invented: subscription price REQ-125, global timezone REQ-222, reminder
lead REQ-139, owner report PDF REQ-142, owner-modify scope REQ-152, timezone-abbreviation
display REQ-221. No per-user timezone was added. Real email, Telegram, file storage,
external payments, billing/approval, frontend integration and actual 2FA remain deferred.

## 31. Risk Register

| Risk | Status / mitigation |
|---|---|
| Session token theft | httpOnly cookie, token hash at rest, revocable sessions |
| User enumeration via login | generic 401 for wrong password == unknown email (tested) |
| Brute force | 5-failure/15-minute lockout, atomic counter, 423; tested incl. concurrency |
| More than one Super Admin | partial unique index + application rule; tested at DB level |
| More than two Admins under concurrency | advisory-lock transaction re-counting inside; 5-way concurrency test |
| Recovery code replay | one-time hashed codes, atomic consume, TTL, attempt cap; tested |
| Production actor spoofing via headers | bridge disabled unless non-prod + enabled; non-DB test proves 401 |
| Test bridge used accidentally in prod | constructor throws when `nodeEnv === 'production'` |
| Test DB drifting from migrations | repaired; `migrate deploy` applied; Super Admin test now meaningful |
| Pre-existing owner-portal test failure | documented (§26); out of scope, owned separately |

## 32. Non-Goals and Deferred Work

Frontend integration, real email delivery, Telegram delivery, external payment / file
storage, subscription billing/approval, deployment/CI-CD, customer platform accounts,
per-user timezone, and actual 2FA (Phase 2 readiness only). Manual booking `COMPLETE`
remains intentionally absent.

## 33. Files Changed or Added

Added (new):
- `src/auth/auth.module.ts`, `src/auth/client-info.ts`, `src/auth/cookie-utils.ts`,
  `src/auth/token-utils.ts`, `src/auth/password-hash.ts`
- `src/auth/controllers/auth.controller.ts`, `recovery.controller.ts`,
  `admin.controller.ts`, `auth.dto.ts`
- `src/auth/cookie-utils.spec.ts`, `token-utils.spec.ts`, `password-hash.spec.ts`
- `src/domain/services/auth.service.ts`, `recovery.service.ts`,
  `admin-management.service.ts`, `auth-constants.ts`, `auth-errors.ts`
- `src/domain/repositories/`: `session.repository.port.ts`,
  `prisma-session.repository.ts`, `user-auth.repository.port.ts`,
  `prisma-user-auth.repository.ts`, `emergency-recovery.repository.port.ts`,
  `prisma-emergency-recovery.repository.ts`, `security-event-auth.repository.port.ts`,
  `prisma-security-event-auth.repository.ts`, `audit-event-auth.repository.port.ts`,
  `prisma-audit-event-auth.repository.ts`
- `src/api/http-auth.spec.ts`, `src/api/http-auth.db.spec.ts`
- `src/domain/auth.db.spec.ts`
- `prisma/migrations/20260916162616_add_auth_session_recovery/`,
  `prisma/migrations/20260917214731_add_super_admin_uniqueness/`

Modified:
- `src/api/api.module.ts`, `src/api/auth/auth-context.ts`,
  `src/api/auth/api-auth.guard.ts`
- `src/app.module.ts`, `src/config/app-config.ts`
- `src/domain/domain.module.ts`, `src/domain/domain-services.module.ts`,
  `src/domain/repositories/tokens.ts`, `src/domain/events/domain-events.ts`
- `prisma/schema.prisma`, `.env.example`, `package.json`, `package-lock.json`,
  `scripts/prisma-migrate.mjs` (Windows `shell: true` fix)

## 34. Test Command Inventory

- Non-DB: `npm test` (vitest; DB-gated files auto-skip).
- DB-gated: `npm run db:up`, `npm run db:provision`, then `npm run test:db`.
- Manual single spec: `RUN_DB_TESTS=true TEST_DATABASE_URL=... npx vitest run <spec> --fileParallelism=false`.
- Lint: `npm run lint`. Typecheck: `npm run typecheck`. Build: `npm run build`.
- Prisma: `npm run prisma:generate`, `npm run prisma:status`.
- Frontend: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

## 35. Prisma / Migration Status

3 migrations found (init domain schema, add auth session/recovery, add super admin
uniqueness); `werefa_dev` schema up to date; both auth migrations also applied to
`werefa_test` (after the repair in §19). `prisma generate` succeeds.

## 36. How the Prompt 42 Baseline Was Preserved

The Prompt 42 HTTP API, DTO validation pipe and single error envelope are reused unchanged;
controllers remain thin. The `AUTH_CONTEXT_RESOLVER` seam is preserved and extended (a new
`SessionAuthContextResolver` is added; the test bridge behaves as before but is now
strictly non-production). No Prompt 41/42 service semantics were altered; the three fixes
in §23 are auth-internal bugs and the `DEVICE_FIRST_USE` ordering correction, which only
affects the new auth path.

## 37. Spec-Conformance Statement

Session-based revocable authentication, 5-failure/15-minute lockout (REQ-193) cleared on
reset (REQ-194), Super-Admin-only one-time hashed recovery (REQ-198–200), exactly one
Super Admin (REQ-037) and exactly two Admins (REQ-038), Super Admin admin-management and
force-logout (REQ-201–206, 217–221), security history (REQ-203), owner tenant scoping,
customer non-authentication, and out-of-band recovery delivery with no code in the
response all follow the canonical spec and the Prompt 43 instructions. The authoritative
specification file was not modified.

## 38. Git State

HEAD is unchanged at `ba7648895a9b81abeeed5e11593f61550ab50106` ("feat(backend): add HTTP
API and contract layer"). The working tree contains only this prompt's backend changes
(added files in §33, modified files in §33, the two migrations, and the report in §27); no
`frontend/**` file is modified. **No commit was made** (the integration agent commits).

## 39. Final Verification Matrix

| Gate | Result |
|---|---|
| `npm run lint` (backend) | pass (0 warnings) |
| `npm run typecheck` (backend) | pass |
| `npm run build` (backend, `nest build`) | pass |
| `npm test` (backend, non-DB) | 98 passed, 147 skipped |
| `npm run test:db` (×2) | 192 passed / 0 failed each run |
| `npm run prisma:status` | 3 migrations; schema up to date |
| `npm test` (frontend) | 274 passed, 1 pre-existing failure (§26) |
| `npm run typecheck` / `lint` / `build` (frontend) | pass / pass / pass |
| Spec diff | empty (byte-unchanged; sha256 `5494658e…b0ff00b`) |
| Git | HEAD `ba76488` unchanged; no commit |

## 40. Audit Findings

1. Three real defects were latent in the new auth code and were caught and fixed by the
   DB-gated tests: two uuid/text raw-SQL cast errors (lockout increment; recovery
   increment/consume) that returned 500, and a `DEVICE_FIRST_USE` ordering bug that made
   the event unreachable (§23).
2. The shared `werefa_test` database was stale — it lacked the Super Admin uniqueness
   migration and held a failed-migration marker, which would have made a security test
   pass without actually testing the invariant. Repaired by deleting the marker and
   deploying the migration as the migrator role (§19).
3. A pre-existing, deterministic frontend test failure exists at HEAD in the owner portal
   scheduling suite, unrelated to and unaffected by this backend prompt; documented for
   separate triage (§26).
