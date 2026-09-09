# 05 — Domain Architecture

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06

## 1. Domain model overview

The functional specification's 22 domains (Master Spec §4) map to six architectural domain groups. IDs stay flat (`REQ-NNN`); grouping is organizational only.

| Architectural group           | Functional domains (§)                                               | Core aggregates                                        |
| ----------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------ |
| **Identity & Access**         | 3 Authentication, 4 Roles, 18 Security, 20 Administration            | `User`, `Session`, `AdminAccount`                      |
| **Business & Catalog**        | 1 Platform/SaaS, 2 Tenant/Business, 8 Services, 19 Public Page       | `Business`, `Service` (variations/add-ons)             |
| **Scheduling & Availability** | 9 Scheduling, 15 Schedule Exceptions, 21 Date/Time, 14 Pause         | `ScheduleVersion`, `ScheduleException`, `PauseState`   |
| **Booking & Payment**         | 5 Public Booking, 6 Customers, 10 Lifecycle, 11 Payments, 7 Telegram | `Booking`, `Payment`, `SlotLock`, `TelegramConnection` |
| **Subscription**              | 12 Subscription, 13 Notifications                                    | `Subscription`, `SubscriptionPayment`                  |
| **Reporting & Audit**         | 16 Audit/History, 17 Reports/Exports                                 | history event streams, report projections              |

## 2. Aggregates and invariants

| Aggregate                            | Composition                                                                                              | Root invariant                                                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Booking**                          | `Booking` + `BookingService[]` (snapshots) + `Payment` + payment proofs + `BookingStatusHistory[]`       | Single active state in the six-value set; Completed/No Show terminal; snapshots immutable (REQ-076); owner-only mutations except creation/resubmission (REQ-058/059) |
| **SlotLock** (bounded by Booking tx) | `SlotLock` row keyed to (business, date, start, end)                                                     | At most one active lock per window (first-wins, REQ-121); no expiry (OQ-SLOT-001); release only per workflow (SM-08/SM-09)                                           |
| **Business**                         | `Business` + `BusinessSettings` + `BusinessCategory` + `PublicSlug` + pause state + subscription pointer | One queue/schedule (REQ-009); independent subscription (REQ-127); never hard-deleted (REQ-216)                                                                       |
| **ScheduleVersion**                  | `ScheduleVersion` + `WorkingPeriod[]` + `BlockedPeriod[]` + `SpecialDate[]`                              | Every saved state retained (REQ-162); latest active applies for availability; latest pending promotes on resume (REQ-151)                                            |
| **Service**                          | `Service` + `ServiceVariation[]` + `AddOn[]`                                                             | No hard-delete with future bookings (REQ-077); deactivate only (REQ-078)                                                                                             |
| **Subscription**                     | `Subscription` + `SubscriptionPayment[]` + proofs + `SubscriptionStatusHistory[]`                        | Durations/graces fixed (REQ-128–131); booking eligibility derived (doc 15)                                                                                           |
| **User**                             | `User` + `Session[]` + `VerificationToken` lifecycle                                                     | Role fixed per account; owners multi-business (REQ-013); password changes revoke sessions (REQ-035)                                                                  |

## 3. Bounded-context responsibilities summary

- **Scheduling** owns time rules only; **Availability** computes free time by combining schedule + bookings + locks + gates (never owns data).
- **Booking** owns the lifecycle; **Payment** owns payment status (separate per REQ-100); **SlotLock** owns the durable claim.
- **Subscription** owns monetary entitlement; **Pause** owns booking-entry gating; jointly they gate availability (doc 10/15).
- **Reporting** reads history; **Audit** records it.

## 4. Anti-corruption rules

- Payment never reads booking state to infer payment status; they are separate (REQ-100).
- Scheduling never mutates bookings (REQ-090) — it only warns (REQ-092) and creates exceptions when the owner opts in (REQ-159/160).
- Pause only disables **new** bookings (REQ-147); existing bookings unaffected; public page stays visible (REQ-146).
- Subscription expiration never deletes or hides owner data (REQ-141).

## 5. Snapshot model

`BookingService` rows snapshot service name, price, and duration (plus variation/add-on choices and their deltas) at booking time. Rationale: future price/duration edits (REQ-071/073/075) must not alter existing bookings (REQ-076). Snapshots are written once inside the booking transaction and never mutated (REQ-080).

## 6. Schedule exceptions

`ScheduleException` represents an owner-kept booking that conflicts with a new schedule (REQ-159/160). It must not be confused with "availability"; exception creation is an owner decision, recorded and visible (REQ-161), generated during `ScheduleVersion` application warnings (REQ-099).
