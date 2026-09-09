# 03 — Logical Architecture

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06

## 1. Module map

Modules are implemented as NestJS feature modules in a **modular monolith**. Each module owns its tables and exposes public interfaces; no module writes another module's tables directly.

| #   | Module                      | Responsibility                                                                                    | Owned data (tables)                                                                                                      | Public interfaces                                                                         | Depends on                                                |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | Identity & Authentication   | Registration, email verification, login, password reset/change, sessions, lockout, 2FA-ready      | `User`, `Session`, `VerificationToken`, `PasswordResetToken`, `RecoveryToken`, `LoginAttempt` (part of Security)         | `AuthService`; REST auth endpoints; `OnLogin` event                                       | Security (events)                                         |
| 2   | User & Account Mgmt         | Roles, account lifecycle, Admin account mgmt, force-logout                                        | `User.role`, `AdminAccountConstraints` (2 Admins)                                                                        | `AccountService`; admin endpoints                                                         | IAM (users)                                               |
| 3   | Tenant / Business Mgmt      | Business registration, owner links, deactivation, subscription pointer                            | `Business`, `BusinessOwner`, `BusinessCategory`, `BusinessSettings`, `PublicSlug`                                        | `BusinessService`; dashboard context service                                              | IAM, Subscription                                         |
| 4   | Public Business Page        | Public page rendering data: name/logo/cover/desc/map/contact/services/content/categories          | reads `Business`, `BusinessSettings`, `Service`, `ScheduleVersion` (read-only), Pause state                              | `PublicPageService` (read-only, per-slug)                                                 | Business, Services, Scheduling, Pause                     |
| 5   | Services / Catalog          | Services, variations, add-ons, pricing/duration, deactivation, snapshots                          | `Service`, `ServiceVariation`, `AddOn`, `BookingService` (snapshot)                                                      | `CatalogService`                                                                          | — (booking snapshots owned by Booking)                    |
| 6   | Scheduling                  | Schedule versions, working periods, blocks, special dates, bookings context                       | `ScheduleVersion`, `WorkingPeriod`, `BlockedPeriod`, `SpecialDate`, `ScheduleException`                                  | `ScheduleService` (apply version, warnings), `ScheduleHistory` recorder                   | Audit                                                     |
| 7   | Availability                | Compute available slots per business/day                                                          | none (reads scheduling + bookings + locks + gates)                                                                       | `AvailabilityService` (pure function)                                                     | Scheduling, Booking (read), SlotLock, Pause, Subscription |
| 8   | Booking                     | Booking lifecycle, snapshots, transitions                                                         | `Booking`, `BookingService`, `BookingStatusHistory`, `BookingNote`                                                       | `BookingService` (submit, accept, reject, complete, no-show, cancel, reschedule, release) | Payment, SlotLock, Availability, Notifications            |
| 9   | Payment (customer)          | Payment status per booking, proof, verification                                                   | `Payment`, `PaymentProof`, `PaymentStatusHistory`                                                                        | `PaymentService`                                                                          | FileStorage, Booking, Notifications                       |
| 10  | Slot Locking                | Durable slot locks, atomic claim, release                                                         | `SlotLock` (+ optional history)                                                                                          | `SlotLockService` (claim, release on workflow)                                            | — (called inside Booking tx)                              |
| 11  | Notifications               | Event-driven outbox: notification events, deliveries, retries                                     | `Notification`, `NotificationDelivery`, `NotificationRecipient`                                                          | `NotificationService` (emit, deliver); outbox table                                       | —                                                         |
| 12  | Telegram Integration        | Connection registry, webhook handling, sending                                                    | `TelegramConnection`, `TelegramUpdate` (dedup), `TelegramOutbox` (use NotificationDelivery)                              | `TelegramService` (link/unlink, handleWebhook, send)                                      | Notification, Identity                                    |
| 13  | Subscription                | Per-business subscription states, trial/grace, proof, review, reminders                           | `Subscription`, `SubscriptionPayment`, `SubscriptionPaymentProof`, `SubscriptionStatusHistory`                           | `SubscriptionService` (activate, extend, expire, review)                                  | Payment(file proofs), Notifications                       |
| 14  | Pause / Resume              | Pause state, resume dates, pending schedules, resume logic                                        | `PauseState` (on BusinessSettings), `PauseEvent` (history)                                                               | `PauseService` (pause, resume manual/auto, evaluate)                                      | Scheduling, Subscription                                  |
| 15  | Reporting                   | Booking reports, current status, history queries, exports (async)                                 | report read models / queries (no owned tables; uses Booking+History+Payment)                                             | `ReportService` (query, requestExport)                                                    | Booking, Audit, PDF (via Notification/File)               |
| 16  | Audit / History             | Append-only history stores                                                                        | `BookingStatusHistory`, `ScheduleHistory` (derived from ScheduleVersion), `SecurityEvent`, `AuditEvent`, `DeletionAudit` | `AuditService` (record)                                                                   | —                                                         |
| 17  | Platform Administration     | Super Admin/Admin operations: Admin mgmt, force logout, reviews, security deletion, recovery      | uses IAM/Subscription/Security/Reporting                                                                                 | `AdminService`                                                                            | many                                                      |
| 18  | File Storage                | Object key mgmt, presigned URLs, upload policy, retention/orphan                                  | `FileObject` (metadata)                                                                                                  | `FileStorageService`                                                                      | — (S3 adapter)                                            |
| 19  | Background Jobs (scheduler) | BullMQ workers: reminders, completion, resume, subscription processing, retries, cleanup, reports | job state in Redis/queue; results in domain tables                                                                       | `JobService` definitions                                                                  | many                                                      |
| 20  | API Gateway/Controllers     | REST boundaries, auth, tenant scope, rate limiting, OpenAPI                                       | —                                                                                                                        | REST controllers (doc 18)                                                                 | all                                                       |

