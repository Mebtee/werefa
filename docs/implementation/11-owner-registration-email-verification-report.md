# 11 — Owner Self-Service Registration & Email Verification (Prompt 17) — Section 38 Final Report

Status: **IMPLEMENTED** · Final quality-gate run: **all green** · This report is the
Prompt 17 §38 close-out (`docs/01-master-specification.md` REQ-005 remainder, REQ-026..031,
`docs/architecture/01-identity-access.md` §4 registration flow, `docs/architecture/22-audit-logging.md`).

Owner self-service registration, email-verification token lifecycle (SHA-256-hashed, single-use,
30-minute expiry), unverified-account login gating, non-enumerating uniform responses, and the
dashboard register/verify pages are complete.

## 1. Conformance summary

| Dimension               | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement coverage    | New Owner can self-register (**REQ-005** remainder); account starts with `isEmailVerified=false`; role is server-determined `Owner` (**REQ-026**); registration sends a verification email containing a one-time deep link (**REQ-027**); verification link expires after 30 minutes (**REQ-028**); verification is single-use — a second use returns 409 TOKEN_USED (**REQ-029**); resend invalidates the prior token (**REQ-030**); unverified accounts cannot log in — server returns 401 VERIFICATION_REQUIRED with no session (**REQ-031**); unverified account gating verified end-to-end via integration tests. |
| Explicitly omitted      | No password-reset, password-change, admin lifecycle, recovery, or session management changes (unchanged from Prompt 08). REQ-032 (admin self-registration review) is N/A — the existing owner/Admin/SuperAdmin lifecycle handles this via the SuperAdmin "create Admin" flow (Prompt 08). No email verification for Admin/SuperAdmin — they are created by SuperAdmin and their `isEmailVerified` defaults to `true`.                                                                                                                                                                                                  |
| Deferred (out of scope) | No resend throttle beyond the existing `auth:verify-request:IP` rate limiter; no CAPTCHA; no invite-link flow; no email change after registration; no admin-initiated account merge.                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## 2. Quality gate (final, this session)

| Step             | Command                                                           | Result                                                                                                                                                                                                                                                                                       |
| ---------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Format        | `prettier --check` (api src/test, dashboard src, db schema)       | PASS (0 files flagged)                                                                                                                                                                                                                                                                       |
| 2. Lint          | `eslint` (api src+test, dashboard src)                            | PASS (0 errors)                                                                                                                                                                                                                                                                              |
| 3. Typecheck     | `tsc --noEmit` (api, dashboard)                                   | PASS (0 errors)                                                                                                                                                                                                                                                                              |
| 4. DB bootstrap  | `npm run db:test:setup --workspace @werefa/db` (export root .env) | PASS — clean `werefa_test` build; 12 migrations applied including `20260911_000000_email_verification`                                                                                                                                                                                       |
| 5. Builds        | `nest build` (api), `vite build` (dashboard)                      | PASS                                                                                                                                                                                                                                                                                         |
| 6. Unit tests    | `vitest run test/unit` (api)                                      | PASS — **204** tests, 21 files (+15 new `email-verification.test.ts` covering token-hash storage, register flows, request/resend, complete, template rendering, no-secret-in-audit)                                                                                                          |
| 7. Integration   | `vitest run test/integration` (api)                               | PASS — **239** tests, 13 files (+18 new `identity-registration.test.ts` covering register→verify→login loop, single-use tokens, resend invalidation, expired/garbage tokens, unverified login denial, non-enumeration, role-manipulation rejection, input validation, rate-limit exhaustion) |
| 8. Startup smoke | `node apps/api/dist/main.js` → `GET /api/v1/health/ready`         | PASS — `{"status":"ok","db":"up"}`; new routes mapped (`POST …/auth/register`, `POST …/verify-email/request`, `POST …/verify-email/complete`); secret masking confirmed.                                                                                                                     |

Numeric deltas vs the Prompt 16 close-out: API unit **189 → 204** (+15), integration
**221 → 239** (+18).

