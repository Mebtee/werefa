# 02 — Identity & Authentication (Prompt 08) — Traceability report

Status: **implemented** · Verified against the quality gate on the date of this doc.

## 1. Source-path mapping

Prompt 08 references `docs/requirements/*`; those paths DO NOT exist in this repository
(see `01-foundation-traceability.md` §1). No requirement/architecture doc was renamed;
the authoritative sources used here are:

- Requirements: `docs/01-master-specification.md` §7 (REQ-024 … REQ-035), §8 (REQ-036 … REQ-044), §22 (REQ-191 … REQ-206), §24 (REQ-217 … REQ-221).
- Roles/permissions: `docs/02-user-roles-permissions.md`.
- Architecture: `docs/architecture/14-auth-security-architecture.md`, `18-api-architecture.md`, `22-audit-logging.md`; ADRs `ADR-008-db-sessions.md`, `ADR-010-rest-api.md`.

## 2. What was implemented

### Database (`packages/db`)

- `user` gained identity columns: `failed_login_count`, `is_locked_until`, `disabled_at`, `recovery_email` (Super Admin only).
- New tables `password_reset_token` and `recovery_token` (one-time codes with `expires_at` / `used_at`).
- Migration `20260905_000300_identity` (Prisma, applied to dev DB). RLS model unchanged; tokens are not tenant-scoped and are accessed under the service context.

### IAM module (`apps/api/src/iam`)

- `AuthService` — `login()`: Argon2id verify with a constant-time dummy verify for unknown emails (uniform 401, no enumeration, REQ-033/REQ-024); atomic lockout via `UPDATE … WHERE is_ok OR locked ` pattern with `make_interval(mins => <lock>)` (5 consecutive failures → 15-minute `is_locked_until`, REQ-193/194); successful login resets the counter.
- `SessionService` — opaque random token stored as SHA-256 (ADR-008), `createSession`/`resolveToken`/`revokeSession`/`revokeAllSessions` (REQ-035), `expires_in` server-side.
- `ResetTokenService` — password reset request issues a one-time random token (30-minute TTL) sent by email; each request invalidates previous tokens; completing a reset revokes all sessions and clears the lock (REQ-033, REQ-194, REQ-035).
- `RecoveryService` — Super Admin emergency recovery (REQ-198..200): request sends a one-time base32 code (15-minute TTL) to the SA's distinct `recovery_email`; completion immediately replaces the password and revokes all sessions; single-use.
- `SuperAdminService` — Admin lifecycle (REQ-217, REQ-037/038/039): create/deactivate/list Admin accounts enforcing exactly one Super Admin and exactly two active Admins; **reactivate** a deactivated Admin (prompt 18) with a fresh `ADMIN_REACTIVATE` audit event and outstanding reset tokens revoked; change Admin password (REQ-219); force-logout of Owners/Admins with immediate email (REQ-220/221). Create and reactivate serialize the "count-then-write" check behind a transaction-scoped PostgreSQL advisory key (`pg_advisory_xact_lock`, prompt 18 Task A) so concurrent requests can never exceed two active Admins.
- `ResetTokenService` — password reset request issues a one-time random token (30-minute TTL) sent by email; each request invalidates previous tokens; completing a reset revokes all sessions and clears the lock (REQ-033, REQ-194, REQ-035). Admin accounts never receive a reset link: a request for an Admin records a `PASSWORD_RESET_DENIED` event and returns the same uniform response as a known account (REQ-218, prompt 18 decision).
- `SecurityEventsService` — records `LOGIN_SUCCESS`, `LOGIN_FAILED`, `ACCOUNT_LOCKED`, `UNRECOGNIZED_DEVICE`, `LOGOUT`, `PASSWORD_CHANGED`, `ADMIN_*`, `FORCED_LOGOUT` with date/time, IP, device/browser, result (REQ-191/192/197, feeds REQ-204 retention job).
- `RateLimitService` — sliding-window in-memory limiter per instance for `authRateLimitMax` / `recoveryRateLimitMax` (REQ-030 spirit; auth & recovery surfaces).
- Guards/decorators: `SessionGuard`, `RolesGuard` (hierarchy Owner<Admin<SuperAdmin, REQ-036/041/042), `@Public()`, `@Roles`, `@Actor`.

### API endpoints (`apps/api/src/iam/{auth.controller,super-admin.controller}.ts`)

