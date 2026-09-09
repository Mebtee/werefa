# 14 — Authentication & Security Architecture

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06
> Binding: REQ-024–035, REQ-191–206, REQ-217–221. Phase 1: email/password; 2FA-ready.

## 1. Credential & token storage

| Item                                          | Storage                                                                                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Passwords                                     | Argon2id (memory/hardened params), encoded in `user.password_hash`. Never reversibly stored; never logged.                                                            |
| Session tokens                                | **Opaque random** (≥256 bit); only **SHA-256 hash** persisted in `session.token_hash`; the raw token lives only in the HTTP-only cookie.                              |
| Verification/reset/recovery                   | Only hashes stored (`verification_token`, `password_reset_token`, `recovery_token`); single active + expiry (R28/R29/R31); one-time use.                              |
| TOTP secret (2FA-ready, Phase 2)              | Encrypted at rest (`two_factor_secret_enc`) with app KMS key; `two_factor_enabled_at` set when enabled. Phase 1 stores nothing—the schema column is encryption-ready. |
| Secrets (Webhook secret, bot token, KMS keys) | Env/secrets manager; never in logs (doc 24).                                                                                                                          |

## 2. Core flows

### Registration & verification (R005/R026–R032)

1. Owner registers with email+password → `user` created `is_email_verified=false`; rate-limited verification request (R30).
2. Email verification link (time-limited R28, single active R31) → verify → optional auto-authenticate (R32) → dashboard access only when verified (R27).

### Login (R024)

1. Validate email+password against `password_hash`.
2. Enforce account lock: after 5 consecutive failures → `is_locked_until = now()+15min` (R193); immediate lockout email with IP/device/browser (R195/R196).
3. On success: create `session`; if device fingerprint is new/unrecognized → record `security_event` (R197, **no email**).
4. Record login success/failure with date/time/IP/device/browser/result (R191/R192).

### Password reset (R033 → R194)

Forgot-password → one-use reset link → new password; **clears** the temporary lock (R194).

### Password change (R35)

Change → hash updated + **revoke all sessions** (`session.revoked_at = now()` for the user) → logout everywhere (R35). Email confirmation is NOT required by product; session revocation is mandatory.

### Session management

- Cookie: `HttpOnly; Secure; SameSite=Lax; Path=/`, session id = raw token; server resolves `token_hash`.
- `active_business_id` cached on the session row and refreshed on business switch (R16/R19/R21/R22).
- Rolling expiry (default 30 days) + inactivity timeout (configurable); revoked on password change, forced logout, Super Admin action (R220, immediate email R221).
- Session may be limited to one account; multiple sessions allowed per product (no constraint) but all revocable.

### Account lock specifics (R193)

Decided: 5 **consecutive** failures → lock 15 minutes; a successful login resets the failure counter; password reset clears it (R194). Implemented on `user.failed_login_count` + `is_locked_until`; lockout email emitted by worker.

### Super Admin emergency recovery (R198–200)

Separate `recovery_email`; request → one-time code to that email (R199) → code permits immediate password replacement (R200). Strict rate limiting; revocation loop guarded.

### 2FA readiness (R34)

- Phase 1: no enforcement. Architecture: `totp` challenge placeholder in the auth pipeline, encrypted secret storage, and an `enforcement` config flag that will route Owner/Admin/SuperAdmin through the second factor in Phase 2.
- Non-goal: SMS/email OTP (not approved). Only TOTP placeholder architecture is prepared.

## 3. Role & tenant authorization

| Guard        | Rule                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Role guard   | Handler metadata declares allowed roles; NestJS `RolesGuard` rejects others (R36–44).                                   |
| Tenant guard | Owner endpoints require resource→business owned by session (doc 04 §5). Admin limited views; SuperAdmin elevated scope. |
| Object-level | Never trust client-supplied `business_id`; derive from the resource where possible.                                     |
| System actor | Internal job/service invocations carry `ActorContext.system`.                                                           |

## 4. Security event logging

| Event                                       | Record (R191/192/197/204/206/220)                                        |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| Login success/failure                       | `security_event(type='LOGIN_*', ip, device, browser, result)`            |
| New/unrecognized device success (R197)      | same, flagged device; **retained 1 year** (R204)                         |
| Lockout (R193)                              | event + immediate email (R195/196)                                       |
| Password reset clears lock (R194)           | event                                                                    |
| Super Admin deletes security records (R205) | own `audit_event` (R206) — deletion still audited                        |
| Forced logout (R220/R221)                   | `audit_event` + email                                                    |
| Viewer scopes                               | Owner → own (R201); Admin → own (R202); SuperAdmin → all relevant (R203) |

Retention: one year (R204); automation: weekly purge job + audit trail of purge (platform-level, product-allowable since R204 mandates one-year retention and R205 only SuperAdmin deletion).

## 5. Threat mitigations (summary table → doc 29)

| Threat                     | Architecture mitigation                                                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential stuffing        | Argon2id; rate limiting; account lock (R193); per-IP limit; monitoring alerts                                                                            |
| Brute force                | Lock + backoff; logarithmic backoff on login endpoint                                                                                                    |
| Session theft              | Opaque token, HttpOnly/Secure cookie, revocation, device fingerprint recording                                                                           |
| IDOR                       | Tenant-scoped queries everywhere; no id-only lookups (doc 04 §5)                                                                                         |
| Tenant breakout            | RLS + business_id predicates + cross-tenant tests (doc 28)                                                                                               |
| CSRF                       | SameSite=Lax cookies + custom header requirement for state-changing calls; no cookie auth on public booking endpoint (uses submission key + same-origin) |
| XSS                        | React default escaping; CSP header; input validation; no raw HTML in rendered user content                                                               |
| SQL injection              | Parameterized queries (Prisma/raw-SQL with bind params only)                                                                                             |
| Malicious uploads          | MIME allow-list + magic-byte check + size limits + object scanning hook (doc 16)                                                                         |
| Webhook/Telegram spoofing  | Shared-secret header + idempotent updates + actor binding (doc 12)                                                                                       |
| Unauthorized report access | Role guard + scope checks + audited export (doc 21)                                                                                                      |
| Secrets leakage            | Never log tokens/hashes/secrets; structured logs redaction (doc 24)                                                                                      |

## 6. Auth-testing links

Security tests enumerated in doc 28; threat detail and residual risk in doc 29.
