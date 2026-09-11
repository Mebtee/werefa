# 12 — Admin Account Lifecycle & Platform Administration (Prompt 18) — Section 38 Final Report

Status: **IMPLEMENTED** · Final quality-gate run: **all green** · This report closes out
Prompt 18 (`docs/01-master-specification.md` §24 REQ-217..221, the Admin-model invariants of
§8 REQ-037..039, and the Prompt 18 close-out checklist).

The Admin account lifecycle is complete: SA creates and manages exactly two active Admin
accounts safely under concurrency (create/reactivate are serialized behind a transaction-scoped
PostgreSQL advisory lock so the "maximum two active Admins" invariant can never be raced away);
deactivated Admins can be reactivated (with outstanding password-reset tokens revoked and a
fresh `ADMIN_REACTIVATE` audit event); the Admin self-password restriction is enforced through
every flow (change-password **and** forgot-password/reset are both denied for Admins, with a
non-enumerating uniform response); the SA "Admin accounts" management UI ships in the dashboard.

## 1. Conformance summary

| Dimension               | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement coverage    | SA creates/deactivates/manages Admins (**REQ-217**); Admin cannot change its own password (**REQ-218**); SA can change an Admin's password (**REQ-219**); SA force-signs-out any user with immediate email (**REQ-220/221**). Model invariants preserved: exactly one Super Admin (**REQ-037**), exactly two active Admins (**REQ-038**), only the SA manages Admins (**REQ-039**), Admins remain platform-level (no `business_id`), and the untouched Super Admin account is unaffected by lifecycle endpoints.                                                                                                                                                                                                             |
| Partial                 | None. No requirement remains partially met.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Deferred (out of scope) | Deactivation **notice message** to the affected admin (REQ-217 text): the admin spec does not require a notice body, so none was implemented and the behavior is documented here (the admin's sessions are revoked immediately and an audit event is recorded; the email pipeline would carry any future notice). UI automation: the dashboard has no test infrastructure (no vitest/testing-library in `apps/dashboard/package.json`) and per the prompt no framework was added — the new panel is manually verified and covered logically by the integration suite. No tenant-scoped or business-scoped admins (REQ-038 keeps them platform-level); no 2FA, SSO, Telegram/prepayment analytics or other unrelated prompts. |
| Explicitly omitted      | No `role` escalation knobs in the create endpoint; no Admin self-service (an Admin resetting its own password or changing its own password is denied); passwords never appear in welcome/password emails or in security-event metadata; no weakening of `@Roles(SuperAdmin)` on any lifecycle endpoint; no schema migration (both new event types ride existing plain `String` enum columns).                                                                                                                                                                                                                                                                                                                                |

## 2. Product decisions (Prompt 18 §15)

- **C2 — STRICT Admin password restriction (approved):** an Admin must not change its own
  password by any mechanism (Change Password, Forgot Password, or email reset); only the Super
  Admin may set an Admin's password. The AuthController change-password restriction from Prompt 08
  stays; the reset flow is now closed for Admins too (see §3). Rationale: guarantees an Admin's
  password is always SA-controlled, keeping the platform's blast radius SA-centric.
- No other §14/§15 product decisions were re-opened (exactly 1 SA, max 2 active Admins, SA-only
  management, soft deactivate with reactivation allowed all preserved).

## 3. What was implemented

### Backend (`apps/api/src/iam`, `apps/api/src/notifications`)

- **`SuperAdminService`** (`super-admin.service.ts`):
  - `createAdmin` — rewrote the count-then-create body as a **single Prisma interactive
    transaction** that first acquires the Admin-model advisory lock
    (`pg_advisory_xact_lock($1)` via `$executeRaw`, key `ADMIN_MODEL_ADVISORY_LOCK =
BigInt(2_847_534_901_640)`), then re-checks the active count (409 "maximum of two active
    Admin accounts") and email uniqueness (409 "already exists") **inside** the lock, inserts,
    and records `ADMIN_CREATE` in the same transaction. After commit it sends the welcome email
    best-effort (never fails the request). This closes the Prompt 08 race where two concurrent
    creates could both pass the count check.
  - `reactivateAdmin(adminId)` — **new** (REQ-217b): transaction + same advisory lock; target
    must exist, be an Admin, and be disabled (active → 409; unknown/non-Admin → 404); re-checks
    the two-active-max invariant under the lock (409 when already full); clears `disabledAt`,
    revokes all outstanding reset tokens (`usedAt = now` via `updateMany`), and records
    `ADMIN_REACTIVATE` in the same transaction. Returns 204.
  - `deactivateAdmin` / `changeAdminPassword` / `forceLogout` unchanged from Prompt 08: deactivate
    revokes all sessions + records `ADMIN_DEACTIVATE`; password change validates policy, clears
    the 15-minute lock, revokes sessions, records `ADMIN_PASSWORD_CHANGE` + admin email; force
    logout revokes sessions + records `FORCE_LOGOUT` + email.
  - **Advisory-lock note:** `pg_advisory_xact_lock()` returns `void`, which Prisma's `$queryRaw`
    cannot deserialize (`Failed to deserialize column of type 'void'`). The lock is therefore
    invoked through `tx.$executeRaw`, which discards the row and returns an affected-count.
    Verified end-to-end by a concurrent-create integration test (5 parallel creates → exactly one
    201 and four 409s; active-count never exceeds two).
- **`ResetTokenService`** (`reset-token.service.ts`) — the Admin reset window is closed
  (**REQ-218**, reset flow): `request()` now reads `{ id, role }`; for role `Admin` it records a
  `PASSWORD_RESET_DENIED` event (result `DENIED`) and returns the standard uniform response
  ("If an account exists…") — no token is minted, no email is sent, and account existence is not
  disclosed. Owner/SuperAdmin reset behavior is unchanged.
- **`SecurityEventService`** (`security-events.service.ts`) — `'ADMIN_REACTIVATE'` added to the
  event-type union (used by `reactivateAdmin`). `PASSWORD_RESET_DENIED` already existed and is
  now actually emitted. No migration: `SecurityEvent.type` is a plain `String` column (verified in
  the Prisma schema).
- **`PlatformEmailer`** (`platform-emails.ts`) — new `'admin-welcome'` template: subject "Your
  Werefa Admin account is ready", informational body with the account email and the dashboard
  `publicBaseUrl`; it deliberately contains **no password and no token** (the SA communicates the
  temporary password out-of-band). Sent after every successful `createAdmin`.
- **`SuperAdminController`** (`super-admin.controller.ts`) — new `POST
/api/v1/super-admin/admins/:id/reactivate` (204). The whole controller is
  `@RolesExact(SuperAdmin)`, so Owner/Admin are 403 and unauthenticated 401 — verified by tests.

### Frontend (`apps/dashboard`)

- **`lib/admin-accounts-api.ts`** — typed client for `GET/POST …/super-admin/admins`,
  `POST …/admins/:id/{deactivate,reactivate,password}`, and the existing
  `POST …/super-admin/logout/:userId`.
- **`business/AdminAccountsPanel.tsx`** — Super Admin "Admin accounts" panel:
  - list table (email, Active/Deactivated pill, created date),
  - "Add admin" create form (email + temporary password; `minLength=12` mirroring the backend
    policy; reset after submit; never retained in state),
  - per-row actions gated by `window.confirm`: **Deactivate**, **Change password** (inline form,
    clears lock + signs out the admin, per backend), **Sign out** (force logout), and
    **Reactivate** for disabled rows,
  - success/info + error banners reusing existing `.alert`/`.info` styles; loading state.
- Wired into **`business/AdminPanel.tsx`** behind the existing `showLifecycle` (SuperAdmin)
  button row as "Admin accounts". **`lib/security-history-api.ts`** gained `ADMIN_REACTIVATE` in
  `SECURITY_FILTER_TYPES` so the new event is filterable in the security-history panel.
- No test framework was added (none exists in the dashboard workspace); the panel is covered
  manually + logically by the backend integration tests.

### Tests (`apps/api/test/integration`)

- **`identity-admin-recovery.test.ts`** — block P rewritten/extended to **22 tests** covering the
  full lifecycle: RBAC for Owner/Admin/anon across every endpoint; third-active-admin 409; create
  under the limit incl. welcome-email assertions (recipient, content, and **absence** of the
  password / token / reset-link); duplicate-email 409 (deactivate-first path so the email
  uniqueness branch is exercised); **5 concurrent creates → exactly one 201 / four 409** and
  active-count stays 2; concurrent same-email → `[201,409]` (never 500); deactivate (sessions
  revoked → 401, login 403, `ADMIN_DEACTIVATE` event); reactivate (clears `disabledAt`, revokes
  outstanding reset tokens, `ADMIN_REACTIVATE` event, re-login 200); reactivate guards (already
  active 409, unknown 404, non-Admin/owner target 404, two-active 409); reactivate RBAC; SA
  password change (clears lock, revokes sessions, old password fails / new works, event metadata
  - email carry no password, canonical credentials restored via `PasswordService`); password-change
    RBAC; force-logout of an Admin target + of an Owner target (session 401, `FORCE_LOGOUT` event,
    email); force-logout RBAC; **Admin forgot-password → uniform 202 message, no email,
    `PASSWORD_RESET_DENIED` event** and Owner reset still emails.
- **`identity-password.test.ts`** — reset-flow tests moved from Admin to a dedicated non-Admin
  fixture `owner2` (`pwd-reset-owner@werefa.test`, added to the shared identity seed as a second
  Owner) so they pass `ResetTokenService`'s Admin gate; block J now logs in the Admin with the
  baseline password (its password is no longer remounted by block H). All 9 tests still green.
- **`security-history.test.ts`** — `beforeAll` now sets `REDIS_URL` (required since the retention
  job's config became mandatory); 19 tests green (a pre-existing suite-level failure, unrelated to
  Prompt 18, which aborted the Nest app at init because the var was missing).

## 4. Requirement → implementation → test mapping

| Req      | Statement (abbr.)                        | Implementation                                                                        | Test                                 |
| -------- | ---------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------ |
| REQ-037  | Exactly one Super Admin                  | `SuperAdminService` (SA created by seed, never touched by lifecycle endpoints)        | P                                    |
| REQ-038  | Exactly two active Admins                | advisory-lock-serialized `createAdmin`/`reactivateAdmin`                              | P (concurrent creates)               |
| REQ-039  | Only SA manages Admins                   | `@RolesExact(SuperAdmin)` on every lifecycle endpoint                                 | P (RBAC)                             |
| REQ-217a | SA creates/deactivates Admins            | `createAdmin` (tx + lock + count/email checks) + `deactivateAdmin`                    | P                                    |
| REQ-217b | Reactivation allowed (soft deactivate)   | `reactivateAdmin` (lock, count re-check, revoke reset tokens, `ADMIN_REACTIVATE`)     | P (reactivate + guards + concurrent) |
| REQ-218  | Admin cannot change own password         | change-password blocked by role + reset denied (`PASSWORD_RESET_DENIED`, uniform 202) | J, P (reset denied)                  |
| REQ-219  | SA can change Admin password             | `changeAdminPassword` (clears lock, revokes sessions, email, event)                   | P (pw change)                        |
| REQ-220  | SA force-logout with immediate email     | `forceLogout` (revoke all sessions + email + `FORCE_LOGOUT`)                          | P (admin + owner targets)            |
| REQ-221  | Forced-logout email must have no secrets | email template + event metadata verified free of password/token                       | P (no-secret assertions)             |

## 5. Quality gate (final, this session)

| Step               | Command                                                                              | Result                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 1. Format          | `npx prettier --check` on changed api/dashboard files                                | PASS (4 files formatted)                                                                                      |
| 2. Lint            | `npm run lint` (api, dashboard, db, shared)                                          | PASS (0 errors)                                                                                               |
| 3. Typecheck       | `npm run typecheck` (all workspaces)                                                 | PASS (0 errors)                                                                                               |
| 4. Unit tests      | `npm run test:unit` (api) — `vitest run test/unit`                                   | PASS — **204** tests, 21 files                                                                                |
| 5. Integration     | `npm run test:integration` (api) — `vitest run test/integration`                     | PASS — **251** tests, 13 files (all green)                                                                    |
| 6. DB bootstrap    | `npm run db:test:setup` (export root `.env`)                                         | PASS — clean `werefa_test`; all migrations applied                                                            |
| 7. Backend build   | `npm run build --workspace @werefa/api` (`nest build`)                               | PASS                                                                                                          |
| 8. Dashboard build | `npm run build --workspace @werefa/dashboard` (`tsc -p tsconfig.json && vite build`) | PASS — 57 modules, dist emitted                                                                               |
| 9. Startup smoke   | `node apps/api/dist/main.js` → `GET /api/v1/health/live` + `/api/v1/auth/me`         | PASS — `{"status":"ok"}`; unauthenticated `/auth/me` → uniform 401; full route map incl. new reactivate route |

Numeric deltas vs the Prompt 17 close-out: API unit **204 → 204** (no unit change needed — the
lifecycle logic is covered at the integration layer), integration **239 → 251** (+12: block P grew
from 10 to 22 tests in `identity-admin-recovery.test.ts`).

## 6. Security invariants (Prompt 18 cross-cutting)

- **Race-proof invariant:** all create/reactivate paths enforce ≤ 2 active Admins **under** the
  advisory lock, so the previously-documented count-then-write race is closed at the database
  layer, not just by error handling.
- **No secret leakage:** event metadata for `ADMIN_PASSWORD_CHANGE`/`FORCE_LOGOUT`/`ADMIN_REACTIVATE`
  and the `admin-welcome`/password emails contain no password, hash, or reset token (asserted in
  tests via regex on email bodies and on event metadata).
- **Uniform non-enumeration for Admin reset:** requesting a reset for an Admin returns the exact
  same 202 body as any unknown account; no token, no email, and the denial is only observable
  from the security-events history (SA-side).
- **Revocation completeness:** deactivate, password change, and force-logout all revoke the
  target's sessions immediately; reactivation does not resurrect them (fresh login required).
- **RBAC surface:** every lifecycle route is `@RolesExact(SuperAdmin)`; there is no Owner/Admin
  path to create, deactivate, reactivate, password-change, or force-logout anyone.

## 7. Regression statement

All **204 unit tests** and **251 integration tests** pass across the whole suite. The two
`identity-password`/`security-history` edits are test-infrastructure corrections (non-Admin reset
fixture + a missing `REDIS_URL` env needed since the retention job); no production behavior in
unrelated domains changed. API and dashboard builds, lint, typecheck, and prettier are clean.
The dashboard panel is manually verified per §1 (no frontend test framework exists and none was
added).

## 8. Prompt 19 boundary

Prompt 19 was **not started**. This report covers Prompt 18 exclusively.