| Endpoint                                         | Access               | Behavior                                                                                    |
| ------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------- |
| `POST /api/v1/auth/login`                        | public, rate-limited | sets `wrf.sid` HttpOnly cookie; uniform 401 / 423 locked                                    |
| `GET /api/v1/auth/me`                            | session              | actor profile + owned businesses                                                            |
| `POST /api/v1/auth/logout`                       | session              | revoke session, clear cookie                                                                |
| `POST /api/v1/auth/password/change`              | Owner/SuperAdmin     | requires current + new password; revokes all sessions (REQ-035; Admins blocked per REQ-218) |
| `POST /api/v1/auth/password/reset/request`       | public, rate-limited | email reset link (uniform response)                                                         |
| `POST /api/v1/auth/password/reset/complete`      | public, rate-limited | one-time token → new password                                                               |
| `POST /api/v1/super-admin/recovery/request`      | public, rate-limited | code to recovery email                                                                      |
| `POST /api/v1/super-admin/recovery/complete`     | public, rate-limited | one-time code → new SA password                                                             |
| `GET/POST/PATCH … /admin*`                       | SuperAdmin only      | list/create/deactivate/reactivate/change-password/force-logout                              |
| `POST /api/v1/super-admin/admins/:id/reactivate` | SuperAdmin only      | clears `disabled_at`, revokes outstanding reset tokens, records `ADMIN_REACTIVATE`          |

### CSRF defense (doc 18)

- `CsrfGuard` registered globally (APP_GUARD): only non-safe methods with a request session cookie are required to carry header `x-requested-with: fetch`. Public endpoints without a cookie are unaffected; safe methods always pass. Cookie is `HttpOnly` + `SameSite=Lax`.

### Emails (`apps/api/src/notifications`, `apps/api/src/jobs`)

- `PlatformEmailer` (templates: reset link, lockout alert w/ IP+device/browser, forced-logout, **admin welcome**, admin credentials) delivered via `MailService` — in-memory capture in tests; MailHog in dev; BullMQ `platform-email` job in prod. `JobsModule` is `@Global()` so the emailer is injectable from the IAM module. The admin-welcome email never contains the password or a token (prompt 18).

### Dashboard (`apps/dashboard/src`)

- Full sign-in (`Login`), sign-out, password change (Owner/SA only; Admins see a notice), forgot-password request + one-time-link completion (`#/reset/<token>`), and Super Admin emergency recovery (`#/recovery`) via hash routes; API client sends the CSRF header on state-changing requests. Prompt 18 added the Super Admin "Admin accounts" panel (list/create/deactivate/reactivate/change-password/force-sign-out with client-side confirmation) and surfaced `ADMIN_REACTIVATE` in the security-history filter options.

### Dashboard panels (`apps/dashboard/src`)

- `business/AdminAccountsPanel.tsx` — Super Admin-only Admin lifecycle UI (prompt 18): table of Admins with active/deactivated pills, create form (email + temporary password), per-row deactivate/reactivate/change-password/force-sign-out with `window.confirm` confirmation; passwords never persist in UI state and the welcome/password emails never contain them. Backend authorization remains the real boundary.
- `lib/admin-accounts-api.ts` — typed client for the `/api/v1/super-admin/admins*` surface (list/create/deactivate/reactivate/change-password/force-logout).

### Dev seed (`apps/api/src/seed/dev-seed.ts`)

- Idempotent upserts: exactly 1 Super Admin with `recovery-email`, exactly 2 Admins, Owner + 2 businesses.

## 3. Requirement → implementation → test mapping

