# 18 — API Architecture

> **Architecture Version:** 1.0.1 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06 (+ Prompt 06-CORRECTION: customer resubmission endpoint with verification + rate limiting, §3.1)

## 1. Style and base

REST/JSON under `/api/v1` (ADR-010), OpenAPI 3.1 document generated at build; JSON:API-style errors (doc 23). Stateless controllers → services; no business logic in controllers.

Auth surface: two modes.

- **Dashboard/API mode:** HTTP-only session cookie (doc 14). CSRF-safe state-changing calls additionally require header `X-Requested-With: fetch` (SameSite=Lax + header check).
- **Public mode:** `POST /api/v1/public/**` is anonymous; idempotency via `submission_key`; rate-limited (Per-IP) by Redis.

## 2. API areas and authorization matrix

| Area                         | Base path                                              | Auth                        | Tenant scope                             |
| ---------------------------- | ------------------------------------------------------ | --------------------------- | ---------------------------------------- |
| Auth (platform)              | `/api/v1/auth/*`                                       | anonymous (mostly)          | none                                     |
| Public business/availability | `/api/v1/public/businesses/{slug}`, `/public/*/slots`  | anonymous                   | public page of that business only (read) |
| Public booking               | `/api/v1/public/bookings` (POST + proof upload)        | anonymous + submission_key  | creates into that business               |
| Owner                        | `/api/v1/owner/**`                                     | OWNER session               | resources must be in owned businesses    |
| Admin                        | `/api/v1/admin/**`                                     | ADMIN session               | platform-level but view-limited (doc 20) |
| Super Admin                  | `/api/v1/super-admin/**`                               | SUPER_ADMIN                 | all (elevated scope) + audit             |
| Telegram                     | `/api/v1/telegram/webhook`                             | webhook secret (no session) | bound connection (doc 12)                |
| Reporting                    | `/api/v1/owner/reports`, `/api/v1/super-admin/reports` | role-scoped                 | scoped query (doc 21)                    |

## 3. Important endpoints (purpose/request/response/errors/idempotency/audit)

### 3.1 Public

| Endpoint                                                | Purpose                                                                   | Request                                                     | Response    | Validation/errors                                                                                                                     | Idempotency                       | Audit                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| `GET /public/businesses/{slug}/slots?date=…&services=…` | availability (R50)                                                        | slug,date,services                                          | slot list   | 404 unknown slug; 400 bad date; 422 duration unfit                                                                                    | none (read)                       | none                                                               |
| `GET /public/businesses/{slug}`                         | public page data (R207–215)                                               | —                                                           | page object | 404                                                                                                                                   | none                              | none                                                               |
| `POST /public/bookings`                                 | create booking + proof (T1)                                               | name,phone,note?,method,services[],submission_key, proofRef | 201 booking | 400 validation; 409 SLOT_UNAVAILABLE; 413 file; 422 subscription/pause closed                                                         | `submission_key` unique           | booking history (auto)                                             |
| `POST /public/rejected-bookings/resubmission`           | customer resubmits proof for a **rejected** booking (T10, SM-09 option B) | phone, verification_code, newProofRef                       | 200         | 400 validation; 401 bad/expired verification code; 403 booking not REJECTED for this phone; 429 rate-limited (per-phone/per-business) | `submission_key` on the new proof | booking + payment history; security_event for verification outcome |
| `POST /public/bookings/{id}/connect-telegram`           | optional TG connect (R56)                                                 | connect_token                                               | 200         | 401 token invalid; 404                                                                                                                | one-time token                    | security event                                                     |

### 3.2 Owner

