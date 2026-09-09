# 06 — Data Architecture

> **Architecture Version:** 1.0.1 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06 (+ Prompt 06-CORRECTION: `ResubmissionVerification` entity; SlotLock ALLOCATED note)

Physical schema details live in `07-database-design.md`. This document explains each conceptual entity and **why it exists**. Entities marked **(optional)** are required to support a behavior but carry no separate product rule.

## 1. Identity & access

| Entity                                  | Why it exists                                                                                                       | Key constraints                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `User`                                  | Owners, Admins, Super Admin have accounts (REQ-024); customers do **not** (REQ-040).                                | unique email; `role` in {OWNER, ADMIN, SUPER_ADMIN}; verified flag   |
| `Session`                               | Server-side revocable sessions → logout-everywhere (REQ-035), force-logout (REQ-220), device recognition (REQ-197). | token_hash unique; `active_business_id` nullable; device fingerprint |
| `VerificationToken`                     | Email verification, time-limited, one-use (REQ-026–031).                                                            | unique (user, purpose); expiry; single active                        |
| `PasswordResetToken`                    | Forgot password (REQ-033); resets clear lock (REQ-194).                                                             | unique; expiry; single active                                        |
| `RecoveryToken`                         | Super Admin emergency recovery one-time code (REQ-198–200).                                                         | unique; expiry; single-use                                           |
| `AdminAccountConstraint` **(optional)** | Enforces exactly 1 Super Admin / exactly 2 Admins (REQ-037/038) and account-creation by Super Admin only (REQ-039). | structural guard table/singleton; enforced transactionally           |

## 2. Business & catalog

| Entity                                  | Why it exists                                                                                                                                                | Key constraints                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `Business`                              | The tenant root; never hard-deleted (REQ-216); deactivate/close only.                                                                                        | UUID pk; public_slug unique (REQ-047/048); category FK    |
| `BusinessOwner`                         | Ownership matrix; one owner may run many businesses (REQ-013); per-business dashboard context (REQ-014).                                                     | unique (user_id, business_id)                             |
| `BusinessCategory`                      | Exact categories **Salon & Barber**, **Other** (REQ-215).                                                                                                    | code unique; seeded, not editable beyond approved set     |
| `BusinessSettings`                      | Prepayment percent/fixed (REQ-111), booking interval (REQ-088), pause flag + message + reopen date (REQ-148/149), deactivated flag, active-schedule pointer. | 1:1 business                                              |
| `PublicSlug` **(folded into Business)** | Reserved slugs, change history re-points QR (REQ-049).                                                                                                       | unique; change log                                        |
| `Service`                               | Catalog item with base price/duration (REQ-071). Soft-deactivate when future bookings exist (REQ-077/078).                                                   | unique (business, name); status active/inactive (REQ-081) |
| `ServiceVariation`                      | Options/price/duration deltas (REQ-072).                                                                                                                     | unique (service, name)                                    |
| `AddOn`                                 | Add-ons may change price/duration (REQ-073).                                                                                                                 | unique (service, name)                                    |

## 3. Scheduling

