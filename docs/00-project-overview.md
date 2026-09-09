# 00 — Project Overview

> **Status:** DRAFT / DECISIONS APPLIED; CONSISTENCY AUDIT COMPLETE; ARCHITECTURE SET COMPLETE (DEC SOURCE-WORD IMPORT PENDING)
> **Version:** 0.5.0
> **Last Updated:** 2026-09-05
> **Documentation Architect note:** This document is a high-level entry point. Detailed, decision-traced requirements live in `01-master-specification.md` (REQ-001 … REQ-232). Approved decision content lives in `250-approved-decisions.md`. All open or unresolved items are tracked in `02-open-questions.md`. A full internal consistency audit is recorded in `consistency-audit.md` (Prompt 04, updated by Prompt 05-FIX) and the five platform roles are documented in `02-user-roles-permissions.md`. The architecture & technical design (Prompt 06) lives in [architecture/README.md](architecture/README.md).

---

## 1. What Is This Document?

This document provides a concise, non-technical overview of the product. It exists so that any reader — including a future coding agent — can quickly understand **what** the product is, **who** uses it, and **where** to find the detailed specifications.

It intentionally does **not** contain the full requirement set. Detailed requirements are captured in the [Master Specification](01-master-specification.md).

---

## 2. What Is the Product?