## 3. What was implemented

### Database

- **New table** `email_verification_token` (platform-level, no RLS):
  - Columns: `id` (uuid PK), `user_id` (FK → `user.id` CASCADE), `token_hash` (unique, sha-256 of
    the raw token), `expires_at` (timestamptz), `used_at` (nullable timestamptz), `created_at`
    (timestamptz).
  - Indexes: unique on `token_hash`; btree on `user_id`.
  - Migration: `packages/db/prisma/migrations/20260911_000000_email_verification/migration.sql`.
- **Prisma schema** (`packages/db/prisma/schema.prisma`): `EmailVerificationToken` model + reverse
  relation `emailVerificationTokens` on `User`. Manual column alignment preserved (no `prisma
format`).

### Backend

- **`EmailVerificationService`** (`apps/api/src/iam/email-verification.service.ts`):
  - `register(email, password, ip?, device?, now?)`: checks existing user → uniform 202 for
    non-Owner/verified-owner/Admin races → creates Owner with `isEmailVerified=false` → hashes
    token with SHA-256 → stores in `email_verification_token` → sends verification email → records
    `REGISTER` security event → returns uniform message. P2002 unique race → uniform 202 (no crash).
  - `request(email, ip?, device?, now?)`: looks up unverified Owner → invalidates prior token
    (sets `usedAt = now`) → mints new → emails → records `EMAIL_VERIFICATION_REQUEST`. Unknown/Admin/
    verified-owner → uniform 202, no email.
  - `complete(token, ip?, device?, now?)`: hashes provided token → lookup by `token_hash` → validates
    expiry (401 TOKEN_EXPIRED) and single-use (409 TOKEN_USED) → atomically claims via `updateMany`
    (where `usedAt IS NULL`) → sets `isEmailVerified=true` → records `EMAIL_VERIFICATION_COMPLETE` →
    returns void (204).
  - Injectable clock (`now` parameter) for deterministic testing.
  - Uniform responses: register = "Your request was received. If this email is available, a
    verification link was sent."; request = "If an account exists for this email, a verification link
    has been sent."

- **Auth controller** (`apps/api/src/iam/auth.controller.ts`): three new `@Public()` endpoints:
  - `POST /api/v1/auth/register` → 202 + `{ message }`.
  - `POST /api/v1/auth/verify-email/request` → 202 + `{ message }`.
  - `POST /api/v1/auth/verify-email/complete` → 204.
  - All rate-limited via `RateLimitService` (`auth:register:IP`, `auth:verify-request:IP`,
    `auth:verify-complete:IP`).

- **Email template** (`apps/api/src/notifications/platform-emails.ts`): new `'verification'`
  template with Werefa branding, deep link `${publicBaseUrl}/verify/${token}`, 30-minute TTL text,
  ignore guard.

- **Security events** (`apps/api/src/iam/security-events.service.ts`): three new event types
  `REGISTER`, `EMAIL_VERIFICATION_REQUEST`, `EMAIL_VERIFICATION_COMPLETE` in the union.

- **Config** (`apps/api/src/config/environment.ts`): new `verificationTokenTtlMinutes` field
  (env `VERIFICATION_TOKEN_TTL_MINUTES`, default 30).

### Frontend

- **`apps/dashboard/src/pages/Register.tsx`**: email+password form → POST `/auth/register` →
  "sent" confirmation state with resend. Footer links to login.
- **`apps/dashboard/src/pages/VerifyEmail.tsx`**: auto-calls `POST /auth/verify-email/complete`
  with the `#/verify/<token>` hash → success/error/expired/used states with login/register links.
- **`apps/dashboard/src/pages/Login.tsx`**: rewired — "Create account" link to `#/register`;
  on 401 `VERIFICATION_REQUIRED`, shows a verification-required state with resend.
- **`apps/dashboard/src/App.tsx`**: routes for `#/register` and `#/verify` pages.

