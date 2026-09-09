# 23 — Error Handling

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06
> Binding: cross-cutting (REQ-121 integrity, REQ-047–049, REQ-157, REQ-193, REQ-236 not applicable). Error taxonomy, envelope, mapping, and worker/global handling.

## 1. Error taxonomy & codes

| Domain      | Code                    | HTTP | Meaning                                         |
| ----------- | ----------------------- | ---- | ----------------------------------------------- |
| Validation  | `VALIDATION_ERROR`      | 400  | DTO/field violation; `fields` present           |
| Auth        | `UNAUTHENTICATED`       | 401  | missing/invalid/expired session or token        |
| Auth        | `ACCOUNT_LOCKED`        | 423  | locked after 5 failures (R193/R194)             |
| Auth        | `VERIFICATION_REQUIRED` | 403  | email not verified (R27)                        |
| Auth        | `TOKEN_EXPIRED`         | 401  | reset/verify/recovery link expired (R28/31/33)  |
| Auth        | `TOKEN_USED`            | 409  | one-time token already consumed                 |
| Authz       | `FORBIDDEN`             | 403  | role/tenant/object denied                       |
| Authz       | `NOT_FOUND`             | 404  | resource missing (no existence leak)            |
| Booking     | `SLOT_UNAVAILABLE`      | 409  | overlap/time taken on claim (REQ-121)           |
| Booking     | `PAYMENT_REJECTED`      | 409  | attempted claim against rejected payment        |
| Booking     | `PAYMENT_PENDING`       | 409  | action requires accepted payment                |
| Booking     | `INVALID_TRANSITION`    | 409  | guarded state change rejected (doc 09)          |
| Booking     | `SCHEDULE_AFFECTED`     | 409  | reschedule into a slot now blocked              |
| Tenant      | `SUBSCRIPTION_EXPIRED`  | 422  | booking disabled (R133)                         |
| Tenant      | `BUSINESS_PAUSED`       | 422  | booking disabled (R147/R157)                    |
| Upload      | `FILE_TOO_LARGE`        | 413  | > MAX_UPLOAD_BYTES (doc 16)                     |
| Upload      | `FILE_TYPE_INVALID`     | 415  | not allow-listed type (doc 16)                  |
| Concurrency | `CONFLICT`              | 409  | optimistic/unique constraint violation surfaced |
| Webhook     | `INVALID_SIGNATURE`     | 401  | Telegram secret mismatch (doc 12)               |
| Rate limit  | `RATE_LIMITED`          | 429  | sliding-window hit                              |
| Generic     | `INTERNAL_ERROR`        | 500  | unexpected; no internals leaked                 |

## 2. Envelope

```
{ "error": { "code": "SLOT_UNAVAILABLE", "title": "Slot no longer available",
             "detail": "Choose another time to continue.", "fields": null } }
```

- `fields` only for `VALIDATION_ERROR` (per-field messages).
- **Never** include stack traces, internal IDs, tenant names of others, or SQL text.

## 3. Mapping/translation

- Frontend maps `code → localized user message` (doc 19 §5).
- Guarded-transition conflicts map to `INVALID_TRANSITION` with a stable (non-leaking) detail.
- DB unique/check violations are caught at the domain layer and translated to domain codes, never leaked as raw DB errors (e.g., advisory-lock retry re-runs the tx instead of erroring, doc 08).

## 4. Business/state correctness vs transport errors

- Domain transitions throw typed domain errors (not 500); transport (400/404/409/422…) is derived from typed errors, not ad hoc.
- `500` is reserved for genuinely unexpected infrastructure/defects; observed by Sentry + metrics (doc 24) and op-alerted (doc 17).

## 5. Worker/job error handling

- Jobs throw typed errors; BullMQ retries with backoff; after max → dead-letter (doc 17); worker never swallows silently (observe + alert).
- Notification failures are per-delivery failures that do not roll back the domain action (doc 13 §7).

## 6. Idempotency & dedup

Error responses are reproducible; clients receive a stable code so retries map cleanly (submission keys, doc 08/18). No partial mutation on failure (transactional boundaries doc 06/07).

## 7. Logging of errors

Structured logs include `requestId`, `businessId` (tenant), `actorId` (no PII), and `code`; never passwords/tokens/proof bodies (doc 24).