| Entity              | Why it exists                                                                                                                                         | Key constraints                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ScheduleVersion`   | Every saved schedule state is retained (REQ-162); history with actor/when/what/reason (REQ-163/164/165); pending versions while paused (REQ-150/151). | immutable row per save; `status` ACTIVE/PENDING; `applied_at`; line of versions per business |
| `WorkingPeriod`     | Multiple periods per day (REQ-083).                                                                                                                   | child of version; (weekday, start, end) no overlap within version                            |
| `BlockedPeriod`     | Period/day blocking (REQ-084/085).                                                                                                                    | child of version; day or (day, start, end)                                                   |
| `SpecialDate`       | Override weekly schedule with custom hours or closure (REQ-086/087).                                                                                  | child of version; unique per date                                                            |
| `ScheduleException` | Owner "Keep Booking" on conflict → approved exception (REQ-159/160), recorded/visible (REQ-161).                                                      | references booking + schedule version; created by owner; audit-visible                       |

## 4. Booking & payment

| Entity                                      | Why it exists                                                                                                                                                                                                                  | Key constraints                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `Booking`                                   | Lifecycle root: name/phone (REQ-054), note (REQ-055), status (REQ-101), scheduled start/end.                                                                                                                                   | business_id FK; status in six-value set; start/end store timezone-abbrev dashboard display still uses global TZ (REQ-222)  |
| `BookingService`                            | Multiple services per booking (REQ-070); **immutable snapshot** of name/price/duration incl. variation/add-on deltas (REQ-074–076).                                                                                            | written once at booking; never mutated (REQ-080)                                                                           |
| `BookingStatusHistory`                      | Full status history internally (REQ-173): actor, date/time, previous, new. Immutable.                                                                                                                                          | append-only; preserves tenant scope                                                                                        |
| `Payment`                                   | Separate payment status (REQ-100); status in {Pending, Accepted, Rejected} only (SM-12/REQ-100).                                                                                                                               | unique business+booking linkage; status constraint                                                                         |
| `PaymentProof`                              | Customer proof image/PDF (REQ-117/118); versioned — resubmission creates new proof (REQ-230, REQ-123).                                                                                                                         | file ref; submitted_at; replaced_by/previous linkage for history                                                           |
| `ResubmissionVerification`                  | **Security control** (doc 08 §9): one-time, hashed, expiring code bound to the booking's phone, required before `REJECTED → PAYMENT_PENDING` reset of a rejected booking (T10). No customer account; no new booking reference. | single-use; code_hash only; bound to booking + phone                                                                       |
| `PaymentStatusHistory` **(optional)**       | Payment transitions (Pending→Accepted/Rejected; Rejected→Pending) for audit (REQ-173 covers booking; payment history complements reporting).                                                                                   | append-only                                                                                                                |
| `SlotLock`                                  | Durable "first wins" claim on a slot window (REQ-121); no expiry (OQ-SLOT-001); status LOCKED/ALLOCATED/RELEASED. ALLOCATED = lock attached to a confirmed booking (formally defined in doc 09 §4.1).                          | unique active lock per exact (business, date, start, end) via partial unique index (defense-in-depth); booking_id nullable |
| `CustomerContact` **(folded into Booking)** | Name/phone live on the booking (REQ-054). No anonymous account exists.                                                                                                                                                         | —                                                                                                                          |

## 5. Telegram & notifications

| Entity                                  | Why it exists                                                                                                       | Key constraints                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `TelegramConnection`                    | Optional customer link to a business's Telegram bot (REQ-056); owner/business Telegram for notifications (REQ-139). | unique (user or booking-customer token, telegram_chat_id); status active/revoked |
| `Notification`                          | One domain event → notification record (content type, channel set, payload ref).                                    | not transactional with bookings (doc 13)                                         |
| `NotificationDelivery`                  | Per channel + recipient delivery row with status/attempts/next_attempt.                                             | idempotency key; retry timing                                                    |
| `TelegramUpdate` (dedup) **(optional)** | Record processed Telegram update ids to guarantee at-most-once webhook handling.                                    | unique update_id                                                                 |

## 6. Subscription

| Entity                                     | Why it exists                                                                                                                                                             | Key constraints                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `Subscription`                             | Independent per business (REQ-127): status, start, current period end, grace end, trial window.                                                                           | 1:1 business; status transitions append-only history   |
| `SubscriptionPayment`                      | One manual bank transfer per renewal request (REQ-135/136); reviewed by Admin/Super Admin (REQ-137); approval extends 30 days (REQ-130); rejection with reason (REQ-138). | business_id; review state; reviewed_by; approved_until |
| `SubscriptionPaymentProof`                 | Owner upload image/PDF (REQ-136).                                                                                                                                         | file ref, immutable                                    |
| `SubscriptionStatusHistory` **(optional)** | Status transitions (trial→trial grace→expired→active…) and auto-resume events (REQ-154/231).                                                                              | append-only                                            |

## 7. Files

| Entity       | Why it exists                                                                                                                      | Key constraints                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `FileObject` | Metadata for stored objects: business scope, category (proof/logo/cover/report/pdf), mime, size, checksum, retention, storage_key. | storage_key unique; never exposes presign outside scope |

## 8. Audit, security & reports

| Entity                                       | Why it exists                                                                                                                                           | Key constraints                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `SecurityEvent`                              | Login success/failure (REQ-191/192), device recognition (REQ-197), lockouts (REQ-193/195), recovery, deletion (REQ-205/206). Retained 1 year (REQ-204). | actor + type + ip + device/browser + result; TTL-enabled |
| `AuditEvent`                                 | Sensitive administrative actions (Admin mgmt REQ-039, force-logout REQ-220, subscription review, security deletion REQ-206, exports REQ-178).           | append-only; actor                                       |
| `ReportJob` / export metadata **(optional)** | Async PDF generation tracking (doc 21): status, requester, scope, file ref.                                                                             | tenant scoped                                            |

## 9. Cross-cutting columns

Conventions (same names everywhere): `id UUID PK` · `business_id UUID NOT NULL REFERENCES business(id)` on tenant rows · `created_at`, `updated_at` timestamptz · **soft-delete/deactivation** via explicit status flags (services `is_active`; business `deactivated_at`; never row-delete business/service with history) · **immutable/snapshot** fields marked `immutable` in schema comments (`BookingService`; `ScheduleVersion` content; history rows) · **audit fields**: `created_by`, `actor_type`, `reason`, plus history tables.

## 10. Tenant ownership matrix (summary)

Every table that can be reached by `business_id` is in the RLS policy set and the repository scoping set: `business`, `business_settings`, `business_owner`, `service`, `service_variation`, `add_on`, `schedule_version`, `working_period`, `blocked_period`, `special_date`, `schedule_exception`, `booking`, `booking_service`, `booking_status_history`, `payment`, `payment_proof`, `payment_status_history`, `slot_lock`, `notification`, `notification_delivery`, `subscription`, `subscription_payment`, `subscription_payment_proof`, `file_object`, `telegram_connection` (by business/owner), report metadata. Platform tables (users/sessions/security/audit) use role-based filters instead.
