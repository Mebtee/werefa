# 07 — Database Design

> **Architecture Version:** 1.0.1 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06 (+ Prompt 06-CORRECTION: unique-index wording in §2/§3; `resubmission_verification` security table)

## 1. Platform

- **PostgreSQL 16.** Default isolation `READ COMMITTED` (correct for the concurrency design in doc 08); `SERIALIZABLE` used only where explicitly needed.
- **Encoding/ctype:** UTF-8. **Timezone storage:** all `TIMESTAMPTZ`; one global display timezone constant (`APP_TIMEZONE`, default Africa/Addis_Ababa) applied at the read/display layer only (REQ-222/223). **Precision:** minutes — store seconds as `:00`; display `HH:mm` (REQ-224/226). Dates `YYYY-MM-DD` (REQ-225).
- **Database roles:** `app` (runtime; RLS-enforced) and `migrator` (DDL; bypasses RLS). No privileged login from app.

## 2. Core schema (key tables; column details abbreviated)

Conventions: `id uuid PK default gen_random_uuid()`; `business_id uuid not null references business(id)` present on every tenant table; `created_at/updated_at timestamptz not null`.

### identity

```
user(id, email citext unique, password_hash, role check role in ('OWNER','ADMIN','SUPER_ADMIN'),
     is_email_verified bool default false, is_locked_until timestamptz null, two_factor_secret_enc,
     two_factor_enabled_at timestamptz null, recovery_email citext, created_at, updated_at)
session(id, user_id fk, token_hash char(64) unique, issued_at, expires_at, ip, device_fingerprint,
        recognized_device bool, active_business_id uuid null references business(id), revoked_at)
verification_token(id, user_id, token_hash unique, purpose, created_at, expires_at, used_at)
password_reset_token(id, user_id, token_hash unique, created_at, expires_at, used_at)
recovery_token(id, super_admin_user_id, code_hash unique, created_at, expires_at, used_at)
```

### business

```
business(id, public_slug citext unique, category_code fk business_category(code), name, logo_file_id,
         cover_file_id, description, address, latitude, longitude, phone_public, deactivated_at,
         active_schedule_version_id, created_at, updated_at)
business_owner(business_id fk, user_id fk, created_at, primary key(business_id, user_id))
business_settings(business_id pk fk, booking_interval_minutes int, prepayment_percent numeric null,
                  prepayment_fixed numeric null, is_paused bool, pause_message, reopen_at timestamptz,
                  pause_updated_at, warning_until null)
business_category(code text pk, label)
```

### catalog

```
service(id, business_id, name, base_price_minor bigint, base_duration_minutes int, is_active bool, created_at)
service_variation(id, service_id, business_id, name, price_delta_minor, duration_delta_minutes, is_active)
add_on(id, service_id, business_id, name, price_delta_minor, duration_delta_minutes, is_active)
```

Indexes: `service(business_id, is_active)`; `service_variation(service_id)`; `add_on(service_id)`.

### scheduling (every row carries business_id + schedule_version_id)

```
schedule_version(id, business_id, version_no int, status check in ('ACTIVE','PENDING'), applied_at, applied_by,
                 reason text, auto_reason text null, replaced_at, unique(business_id, version_no))
working_period(id, schedule_version_id, business_id, weekday smallint, start_time time, end_time time)
blocked_period(id, schedule_version_id, business_id, day_of_week smallint null, start_time time null, end_time time null)
special_date(id, schedule_version_id, business_id, date date, kind check in ('CLOSED','CUSTOM'), start_time, end_time)
schedule_exception(id, business_id, schedule_version_id, booking_id, created_at, created_by)
```

Constraints: `working_period` no overlap within a version+weekday; `special_date` unique per version+date.

### booking & payment

```
booking(id, business_id, status check in ('PAYMENT_PENDING','CONFIRMED','REJECTED','COMPLETED','NO_SHOW','CANCELLED'),
        customer_name, customer_phone, note, start_at timestamptz, end_at timestamptz, version, created_at, updated_at)
booking_service(id, booking_id, business_id, service_id, name_snapshot, unit_price_minor, duration_minutes,
                variation_snapshot jsonb, addon_snapshot jsonb)
booking_status_history(id, booking_id, business_id, from_status, to_status, actor_type, actor_user_id,
                      reason, occurred_at)
payment(id, business_id, booking_id unique references booking(id), status check in ('PENDING','ACCEPTED','REJECTED'),
        method check in ('BANK_TRANSFER','TELEBIRR_MOBILE_MONEY'), prepaid_minor, created_at, updated_at)
payment_status_history(id, payment_id, business_id, from_status, to_status, actor_type, actor_user_id, occurred_at)
payment_proof(id, payment_id, business_id, file_object_id, submission_key, submitted_at, replaced_by_proof_id null)
resubmission_verification(id, booking_id fk, business_id, phone, code_hash char(64), purpose,
                         created_at, expires_at, used_at null, attempts int default 0)
slot_lock(id, business_id, booking_id null fk, slot_date date, start_at timestamptz, end_at timestamptz,
          status check in ('LOCKED','ALLOCATED','RELEASED'), created_at, released_at, released_by)
```

Critical structure for concurrency:

```
CREATE UNIQUE INDEX uq_slot_lock_active ON slot_lock(business_id, slot_date, start_at)
  WHERE status IN ('LOCKED','ALLOCATED');
```

Booking indexes: `booking(business_id, start_at)`, `booking(business_id, status)`; history index `booking_status_history(business_id, occurred_at)`; payment `(business_id)`; slot_lock `(business_id, slot_date)`.

### telegram / notifications