| Req             | Statement (abbr.)                           | Implementation                                          | Test                                  |
| --------------- | ------------------------------------------- | ------------------------------------------------------- | ------------------------------------- |
| REQ-024         | Phase 1 email/password login                | `AuthService.login`, sessions                           | `identity-login.test.ts` A, Q         |
| REQ-033         | Forgot-password via email reset             | `ResetTokenService` + email                             | `identity-password.test.ts` E,F,G,H,M |
| REQ-035         | Password change logs out everywhere         | `revokeAllSessions`                                     | `identity-password.test.ts` I         |
| REQ-036/041/042 | Role set & hierarchy                        | `RolesGuard`, DB `role` enum                            | `test/unit/roles-guard.test.ts`       |
| REQ-037         | Exactly one Super Admin                     | `SuperAdminService` enforcement                         | `identity-admin-recovery.test.ts` P   |
| REQ-038         | Exactly two admins (active)                 | advisory-lock serialized create/reactivate              | `identity-admin-recovery.test.ts` P   |
| REQ-039         | Only SA manages Admins                      | `@Roles(SuperAdmin)`                                    | `identity-admin-recovery.test.ts` P   |
| REQ-191         | Login success/failure recorded              | `SecurityEventsService`                                 | `identity-login.test.ts` D            |
| REQ-192         | Records include dt/IP/device/browser/result | event fields                                            | D                                     |
| REQ-193         | 5 failures → 15-min lock                    | atomic counter + `make_interval`                        | B                                     |
| REQ-194         | Reset clears lock                           | counter/lock reset on reset                             | F (after lock), B                     |
| REQ-195/196     | Lockout email w/ IP+device/browser          | `PlatformEmailer` lockout template                      | B (mail asserted)                     |
| REQ-197         | Unrecognized device recorded, no email      | UNRECOGNIZED_DEVICE event                               | D, R                                  |
| REQ-198         | SA distinct recovery email                  | `recovery_email` column                                 | K                                     |
| REQ-199         | Recovery sends one-time code                | `RecoveryService` code + email                          | K                                     |
| REQ-200         | Code → immediate password replacement       | `recovery.complete`                                     | L                                     |
| REQ-201..203    | View own/all security history               | recorded in DB (view endpoints = later UX)              | D (recorded)                          |
| REQ-204         | Records retained 1 year                     | retention persistence (`retention-security-events.job`) | foundation                            |
| REQ-217a        | SA creates/deactivates Admins (max 2)       | advisory-lock `createAdmin` + `deactivateAdmin`         | `identity-admin-recovery.test.ts` P   |
| REQ-217b        | SA reactivates a deactivated Admin          | `reactivateAdmin` + `ADMIN_REACTIVATE` event            | P (reactivate)                        |
| REQ-218         | Admin cannot change own password            | forbidden by role (change-password + reset denial)      | J, P (reset denied)                   |
| REQ-219         | SA can change Admin password                | `SuperAdminService` (clears lock, revokes sessions)     | P (pw change)                         |
| REQ-220/221     | SA force-logout + immediate email           | `revokeAllSessions` + email                             | P                                     |

Non-enumeration (uniform 401), rate limiting (429), and CSRF (403/204) are additionally covered by tests C, S/T, and the recovery rate-limit case.

## 4. Test totals (last verified run)

- API unit: **22 passing** (`apps/api/test/unit`).
- API integration: **40 passing** (5 files; 29 identity tests + foundation front-door & RLS suites).
- Dashboard: `typecheck`, `lint`, `vite build` clean. API: `typecheck`, `lint`, prettier clean.
- Run: `npm run test:unit --workspace @werefa/api`; `npm run test:integration --workspace @werefa/api` (rebuilds `werefa_test`), executed with the repo root `.env` sourced.

## 5. Known gaps / deferred (out of Prompt 08 scope)

- Security/activity-history **viewing** endpoints (REQ-201/202/203) and deletion (REQ-205/206) are data-complete (records exist, retention job runs) but have no API/UI yet — deferred to the account-management module.
- Email delivery in tests is in-memory capture; dev uses MailHog. A production SMTP provider is deployment-phase config.
- Rate limiter is per-instance in-memory (REQ-030 spirit); shared backing store is a scaling item (doc 25).
- 2FA (REQ-034) is architecturally ready (session/device metadata, events) but intentionally not enabled (Phase 2).
- Recovery-code email signing (GPG, decisions #12/#19) not applied — logging emission only.
- Registration / email verification / customer flows (REQ-026..031, REQ-040) remain future modules.

## 6. Commands that prove identity

```bash
set -a; . ./.env; set +a
npm run test:unit --workspace @werefa/api
npm run test:integration --workspace @werefa/api   # 40 tests incl. identity suites
npm run database:generate --workspace @werefa/db   # schema up to date
npm run seed:dev --workspace @werefa/api           # 1 SA + 2 Admins + owner, idempotent
npm run typecheck && npm run lint && npm run build # per workspace quality gate
# Dashboard live check: npm run dev:api + npm run dev:dashboard → #/reset, #/recovery,
# login (owner@… / admin@… / superadmin@…), change password (Owner/SA only).
```
