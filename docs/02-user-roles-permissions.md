# 02 — User Roles and Permissions

> **Status:** DOCUMENTED FROM APPROVED FACTS AND PROMPT 05-FIX DECISIONS — NO INVENTED PERMISSIONS
> **Version:** 0.5.0
> **Last Updated:** 2026-09-05
>
> **PURPOSE:** This document defines the five platform roles and, for each role, the permissions that are **Allowed**, **Not allowed**, **Conditional**, or **Pending clarification**, each backed by approved facts (`KF-*`) and the corresponding requirements (REQ-*). It is a sibling of [02-open-questions.md](02-open-questions.md) (unresolved items) and maps to [01-master-specification.md](01-master-specification.md).
>
> **Rule:** Every permission listed is derived from an approved fact or an approved decision. Nothing below is invented. Where an approved fact does not answer a question, the item is marked **Pending clarification**, never silently assumed.
>
> **Change note (Prompt 05-FIX):** The final approved decisions were applied. **Telegram is now optional** for customers — booking without Telegram is **Allowed** (OQ-CUST-001). Customer notification rows are conditioned on "if connected" and the new No Show / cancellation / reschedule notifications (SM-05/06/07) are added. The owner cancel action now covers **Payment Pending** bookings (slot stays blocked until explicit release, SM-08) and releasing/cancelling a **Rejected** booking (SM-09). Custom payment methods are no longer configurable (OQ-PAY-001); business categories are exactly Salon & Barber + Other (OQ-PUB-001). OQ-CUST-001 and OQ-BOOK-001 are resolved (phone-number booking identification, OQ-BOOK-001).
>
> **RELATED FILES:**
>
> - [01-master-specification.md](01-master-specification.md) — authoritative requirements (REQ-001 … REQ-232)
> - [02-open-questions.md](02-open-questions.md) — unresolved / ambiguous items (all currently resolved)
> - [250-approved-decisions.md](250-approved-decisions.md) — canonical decision register
> - [consistency-audit.md](consistency-audit.md) — conflict resolution and cross-domain findings
> - [requirements-traceability.md](requirements-traceability.md) — REQ → KF/DEC traceability

---

## 1. Role Overview

| Role               | Count / identity                                                                               | Platform account | Primary function                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Super Admin**    | Exactly 1 (KF-ROLE-02 → REQ-037)                                                               | Yes              | Platform-wide access; admin-account lifecycle; full history views; security administration (KF-ROLE-06 → REQ-041).     |
| **Admin**          | Exactly 2 (KF-ROLE-03 → REQ-038)                                                               | Yes              | Restricted administrative access; subscription-proof review; current-status-only booking views (KF-ROLE-07 → REQ-042). |
| **Business Owner** | One owner per business; one owner can manage multiple businesses (KF-ACCT-01/02 → REQ-012/013) | Yes              | Operates within businesses they own/manage only (KF-ROLE-08 → REQ-043); full business management.                      |
| **Customer**       | No platform account (KF-CUST-01 / KF-ROLE-05 → REQ-040)                                        | No               | Public booking flow; optional Telegram connection; receives notifications (if connected).                              |
| **System**         | Automatic actor for system-generated changes (KF-ROLE-09)                                      | N/A              | Automatic transitions and automatic schedule changes (e.g., REQ-102, REQ-165).                                         |

The five-role set is closed (REQ-036). No additional platform roles may be added without changing that requirement.

---

## 2. Permission Classification

| Status                    | Meaning                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Allowed**               | The role can perform this action (per an approved fact / requirement).                               |
| **Not allowed**           | The role is explicitly prohibited from performing this action (per an approved fact / requirement).  |
| **Conditional**           | Allowed subject to an explicit condition (listed in the row).                                        |
| **Pending clarification** | The approved facts do not yet answer the question; recorded as an open item. No behavior is assumed. |

---

## 3. Cross-cutting Rules

- **Tenant isolation:** A Business Owner of Business A NEVER accesses Business B data (bookings, customers, services, schedules, payment proofs, subscription info, reports, audit/history, business configuration). See [consistency-audit.md](consistency-audit.md) §8.1.
- **Exceptions (approved):**
  - **Super Admin** has platform-wide access to relevant data across all businesses (KF-ROLE-06 → REQ-041).
  - **Admin** has restricted administrative access limited to its defined administrative functions (KF-ROLE-07 → REQ-042); an Admin cannot view schedule history and sees only current booking status.