```
telegram_connection(id, business_id null, user_id null, chat_id bigint unique, topic/status, connected_at, revoked_at)
telegram_update(update_id bigint primary key, processed_at)
notification(id, business_id null, type, tenant_scope, created_at)
notification_delivery(id, notification_id, recipient_type, recipient_ref, channel check in ('EMAIL','TELEGRAM'),
    status check in ('PENDING','SENDING','SENT','FAILED','DEAD_LETTERED','SUPPRESSED'), attempts int,
    next_attempt_at, idempotency_key unique, payload_ref, sent_at, last_error)
```

### subscription

```
subscription(id, business_id unique, status check in ('NONE','TRIAL','TRIAL_GRACE','ACTIVE','PAID_GRACE','EXPIRED'),
             trial_started_at, trial_ends_at, trial_grace_ends_at, period_ends_at, paid_grace_ends_at, created_at)
subscription_status_history(id, business_id, from_status, to_status, actor_type, actor_user_id, reason, occurred_at)
subscription_payment(id, business_id, requested_at, reviewed_by null, review_status check in ('PENDING','APPROVED','REJECTED'),
                     rejection_reason, approved_until, file_object_id fk, created_at)
```

Indexes: `subscription_payment(business_id, review_status)`; `subscription_payment(review_status)` for the two Admins' review queue.

### files / reports / audit

```
file_object(id, business_id null, category check in ('CUSTOMER_PROOF','SUBSCRIPTION_PROOF','LOGO','COVER','REPORT_PDF'),
            storage_key text unique, mime, size_bytes, checksum_sha256, uploaded_by, created_at, expires_at null)
security_event(id, user_id null, type, ip, device, browser, result, created_at)   -- neat 1-year retention job
audit_event(id, actor_user_id, actor_role, action, business_id null, detail jsonb, created_at)
report_job(id, business_id null, requester_user_id, scope jsonb, status, file_object_id null, created_at, finished_at)
```

## 3. Constraints & guarantees

| Guarantee                                                       | Mechanism                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exactly 1 Super Admin / 2 Admins (REQ-037/038)                  | `admin_account_constraint` guard evaluated in Admin-account transaction + tests                                                                                                                                                                                 |
| Payment status only {Pending,Accepted,Rejected} (REQ-100/SM-12) | `CHECK` constraint on `payment.status`                                                                                                                                                                                                                          |
| Booking status six-value set (REQ-101)                          | `CHECK` on `booking.status`                                                                                                                                                                                                                                     |
| Unique active slot lock (REQ-121)                               | Partial unique index on exact slot identity `(business_id, slot_date, start_at) WHERE status IN ('LOCKED','ALLOCATED')` — **defense-in-depth**; overlap of different windows is prevented by the advisory lock + in-transaction overlap re-check (doc 08 §1/§3) |
| Unique slug (REQ-047)                                           | unique index on `business.public_slug` citext                                                                                                                                                                                                                   |
| One payment per booking                                         | unique on `payment.booking_id`                                                                                                                                                                                                                                  |
| Immutable snapshots (REQ-076)                                   | `BookingService` rows written once; no update path                                                                                                                                                                                                              |
| History append-only (REQ-173/163)                               | service-level: only INSERT; no UPDATE/DELETE grants for app role on history tables                                                                                                                                                                              |
| Proof resubmission lineage (REQ-230)                            | `payment_proof.replaced_by_proof_id` self-FK chain                                                                                                                                                                                                              |
| Resubmission requires verification (doc 08 §9)                  | `resubmission_verification` single-use, hashed, expiring code bound to the booking's phone; success required for the `REJECTED → PAYMENT_PENDING` transition                                                                                                    |
| Idempotent submissions                                          | unique `submission_key` per proof submission                                                                                                                                                                                                                    |
| Minutes precision (REQ-226)                                     | `CHECK (extract(second from start_at) = 0 and extract(millisecond from ...)=0)`                                                                                                                                                                                 |
| Deactivation, never hard delete (REQ-216/077)                   | business/services have no DELETE path                                                                                                                                                                                                                           |

## 4. Row-Level Security (defense-in-depth)

- Enable RLS on all `business_id` tables.
- Policy for `app` role: `USING (business_id = current_setting('app.business_id')::uuid)` for tenant tables; the API sets `app.business_id` (and `app.scope`) per request within its connection transaction. Owner with multiple businesses: policy uses membership lookup via `business_owner`.
- Super Admin elevated reads run in a separate scoped role/session (`app_superadmin`) used only by audited SuperAdmin flows.
- **Migration note:** migrations run as `migrator` (RLS bypassed) and must not be run inside app connections.

## 5. Migration strategy

- **Tool:** Prisma Migrate; all schema in `schema.prisma`; reviewable SQL migrations committed.
- **Workflow:** migrate locally → CI test env → staging → production (manual approval), all forward-only. Rollback = reverse migration only for the immediate step (backup-first); domain rollbacks are handled by data correction, not schema rollback.
- **Foreign-key/not-null changes:** standard expand/contract (add nullable → backfill → set NOT NULL → drop old).
- Seeded reference data: `business_category` (Salon & Barber, Other), standard subscription price (single value, REQ-125), `admin_account_constraint`, Super Admin bootstrap flag.

## 6. Read-model options

- Default: queries hit normalized tables with composite indexes.
- Optional short-TTL cache (Redis, ≤60 s) for **public availability snippets** — never authoritative; concurrent booking still goes through the transactional path (doc 08).
- Reporting queries (history-heavy) use direct SQL over history tables with pagination; no separate reporting DB in this phase (performance headroom is adequate — doc 25).