| Endpoint                                      | Purpose                              | Auth/scope                                 | Idempotency/audit                           |
| --------------------------------------------- | ------------------------------------ | ------------------------------------------ | ------------------------------------------- |
| `POST /owner/bookings/{id}/accept` / `reject` | T2/T3                                | owner of business; reject needs reason     | guarded transition; booking+payment history |
| `POST /owner/bookings/{id}/reschedule`        | T7                                   | owner; new slot validates (R106)           | txn under advisory lock; history            |
| `POST /owner/bookings/{id}/cancel`            | T6/T8 (pending cancel)               | owner                                      | SM-08: slot stays blocked; history          |
| `POST /owner/bookings/{id}/release-slot`      | T8/T9 explicit release               | owner; only CANCELED-pending/rejected case | slot_lock release; history                  |
| `POST /owner/bookings/{id}/no-show`           | T5                                   | owner                                      | terminal; history; R227 notif (TG)          |
| `PUT /owner/schedules`                        | apply schedule version (R082–099)    | owner                                      | new version + warnings (R092); history      |
| `GET /owner/bookings/{id}/history`            | full history (R174)                  | owner                                      | read                                        |
| `GET /owner/schedules/history`                | view schedule history (R166)         | owner                                      | read; **PDF via report job** (R170)         |
| `POST /owner/subscriptions/renew`             | upload subscription proof (R135/136) | owner                                      | unique submission; review queue             |
| `POST /owner/pause` / `resume`                | pause/resume (R143–158)              | owner                                      | history event; resume validates (R157/158)  |
| `POST /owner/businesses/switch`               | business context (R16/19)            | owner                                      | session active_business updated             |

### 3.3 Admin

| Endpoint                                                   | Purpose                    | Notes                                                   |
| ---------------------------------------------------------- | -------------------------- | ------------------------------------------------------- |
| `GET /admin/subscription-reviews`                          | review queue (R140)        | only 2 Admins; pending only                             |
| `POST /admin/subscription-reviews/{id}/approve` / `reject` | R137/138                   | approve extends 30 d (R130); reject needs reason; audit |
| `GET /admin/bookings?status=`                              | current status only (R176) | no history field exposed                                |

### 3.4 Super Admin

| Endpoint                                                       | Purpose                                            | Notes                       |
| -------------------------------------------------------------- | -------------------------------------------------- | --------------------------- |
| `GET /super-admin/admins`, `POST /admins`, `PATCH /admins/:id` | account lifecycle (R217) + constraints (R37/38/39) | audited                     |
| `POST /super-admin/admin-password`                             | change Admin password (R219)                       | audited                     |
| `POST /super-admin/logout/{userId}`                            | force logout (R220) + email (R221)                 | audited                     |
| `GET /super-admin/bookings/history`                            | full history (R177)                                | elevated scope              |
| `POST /super-admin/exports/booking-history`                    | PDF export (R178/179/180)                          | scope all-or-one (R181)     |
| `GET /super-admin/schedules/{businessId}/history`              | schedule history (R167)                            | elevated                    |
| `POST /super-admin/security/delete`                            | delete security records (R205)                     | audited (R206)              |
| `POST /super-admin/recovery/request`                           | emergency recovery (R198/199/200)                  | rate-limited; one-time code |
| `POST /super-admin/telegram/reset`                             | platform admin                                     | ops                         |

### 3.5 Telegram webhook

| Endpoint                        | Purpose                      | Notes                                                          |
| ------------------------------- | ---------------------------- | -------------------------------------------------------------- |
| `POST /api/v1/telegram/webhook` | bot updates (R67/68 + gifts) | secret header; update-id dedup; owner-bound callbacks (doc 12) |

## 4. Cross-cutting behavior

- **Validation:** DTO + whitelist (NestJS pipes); global `ValidationException` → 400 with field errors (doc 23).
- **Errors:** single envelope `{ error: { code, title, detail?, fields? } }`; codes from doc 23 taxonomy; no stack/internal IDs/tenant leakage.
- **Rate limiting:** Redis sliding window; strictest on `/public/**` and `/auth/**`; configurable per route.
- **Pagination:** cursor-based for history/report endpoints; page size caps.
- **Versioning:** path prefix v1; breaking changes → v2 (no churn now).
- **Audit:** state-changing endpoints record their domain history; sensitive admin ops additionally write `audit_event`; exports write `report_job`.
- **Time semantics:** all JSON datetimes ISO-8601 **UTC**; display conversion server->client with the global TZ constant for dashboard; PDF/email omit the abbreviation.

## 5. OpenAPI + client

Generated OpenAPI spec committed; typed fetch clients generated for the SPAs; contract tests (doc 28).