**The product is named "Werefa"** (final product-name decision; see [250-approved-decisions.md — Appendix C](250-approved-decisions.md#appendix-c-prompt-05-fix-final-approved-decisions-applied) — OQ-PROD-001).

Werefa is a **multi-tenant SaaS scheduler / scheduling platform** for small businesses. Each business (tenant) gets its own public booking page where customers book appointments without creating an account. Books flow through a booking lifecycle (proof-of-payment verification, confirmation, completion, no-show, cancellation) and payments use configurable methods (manual bank transfer and mobile money such as Telebirr). Scheduling handles recurrence, conflicts, and warnings; Telegram (optional for customers) carries notifications; and subscription, pause/resume, reports, and audit/history complete the domain model.

It was known internally by the working name **"Scheduler"** (derived from the repository name); the working name is superseded by the approved name **Werefa**.

### Known High-Level Characteristics (confirmed requirements exist)

| #   | Characteristic                                                | Status                                                   |
| --- | ------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | Involves **bookings**                                         | Confirmed (see §14 Booking Lifecycle, §9 Public Booking) |
| 2   | Involves **scheduling / schedules**                           | Confirmed (see §13 Scheduling)                           |
| 3   | Involves **conflict handling** between bookings and schedules | Confirmed (see §13 Scheduling warnings)                  |
| 4   | Involves **exceptions** (schedule exceptions)                 | Confirmed (see §19 Schedule Exceptions)                  |
| 5   | Involves **notifications**                                    | Confirmed (see §11 Telegram, §17 Notifications)          |
| 6   | Involves **history / audit**                                  | Confirmed (see §20 Audit / History)                      |
| 7   | Involves **reports**                                          | Confirmed (see §21 Reports / Exports)                    |

---

## 3. Who Uses the Product?

The **approved role model** is:

| Role               | Notes                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| **Super Admin**    | Exactly one exists. Can create/deactivate/manage Admin accounts; also the only role able to change Admin passwords. |
| **Admin**          | Exactly two accounts. Managed exclusively by the Super Admin.                                                       |
| **Business Owner** | Anyone can register as one. Configures their own business.                                                          |
| **Customer**       | Does **not** have a platform account. Books via the public booking page / QR flow.                                  |
| **System**         | System-generated actions (e.g., schedule changes) use System as the actor.                                          |

Source of truth: [250-approved-decisions.md — Appendix A.3 Roles](250-approved-decisions.md#a3-roles-kf-role).

> Role capabilities and permissions are formalized as requirements REQ-036 … REQ-044 (§8 Users / Roles / Permissions) plus per-domain authorization requirements.

---

## 4. What Can Each Role Do?

Roles and their capabilities are derived from approved content. See [01-master-specification.md](01-master-specification.md) §8 (Users / Roles / Permissions), §24 (Administration), and per-domain requirements. Permission scope is described by requirements REQ-036 … REQ-044 and REQ-217 … REQ-221.

---

## 5. What Are the Business Rules?

Business rules are enumerated in the requirements of the Master Specification under the relevant domains, e.g. §16 Subscription durations and grace periods (REQ-125 … REQ-141), §15 Payments (REQ-110 … REQ-124), §13 Scheduling (REQ-082 … REQ-099).

---

## 6. How Does Booking Work?

Public booking flow requirements are in [Master Specification](01-master-specification.md) §9 (Public Booking, REQ-045 … REQ-053); booking lifecycle and status behavior in §14 (REQ-100 … REQ-109) and the state model in §26.

---

## 7. How Does Scheduling Work?

Scheduling requirements are in [Master Specification](01-master-specification.md) §13 (Scheduling, REQ-082 … REQ-099) including conflict warnings (REQ-091 … REQ-099); pause/resume behavior in §18 (REQ-143 … REQ-158); dates/time rules in §25 (REQ-222 … REQ-226).

---

## 8. What Domains Exist?

The documentation is organized into **22 persistent domains**, matching the Master Specification sections. Each domain is an area of product behavior. Requirements use flat identifiers `REQ-NNN`; domain grouping is expressed by section structure and by [requirements-traceability.md](requirements-traceability.md).

| #   | Domain (key)                                      | Requirements      | Focus                                                                                      |
| --- | ------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| 1   | Platform / SaaS (PLATFORM)                        | REQ-001 … REQ-006 | Multi-tenant SaaS service                                                                  |
| 2   | Tenant / Business (TENANT)                        | REQ-007 … REQ-023 | Per-business queues, URLs, owner/account model                                             |
| 3   | Authentication (AUTH)                             | REQ-024 … REQ-035 | Login, verification, password, 2FA-ready                                                   |
| 4   | Users / Roles / Permissions (ROLES)               | REQ-036 … REQ-044 | Super Admin / Admin / Owner / Customer / System                                            |
| 5   | Public Booking (PUB-BOOK)                         | REQ-045 … REQ-053 | Public page, slug/QR, slot availability                                                    |
| 6   | Customers (CUSTOMER)                              | REQ-054 … REQ-059 | Customer data, Telegram binding, limits                                                    |
| 7   | Telegram (TG)                                     | REQ-060 … REQ-069 | Customer and owner notifications, accept/reject                                            |
| 8   | Services / Pricing (SERVICE)                      | REQ-070 … REQ-081 | Services, variations, add-ons, deactivation                                                |
| 9   | Scheduling (SCHED)                                | REQ-082 … REQ-099 | Hours, blocks, conflicts, warnings, quick actions                                          |
| 10  | Booking Lifecycle (LIFECYCLE)                     | REQ-100 … REQ-109 | Statuses, completion, reschedule                                                           |
| 11  | Payments (PAYMENT)                                | REQ-110 … REQ-124 | Prepayment, proof, verification, refunds                                                   |
| 12  | Subscription (SUBSCRIPTION)                       | REQ-125 … REQ-141 | Periods, graces, proof, renewal, warnings                                                  |
| 13  | Notifications (NOTIF)                             | REQ-142           | Channels: email + Telegram                                                                 |
| 14  | Pause / Resume (PAUSE)                            | REQ-143 … REQ-158 | Pausing bookings, resume rules                                                             |
| 15  | Schedule Exceptions (EXCEPTION)                   | REQ-159 … REQ-161 | Keep Booking approved exceptions                                                           |
| 16  | Audit / History (AUDIT)                           | REQ-162 … REQ-174 | Schedule/booking/security history                                                          |
| 17  | Reports / Exports (REPORT)                        | REQ-175 … REQ-190 | Reports, PDF export, filters, sorting                                                      |
| 18  | Security (SECURITY)                               | REQ-191 … REQ-206 | Login events, lockouts, recovery, retention                                                |
| 19  | Public Business Page (PUB-PAGE)                   | REQ-207 … REQ-216 | Page content, map, categories, closure                                                     |
| 20  | Administration (ADMIN)                            | REQ-217 … REQ-221 | Admin accounts, password control, forced logout                                            |
| 21  | Cross-cutting Date / Time (DATETIME)              | REQ-222 … REQ-226 | Timezone, formats, precision                                                               |
| 22  | Approved Decisions — Prompt 05-FIX (DEC-APPROVED) | REQ-227 … REQ-232 | No-Show/cancel/reschedule notif, reject-resubmit, failed-resume event, product name Werefa |

> **Note:** Domain keys are organizational labels only; requirement identifiers are flat. See the Master Specification §4 for the authoritative domain table.

---

## 9. How Does Documentation Relate to the 250-Decision Process?

The product has already passed through a **250-question requirements decision process**. All 250 decisions are considered **approved** unless a later instruction explicitly changes one.

- The **canonical decision register** (`DEC-001`…`DEC-250`) is maintained in [250-approved-decisions.md](250-approved-decisions.md).
- Approved decision content captured so far is recorded there as `KF-*` facts (Appendix A, 242 facts); `DEC-*` mapping is pending import of the exact source wording.
- Import progress is tracked in [decision-import-checklist.md](decision-import-checklist.md); decision-to-requirement mapping in [decision-traceability.md](decision-traceability.md).
- All 242 `KF-*` facts have been converted into requirements REQ-001 … REQ-226. The **14 Prompt 05-FIX final approved decisions** produced six additional requirements (REQ-227 … REQ-232) for a total of **232**. The per-requirement mapping is in [requirements-traceability.md](requirements-traceability.md). Exact DEC wording is still pending; when imported, it will confirm (or refine) the derived requirements.

---

## 10. Documentation Source of Truth

**The documentation is the source of truth for implementation.**

- Detailed requirements: `01-master-specification.md`
- Canonical decision register: `250-approved-decisions.md`
- Decision-to-requirement mapping: `decision-traceability.md`
- REQ → KF traceability matrix: `requirements-traceability.md`
- Requirement quality results: `requirements-quality-check.md`
- Import progress: `decision-import-checklist.md`
- Open questions & ambiguities: `02-open-questions.md`
- **Architecture & technical design — Prompt 06:** `architecture/README.md` (30 design docs + 12 ADRs; REQ→component mapping in `architecture/30-architecture-traceability.md`)
- Index & navigation: `03-documentation-index.md`
- Entry point & quickstart (for coding agents): `README.md`

---

## 11. Maintenance Model

See [Maintenance and Change Control](01-master-specification.md#maintenance-and-change-control) in the Master Specification, and [Maintaining the Documentation](03-documentation-index.md#maintaining-the-documentation) in the Index.

---

## 12. Definition of Done (Documentation Stage)

The documentation for the current stage is considered done when:

1. All 250 approved decisions are imported into the canonical register ([250-approved-decisions.md](250-approved-decisions.md)) with canonical wording.
2. The approved decisions are incorporated into the Master Specification as traceable requirements (**complete for Prompt 03 + Prompt 05-FIX**: 232 requirements REQ-001 … REQ-232).
3. Every approved decision has one or more traceable requirements (verified in [requirements-traceability.md](requirements-traceability.md) and [decision-traceability.md](decision-traceability.md)).
4. All open questions are resolved or explicitly deferred with rationale.
5. Requirement identifiers are consistent across all documentation files.
6. No requirement-internal contradictions exist; all CONF-* conflicts are resolved.
7. Every requirement is testable.
8. Every requirement is mapped to an architecture component (Prompt 06; `architecture/30-architecture-traceability.md` — 232/232) with no architecture issues raised.

> Application implementation has **not** begun and will not begin until the documentation stage is complete.