## 2. Shared cross-cutting concerns

- **Tenant context**: request-scoped `TenantContext { businessId? }`; injected by middleware for dashboard APIs; enforced by repository/service guards (doc 04).
- **Actor context**: `ActorContext { role, userId?, businessId? }` from session; written to every history record.
- **Idempotency**: `SubmissionKey`, `UpdateId`, job keys — enforced centrally.
- **Error envelope**: unified error schema (doc 23).
- **Correlation ID**: request-scoped, logged, propagated to jobs and notifications (doc 24).

## 3. Transaction boundaries

| Operation                            | Transaction scope (Postgres)                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Create booking + payment + slot lock | Single transaction (doc 08): advisory xact lock(business) → availability re-check → inserts           |
| Accept/Reject proof                  | Single transaction: booking + payment + history updates; notifications after commit                   |
| Reschedule                           | Single transaction: old slot release + new slot claim (under same business advisory lock)             |
| Schedule version apply               | Single transaction: new `ScheduleVersion` + warnings evaluation; pending version on paused businesses |
| Subscription review                  | Single transaction: SubscriptionPayment + Subscription state + history; notifications after commit    |
| Pause/Resume                         | Single transaction: PauseEvent + BusinessSettings; resume also activates latest pending schedule      |
| Background jobs                      | Each job = one transaction; job is idempotent (doc 17)                                                |

## 4. Security boundaries

- **Public boundary**: availability reads + booking submission + page reads + auth endpoints (forgot-password) + Telegram callback. No tenant data beyond the business's own public page.
- **Owner boundary**: own businesses only (REQ-043). Every resource query must include `business_id IN ownerBusinessIds` — never ID-only.
- **Admin boundary**: subscription review, current-status views; explicitly **no** schedule history (REQ-168), no full booking history (REQ-176), no password self-change (REQ-218).
- **Super Admin boundary**: platform-wide access (REQ-041) with its own elevated, audited paths (full history, PDF export, security deletion, Admin mgmt, force logout).
- **System boundary**: internal service-to-service via dedicated contexts, never user sessions.

## 5. Key invariants (module-level)

- **Availability module**: never marks a slot available if the booking wouldn't fit remaining time (REQ-089); computed against the **active** schedule version only.
- **Booking module**: state set exactly the six values (REQ-101); Completed/No Show terminal (SM-10); creation only via public flow (REQ-059); snapshots immutable once paid (REQ-076).
- **Payment module**: status in {Pending, Accepted, Rejected} (REQ-100); rejection requires reason (REQ-124); no refund state (REQ-122).
- **SlotLock module**: one active lock per slot window; no TTL (OQ-SLOT-001); explicit release rules (SM-08/SM-09).
- **Subscription module**: exactly one standard price (REQ-125); durations/graces fixed; independent per business (REQ-127).
- **Pause module**: paused ⇒ new bookings disabled (REQ-147); indefinite pause never auto-resumes on renewal (REQ-156).
- **Scheduling module**: every saved state is a retained version (REQ-162); latest pending promotes on resume (REQ-151).
- **Audit module**: history is append-only; deletion only via Super Admin paths and itself audited (REQ-205/206).

## 6. Module dependency rules

- **Acyclic feature graph**; a dependency from `X→Y` means X may call Y's public interface only.
- Approval of dependency direction: `Booking → {SlotLock, Payment, Availability, Notification}`; `Payment → {FileStorage}`; `Report → {Booking, Audit}`; `Subscription → {FileStorage, Notification}`; no module depends on the controllers.
- **Strict access rule**: any cross-module read of `Booking`/`SlotLock` by `Availability` is read-only and must be scoped by `business_id`.