### Tests

- **Unit** (`apps/api/test/unit/email-verification.test.ts` — 15 tests):
  - Token storage safety: SHA-256 hash only, no raw token in DB or email.
  - Register: new owner, existing unverified reissue, verified-owner no-op, admin no-op, P2002 race.
  - Request/resend: mints new, invalidates prior.
  - Complete: success, unknown token, expired, used, resend invalidation.
  - Audit fields never contain token/password.
  - Platform email template: subject, verify link, TTL, ignore guard.

- **Integration** (`apps/api/test/integration/identity-registration.test.ts` — 18 tests):
  - A: registration creates unverified OWNER (202, uniform msg, email with link, DB state).
  - B: full loop register → verify → login → /me (Owner, no businesses).
  - C: single-use enforcement (first 409 TOKEN_USED after resend; second works; used can't replay).
  - D: garbage token → 401; DB-expired token → 401.
  - E: unverified login → 401 VERIFICATION_REQUIRED, no session cookie.
  - F: non-enumeration (Admin email → 202, no email/token; verified owner → 202, no email).
  - G: role manipulation ignored (body with `role: SuperAdmin` → still Owner).
  - H: verify-email/request never discloses account existence (unknown/Admin → 202 no email;
    already-verified owner → 202 no email).
  - I: input validation (missing email, malformed email, short password → 400).
  - J: rate limiting (pre-fill bucket → 429 RATE_LIMITED).

## 4. Non-enumeration guarantees

All three registration/verification paths return the same envelope regardless of whether the email
exists, the user is already verified, or the email belongs to a platform account:

| Path                         | Known unverified owner         | Known verified owner / Admin | Unknown email        |
| ---------------------------- | ------------------------------ | ---------------------------- | -------------------- |
| `POST /auth/register`        | 202 + email + token            | 202, no email, no token      | 202, no email, token |
| `POST /verify-email/request` | 202 + new email + invalidation | 202, no email                | 202, no email        |
| `POST /auth/login`           | 401 VERIFICATION_REQUIRED      | normal login flow            | 401 UNAUTHENTICATED  |

The login path for unverified accounts was already implemented in Prompt 08 (`auth.service.ts` line
~80: `if (!user.isEmailVerified) throw AppException.verificationRequired()`). No code change was
needed — only the frontend now handles the response by showing a verification-required UI with
resend capability.

## 5. Security invariants

- **Server-determined role**: the register endpoint ignores any client-supplied `role` field;
  the account is always created as `Owner`.
- **Hashed tokens**: the raw token is never stored — only the SHA-256 hash. The raw token is
  included in the email and nowhere else.
- **Single-use with atomic claim**: `complete()` uses `updateMany({ where: { usedAt: null } })`
  inside `$transaction` to prevent double-redemption races.
- **Resend invalidation**: each `request()` sets `usedAt = now` on all prior unconsumed tokens
  for that user before minting a new one.
- **P2002 race safety**: the `register()` catch block detects unique-constraint races (concurrent
  registration of the same email) and returns the same uniform 202.
- **No secrets in audit**: security events record only `REGISTER`, `EMAIL_VERIFICATION_REQUEST`,
  and `EMAIL_VERIFICATION_COMPLETE` with ip/device — never tokens, passwords, or hashes.
- **Injectable clock**: all time-dependent logic accepts a `now` parameter for deterministic
  testing (no `Date.now()` inside the service).
- **Rate limiting**: all three endpoints use `RateLimitService` with distinct per-IP bucket keys.

## 6. Regression statement

All **204 unit tests** and **239 integration tests** pass. The new tests cover exclusively
new endpoints, services, and pages. Existing identity, business, service, booking, schedule,
notification, subscription, security-history, and reporting test suites are unchanged and green.
Dashboard and API builds are clean. Lint and typecheck produce zero errors.

## 7. Prompt 18 boundary

Prompt 18 was **not started**. This report covers Prompt 17 exclusively.