- **No delegation / impersonation is defined** — an owner acting on another business's configuration, or a Super Admin/Admin acting as an owner, is **Pending clarification** (see §9).

---

## 4. Super Admin

Exactly one Super Admin account exists (REQ-037). Platform-wide actor (REQ-041).

| Permission                                                                                | Status                                                                   | Basis                            |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------- |
| Access all businesses and their relevant data platform-wide                               | **Allowed**                                                              | KF-ROLE-06; REQ-041              |
| View full booking status history                                                          | **Allowed**                                                              | KF-REPORT-06; REQ-177            |
| Export full booking status history to PDF                                                 | **Allowed**                                                              | KF-REPORT-07; REQ-178            |
| Export scope: all businesses OR one selected business                                     | **Conditional** (all, or exactly one business; multi-select not allowed) | KF-REPORT-09/10; REQ-180/181     |
| View schedule history                                                                     | **Allowed**                                                              | KF-SCHED-19; REQ-167             |
| Export schedule history as PDF                                                            | **Allowed**                                                              | KF-SCHED-22; REQ-170             |
| Create, deactivate, and manage Admin accounts                                             | **Allowed**                                                              | KF-ROLE-04; REQ-217, REQ-039     |
| Change Admin passwords                                                                    | **Allowed** (also logs the Admin out everywhere)                         | KF-SEC-07; REQ-219, REQ-035      |
| Force-log-out Owners and Admins                                                           | **Allowed** (immediate email to affected user)                           | KF-SEC-04/05; REQ-220/221        |
| View all relevant security history                                                        | **Allowed**                                                              | KF-SEC-17; REQ-203               |
| Delete security/activity records                                                          | **Allowed** (the deletion itself is audited)                             | KF-AUTH-08; REQ-205/206          |
| Emergency recovery via separate recovery email with one-time code                         | **Allowed**                                                              | KF-SEC-01/02/03; REQ-198/199/200 |
| Review subscription payment proofs                                                        | **Allowed**                                                              | KF-SUB-07; REQ-137               |
| Create bookings from the dashboard or Telegram                                            | **Not allowed**                                                          | KF-CUST-05/06/07; REQ-059        |
| Receive the two subscription-payment notifications                                        | **Not allowed** (that role belongs to the two Admins)                    | KF-SUB-17; REQ-140               |
| Act as/impersonate a Business Owner (manage business configuration on the owner's behalf) | **Pending clarification**                                                | not defined by approved facts    |
| View/export customer booking-history reports per business as owner would                  | **Pending clarification**                                                | not defined by approved facts    |

---

## 5. Admin

Exactly two Admin accounts exist (REQ-038). Restricted administrative access (REQ-042).

| Permission                                                                  | Status                                              | Basis                                           |
| --------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------- |
| Review subscription payment proofs (with Super Admin)                       | **Allowed**                                         | KF-SUB-07; REQ-137                              |
| Approve subscription proof → activates/extends subscription 30 days         | **Allowed**                                         | KF-SUB-08; REQ-137 AC2                          |
| Reject subscription proof (reason required; reason sent to owner)           | **Allowed**                                         | KF-SUB-14/15; REQ-138                           |
| Receive subscription-payment notifications (exactly the two Admin accounts) | **Allowed**                                         | KF-SUB-17; REQ-140                              |
| View current booking status only (no full history)                          | **Allowed**                                         | KF-REPORT-05; REQ-176                           |
| View own security history                                                   | **Allowed**                                         | KF-SEC-16; REQ-202                              |
| Have own password changed by the Super Admin                                | **Allowed** (requires Super Admin action)           | KF-SEC-07; REQ-219                              |
| View schedule history                                                       | **Not allowed**                                     | KF-SCHED-20; REQ-168                            |
| Change own password                                                         | **Not allowed**                                     | KF-SEC-06; REQ-218                              |
| View full booking history                                                   | **Not allowed**                                     | KF-REPORT-05; REQ-176                           |
| Export full booking status history to PDF                                   | **Not allowed**                                     | KF-REPORT-07; REQ-178 (Super Admin only)        |
| Create/deactivate/manage Admin accounts                                     | **Not allowed**                                     | KF-ROLE-04; REQ-039, REQ-217 (Super Admin only) |
| Force-log-out users                                                         | **Not allowed**                                     | KF-SEC-04; REQ-220 (Super Admin only)           |
| Access owner business data beyond the approved administrative functions     | **Not allowed** (tenant isolation; restricted role) | KF-ROLE-07; REQ-042                             |
| Perform owner-specific actions (service/schedule/booking management)        | **Not allowed** unless a later decision grants it   | KF-ROLE-07; REQ-042                             |

---

## 6. Business Owner

One owner per business (REQ-012); one owner may manage multiple businesses (REQ-013). The owner operates only within businesses they own/manage (REQ-043). Deactivated/expired businesses remain openable by the owner for existing data (REQ-023).

| Permission                                                                                                               | Status                                                                                                     | Basis                                                      |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Register as a Business Owner / create a business                                                                         | **Allowed**                                                                                                | KF-BIZ-05; REQ-007                                         |
| Configure own business                                                                                                   | **Allowed**                                                                                                | KF-BIZ-11; REQ-011                                         |
| After login: select among owned businesses / direct-open when exactly one / see Create Business when none                | **Conditional**                                                                                            | KF-ACCT-05/06/08; REQ-016/017/018                          |
| Use a business switcher from the main dashboard; active business identity visible                                        | **Allowed**                                                                                                | KF-ACCT-09/10; REQ-019/020                                 |
| Last selected business remembered; may be opened automatically on next login                                             | **Conditional** (KF-ACCT-11 remembered; KF-ACCT-12 auto-open is MAY)                                       | REQ-021/022                                                |
| Open deactivated/expired businesses to manage existing data                                                              | **Allowed**                                                                                                | KF-ACCT-13; REQ-023                                        |
| Verify payment proof in dashboard                                                                                        | **Allowed**                                                                                                | KF-PAY-07; REQ-119                                         |
| Verify payment proof via Telegram (with details + proof)                                                                 | **Allowed**                                                                                                | KF-PAY-07; REQ-120, REQ-066                                |
| Accept a booking from Telegram                                                                                           | **Allowed**                                                                                                | KF-TG-07; REQ-067                                          |
| Reject a booking from Telegram (reason required; customer gets the reason)                                               | **Allowed**                                                                                                | KF-TG-07/08/09; REQ-068, REQ-062                           |
| Mark a booking as No Show                                                                                                | **Allowed** (terminal; no transition out)                                                                  | KF-BOOK-05; REQ-103, SM-10                                 |
| Cancel a Confirmed booking                                                                                               | **Allowed** (customer notified via Telegram, if connected)                                                 | KF-BOOK-06; REQ-104, REQ-228 (SM-06)                       |
| Cancel a Payment Pending booking (before verification)                                                                   | **Allowed** (slot stays blocked until the owner explicitly releases it; no customer notification required) | KF-BOOK-06; REQ-104 (SM-08)                                |
| Reschedule a confirmed booking to an available slot                                                                      | **Allowed** (customer notified with new date/time via Telegram, if connected)                              | KF-BOOK-11/16; REQ-105/106, REQ-229 (SM-07)                |
| Perform other modifications of an active booking (e.g., change services/price)                                           | **Pending clarification**                                                                                  | KF-CUST-09 "modify" scope (see SEM-003)                    |
| Handle manual cancellation/refund (no automatic refunds)                                                                 | **Allowed** (manual only)                                                                                  | KF-PAY-08/09; REQ-122                                      |
| Release a slot after a rejected proof                                                                                    | **Allowed** (release/cancel the rejected booking, releasing the slot)                                      | KF-BOOK-10; REQ-123 (SM-09 option A)                       |
| Configure prepayment as percentage or fixed amount                                                                       | **Allowed**                                                                                                | KF-PAY-02; REQ-111                                         |
| Configure payment methods (Bank Transfer, Telebirr / mobile money)                                                       | **Allowed** (initial set fixed; no custom methods in this phase)                                           | KF-PAY-03/04/05; REQ-112/113/114, REQ-115 (OQ-PAY-001)     |
| Configure services, variations/options, add-ons, prices and durations                                                    | **Allowed**                                                                                                | KF-SVC-01/02/03 (Services domain, master spec §12)         |
| Deactivate (soft-delete) services that have future bookings; reactivate later                                            | **Allowed**                                                                                                | KF-SVC-04/05/06/07/08 (Services domain)                    |
| Configure schedule: working hours (multiple periods), special dates, blocks, booking interval                            | **Allowed**                                                                                                | KF-SCHED-06/07/08/09 (Scheduling domain, master spec §13)  |
| Apply schedule changes even when they create conflicts; handle affected bookings with Reschedule / Cancel / Keep Booking | **Allowed**                                                                                                | KF-SCHED-24/31; REQ-099, REQ-159/160                       |
| View own schedule history                                                                                                | **Allowed**                                                                                                | KF-SCHED-19; REQ-166                                       |
| Restore / revert schedule history                                                                                        | **Not allowed**                                                                                            | KF-SCHED-21; REQ-169                                       |
| Export schedule history as PDF (custom start/end; versions + dates/times only)                                           | **Allowed**                                                                                                | KF-SCHED-22/23/32; REQ-170/171/172                         |
| View full booking status history for own bookings                                                                        | **Allowed**                                                                                                | KF-REPORT-04; REQ-174                                      |
| View booking reports (current status) with filters                                                                       | **Allowed**                                                                                                | KF-REPORT-01/13/14; REQ-175/184/185                        |
| Export booking-report PDF                                                                                                | **Pending clarification**                                                                                  | only Super Admin export is defined (KF-REPORT-07; REQ-178) |
| Create bookings from the dashboard                                                                                       | **Not allowed**                                                                                            | KF-CUST-06; REQ-059                                        |
| Create bookings via Telegram                                                                                             | **Not allowed**                                                                                            | KF-CUST-07; REQ-059                                        |
| Upload subscription payment proof (image/PDF)                                                                            | **Allowed**                                                                                                | KF-SUB-05/06; REQ-136                                      |
| Access dashboard and existing data after subscription expiration (with warning until renewal)                            | **Allowed**                                                                                                | KF-SUB-19/20/21/22/23; REQ-141, REQ-023                    |
| View own security/activity history                                                                                       | **Allowed**                                                                                                | KF-SEC-15; REQ-201                                         |
| Delete own security/activity records                                                                                     | **Not allowed**                                                                                            | KF-AUTH-08; REQ-205 (Super Admin only)                     |
| Pause bookings (indefinite or with automatic resume date); manage resume date                                            | **Allowed**                                                                                                | KF-PUB-13/14/17, KF-PAUSE-09/04/05; REQ-143/144/145/157    |
| Resume bookings manually (immediate if subscription active); auto resume per rules                                       | **Conditional**                                                                                            | KF-PAUSE-05; REQ-157, REQ-158                              |
| Deactivate/close the business (not permanently delete); reactivate                                                       | **Allowed**                                                                                                | KF-PUB-18/19/25/26; REQ-216                                |
| Access a business the owner does not own/manage                                                                          | **Not allowed** (tenant isolation)                                                                         | KF-ROLE-08; REQ-043                                        |

---

## 7. Customer

Customers have no platform accounts (REQ-040) and therefore have no dashboard, login, or owner-facing permissions.

| Permission                                                                                              | Status                                                   | Basis                                       |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------- |
| Book through the public booking page / QR flow                                                          | **Allowed**                                              | KF-CUST-05; REQ-045                         |
| Provide name and phone number; optional note                                                            | **Allowed**                                              | KF-CUST-02/03; REQ-054/055                  |
| Connect Telegram during booking (optional)                                                              | **Allowed** (optional; booking completes without it)     | KF-CUST-04, KF-TG-01; REQ-056 (OQ-CUST-001) |
| **Book without connecting Telegram**                                                                    | **Allowed** (no notification is sent to such a customer) | REQ-056 (OQ-CUST-001 RESOLVED)              |
| Select a payment method                                                                                 | **Allowed**                                              | KF-PAY-10; REQ-116                          |
| Upload payment proof (image/PDF)                                                                        | **Allowed**                                              | KF-PAY-11/06; REQ-117/118                   |
| Identify own booking by phone number (no customer-facing reference/code; internal Booking ID retained)  | **Allowed**                                              | KF-BOOK-14; REQ-109 (OQ-BOOK-001 RESOLVED)  |
| Receive payment-proof/verification-pending notification (Telegram, if connected)                        | **Allowed**                                              | KF-TG-02; REQ-060                           |
| Receive confirmation notification (Telegram, if connected)                                              | **Allowed**                                              | KF-TG-03; REQ-061                           |
| Receive rejection notification with reason (Telegram, if connected)                                     | **Allowed**                                              | KF-TG-03/09; REQ-062, REQ-124               |
| Receive reminders 24h and 1h before the appointment (Telegram, if connected)                            | **Allowed**                                              | KF-TG-04; REQ-063/064                       |
| **Receive No Show notification (Telegram, if connected)**                                               | **Allowed**                                              | REQ-227 (SM-05)                             |
| **Receive cancellation notification for a Cancelled Confirmed booking (Telegram, if connected)**        | **Allowed**                                              | REQ-228 (SM-06)                             |
| **Receive reschedule notification with the new date/time (Telegram, if connected)**                     | **Allowed**                                              | REQ-229 (SM-07)                             |
| **Submit new payment proof after a rejection (returns booking to Payment Pending; slot stays blocked)** | **Allowed**                                              | REQ-230 (SM-09 option B)                    |
| Cancel or modify own bookings                                                                           | **Not allowed**                                          | KF-CUST-08; REQ-058                         |
| View customer booking history through the public page                                                   | **Not allowed**                                          | KF-CUST-10; REQ-057                         |
| Access an owner dashboard / owner actions                                                               | **Not allowed** (no platform account)                    | REQ-040                                     |
| Receive a customer-facing booking reference/code                                                        | **Not allowed** (identification is by phone number)      | KF-BOOK-14; REQ-109                         |

---

## 8. System

The **System** is the automatic actor for system-generated changes (KF-ROLE-09). It has no login and no permission surface; it records its actions under the System actor identity.

| Behavior                                                                                                                                                                      | Status                  | Basis                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------- |
| Auto-transition Confirmed → Completed at the scheduled end time                                                                                                               | **Allowed (automatic)** | KF-BOOK-04; REQ-102                                                       |
| Lock the slot on successful proof submission (no automatic expiry; released only by an allowed workflow action)                                                               | **Allowed (automatic)** | KF-BOOK-08; REQ-121 AC5 (OQ-SLOT-001 RESOLVED)                            |
| Record automatic resume events and their outcomes in history (bookings stay closed when the subscription is expired)                                                          | **Allowed (automatic)** | REQ-231 (SM-13)                                                           |
| Record system-generated schedule changes with System actor + automatic reason                                                                                                 | **Allowed (automatic)** | KF-SCHED-18; REQ-165                                                      |
| Send automated notifications (customer proof/confirmation/rejection/reminders/No Show/cancellation/reschedule — to customers only if Telegram connected; owner notifications) | **Allowed (automatic)** | Telegram/notification requirements (REQ-060 … REQ-069, REQ-227 … REQ-229) |
| Send automatic refunds                                                                                                                                                        | **Not allowed**         | KF-PAY-08; REQ-122                                                        |
| Make product or business decisions autonomously                                                                                                                               | **Not allowed**         | documentation principle (no invented behavior)                            |

---

## 9. Open Clarifications Referenced by This Document

**All product open questions (OQ-CUST-001, OQ-BOOK-001, and the other four) are RESOLVED** by the Prompt 05-FIX approved decisions (see [02-open-questions.md](02-open-questions.md)). The remaining items below are documentation-level clarifications that are **not** product decisions:

| Item                                                                                               | Pending question                                                                                   | Where tracked                     |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------- |
| Owner "modify" scope beyond cancel/reschedule                                                      | What does KF-CUST-09 "modify" include besides cancel and reschedule?                               | consistency audit SEM-003         |
| Owner export of booking-report PDF                                                                 | Owner booking-history PDF export is not defined (only Super Admin export exists and is documented) | consistency audit / report domain |
| Super Admin/Admin acting as a Business Owner (business configuration management on owners' behalf) | Not defined by approved facts                                                                      | consistency audit §8.1            |

These items are **non-blocking for documentation**.

---

## 10. Verification Notes

- All five role identities and counts come from approved facts (KF-ROLE-01/02/03, KF-CUST-01/KF-ROLE-05, KF-ACCT-01/02).
- Every "Allowed" / "Not allowed" / "Conditional" entry above traces to at least one `KF-*` fact and its requirement(s) in `01-master-specification.md`.
- Cross-role boundaries (owner vs Admin vs Super Admin) match [consistency-audit.md](consistency-audit.md) §8.1 tenant-isolation audit, including the two approved exceptions.
- No permission was invented. Items the approved facts cannot answer are listed as Pending clarification and MUST NOT be assumed in design work.
