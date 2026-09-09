# 01 — Master Specification

> **Status:** REQUIREMENTS HARDENED (v0.5.0 — PROMPT 05-FIX DECISIONS APPLIED) — DEC SOURCE MAPPING PENDING
> **Version:** 0.5.0
> **Last Updated:** 2026-09-05
>
> **PURPOSE:** This is the central, authoritative document containing **all approved product decisions** and their traceable requirements. It is the **source of truth** for implementation.
>
> **Change note (Prompt 03):** The 242 approved `KF-*` product facts (see `250-approved-decisions.md`) have been converted into **226 formal requirements** (REQ-001 … REQ-226), grouped by 21 domains. Exact `DEC-001 … DEC-250` source wording remains pending; every requirement records `PENDING DECISION REGISTER MAPPING` as its decision source unless otherwise noted.
>
> **Change note (Prompt 04):** A full internal consistency audit of the documentation set was performed and recorded in `consistency-audit.md`. CONF-001 is **RESOLVED** (later decision supersedes the earlier rule); the historical earlier rule is preserved. Section 26 was restructured into dedicated **Booking State Machine**, **Payment State Machine**, and **Slot-Lock State** sections. `02-user-roles-permissions.md` documents the five roles and their permissions. Slot-integrity (REQ-121), schedule-exception semantics (REQ-160), and report-sorting (REQ-190) requirements were tightened. No requirements were renumbered or deleted.
>
> **Change note (Prompt 05-FIX):** The **14 final approved decisions** (8 state-machine decisions SM-05 … SM-10/SM-12/SM-13 and 6 open questions OQ-SLOT-001, OQ-PROD-001, OQ-CUST-001, OQ-BOOK-001, OQ-PUB-001, OQ-PAY-001) from `PROMPT 05-FIX` were applied directly to the documentation. All 6 open questions are **RESOLVED** and the 8 state-machine decisions are **RESOLVED**. Product name is **Werefa**. Telegram is **optional** for customers. Customer notification is defined for No Show, cancellation, and reschedule (only when the customer is connected to Telegram). An owner may cancel a Payment Pending booking (slot stays blocked until explicit release); a Rejected booking may be released by the owner or resubmitted by the customer (slot stays blocked). Completed and No Show are permanently terminal. The payment-status enumeration is exactly **Pending / Accepted / Rejected**. Slot locks have **no automatic expiry**. Failed auto-resume events are **recorded in history** and never interpreted as bookings being available. Initial business categories are exactly **Salon & Barber** and **Other**; initial payment methods are exactly **Bank Transfer** and **Telebirr / mobile money**. This is reflected by updating existing requirements in place, superseding conflicting wording (e.g., REQ-115), and adding **6 new requirements** (REQ-227 … REQ-232) in a new domain 22 (Section 30). Total requirements: **226 → 232**. No existing REQ ID was renumbered or deleted.
>
> **RELATED FILES:**
>
> - [00-project-overview.md](00-project-overview.md) — high-level product overview
> - [02-open-questions.md](02-open-questions.md) — unresolved / ambiguous items
> - [02-user-roles-permissions.md](02-user-roles-permissions.md) — roles and per-role permissions
> - [03-documentation-index.md](03-documentation-index.md) — navigation and maintenance guide
> - [250-approved-decisions.md](250-approved-decisions.md) — canonical decision register
> - [consistency-audit.md](consistency-audit.md) — full documentation consistency audit (Prompt 04)
> - [decision-traceability.md](decision-traceability.md) — decision-to-requirement mapping
> - [decision-import-checklist.md](decision-import-checklist.md) — import tracking
> - [requirements-traceability.md](requirements-traceability.md) — REQ → KF/DEC traceability matrix
> - [requirements-quality-check.md](requirements-quality-check.md) — per-requirement quality checklist

---

## Table of Contents

1. [Requirement Identifier Conventions](#1-requirement-identifier-conventions)
2. [Decision Traceability Model](#2-decision-traceability-model)
3. [Documentation Status](#3-documentation-status)
4. [Domain Model](#4-domain-model)
5. [Domain 1 — Platform / SaaS](#5-domain-1--platform--saas)
6. [Domain 2 — Tenant / Business](#6-domain-2--tenant--business)
7. [Domain 3 — Authentication](#7-domain-3--authentication)
8. [Domain 4 — Users / Roles / Permissions](#8-domain-4--users--roles--permissions)
9. [Domain 5 — Public Booking](#9-domain-5--public-booking)
10. [Domain 6 — Customers](#10-domain-6--customers)
11. [Domain 7 — Telegram](#11-domain-7--telegram)
12. [Domain 8 — Services / Pricing](#12-domain-8--services--pricing)
13. [Domain 9 — Scheduling](#13-domain-9--scheduling)
14. [Domain 10 — Booking Lifecycle](#14-domain-10--booking-lifecycle)
15. [Domain 11 — Payments](#15-domain-11--payments)
16. [Domain 12 — Subscription](#16-domain-12--subscription)
17. [Domain 13 — Notifications](#17-domain-13--notifications)
18. [Domain 14 — Pause / Resume](#18-domain-14--pause--resume)
19. [Domain 15 — Schedule Exceptions](#19-domain-15--schedule-exceptions)
20. [Domain 16 — Audit / History](#20-domain-16--audit--history)
21. [Domain 17 — Reports / Exports](#21-domain-17--reports--exports)
22. [Domain 18 — Security](#22-domain-18--security)
23. [Domain 19 — Public Business Page](#23-domain-19--public-business-page)
24. [Domain 20 — Administration](#24-domain-20--administration)
25. [Domain 21 — Cross-cutting Date / Time Rules](#25-domain-21--cross-cutting-date--time-rules)
26. [Booking State Machine, Payment State Machine, and Slot-Lock State](#26-booking-state-machine-payment-state-machine-and-slot-lock-state)
27. [Requirement Classification](#27-requirement-classification)
28. [Definition of Done](#28-definition-of-done)
29. [Maintenance and Change Control](#29-maintenance-and-change-control)
30. [Domain 22 — Approved Decisions — Prompt 05-FIX (Functional Requirements)](#30-domain-22--approved-decisions--prompt-05-fix-functional-requirements)

---

## 1. Requirement Identifier Conventions

### 1.1 Identifier Format

Each requirement uses a **stable, globally unique identifier**:

```
REQ-NNN
```

where `NNN` is a zero-padded number from `001` upwards, assigned in document order.

> **Convention change (Prompt 03):** This replaces the earlier `REQ-<DOMAIN>-NNN` numbering convention documented in version 0.2.0. Identifiers are now **flat and sequential per the whole specification**. Domain grouping is expressed by the section structure and by the traceability matrix, not by the identifier prefix. This change is recorded rather than silently applied; the earlier convention was not used in any mandatory external contract.

### 1.2 Numbering Rules

- Numbering is sequential, as requirements are authored.
- **Do not create fake requirements to fill number gaps.** Gaps, if they occur, are acceptable.
- REQ numbers do **not** correspond to DEC numbers. Do not assume a mapping.
- A requirement may be `APPROVED`, `SUPERSEDED`, or `DEPRECATED`. All requirements in this document are currently `APPROVED` (derived from approved `KF-*` facts).

### 1.3 Requirement Template

```markdown
### REQ-NNN — <Short Title>

- **Statement:** <precise, testable behavior, one behavior per requirement.>
- **Source:** <KF-* identifier(s), comma-separated>
- **Decision Source:** PENDING DECISION REGISTER MAPPING (or DEC-<n> when known)
- **Priority:** MUST | SHOULD | MAY
- **Class:** FUNC | SEC | DATA-INT | AUDIT | UX | AVAIL
- **Acceptance criteria:**
  - AC1: <objective, PASS/FAIL check>
  - ...
- **Dependencies:** REQ-XXX, REQ-YYY (or "—")
```

**Priority rules:** Confirmed product behavior defaults to `MUST`. `SHOULD`/`MAY` are used only where the approved facts qualify a behavior as optional ("may"). No priority is invented.

---

## 2. Decision Traceability Model

### 2.1 Traceability Chain

The desired chain is:

```
DEC-* → KF-* → REQ-* → SPEC/DOCUMENT → TEST
```

Because exact `DEC-*` source wording is not yet available, the effective chain is:

```
[PENDING DEC] → KF-* → REQ-* → SPEC/DOCUMENT → TEST
```

### 2.2 Sources of Requirements

- _*KF-* facts_* are the approved product facts captured in [250-approved-decisions.md — Appendix A](250-approved-decisions.md). They are treated as approved decision content and are the primary `Source` of every requirement.
- _*DEC-* decisions_* (DEC-001 … DEC-250) are registered but their exact wording is pending. Where no mapping is known, `Decision Source: PENDING DECISION REGISTER MAPPING`.

### 2.3 Reverse Index

The per-requirement mapping (REQ → KF → DEC → document → test) is maintained in [requirements-traceability.md](requirements-traceability.md).

---

## 3. Documentation Status

### 3.1 Approved Decision Content

- 250 decision slots registered (`DEC-001 … DEC-250`); exact wording pending.
- **242 `KF-*` facts** captured (14 existing groups + new `KF-ACCT` group).
- **All 242 `KF-*` facts converted** into one or more requirements (REQ-001 … REQ-226). Prompt 05-FIX then added REQ-227 … REQ-232 (Domain 22). See [requirements-traceability.md](requirements-traceability.md).
- **14 final approved decisions** (Prompt 05-FIX: SM-05 … SM-10/SM-12/SM-13 and OQ-SLOT-001, OQ-PROD-001, OQ-CUST-001, OQ-BOOK-001, OQ-PUB-001, OQ-PAY-001) applied directly to this specification. They are recorded in [250-approved-decisions.md](250-approved-decisions.md) and expressed as requirements — the 8 decisions extended/refined existing requirements and 6 decisions produced **6 new requirements** (REQ-227 … REQ-232, Domain 22, Section 30). Total: **232 requirements** (REQ-001 … REQ-232).

### 3.2 Known Conflicts

- **CONF-001** (report sort: identical Booking IDs). Earlier rule = Actor name A–Z; later rule = date/time secondary key. **RESOLVED — LATER DECISION SUPERSEDES EARLIER RULE** (chronology of the two approved decisions is clear). Final intended behavior: **Primary** = Booking ID; **Secondary** = Date/time; **Final tie-breaker** = Actor A–Z. The earlier rule remains preserved in [250-approved-decisions.md](250-approved-decisions.md) and never silently discarded. See [consistency-audit.md](consistency-audit.md).

### 3.3 Missing Input

- Exact `DEC-001 … DEC-250` source wording: pending import (see [decision-import-checklist.md](decision-import-checklist.md)).
- All previously open product questions and state-machine decisions are **RESOLVED** by Prompt 05-FIX (see [02-open-questions.md](02-open-questions.md) and [consistency-audit.md](consistency-audit.md)). No open product questions remain.

---

## 4. Domain Model

Requirements are grouped into 22 domains. The domain key used in the traceability matrix appears in parentheses.

| #   | Domain                                            | Requirements      |
| --- | ------------------------------------------------- | ----------------- |
| 1   | Platform / SaaS (PLATFORM)                        | REQ-001 … REQ-006 |
| 2   | Tenant / Business (TENANT)                        | REQ-007 … REQ-023 |
| 3   | Authentication (AUTH)                             | REQ-024 … REQ-035 |
| 4   | Users / Roles / Permissions (ROLES)               | REQ-036 … REQ-044 |
| 5   | Public Booking (PUB-BOOK)                         | REQ-045 … REQ-053 |
| 6   | Customers (CUSTOMER)                              | REQ-054 … REQ-059 |
| 7   | Telegram (TG)                                     | REQ-060 … REQ-069 |
| 8   | Services / Pricing (SERVICE)                      | REQ-070 … REQ-081 |
| 9   | Scheduling (SCHED)                                | REQ-082 … REQ-099 |
| 10  | Booking Lifecycle (LIFECYCLE)                     | REQ-100 … REQ-109 |
| 11  | Payments (PAYMENT)                                | REQ-110 … REQ-124 |
| 12  | Subscription (SUBSCRIPTION)                       | REQ-125 … REQ-141 |
| 13  | Notifications (NOTIF)                             | REQ-142           |
| 14  | Pause / Resume (PAUSE)                            | REQ-143 … REQ-158 |
| 15  | Schedule Exceptions (EXCEPTION)                   | REQ-159 … REQ-161 |
| 16  | Audit / History (AUDIT)                           | REQ-162 … REQ-174 |
| 17  | Reports / Exports (REPORT)                        | REQ-175 … REQ-190 |
| 18  | Security (SECURITY)                               | REQ-191 … REQ-206 |
| 19  | Public Business Page (PUB-PAGE)                   | REQ-207 … REQ-216 |
| 20  | Administration (ADMIN)                            | REQ-217 … REQ-221 |
| 21  | Cross-cutting Date / Time (DATETIME)              | REQ-222 … REQ-226 |
| 22  | Approved Decisions — Prompt 05-FIX (DEC-APPROVED) | REQ-227 … REQ-232 |

> **Note:** Domain 22 groups the requirements derived from the final approved decisions of Prompt 05-FIX. They are numbered at the end to preserve the stability of every existing REQ ID.

---

## 5. Domain 1 — Platform / SaaS

### REQ-001 — Multi-tenant SaaS platform

- **Statement:** The platform SHALL operate as a multi-tenant SaaS service.
- **Source:** KF-BIZ-01 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Two distinctly registered businesses can exist and operate concurrently on the platform.
- **Dependencies:** REQ-002

### REQ-002 — Business as separate tenant

- **Statement:** Each registered business SHALL be a separate tenant; tenant identity SHALL be distinct per business.
- **Source:** KF-BIZ-02 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: Tenant-scoped data of business A is not accessible to business B (see REQ-004, REQ-043).
- **Dependencies:** REQ-001, REQ-004, REQ-043

### REQ-003 — Any business type may register

- **Statement:** The platform SHALL accept registration of any business type.
- **Source:** KF-BIZ-03 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Registration succeeds for a business type not equal to any predefined category (see REQ-215).
- **Dependencies:** REQ-215

### REQ-004 — Generic architecture not restricted to initial target types

- **Statement:** The platform architecture SHALL be generic and SHALL NOT impose salon/barber-specific requirements.
- **Source:** KF-BIZ-04 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: No business-type-specific required fields are enforced for non-salon business types.
- **Dependencies:** REQ-003

### REQ-005 — Self-service Business Owner registration

- **Statement:** Any person SHALL be able to register as a Business Owner without requiring platform approval to create the account.
- **Source:** KF-BIZ-05 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: A new visitor can complete owner registration and proceed to business creation.
- **Dependencies:** REQ-026

### REQ-006 — 30-day free trial per new business

- **Statement:** Each new business SHALL receive a 30-day free trial.
- **Source:** KF-BIZ-06 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: A new business is in trial state for exactly 30 days from creation.
- **Dependencies:** REQ-128

---

## 6. Domain 2 — Tenant / Business

### REQ-007 — One public booking URL per business

- **Statement:** Each business SHALL have exactly one public booking URL.
- **Source:** KF-BIZ-07, KF-PUB-01 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Given one business, the system exposes one and only one public booking URL.
- **Dependencies:** REQ-045, REQ-046

### REQ-008 — One QR code per business

- **Statement:** Each business SHALL have exactly one QR code that points to its public booking URL.
- **Source:** KF-BIZ-08, KF-PUB-07 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Scanning the business QR code opens that business's public booking page.
- **Dependencies:** REQ-007

### REQ-009 — One shared queue/schedule per business

- **Statement:** Each business SHALL have exactly one shared booking queue/schedule.
- **Source:** KF-BIZ-09 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: All bookings for a business write into the business's single schedule context.
- **Dependencies:** REQ-014

### REQ-010 — No individual staff/barber booking links

- **Statement:** The platform SHALL NOT provide individual staff/barber booking URLs.
- **Source:** KF-BIZ-10 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: There is no path to generate or share a per-staff booking link.
- **Dependencies:** REQ-007

### REQ-011 — Owners configure their own business

- **Statement:** The Business Owner SHALL be able to configure their own business settings.
- **Source:** KF-BIZ-11 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The owner can edit business configuration (schedule, services, page, payments — per their domain requirements).
- **Dependencies:** REQ-043

### REQ-012 — One business has one owner relationship

- **Statement:** Each business SHALL have exactly one owning Business Owner account.
- **Source:** KF-ACCT-01 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: A business has exactly one owner record; reassignment is not part of confirmed behavior.
- **Dependencies:** REQ-013

### REQ-013 — One owner may manage multiple businesses

- **Statement:** One Business Owner account SHALL be able to manage multiple businesses.
- **Source:** KF-ACCT-02 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: A single owner account can own two or more businesses.
- **Dependencies:** REQ-012

### REQ-014 — Per-business dashboard context

- **Statement:** Each business SHALL have its own dashboard context, distinct from other businesses of the same owner.
- **Source:** KF-ACCT-03 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: Data shown in business A's dashboard never includes business B's operational data.
- **Dependencies:** REQ-013

### REQ-015 — Independent subscription per business

- **Statement:** Each business SHALL have an independent subscription/its own subscription lifecycle, unaffected by other businesses.
- **Source:** KF-ACCT-04, KF-BIZ-12 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: Renewing business A does not change business B's subscription state.
- **Dependencies:** REQ-125

### REQ-016 — Post-login selection when multiple businesses

- **Statement:** After login, if the owner has multiple businesses, the system SHALL present a business selection.
- **Source:** KF-ACCT-05, KF-ACCT-07 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** UX
- **Acceptance criteria:**
  - AC1: Owner with two businesses sees a selection list, not an arbitrary default.
- **Dependencies:** REQ-013

### REQ-017 — Direct open when exactly one business

- **Statement:** After login, if the owner has exactly one business, the system SHALL open that business directly.
- **Source:** KF-ACCT-06 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** UX
- **Acceptance criteria:**
  - AC1: Owner with one business lands on that business's dashboard without a picker.
- **Dependencies:** REQ-013

### REQ-018 — Show Create Business when no business exists

- **Statement:** After login, if the owner has no business, the system SHALL present the Create Business flow.
- **Source:** KF-ACCT-08 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Owner with zero businesses can begin business creation without manual URL navigation.
- **Dependencies:** REQ-005

### REQ-019 — Business switcher from main dashboard

- **Statement:** A business switcher SHALL be available from the main dashboard/home experience.
- **Source:** KF-ACCT-09 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** UX
- **Acceptance criteria:**
  - AC1: From the active dashboard, the owner can switch to another of their businesses.
- **Dependencies:** REQ-016

### REQ-020 — Active business identity visible

- **Statement:** The active business identity SHALL remain visible in the dashboard experience.
- **Source:** KF-ACCT-10 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** UX
- **Acceptance criteria:**
  - AC1: The dashboard always indicates which business is currently being managed.
- **Dependencies:** REQ-019

### REQ-021 — Last selected business remembered

- **Statement:** The system SHALL remember the last selected business per owner.
- **Source:** KF-ACCT-11 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** UX
- **Acceptance criteria:**
  - AC1: After switching businesses, the previously active business is the remembered selection.
- **Dependencies:** REQ-019

### REQ-022 — Automatic open of last selected business on next login

- **Statement:** On the next login, the system MAY automatically open the last selected business.
- **Source:** KF-ACCT-12 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MAY | **Class:** UX
- **Acceptance criteria:**
  - AC1: When enabled, login for a multi-business owner opens the remembered business context.
- **Dependencies:** REQ-021

### REQ-023 — Deactivated/expired businesses openable by owner

- **Statement:** Deactivated or subscription-expired businesses SHALL still be openable by their owner to manage existing data.
- **Source:** KF-ACCT-13 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Owner of a deactivated business can open its dashboard and access existing bookings/customer data.
- **Dependencies:** REQ-014, REQ-141

---

## 7. Domain 3 — Authentication

### REQ-024 — Phase 1 email/password login

- **Statement:** Phase 1 login SHALL use email and password.
- **Source:** KF-AUTH-01 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: A registered user can authenticate with correct email/password credentials.
- **Dependencies:** REQ-025

### REQ-025 — Google login not part of Phase 1

- **Statement:** Google single sign-on SHALL NOT be provided in Phase 1.
- **Source:** KF-AUTH-02 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: No Google sign-in option is available on the Phase 1 login surface.
- **Dependencies:** —

### REQ-026 — Owner email verification required

- **Statement:** Owner accounts SHALL require email verification.
- **Source:** KF-AUTH-03 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: An owner cannot use normal functions until their email is verified.
- **Dependencies:** REQ-027

### REQ-027 — Unverified users blocked from normal dashboard access

- **Statement:** Unverified users SHALL NOT proceed to normal dashboard access.
- **Source:** KF-AUTH-09 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: Unverified user login does not reach the dashboard; a verification prompt is shown.
- **Dependencies:** REQ-026

### REQ-028 — Verification links time-limited

- **Statement:** Email verification links SHALL be time-limited.
- **Source:** KF-AUTH-10 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: A verification link used after its expiry is rejected as invalid.
- **Dependencies:** REQ-029

### REQ-029 — Expired verification link replacement

- **Statement:** An expired verification link SHALL be replaceable by requesting another.
- **Source:** KF-AUTH-11 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: After requesting a new link, the user can complete verification with the new link.
- **Dependencies:** REQ-028, REQ-031

### REQ-030 — Verification request rate limiting

- **Statement:** Requests for verification links SHALL be rate limited.
- **Source:** KF-AUTH-12 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: Excessive repeated verification-request attempts within a short window are rejected.
- **Dependencies:** —

### REQ-031 — New verification link invalidates previous links

- **Statement:** Issuing a new verification link SHALL invalidate previous verification links.
- **Source:** KF-AUTH-13 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: After a new link is issued, the older link no longer verifies the account.
- **Dependencies:** REQ-029

### REQ-032 — Successful verification may auto-authenticate

- **Statement:** Successful verification MAY automatically authenticate the user.
- **Source:** KF-AUTH-14 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MAY | **Class:** UX
- **Acceptance criteria:**
  - AC1: When implemented, a verified user is signed in directly after verification.
- **Dependencies:** REQ-026

### REQ-033 — Forgot-password via email reset

- **Statement:** Password recovery SHALL be performed via email reset links.
- **Source:** KF-AUTH-04 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: A user requesting a reset receives an email link that allows setting a new password.
- **Dependencies:** REQ-094

### REQ-034 — 2FA-ready Phase 1 architecture

- **Statement:** The Phase 1 architecture SHALL be 2FA-ready; 2FA itself is Phase 2.
- **Source:** KF-AUTH-05 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: The architecture does not preclude adding a second authentication factor in Phase 2.
- **Dependencies:** —

### REQ-035 — Password change logs the user out everywhere

- **Statement:** A password change SHALL terminate the affected user's sessions everywhere.
- **Source:** KF-AUTH-06, KF-SEC-08 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: After changing the password, all existing sessions of that user are invalid.
- **Dependencies:** REQ-219

---

## 8. Domain 4 — Users / Roles / Permissions

### REQ-036 — Confirmed role set

- **Statement:** The platform SHALL model exactly the roles: Super Admin, Admin, Business Owner, Customer, and System.
- **Source:** KF-ROLE-01 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The system supports these five roles and no additional platform roles.
- **Dependencies:** —

### REQ-037 — Exactly one Super Admin

- **Statement:** The platform SHALL have exactly one Super Admin account.
- **Source:** KF-ROLE-02, KF-SUB-18 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: The system enforces a single Super Admin; no second Super Admin can be created.
- **Dependencies:** REQ-217

### REQ-038 — Exactly two Admin accounts

- **Statement:** The platform SHALL have exactly two Admin accounts.
- **Source:** KF-ROLE-03 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: The number of active Admin accounts is two; creation of a third is blocked.
- **Dependencies:** REQ-217

### REQ-039 — Only Super Admin manages Admin accounts

- **Statement:** Only the Super Admin SHALL be able to create, deactivate, and manage Admin accounts.
- **Source:** KF-ROLE-04 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: Non-Super-Admin users cannot create/deactivate/manage Admin accounts.
- **Dependencies:** REQ-036, REQ-217

### REQ-040 — Customers have no platform account

- **Statement:** Customers SHALL NOT have platform accounts.
- **Source:** KF-CUST-01, KF-ROLE-05 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: No customer login/account creation flow exists on the platform.
- **Dependencies:** REQ-054

### REQ-041 — Super Admin platform-wide access

- **Statement:** The Super Admin SHALL have platform-wide visibility and access.
- **Source:** KF-ROLE-06 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: Super Admin can access all businesses and their relevant data per approved permissions.
- **Dependencies:** REQ-177, REQ-178

### REQ-042 — Admin restricted administrative access

- **Statement:** Admin access SHALL be restricted to approved administrative functions.
- **Source:** KF-ROLE-07 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: Admin cannot perform super-admin-only or owner-only operations (e.g., REQ-168, REQ-177).
- **Dependencies:** REQ-177, REQ-168

### REQ-043 — Owner operates only within owned businesses

- **Statement:** A Business Owner SHALL operate only within businesses they own/manage.
- **Source:** KF-ROLE-08 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: Owner of business A cannot view or modify business B's operational data.
- **Dependencies:** REQ-002, REQ-013

### REQ-044 — System actor for automatic changes

- **Statement:** The System SHALL be used as the actor for automatic/system-generated changes (e.g., automatic schedule changes).
- **Source:** KF-ROLE-09, KF-SCHED-18 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** AUDIT
- **Acceptance criteria:**
  - AC1: Automatic changes record the actor as System with an automatic reason.
- **Dependencies:** REQ-165

---

## 9. Domain 5 — Public Booking

### REQ-045 — Public booking page is the booking entry point

- **Statement:** The public booking page SHALL be the sole entry point for creating bookings.
- **Source:** KF-CUST-05, KF-PUB-01 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: No booking can originate outside the public page/QR flow (see also REQ-059).
- **Dependencies:** REQ-007, REQ-059

### REQ-046 — QR points to public URL

- **Statement:** The business QR code SHALL point to the business's public booking URL.
- **Source:** KF-PUB-07 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Scanning the QR opens the correct business public page.
- **Dependencies:** REQ-008

### REQ-047 — Public URL slug unique

- **Statement:** Each business SHALL choose a public URL slug that is unique platform-wide.
- **Source:** KF-PUB-05 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: Two different businesses cannot hold the same public slug.
- **Dependencies:** REQ-048

### REQ-048 — Invalid/reserved slugs rejected

- **Statement:** The system SHALL reject invalid and reserved slugs.
- **Source:** KF-PUB-06 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Reserved and format-invalid slugs are refused at slug save time.
- **Dependencies:** REQ-047

### REQ-049 — Slug change updates QR target

- **Statement:** When the public slug changes, the QR code SHALL automatically follow the new URL.
- **Source:** KF-PUB-08 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: After a slug change, scanning the (re-issued/regenerated) QR resolves to the new URL without manual re-encoding.
- **Dependencies:** REQ-046

### REQ-050 — Available times computed from schedule, duration, bookings, blocks

- **Statement:** Available booking times SHALL be calculated from the schedule, service duration, existing bookings and blocks.
- **Source:** KF-PUB-21 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: A slot that falls inside a block, outside working hours, or overlapping an existing booking is not offered.
- **Dependencies:** REQ-082, REQ-084, REQ-085, REQ-089

### REQ-051 — Selecting a time does not lock it

- **Statement:** Selecting a time on the public page SHALL NOT lock the slot.
- **Source:** KF-PUB-22 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: After a customer selects a time, another customer can still view the same slot as available.
- **Dependencies:** REQ-052

### REQ-052 — Slot remains available until payment proof submitted

- **Statement:** A slot SHALL remain available to other customers until a payment proof is successfully submitted.
- **Source:** KF-PUB-23 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: Availability of the slot does not change at time selection; it changes only at claimed proof submission.
- **Dependencies:** REQ-051, REQ-121

### REQ-053 — Second customer receives unavailable result for claimed slot

- **Statement:** A second customer attempting to claim an already-claimed slot SHALL receive an unavailable result.
- **Source:** KF-PUB-24 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: When two customers attempt the same slot, exactly one wins; the other sees the slot as unavailable (see REQ-121).
- **Dependencies:** REQ-121

---

## 10. Domain 6 — Customers

### REQ-054 — Customer provides name and phone

- **Statement:** Customer booking information SHALL include name and phone number.
- **Source:** KF-CUST-02 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: A booking cannot be submitted without a customer name and phone number.
- **Dependencies:** REQ-045

### REQ-055 — Booking note optional

- **Statement:** The booking note SHALL be optional.
- **Source:** KF-CUST-03 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: A booking can be submitted with and without a note.
- **Dependencies:** REQ-054

### REQ-056 — Customer may connect Telegram during booking; Telegram is optional

- **Statement:** Connecting Telegram SHALL be **optional** for the customer during the booking flow. A customer SHALL be able to complete a booking without connecting Telegram. If the customer connects Telegram, Telegram-based notifications to that customer are enabled; if the customer does not connect, no Telegram notification is sent to that customer and no part of the booking is withheld.
- **Source:** KF-CUST-04, KF-TG-01 (as refined by approved decision OQ-CUST-001) | **Decision Source:** RESOLVED — PROMPT 05-FIX OQ-CUST-001 (and SM-05/SM-06/SM-07); supersedes "must connect" reading of KF-CUST-04 / KF-TG-01 | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: A booking can be completed without connecting Telegram.
  - AC2: A customer who connects Telegram receives Telegram notifications; a customer who does not connect receives none.
  - AC3: No booking step fails, and no booking is delayed or rejected, solely because the customer did not connect Telegram.
- **Dependencies:** REQ-045, REQ-060, REQ-061, REQ-062, REQ-063, REQ-064, REQ-227, REQ-228, REQ-229

### REQ-057 — Customer booking history not exposed on public page

- **Statement:** The public booking page SHALL NOT expose customer booking history.
- **Source:** KF-CUST-10 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: No public-page surface retrieves or displays a customer's past bookings.
- **Dependencies:** REQ-045

### REQ-058 — Customer cannot cancel or modify booked appointments

- **Statement:** Customers SHALL NOT be able to cancel or modify their own bookings.
- **Source:** KF-CUST-08 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: No customer-facing cancel/modify action exists.
- **Dependencies:** REQ-104

### REQ-059 — No booking creation via Telegram; bookings only from public flow

- **Statement:** Owners SHALL NOT create bookings from the dashboard, and bookings SHALL NOT be created via Telegram; every booking SHALL originate from the public booking flow.
- **Source:** KF-CUST-06, KF-CUST-07, KF-CUST-05 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: Attempts to create a booking via the dashboard or Telegram are not supported.
- **Dependencies:** REQ-045

---

## 11. Domain 7 — Telegram

### REQ-060 — Customer receives proof-received / verification-pending notification

- **Statement:** After the customer submits payment proof, the customer SHALL receive a proof-received / verification-pending notification on Telegram **if the customer is connected to Telegram** (REQ-056).
- **Source:** KF-TG-02 (as refined by approved decision OQ-CUST-001) | **Decision Source:** RESOLVED — PROMPT 05-FIX OQ-CUST-001 | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: On proof submission, the connected customer's Telegram chat receives the notification; a customer without Telegram receives no notification and the booking still proceeds.
- **Dependencies:** REQ-056, REQ-117

### REQ-061 — Customer receives accepted/confirmed notification

- **Statement:** When the owner accepts/confirms the booking, the customer SHALL receive a confirmation notification on Telegram **if the customer is connected to Telegram** (REQ-056).
- **Source:** KF-TG-03 (as refined by approved decision OQ-CUST-001) | **Decision Source:** RESOLVED — PROMPT 05-FIX OQ-CUST-001 | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: On owner Accept, the connected customer receives the confirmation; a customer without Telegram receives no notification.
- **Dependencies:** REQ-056, REQ-067, REQ-101

### REQ-062 — Customer receives rejection notification with reason

- **Statement:** When the owner rejects a booking, the customer SHALL receive a rejection notification including the reason **if the customer is connected to Telegram** (REQ-056).
- **Source:** KF-TG-03, KF-TG-09 (as refined by approved decision OQ-CUST-001) | **Decision Source:** RESOLVED — PROMPT 05-FIX OQ-CUST-001 | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: On owner Reject, the connected customer receives the rejection and the required reason; a customer without Telegram receives no notification.
- **Dependencies:** REQ-056, REQ-068

### REQ-063 — Customer reminder 24 hours before appointment

- **Statement:** The system SHALL send the customer a reminder 24 hours before the appointment **if the customer is connected to Telegram** (REQ-056).
- **Source:** KF-TG-04 (as refined by approved decision OQ-CUST-001) | **Decision Source:** RESOLVED — PROMPT 05-FIX OQ-CUST-001 | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: For a confirmed appointment, a reminder is delivered to the connected customer at 24 hours before start; no reminder is attempted for a customer without Telegram.
- **Dependencies:** REQ-056, REQ-101

### REQ-064 — Customer reminder 1 hour before appointment

- **Statement:** The system SHALL send the customer a reminder 1 hour before the appointment **if the customer is connected to Telegram** (REQ-056).
- **Source:** KF-TG-04 (as refined by approved decision OQ-CUST-001) | **Decision Source:** RESOLVED — PROMPT 05-FIX OQ-CUST-001 | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: For a confirmed appointment, a reminder is delivered to the connected customer at 1 hour before start; no reminder is attempted for a customer without Telegram.
- **Dependencies:** REQ-056, REQ-101

### REQ-065 — Owner notified on new payment proof submission

- **Statement:** The owner SHALL receive a notification when a new payment proof is submitted.
- **Source:** KF-TG-05 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: On proof submission, the owner receives the notification.
- **Dependencies:** REQ-117

### REQ-066 — Owner Telegram notification content

- **Statement:** The owner's Telegram notification SHALL contain booking details, customer information, services, date/time, payment amount/method, and the payment proof.
- **Source:** KF-TG-06 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The owner notification displays all named fields plus attachment of the proof.
- **Dependencies:** REQ-065

### REQ-067 — Owner can Accept from Telegram

- **Statement:** The owner SHALL be able to accept a booking from Telegram.
- **Source:** KF-TG-07 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Accepting via Telegram confirms the booking and triggers the customer confirmation.
- **Dependencies:** REQ-061

### REQ-068 — Owner can Reject from Telegram; reason required

- **Statement:** The owner SHALL be able to reject a booking from Telegram, and rejection SHALL require a reason.
- **Source:** KF-TG-07, KF-TG-08 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: A Telegram rejection without a reason is refused.
- **Dependencies:** REQ-062

### REQ-069 — Owner does not receive appointment reminders

- **Statement:** The owner SHALL NOT receive appointment reminders.
- **Source:** KF-TG-10 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: No reminder workflow targets the owner for upcoming appointments.
- **Dependencies:** —

---

## 12. Domain 8 — Services / Pricing

### REQ-070 — Multiple services selectable

- **Statement:** A booking SHALL allow selection of multiple services.
- **Source:** KF-BOOK-01 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: A booking can contain more than one service.
- **Dependencies:** REQ-074

### REQ-071 — Base service price and duration

- **Statement:** Each service SHALL have a price and a duration.
- **Source:** KF-SVC-01 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: A service cannot be saved without a price and a duration.
- **Dependencies:** —

### REQ-072 — Variations/options supported

- **Statement:** Services SHALL support variations/options.
- **Source:** KF-SVC-02 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: A service can have one or more defined variations/options.
- **Dependencies:** REQ-071

### REQ-073 — Add-ons may change price and duration

- **Statement:** Add-ons SHALL be able to change the price and the duration of a booking.
- **Source:** KF-SVC-03 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: Adding an add-on increases the booking's price and/or duration by its configured values.
- **Dependencies:** REQ-071

### REQ-074 — Total duration is the sum of selected components

- **Statement:** The total booking duration SHALL be the sum of the selected services, variations and add-ons.
- **Source:** KF-BOOK-02 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: Total duration equals the sum of the durations of every selected component.
- **Dependencies:** REQ-070, REQ-072, REQ-073

### REQ-075 — Total price derived from selected components

- **Statement:** The system SHALL derive the booking total price from the selected services/variations/add-ons.
- **Source:** KF-SVC-01, KF-SVC-03 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: Total price shown equals the sum of the prices of the selected components as configured.
- **Dependencies:** REQ-074

### REQ-076 — Existing bookings preserve price/duration snapshots

- **Statement:** Existing bookings SHALL preserve the original price and duration snapshots.
- **Source:** KF-BOOK-03, KF-SVC-06 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: Later price/duration changes to a service do not alter an existing booking's recorded price/duration.
- **Dependencies:** REQ-071, REQ-080

### REQ-077 — Services with future bookings cannot be hard-deleted

- **Statement:** A service that has future bookings SHALL NOT be hard-deleted.
- **Source:** KF-SVC-04 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: The system refuses permanent deletion of a service with future bookings.
- **Dependencies:** REQ-078

### REQ-078 — Such services can be deactivated

- **Statement:** Services with future bookings SHALL be deactivatable instead of deleted.
- **Source:** KF-SVC-05 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Deactivation succeeds and records the service as inactive.
- **Dependencies:** REQ-077

### REQ-079 — Deactivated services not selectable and hidden from public page

- **Statement:** Deactivated services SHALL NOT be selectable for new bookings and SHALL disappear from the public booking page.
- **Source:** KF-SVC-05, KF-SVC-07 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: A new booking cannot select a deactivated service; the public page does not show it.
- **Dependencies:** REQ-078

### REQ-080 — Existing bookings unchanged by deactivation

- **Statement:** Deactivating a service SHALL NOT change existing bookings.
- **Source:** KF-SVC-06 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: Bookings containing the deactivated service remain valid and unchanged.
- **Dependencies:** REQ-076, REQ-078

### REQ-081 — Deactivated services can be reactivated

- **Statement:** A deactivated service SHALL be reactivatable.
- **Source:** KF-SVC-08 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: After reactivation the service returns to the public booking page for new bookings.
- **Dependencies:** REQ-079

---

## 13. Domain 9 — Scheduling

### REQ-082 — Weekly working hours configurable

- **Statement:** Weekly working hours SHALL be configurable per business.
- **Source:** KF-SCHED-06 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The owner can define working hours for the week.
- **Dependencies:** REQ-050

### REQ-083 — Multiple working periods per day

- **Statement:** A single day SHALL support multiple working periods.
- **Source:** KF-SCHED-06 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: A day can define two or more separate working periods.
- **Dependencies:** REQ-082

### REQ-084 — Specific periods can be blocked

- **Statement:** Specific periods within a schedule SHALL be blockable.
- **Source:** KF-SCHED-08 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: A blocked period produces no available booking times (see REQ-050).
- **Dependencies:** REQ-050

### REQ-085 — Whole days can be blocked

- **Statement:** Whole days SHALL be blockable (no bookings offered).
- **Source:** KF-SCHED-08 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: A blocked day offers no available times.
- **Dependencies:** REQ-050

### REQ-086 — Special dates can override weekly schedules

- **Statement:** Special dates SHALL be able to override the weekly schedule.
- **Source:** KF-SCHED-07 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: A special date's hours (or closure, per REQ-087) supersede the week's normal hours.
- **Dependencies:** REQ-082

### REQ-087 — Special dates may be closed or have custom hours

- **Statement:** Special dates SHALL be definable as closed or as having custom hours.
- **Source:** KF-SCHED-34 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: A closed special date yields no availability; a custom-hours special date yields availability per its custom hours.
- **Dependencies:** REQ-086

### REQ-088 — Booking interval configurable

- **Statement:** The booking interval SHALL be configurable.
- **Source:** KF-SCHED-09 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Slot start times follow the configured interval.
- **Dependencies:** REQ-050

### REQ-089 — Full service duration must fit available working time

- **Statement:** A booking SHALL only be offered when the full service duration fits within the available working time.
- **Source:** KF-SCHED-10 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: No slot is offered if the combined duration extends beyond working hours or into a block.
- **Dependencies:** REQ-050, REQ-074

### REQ-090 — Existing bookings unchanged when schedule changes

- **Statement:** Existing bookings SHALL NOT be silently changed by schedule changes.
- **Source:** KF-SCHED-11 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: After a schedule change, existing bookings keep their dates/times unless the owner acts.
- **Dependencies:** REQ-091, REQ-160

### REQ-091 — Schedule changes allowed despite conflicts

- **Statement:** Schedule changes SHALL be permitted even when they produce conflicts with existing bookings.
- **Source:** KF-SCHED-24, KF-SCHED-12 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The system does not block a schedule change that creates conflicts; it warns (REQ-092).
- **Dependencies:** REQ-092

### REQ-092 — System warns about affected bookings

- **Statement:** When a schedule change affects existing bookings, the system SHALL generate a warning with affected-booking information.
- **Source:** KF-SCHED-13 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The owner sees a warning listing affected bookings when saving the schedule change.
- **Dependencies:** REQ-091

### REQ-093 — Warning identifies affected booking, date/time and reason

- **Statement:** The warning SHALL identify each affected booking, the affected date/time, and the conflict reason.
- **Source:** KF-SCHED-25 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: For each affected booking, the booking, date/time, and reason are shown.
- **Dependencies:** REQ-092

### REQ-094 — Affected-booking email generated

- **Statement:** An affected-booking email SHALL be generated for the impacted schedule change.
- **Source:** KF-SCHED-26 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The affected-booking email is sent when a conflictual schedule change is applied.
- **Dependencies:** REQ-092, REQ-142

### REQ-095 — Close schedule changes may be grouped into a five-minute window

- **Statement:** Close schedule changes MAY be grouped into a five-minute notification window.
- **Source:** KF-SCHED-27 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MAY | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: When grouping is enabled, notifications for changes within the window are combined into one delivery.
- **Dependencies:** REQ-094

### REQ-096 — Every affected booking individually listed

- **Statement:** The affected-booking notification SHALL list every affected booking individually.
- **Source:** KF-SCHED-28 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The notification contains one entry per affected booking.
- **Dependencies:** REQ-094

### REQ-097 — Notification contains customer name, phone, date/time and services

- **Statement:** The affected-booking notification SHALL contain customer name, phone, date/time and selected services.
- **Source:** KF-SCHED-29 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Each listed affected booking shows name, phone, date/time, and services.
- **Dependencies:** REQ-096

### REQ-098 — Direct access to affected bookings

- **Statement:** The affected-booking notification SHALL include direct access to the affected bookings.
- **Source:** KF-SCHED-30 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** UX
- **Acceptance criteria:**
  - AC1: From the notification, the owner can open each affected booking.
- **Dependencies:** REQ-096, REQ-099

### REQ-099 — Quick actions: Reschedule, Cancel, Keep Booking

- **Statement:** Affected-booking notifications/views SHALL offer quick actions including Reschedule, Cancel, and Keep Booking.
- **Source:** KF-SCHED-31 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The owner can choose Reschedule, Cancel, or Keep Booking for each affected booking.
- **Dependencies:** REQ-098, REQ-159

---

## 14. Domain 10 — Booking Lifecycle

### REQ-100 — Booking status modeled separately from payment status

- **Statement:** Booking status SHALL be modeled separately from payment status, and the payment status enumeration SHALL be exactly: **Pending, Accepted, Rejected**. No other payment status value (including **Refund, Partially Refunded, Failed**, or any other) SHALL be used.
- **Source:** KF-BOOK-07 (as refined by approved decision SM-12) | **Decision Source:** RESOLVED — PROMPT 05-FIX SM-12 | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: A booking can be confirmed while a separate payment status is tracked distinctly (see Section 26).
  - AC2: Only the three payment statuses Pending, Accepted, Rejected are ever assignable to a payment.
  - AC3: No payment status value outside {Pending, Accepted, Rejected} exists in any UI, API, data model, or export.
- **Dependencies:** REQ-101, Section 26

### REQ-101 — Confirmed booking state set

- **Statement:** The booking state SHALL be limited to: Payment Pending, Confirmed, Completed, No Show, Cancelled, Rejected.
- **Source:** KF-BOOK-15, KF-BOOK-17 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: No user-facing booking state outside this set exists.
- **Dependencies:** REQ-100, Section 26

### REQ-102 — Confirmed becomes Completed automatically

- **Statement:** Confirmed appointments SHALL automatically become Completed after their scheduled end time.
- **Source:** KF-BOOK-04 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: At the scheduled end time, a confirmed booking transitions to Completed (see Section 26).
- **Dependencies:** REQ-101

### REQ-103 — Owner can manually mark No Show

- **Statement:** The owner SHALL be able to manually mark a booking as No Show. No Show is a **permanently terminal** state: once set, no further transition out of No Show is permitted.
- **Source:** KF-BOOK-05 (as refined by approved decision SM-10) | **Decision Source:** RESOLVED — PROMPT 05-FIX SM-10 | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The owner can set a booking to No Show and the transition is recorded.
  - AC2: No UI, API, or workflow offers any transition out of the No Show state.
- **Dependencies:** Section 26, REQ-227

### REQ-104 — Owner can manually cancel

- **Statement:** The owner SHALL be able to manually cancel a booking. The owner MAY cancel a booking in the Confirmed state or in the **Payment Pending** state (a booking still awaiting proof verification). When a Payment Pending booking is cancelled, the associated slot SHALL remain blocked until the owner explicitly releases it through the permitted release action (it is NOT released automatically by the cancellation).
- **Source:** KF-BOOK-06, KF-CUST-09 (as refined by approved decisions SM-06 and SM-08) | **Decision Source:** RESOLVED — PROMPT 05-FIX SM-06, SM-08 | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The owner can cancel a Confirmed booking and the transition is recorded.
  - AC2: The owner can cancel a Payment Pending booking; the booking becomes Cancelled.
  - AC3: Cancelling a Payment Pending booking does NOT release the slot; the slot remains blocked until the owner explicitly releases it.
  - AC4: For a Cancelled Confirmed booking, the customer is notified via Telegram if connected (REQ-228); no notification is imposed for a Payment Pending cancellation (SM-08 does not require one).
- **Dependencies:** Section 26, REQ-123, REQ-228

### REQ-105 — Owner can reschedule confirmed bookings

- **Statement:** The owner SHALL be able to reschedule a confirmed booking.
- **Source:** KF-BOOK-11 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Rescheduling changes the booking's date/time to an available slot.
- **Dependencies:** REQ-106

### REQ-106 — Reschedule requires an available date/time

- **Statement:** Rescheduling a confirmed booking SHALL require an available date/time.
- **Source:** KF-BOOK-16 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: Reschedule to an unavailable or non-fitting slot is refused.
- **Dependencies:** REQ-105, REQ-089

### REQ-107 — Existing payment remains attached after reschedule

- **Statement:** The existing payment SHALL remain attached to the booking after rescheduling.
- **Source:** KF-BOOK-12 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: After reschedule, the previously received payment stays on the booking.
- **Dependencies:** REQ-105

### REQ-108 — Higher new price handled manually by owner

- **Statement:** If the rescheduled price would be higher, the owner SHALL handle the difference manually.
- **Source:** KF-BOOK-13 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The system does not automatically charge a price difference on reschedule.
- **Dependencies:** REQ-107

### REQ-109 — Customer identifies booking by phone number; no customer-facing reference/code

- **Statement:** A customer SHALL identify their booking using their **phone number**. The platform SHALL NOT issue a separate customer-facing booking reference/code. The internal **Booking ID** SHALL be retained for administration, reporting, audit, sorting, and internal traceability, and is not intended to be shown to customers as a reference.
- **Source:** KF-BOOK-14 (as refined by approved decision OQ-BOOK-001) | **Decision Source:** RESOLVED — PROMPT 05-FIX OQ-BOOK-001 | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The customer can reference/identify their booking by their phone number (e.g., in owner–customer conversations and any customer-facing lookup).
  - AC2: No visible booking reference/code is shown to customers.
  - AC3: The internal Booking ID continues to exist for admin/reporting/audit/sorting/traceability and remains distinct from any customer-facing identification.
- **Dependencies:** REQ-054, REQ-061

---

## 15. Domain 11 — Payments

### REQ-110 — Prepayment required per business configuration

- **Statement:** Customer prepayment SHALL be required according to each business's configuration.
- **Source:** KF-PAY-01 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: A business configured for prepayment shows a prepayment requirement in booking.
- **Dependencies:** REQ-111

### REQ-111 — Owner configures percentage or fixed prepayment

- **Statement:** The owner SHALL configure prepayment as either a percentage or a fixed amount.
- **Source:** KF-PAY-02 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The configuration accepts one of the two forms and rejects mixing.
- **Dependencies:** REQ-110

### REQ-112 — Multiple payment methods supported

- **Statement:** The platform SHALL support multiple payment methods. The initial customer payment-method set is exactly: **Bank Transfer** and **Telebirr / mobile money**; no other payment method SHALL be offered in this phase.
- **Source:** KF-PAY-03 (as refined by approved decision OQ-PAY-001) | **Decision Source:** RESOLVED — PROMPT 05-FIX OQ-PAY-001 | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: A business can offer both Bank Transfer and Telebirr / mobile money.
  - AC2: No payment method other than Bank Transfer and Telebirr / mobile money can be configured or selected in this phase.
- **Dependencies:** REQ-113, REQ-114

### REQ-113 — Manual bank transfer supported

- **Statement:** Manual bank transfer SHALL be a supported payment method.
- **Source:** KF-PAY-04 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: A business can enable manual bank transfer and customers can select it.
- **Dependencies:** REQ-116

### REQ-114 — Mobile-money (e.g., Telebirr) supported

- **Statement:** Mobile-money payment methods such as Telebirr SHALL be supported.
- **Source:** KF-PAY-05 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: A business can configure a mobile-money method and customers can select it.
- **Dependencies:** REQ-116

### REQ-115 — Custom payment methods NOT configured in this phase

- **Statement:** Custom payment methods SHALL NOT be configurable in this phase. The initial set of payment methods is fixed to **Bank Transfer** and **Telebirr / mobile money** (OQ-PAY-001); no custom method may be added.
- **Source:** KF-PAY-05 (superseded by approved decision OQ-PAY-001) | **Decision Source:** RESOLVED — PROMPT 05-FIX OQ-PAY-001 (SUPERSEDES the prior "custom payment methods configurable" reading) | **Priority:** MUST | **Class:** FUNC
- **Status:** APPROVED (as superseded wording — see change note in change log).
- **Acceptance criteria:**
  - AC1: No UI, configuration, or API allows defining a custom payment method.
- **Dependencies:** REQ-112

### REQ-116 — Customer selects a payment method

- **Statement:** During booking, the customer SHALL select a payment method.
- **Source:** KF-PAY-10 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The booking flow requires a payment-method choice before proof submission.
- **Dependencies:** REQ-112

### REQ-117 — Customer uploads payment proof

- **Statement:** The customer SHALL upload payment proof during booking.
- **Source:** KF-PAY-11 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: A booking proceeds only after proof upload (see REQ-052).
- **Dependencies:** REQ-118, REQ-052

### REQ-118 — Payment proof supports image and PDF

- **Statement:** Payment proof upload SHALL accept image and PDF files.
- **Source:** KF-PAY-06, KF-SUB-06 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Both image and PDF proofs upload successfully; other formats are refused.
- **Dependencies:** REQ-117

### REQ-119 — Owner verifies proof in dashboard

- **Statement:** The owner SHALL be able to verify payment proof in the dashboard.
- **Source:** KF-PAY-07 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The dashboard exposes the proof and accept/reject actions.
- **Dependencies:** REQ-117

### REQ-120 — Owner verifies proof via Telegram

- **Statement:** The owner SHALL be able to verify payment proof through Telegram.
- **Source:** KF-PAY-07 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Telegram presents proof details and accept/reject actions (see REQ-067).
- **Dependencies:** REQ-066, REQ-067

### REQ-121 — Slot claim is atomic; exactly one winner (race condition)

- **Statement:** Two customers MUST NOT both successfully claim the same appointment slot through concurrent payment-proof submissions. The proof-submission attempts MAY occur concurrently; the system SHALL determine ownership of the slot atomically; exactly one successful claim SHALL win; every losing attempt SHALL receive an unavailable result; and the system SHALL never create two successful bookings for the same slot, including under concurrent requests. To enforce this, a slot SHALL be locked upon a successful proof submission (slot-lock, see Section 26.3). The lock SHALL have **no automatic expiry**: it persists until an allowed workflow explicitly releases it (no timeout, TTL, or automatic unlock).
- **Source:** KF-BOOK-08, KF-BOOK-09, KF-PUB-24 (as refined by approved decision OQ-SLOT-001) | **Decision Source:** RESOLVED — PROMPT 05-FIX OQ-SLOT-001 | **Priority:** MUST | **Class:** DATA-INT
- **Rationale:** This is the confirmed race-condition rule: first successful submission wins atomically; a second customer must receive an unavailable result. The slot lock exists (KF-BOOK-08) and its duration is decided: **no automatic expiry**; the lock is released only by an allowed workflow action (approval — allocated to the confirmed booking; rejection — released by the owner or replaced by a valid resubmission; cancellation — released by the owner; lifecycle end).
- **Acceptance criteria:**
  - AC1: Concurrent submissions for the same slot yield exactly one winner.
  - AC2: Every losing attempt sees the slot as unavailable — no partial claim state.
  - AC3: At most one successful booking ever exists for a given slot.
  - AC4: The decision is atomic (no window in which both succeed).
  - AC5: A successful proof submission locks the slot; the lock never expires and is removed only by an allowed workflow release.
- **Dependencies:** REQ-052, REQ-053, REQ-123

### REQ-122 — No automatic refunds; refund handling manual

- **Statement:** The system SHALL NOT issue automatic refunds; cancellation/refund handling SHALL be manual.
- **Source:** KF-PAY-08, KF-PAY-09 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: No refund action occurs automatically; any refund requires manual owner action.
- **Dependencies:** —

### REQ-123 — Rejected proof keeps slot blocked until release or valid resubmission

- **Statement:** A rejected payment proof SHALL keep the slot blocked. The slot SHALL be released only when the owner explicitly releases/cancels the booking (releasing the slot) OR when the customer submits new valid proof (booking returns to Payment Pending while the slot remains blocked).
- **Source:** KF-BOOK-10 (as refined by approved decisions SM-09 and OQ-SLOT-001) | **Decision Source:** RESOLVED — PROMPT 05-FIX SM-09, OQ-SLOT-001 | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: After rejection, the slot is not offered to new customers until the owner releases it or a valid resubmission returns the booking to Payment Pending.
  - AC2: A valid resubmission (REQ-230) keeps the slot blocked and returns the booking to Payment Pending.
  - AC3: No automatic release occurs at any time for a rejected booking.
- **Dependencies:** REQ-121, REQ-230

### REQ-124 — Proof rejection may include a reason sent to the customer

- **Statement:** Payment-proof rejection MAY include a reason, and the customer SHALL receive the rejection reason.
- **Source:** KF-PAY-12, KF-TG-09 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: When a reason is supplied, the customer receives it.
- **Dependencies:** REQ-123, REQ-062

---

## 16. Domain 12 — Subscription

### REQ-125 — One standard monthly price

- **Statement:** The platform SHALL have one standard monthly subscription price.
- **Source:** KF-SUB-01 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: Exactly one standard monthly price exists for subscription.
- **Dependencies:** —

### REQ-126 — No subscription tiers initially

- **Statement:** The platform SHALL NOT have subscription tiers initially.
- **Source:** KF-SUB-02 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: No tier selection exists in subscription.
- **Dependencies:** REQ-125

### REQ-127 — Independent subscription state per business

- **Statement:** Each business SHALL track its own independent subscription state.
- **Source:** KF-SUB-03, KF-BIZ-12 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: Two businesses can be in different subscription states.
- **Dependencies:** REQ-015

### REQ-128 — Trial is 30 days

- **Statement:** The free trial SHALL last 30 days.
- **Source:** KF-SUB-03 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: Trial duration is 30 days per business.
- **Dependencies:** REQ-006

### REQ-129 — Trial grace is 3 days

- **Statement:** The trial grace period SHALL be 3 days.
- **Source:** KF-SUB-09 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: Trial grace lasts 3 days.
- **Dependencies:** REQ-132

### REQ-130 — Paid subscription period is 30 days

- **Statement:** A paid subscription period SHALL be 30 days (activation/extension).
- **Source:** KF-SUB-08 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: Approval activates or extends the subscription by 30 days.
- **Dependencies:** REQ-137

### REQ-131 — Paid grace is 5 days

- **Statement:** The paid-subscription grace period SHALL be 5 days.
- **Source:** KF-SUB-10 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: After period end, 5 days of paid grace apply.
- **Dependencies:** REQ-132

### REQ-132 — Bookings continue during grace

- **Statement:** New bookings SHALL continue to be accepted during any grace period (trial or paid).
- **Source:** KF-SUB-11 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: During grace, booking remains enabled.
- **Dependencies:** REQ-129, REQ-131

### REQ-133 — After grace, new bookings disabled

- **Statement:** After the grace period ends (without renewal), new bookings SHALL be disabled.
- **Source:** KF-SUB-12 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: At grace expiry, the public flow refuses new bookings.
- **Dependencies:** REQ-132

### REQ-134 — Public page remains visible (expired/grace states)

- **Statement:** The public page SHALL remain visible during grace and after subscription expiration.
- **Source:** KF-SUB-13, KF-PUB-20 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The public page renders in all subscription states; only new bookings are gated.
- **Dependencies:** REQ-133

### REQ-135 — Subscription paid via manual bank transfer

- **Statement:** Subscription payment SHALL be made by manual bank transfer.
- **Source:** KF-SUB-04 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The subscription-payment flow instructs manual bank transfer.
- **Dependencies:** —

### REQ-136 — Owner uploads subscription payment proof

- **Statement:** The owner SHALL upload subscription payment proof; proof SHALL accept image and PDF.
- **Source:** KF-SUB-05, KF-SUB-06 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: A subscription payment requires owner proof upload (image/PDF).
- **Dependencies:** REQ-135

### REQ-137 — Admin/Super Admin reviews subscription proof; approval extends 30 days

- **Statement:** An Admin or the Super Admin SHALL review subscription payment proof; approval SHALL activate/extend the subscription by 30 days.
- **Source:** KF-SUB-07, KF-SUB-08 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Only Admin/Super Admin can approve subscription proof.
  - AC2: Approval extends the subscription by 30 days.
- **Dependencies:** REQ-130, REQ-136, REQ-220

### REQ-138 — Rejection requires a reason; sent to owner

- **Statement:** Subscription-proof rejection SHALL require a reason, and the reason SHALL be sent to the owner.
- **Source:** KF-SUB-14, KF-SUB-15 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Rejection without reason is refused; owner receives the reason.
- **Dependencies:** REQ-137

### REQ-139 — Reminders use email and business Telegram

- **Statement:** Subscription reminders SHALL be delivered by email and to the business Telegram.
- **Source:** KF-SUB-16 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Subscription reminders are sent via both channels.
- **Dependencies:** REQ-142

### REQ-140 — Exactly two Admin accounts receive subscription payment notifications

- **Statement:** Exactly the two Admin accounts SHALL receive subscription-payment notifications.
- **Source:** KF-SUB-17 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: Subscription-payment notifications are delivered to the two Admins only.
- **Dependencies:** REQ-038, REQ-142

### REQ-141 — Owner retains access and data after expiration; warning until renewal

- **Statement:** After the paid grace period ends, the owner SHALL retain dashboard access, access to existing bookings, customer data and business data, and a prominent subscription warning SHALL remain visible until renewal.
- **Source:** KF-SUB-19, KF-SUB-20, KF-SUB-21, KF-SUB-22, KF-SUB-23 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Expired business owner can access dashboard and existing data (see REQ-023).
  - AC2: A subscription warning remains until renewal.
- **Dependencies:** REQ-133, REQ-023

---

## 17. Domain 13 — Notifications

### REQ-142 — Notification channels are email and Telegram

- **Statement:** Notifications SHALL be delivered via email and Telegram as specified by the confirmed flows (booking, schedule, subscription, security); no other channel is confirmed.
- **Source:** KF-SUB-16, KF-TG-02 … KF-TG-10, KF-SCHED-26, KF-SEC-05, KF-SEC-18 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Every confirmed notification (customer/owner/subscription/security/schedule) maps to email or Telegram.
- **Dependencies:** —

---

## 18. Domain 14 — Pause / Resume

### REQ-143 — Business can pause bookings

- **Statement:** A business SHALL be able to pause bookings.
- **Source:** KF-PUB-13 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The owner can put the business into the paused state.
- **Dependencies:** REQ-146, REQ-147

### REQ-144 — Pause can be indefinite or with automatic resume date

- **Statement:** A pause SHALL be configurable as indefinite or with an automatic resume date.
- **Source:** KF-PUB-14 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Both pause forms are supported.
- **Dependencies:** REQ-143

### REQ-145 — Resume date can be changed, removed or extended

- **Statement:** An automatic resume date SHALL be changeable, removable, or extendable.
- **Source:** KF-PAUSE-09 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The owner can modify, remove, or extend the scheduled resume date.
- **Dependencies:** REQ-144

### REQ-146 — Public page visible while paused

- **Statement:** The public page SHALL remain visible while the business is paused.
- **Source:** KF-PUB-15 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The paused page still renders to visitors.
- **Dependencies:** REQ-143

### REQ-147 — New bookings disabled while paused

- **Statement:** New bookings SHALL be disabled while the business is paused.
- **Source:** KF-PUB-16 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: No new booking can be started while paused.
- **Dependencies:** REQ-143

### REQ-148 — Optional pause message shown

- **Statement:** An optional pause message SHALL be displayable on the page.
- **Source:** KF-PUB-17 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** UX
- **Acceptance criteria:**
  - AC1: If set, the pause message is shown to visitors.
- **Dependencies:** REQ-146

### REQ-149 — Optional reopening date shown

- **Statement:** The reopening date, when set, SHALL be displayable on the page.
- **Source:** KF-PUB-17 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** UX
- **Acceptance criteria:**
  - AC1: If set, the reopening date is shown to visitors.
- **Dependencies:** REQ-146

### REQ-150 — Schedule changes while paused are pending and versioned

- **Statement:** Schedule changes made while bookings are paused SHALL be recorded as pending and versioned.
- **Source:** KF-SCHED-14, KF-PAUSE-07 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: A paused business accepts schedule edits that are flagged pending, never auto-activated.
- **Dependencies:** REQ-151, REQ-162

### REQ-151 — Latest pending schedule becomes active on resume

- **Statement:** When bookings resume, the latest pending schedule SHALL become active.
- **Source:** KF-SCHED-15, KF-PAUSE-08 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: On resume, the most recent pending schedule supersedes earlier pending versions.
- **Dependencies:** REQ-150

### REQ-152 — Multiple changes while paused retained in history

- **Statement:** Multiple schedule changes made during a pause SHALL remain in schedule history.
- **Source:** KF-PAUSE-07, KF-SCHED-16 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** AUDIT
- **Acceptance criteria:**
  - AC1: Each paused-period change appears in schedule history (see REQ-163).
- **Dependencies:** REQ-150, REQ-163

### REQ-153 — Automatic resume only if subscription active

- **Statement:** Automatic resume SHALL occur only when the subscription is active.
- **Source:** KF-PAUSE-01 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: No auto-resume when the subscription is not active.
- **Dependencies:** REQ-144, REQ-127

### REQ-154 — Expired subscription prevents automatic reopening

- **Statement:** If the subscription is expired at the scheduled resume time, bookings SHALL remain closed.
- **Source:** KF-PAUSE-02 (as refined by approved decision SM-13) | **Decision Source:** RESOLVED — PROMPT 05-FIX SM-13 | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: At scheduled resume with expired subscription, bookings stay closed.
  - AC2: The automatic resume event and its outcome are recorded in history (REQ-231); the recorded event is never interpreted as the business being available for bookings.
- **Dependencies:** REQ-153, REQ-231

### REQ-155 — Renewal after pause period ended permits automatic reopening

- **Statement:** If the subscription is renewed later and the scheduled pause period has already ended, automatic reopening SHALL occur.
- **Source:** KF-PAUSE-03 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: Renewal after the pause end date reopens bookings automatically.
- **Dependencies:** REQ-153

### REQ-156 — Indefinite pause stays paused on renewal

- **Statement:** An indefinitely paused business SHALL NOT automatically reopen merely because the subscription is renewed.
- **Source:** KF-PAUSE-04 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: Renewal does not resume an indefinite pause.
- **Dependencies:** REQ-144

### REQ-157 — Manual resume opens immediately if subscription active

- **Statement:** Manual resume SHALL immediately open bookings if the subscription is active.
- **Source:** KF-PAUSE-05 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Manual resume with an active subscription reopens bookings at once.
- **Dependencies:** REQ-153, REQ-158

### REQ-158 — Resume checks current schedule/availability

- **Statement:** Resume SHALL check the current schedule/availability.
- **Source:** KF-PAUSE-06 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: On resume, availability is recomputed against the active schedule.
- **Dependencies:** REQ-151, REQ-157

---

## 19. Domain 15 — Schedule Exceptions

### REQ-159 — Owner may choose Keep Booking on conflict

- **Statement:** When a schedule change conflicts with an existing booking, the owner SHALL be able to choose Keep Booking.
- **Source:** KF-SCHED-31 | **Decision Source:** DEC-175 (per earlier documentation example; formal mapping pending) | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Keep Booking is available as a quick action for affected bookings (see REQ-099).
- **Dependencies:** REQ-099

### REQ-160 — Kept booking becomes an approved schedule exception

- **Statement:** When the owner chooses Keep Booking, the conflicting booking SHALL become an approved schedule exception and remain intact. The exception SHALL be specific to that booking, SHALL NOT modify the normal schedule, SHALL be visible in the booking dashboard with a "Schedule Exception" label and the reason/details, SHALL remain attached to the booking record after the appointment is completed, and SHALL appear in exported booking reports. The customer SHALL NOT be notified about the exception itself.
- **Source:** KF-SCHED-31, KF-SCHED-11 | **Decision Source:** DEC-175 (per earlier documentation example; formal mapping pending) | **Priority:** MUST | **Class:** DATA-INT
- **Rationale:** Schedule-exception semantics consolidated from the Keep Booking decision (DEC-175 pending) — the exception is per-booking, does not change the schedule itself, and is an owner-side record.
- **Acceptance criteria:**
  - AC1: The booking is retained despite the schedule change and is recorded as an approved exception.
  - AC2: The exception is labeled "Schedule Exception" and carries the reason/details.
  - AC3: The exception does not alter the normal schedule; other bookings/unpaused periods are unaffected.
  - AC4: The exception is visible in the booking dashboard and remains after the appointment completes.
  - AC5: The exception appears in exported booking reports.
  - AC6: No customer notification is triggered by the exception.
- **Dependencies:** REQ-159, REQ-090

### REQ-161 — Exception creation is recorded and visible

- **Statement:** The creation of a schedule exception SHALL be recorded and visible in the affected booking's history.
- **Source:** KF-SCHED-16, KF-SCHED-17 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** AUDIT
- **Acceptance criteria:**
  - AC1: The affected booking's audit/history records the exception decision.
- **Dependencies:** REQ-160, REQ-173

---

## 20. Domain 16 — Audit / History

### REQ-162 — Schedule versions retained

- **Statement:** Schedule versions SHALL be retained.
- **Source:** KF-SCHED-16 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** AUDIT
- **Acceptance criteria:**
  - AC1: Every saved schedule state is stored as a retrievable version.
- **Dependencies:** REQ-150, REQ-172

### REQ-163 — Schedule history records who/when/what/reason

- **Statement:** Schedule history SHALL record who changed the schedule, when, what changed, and the reason.
- **Source:** KF-SCHED-17 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** AUDIT
- **Acceptance criteria:**
  - AC1: Each history entry contains actor, date/time, changed content, and reason.
- **Dependencies:** REQ-162

### REQ-164 — Manual reason optional

- **Statement:** A manually entered change reason SHALL be optional.
- **Source:** KF-SCHED-33 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: A manual schedule change can be saved with or without a reason.
- **Dependencies:** REQ-163

### REQ-165 — Automatic changes use System actor and automatic reason

- **Statement:** Automatic schedule changes SHALL use System as the actor and carry an automatic reason.
- **Source:** KF-SCHED-18, KF-ROLE-09 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** AUDIT
- **Acceptance criteria:**
  - AC1: History entries for automatic changes show System and an automatic reason.
- **Dependencies:** REQ-163, REQ-044

### REQ-166 — Owner can view schedule history

- **Statement:** The owner SHALL be able to view schedule history for their business.
- **Source:** KF-SCHED-19 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Owner's schedule-history view is available.
- **Dependencies:** REQ-163

### REQ-167 — Super Admin can view schedule history

- **Statement:** The Super Admin SHALL be able to view schedule history.
- **Source:** KF-SCHED-19 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Super Admin can view any business's schedule history.
- **Dependencies:** REQ-163

### REQ-168 — Admin cannot view schedule history

- **Statement:** Admin SHALL NOT be able to view schedule history.
- **Source:** KF-SCHED-20 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: Admins receive no schedule-history access.
- **Dependencies:** REQ-042

### REQ-169 — Owner cannot restore/revert; history view-only

- **Statement:** The owner SHALL NOT be able to restore/revert a previous schedule version; schedule history SHALL be view-only.
- **Source:** KF-SCHED-21 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: No restore/revert action exists for the owner.
- **Dependencies:** REQ-166

### REQ-170 — Schedule history export as PDF

- **Statement:** Schedule history SHALL be exportable as PDF.
- **Source:** KF-SCHED-22 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The owner/Super Admin can export the schedule history to a PDF file.
- **Dependencies:** REQ-166, REQ-167

### REQ-171 — Schedule-history export supports custom start/end date

- **Statement:** The schedule-history PDF export SHALL support a custom start/end date range.
- **Source:** KF-SCHED-32 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Export respects the selected date range.
- **Dependencies:** REQ-170

### REQ-172 — Schedule-history PDF contains versions and dates/times only

- **Statement:** The schedule-history PDF SHALL contain schedule versions and dates/times, and SHALL NOT contain actor/change/reason details.
- **Source:** KF-SCHED-23 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The PDF omits actor, change details, and reasons.
- **Dependencies:** REQ-170

### REQ-173 — Full booking status history retained internally

- **Statement:** Full booking status history SHALL be stored internally, recording actor, date/time, previous status and new status.
- **Source:** KF-REPORT-02, KF-REPORT-03 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** AUDIT
- **Acceptance criteria:**
  - AC1: Each booking state transition records actor, date/time, previous and new status.
- **Dependencies:** Section 26, REQ-175

### REQ-174 — Owner can view full history for own bookings

- **Statement:** The owner SHALL be able to view the full status history of their own bookings.
- **Source:** KF-REPORT-04 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The owner sees the complete history for bookings in their business.
- **Dependencies:** REQ-173

---

## 21. Domain 17 — Reports / Exports

### REQ-175 — Booking reports show current status

- **Statement:** Booking reports SHALL show the current booking status.
- **Source:** KF-REPORT-01 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The report lists bookings with their current status.
- **Dependencies:** REQ-185

### REQ-176 — Admin sees current status only

- **Statement:** Admin SHALL see only the current booking status, not full history.
- **Source:** KF-REPORT-05 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: Admin-facing booking views expose current status only.
- **Dependencies:** REQ-042

### REQ-177 — Super Admin can view full booking history

- **Statement:** The Super Admin SHALL be able to view full booking status history.
- **Source:** KF-REPORT-06 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Super Admin's view includes complete status history across businesses.
- **Dependencies:** REQ-173

### REQ-178 — Super Admin can export full booking status history to PDF

- **Statement:** The Super Admin SHALL be able to export the full booking status history as PDF.
- **Source:** KF-REPORT-07 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: A PDF export of full status history is available to Super Admin.
- **Dependencies:** REQ-177, REQ-179

### REQ-179 — Export supports custom date range

- **Statement:** The booking-history PDF export SHALL support a custom date range.
- **Source:** KF-REPORT-08 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Export output is limited to the chosen date range.
- **Dependencies:** REQ-178

### REQ-180 — Export covers all businesses or one selected business

- **Statement:** The export SHALL cover all businesses or one selected business.
- **Source:** KF-REPORT-09 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Export scope is either all businesses or exactly one selected business.
- **Dependencies:** REQ-178

### REQ-181 — Business multi-select not allowed

- **Statement:** Multi-selecting multiple businesses for export SHALL NOT be allowed.
- **Source:** KF-REPORT-10 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The export UI cannot select more than one specific business.
- **Dependencies:** REQ-180

### REQ-182 — PDF contains Booking ID, customer, business, status changes, dates/times, actor

- **Statement:** The exported PDF SHALL contain Booking ID, customer name, business name, status changes, dates/times and actor.
- **Source:** KF-REPORT-11 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Each history row in the PDF shows the six named fields.
- **Dependencies:** REQ-178

### REQ-183 — PDF excludes reasons/notes

- **Statement:** The exported PDF SHALL NOT contain reasons/notes.
- **Source:** KF-REPORT-12 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The PDF includes no reason/note fields.
- **Dependencies:** REQ-178

### REQ-184 — Filters: status, actor, date range, business

- **Statement:** Booking-history reporting SHALL support filters for status, actor, date range and business.
- **Source:** KF-REPORT-13 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Each named filter is available.
- **Dependencies:** REQ-185

### REQ-185 — Filter AND/OR semantics

- **Statement:** Filters SHALL combine with AND between categories and OR within a category.
- **Source:** KF-REPORT-14 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Selecting two categories requires both (AND); two values in one category include either (OR).
- **Dependencies:** REQ-184

### REQ-186 — Filters not remembered; reset defaults to 30 days

- **Statement:** Report filters SHALL NOT be remembered after leaving; reset SHALL default to the most recent 30 days (based on the current date/time when the report is opened).
- **Source:** KF-REPORT-15, KF-REPORT-16 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Reopening the report shows the default 30-day window with no stale selections.
- **Dependencies:** REQ-184

### REQ-187 — Default sort newest first

- **Statement:** The report SHALL default to newest-first ordering.
- **Source:** KF-REPORT-17 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** UX
- **Acceptance criteria:**
  - AC1: On open/reset, rows are ordered newest first.
- **Dependencies:** REQ-189

### REQ-188 — Sortable columns

- **Statement:** The report SHALL support sorting by date/time, Booking ID, customer name, business name, status and actor.
- **Source:** KF-REPORT-18 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** UX
- **Acceptance criteria:**
  - AC1: Each named column is sortable.
- **Dependencies:** REQ-189

### REQ-189 — Date/time sorting rules

- **Statement:** Date/time sorting SHALL use the exact date/time; date-only primary sorting SHALL use the exact time as the secondary key.
- **Source:** KF-REPORT-19, KF-REPORT-20 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: Rows sort by exact timestamp; date-only keys break ties by exact time.
- **Dependencies:** REQ-188, REQ-222

### REQ-190 — Booking ID and other-column sorting rules (CONF-001 recorded)

- **Statement:** Booking ID sorting SHALL be numeric/chronological. The final sort order for rows is: **Primary = Booking ID; Secondary = Date/time; Final tie-breaker = Actor A–Z** (identical Booking ID and timestamp). Customer/business/status/actor sorting SHALL use Booking ID as the secondary key and date/time as the final key where specified.
- **Source:** KF-REPORT-21, KF-REPORT-22, KF-REPORT-23, KF-REPORT-24 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Rationale:** This requirement preserves CONF-001. The later approved decision (date/time secondary key) **supersedes** the earlier rule (Actor name A–Z secondary key); the earlier rule is preserved as history and the resolution is documented in [consistency-audit.md](consistency-audit.md).
- **Acceptance criteria:**
  - AC1: Booking ID sort is numeric/chronological.
  - AC2: Ties on Booking ID are secondarily ordered by date/time.
  - AC3: If Booking ID and timestamp are identical, Actor A–Z is the final order.
  - AC4: Customer/business/status/actor sorts apply the specified Booking-ID secondary and date/time final behavior.
- **Dependencies:** REQ-188, [CONF-001](250-approved-decisions.md#known-decision-conflicts)

---

## 22. Domain 18 — Security

### REQ-191 — Login success and failure recorded

- **Statement:** Login success and login failure SHALL be recorded.
- **Source:** KF-SEC-09 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** AUDIT
- **Acceptance criteria:**
  - AC1: Both successful and failed login events produce records.
- **Dependencies:** —

### REQ-192 — Login records include date/time, IP, device/browser and result

- **Statement:** Login records SHALL include date/time, IP, device/browser, and result.
- **Source:** KF-SEC-10 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** AUDIT
- **Acceptance criteria:**
  - AC1: Every login record contains the four named attributes.
- **Dependencies:** REQ-191

### REQ-193 — Five consecutive failed attempts cause a 15-minute lock

- **Statement:** Five consecutive failed login attempts SHALL cause a 15-minute temporary lock of the account.
- **Source:** KF-SEC-11 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: After 5 consecutive failures, further attempts are refused for 15 minutes.
- **Dependencies:** REQ-191

### REQ-194 — Successful password reset clears the lock

- **Statement:** A successful password reset SHALL clear the temporary lock.
- **Source:** KF-SEC-12 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: After a password reset, the locked account can log in.
- **Dependencies:** REQ-193, REQ-033

### REQ-195 — Lockout generates an immediate email

- **Statement:** A 15-minute lockout SHALL generate an immediate email.
- **Source:** KF-SEC-18 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: The lockout email is generated at lock time.
- **Dependencies:** REQ-193, REQ-196

### REQ-196 — Lockout email includes IP and device/browser

- **Statement:** The lockout email SHALL include the IP and device/browser.
- **Source:** KF-SEC-13 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: The email shows IP and device/browser of the attempts.
- **Dependencies:** REQ-195

### REQ-197 — New/unrecognized successful devices recorded

- **Statement:** Successful login from a new/unrecognized device SHALL be recorded (without email).
- **Source:** KF-SEC-14 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** AUDIT
- **Acceptance criteria:**
  - AC1: First-time device logins are entered into the activity history; no email is sent.
- **Dependencies:** REQ-191

### REQ-198 — Super Admin emergency recovery email

- **Statement:** The Super Admin SHALL have a separate emergency recovery email.
- **Source:** KF-SEC-01 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: A distinct recovery email is configured for the Super Admin.
- **Dependencies:** REQ-199

### REQ-199 — Emergency recovery sends a one-time code

- **Statement:** Emergency recovery SHALL send a one-time code.
- **Source:** KF-SEC-02 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: Requesting emergency recovery delivers a one-time code.
- **Dependencies:** REQ-198

### REQ-200 — Recovery code permits immediate password replacement

- **Statement:** A successful recovery code SHALL immediately permit a new password.
- **Source:** KF-SEC-03 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: After valid code entry, the Super Admin can set a new password at once.
- **Dependencies:** REQ-199

### REQ-201 — Owner views own security/activity history

- **Statement:** The owner SHALL be able to view their own security/activity history.
- **Source:** KF-SEC-15 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** AUDIT
- **Acceptance criteria:**
  - AC1: The owner's security/activity history is viewable.
- **Dependencies:** REQ-191

### REQ-202 — Admin views own security history

- **Statement:** Admin SHALL be able to view their own security history.
- **Source:** KF-SEC-16 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** AUDIT
- **Acceptance criteria:**
  - AC1: Admin's own security history is viewable.
- **Dependencies:** REQ-191

### REQ-203 — Super Admin views all relevant security history

- **Statement:** The Super Admin SHALL be able to view all relevant security history.
- **Source:** KF-SEC-17 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** AUDIT
- **Acceptance criteria:**
  - AC1: Super Admin can view security history platform-wide as relevant.
- **Dependencies:** REQ-191

### REQ-204 — Security/activity records retained one year

- **Statement:** Security/activity records SHALL be retained for one year.
- **Source:** KF-AUTH-07 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: Security/activity records are available for one year.
- **Dependencies:** REQ-191

### REQ-205 — Super Admin can delete security/activity records

- **Statement:** The Super Admin SHALL be able to delete security/activity records.
- **Source:** KF-AUTH-08 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: Super Admin can delete qualifying security/activity records.
- **Dependencies:** REQ-206

### REQ-206 — Deletion itself audited

- **Statement:** The deletion of security/activity records SHALL itself be audited.
- **Source:** KF-AUTH-08 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** AUDIT
- **Acceptance criteria:**
  - AC1: A deletion event produces its own audit record.
- **Dependencies:** REQ-205

---

## 23. Domain 19 — Public Business Page

### REQ-207 — Public page customizable

- **Statement:** The business SHALL be able to customize its public page.
- **Source:** KF-PUB-02 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** UX
- **Acceptance criteria:**
  - AC1: Page customization settings are available to the owner.
- **Dependencies:** —

### REQ-208 — One main cover photo; no gallery

- **Statement:** The public page SHALL support exactly one main cover photo and SHALL NOT have a gallery.
- **Source:** KF-PUB-03, KF-PUB-04 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Only one cover photo can be set; no gallery UI exists.
- **Dependencies:** REQ-207

### REQ-209 — Page includes business name and logo

- **Statement:** The public page SHALL include the business name and logo.
- **Source:** KF-PUB-27 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Business name and logo render on the page.
- **Dependencies:** REQ-207

### REQ-210 — Page includes business description

- **Statement:** The public page SHALL include a business description.
- **Source:** KF-PUB-28 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The business description is displayed on the page.
- **Dependencies:** REQ-207

### REQ-211 — Location includes address and latitude/longitude

- **Statement:** Business location SHALL include an address and latitude/longitude.
- **Source:** KF-PUB-09 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: The location may be saved with all three attributes.
- **Dependencies:** REQ-212

### REQ-212 — Map access (Google Maps / OpenStreetMap)

- **Statement:** The public page SHALL be able to provide map access via Google Maps and/or OpenStreetMap.
- **Source:** KF-PUB-10 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: A map link/embed for the business location is available on the page.
- **Dependencies:** REQ-211

### REQ-213 — Public contact is phone

- **Statement:** Public contact information SHALL be the business phone number.
- **Source:** KF-PUB-11 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The public page shows the business phone as the contact method.
- **Dependencies:** —

### REQ-214 — Page content: services, prices, durations, variations, add-ons, available times

- **Statement:** The public page SHALL include services, prices, durations, variations/options, add-ons and available booking times.
- **Source:** KF-PUB-29 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Each named content element is rendered on the public page.
- **Dependencies:** REQ-071, REQ-072, REQ-073, REQ-050

### REQ-215 — Business type categories are exactly Salon & Barber and Other

- **Statement:** Business type SHALL be selected from exactly the predefined categories **Salon & Barber** and **Other**. No other predefined category and no custom category SHALL be offered in this phase.
- **Source:** KF-PUB-12 (as refined by approved decision OQ-PUB-001) | **Decision Source:** RESOLVED — PROMPT 05-FIX OQ-PUB-001 | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: The business-type field offers exactly "Salon & Barber" and "Other".
  - AC2: Selecting a business type outside {Salon & Barber, Other} is not possible.
- **Dependencies:** REQ-003

### REQ-216 — Business deactivation/closure by owner

- **Statement:** The owner SHALL be able to deactivate/close (not permanently delete) the business; the owner SHALL retain dashboard access; new bookings SHALL be disabled; the owner SHALL be able to reactivate; reactivation SHALL immediately reopen bookings if the subscription is active.
- **Source:** KF-PUB-18, KF-PUB-19, KF-PUB-25, KF-PUB-26 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Deactivation disables new bookings while keeping owner dashboard access.
  - AC2: Reactivation with an active subscription reopens bookings immediately.
- **Dependencies:** REQ-023, REQ-157

---

## 24. Domain 20 — Administration

### REQ-217 — Super Admin admin-account lifecycle operations

- **Statement:** The Super Admin SHALL be able to create, deactivate, and manage Admin accounts.
- **Source:** KF-ROLE-04 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: Super Admin can create/deactivate/manage Admin accounts.
- **Dependencies:** REQ-037, REQ-038, REQ-039

### REQ-218 — Admin cannot change own password

- **Statement:** An Admin SHALL NOT be able to change their own password.
- **Source:** KF-SEC-06 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: No self-service password change is available to Admin.
- **Dependencies:** REQ-219

### REQ-219 — Super Admin can change Admin passwords

- **Statement:** The Super Admin SHALL be able to change Admin passwords.
- **Source:** KF-SEC-07 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: Super Admin can set a new Admin password (logging the Admin out everywhere — see REQ-035).
- **Dependencies:** REQ-035, REQ-218

### REQ-220 — Super Admin can force-log-out Owners/Admins

- **Statement:** The Super Admin SHALL be able to force-log-out Owner and Admin users.
- **Source:** KF-SEC-04 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: Forced logout terminates the target's sessions.
- **Dependencies:** REQ-221

### REQ-221 — Forced logout sends immediate email

- **Statement:** A forced logout SHALL send an immediate email to the affected user.
- **Source:** KF-SEC-05 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** SEC
- **Acceptance criteria:**
  - AC1: The email is sent at the moment of forced logout.
- **Dependencies:** REQ-220

---

## 25. Domain 21 — Cross-cutting Date / Time Rules

### REQ-222 — One global system timezone

- **Statement:** The platform SHALL use one fixed global system timezone.
- **Source:** KF-SCHED-01 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: All system time handling uses the single global timezone.
- **Dependencies:** —

### REQ-223 — Businesses cannot choose a timezone

- **Statement:** Businesses SHALL NOT be able to select their own timezone.
- **Source:** KF-SCHED-02 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: No timezone picker exists for a business.
- **Dependencies:** REQ-222

### REQ-224 — 24-hour time format

- **Statement:** Time values SHALL use the 24-hour format.
- **Source:** KF-SCHED-03 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: Times display in HH:MM 24-hour form.
- **Dependencies:** REQ-225

### REQ-225 — Date format YYYY-MM-DD

- **Statement:** Date values SHALL use the YYYY-MM-DD format.
- **Source:** KF-SCHED-04 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: Dates display/export as YYYY-MM-DD.
- **Dependencies:** —

### REQ-226 — Minute precision; seconds not stored

- **Statement:** Stored timestamps SHALL have minute precision; seconds SHALL NOT be stored.
- **Source:** KF-SCHED-05 | **Decision Source:** PENDING DECISION REGISTER MAPPING | **Priority:** MUST | **Class:** DATA-INT
- **Acceptance criteria:**
  - AC1: No stored timestamp retains second-level precision.
- **Dependencies:** REQ-222

---

## 26. Booking State Machine, Payment State Machine, and Slot-Lock State

> **Status:** CONFIRMED STATES AND TRANSITIONS. The previously open state-machine decisions (SM-05 … SM-10, SM-12, SM-13) are **RESOLVED** by the final approved decisions of Prompt 05-FIX and are reflected in the tables below. No product behavior is invented beyond the approved decisions.

### 26.1 Booking State Machine

The booking state set is fixed (REQ-101) and is **modeled separately from payment status** (REQ-100).

| State           | Meaning (per approved facts)                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| Payment Pending | Booking created; prepayment proof submitted and awaiting acceptance (REQ-101).                        |
| Confirmed       | Owner accepted/verified the booking/proof (REQ-061, REQ-101).                                         |
| Completed       | Passed scheduled end time; transitioned automatically from Confirmed (REQ-102). **Terminal (SM-10).** |
| No Show         | Owner manually marked the appointment as missed (REQ-103). **Terminal (SM-10).**                      |
| Cancelled       | Owner manually cancelled the booking (REQ-104).                                                       |
| Rejected        | Owner rejected the booking/proof; reason required (REQ-062, REQ-101).                                 |

**No other user-facing booking states are defined** (KF-BOOK-17).

**Confirmed transitions** — including those resolved by Prompt 05-FIX decisions:

| #   | Trigger                                                          | Previous state           | New state                               | Actor             | Auto/Manual                       | Conditions                                                                                                                                                     | Customer notification                                                                                 | Owner notification                       | Payment state change                                                                      | Slot availability change                                                         |
| --- | ---------------------------------------------------------------- | ------------------------ | --------------------------------------- | ----------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| T1  | Customer completes public booking flow and submits payment proof | (none — booking created) | Payment Pending                         | Customer / System | Automatic (on submission)         | Name and phone (REQ-054); slot available (REQ-052); payment method selected (REQ-116); proof uploaded (REQ-117). Telegram connection is **optional** (REQ-056) | Proof-received / verification-pending via Telegram, if connected (REQ-060)                            | New payment-proof notification (REQ-065) | No proof → proof submitted / Pending (REQ-100)                                            | Slot locked on successful submission; no automatic expiry (REQ-121, OQ-SLOT-001) |
| T2  | Owner accepts/verifies the proof                                 | Payment Pending          | Confirmed                               | Owner             | Manual (REQ-119/120)              | Proof accepted (REQ-067)                                                                                                                                       | Confirmation via Telegram, if connected (REQ-061)                                                     | None (owner acted directly)              | Pending → Accepted (REQ-100)                                                              | Slot stays allocated to the confirmed booking; released only at lifecycle end    |
| T3  | Owner rejects (reason required)                                  | Payment Pending          | Rejected                                | Owner             | Manual (REQ-062, REQ-068)         | Reject action with a reason (KF-TG-08)                                                                                                                         | Rejection with the supplied reason via Telegram, if connected (REQ-062, REQ-124)                      | None (owner acted directly)              | Pending → Rejected (REQ-100)                                                              | Slot remains blocked until owner releases or customer resubmits (REQ-123)        |
| T4  | Scheduled end time reached                                       | Confirmed                | Completed                               | System            | Automatic (REQ-102)               | End time of the appointment passed                                                                                                                             | None specified                                                                                        | None specified                           | Unchanged (Accepted, attached)                                                            | Slot released                                                                    |
| T5  | Owner marks the appointment as missed                            | Confirmed                | No Show                                 | Owner             | Manual (REQ-103)                  | Owner action                                                                                                                                                   | No Show notification via Telegram, if connected (REQ-227). Terminal state — no transition out (SM-10) | None (owner acted directly)              | Unchanged (Accepted, attached)                                                            | Slot released                                                                    |
| T6  | Owner cancels the booking                                        | Confirmed                | Cancelled                               | Owner             | Manual (REQ-104)                  | Owner action                                                                                                                                                   | Cancellation notification via Telegram, if connected (REQ-228)                                        | None (owner acted directly)              | Unchanged (Accepted, attached); refund handling is manual only (REQ-122)                  | Slot released                                                                    |
| T7  | Owner reschedules the booking to a new available slot            | Confirmed                | Confirmed (same booking, new date/time) | Owner             | Manual (REQ-105)                  | New date/time available and fitting (REQ-106, REQ-089)                                                                                                         | Reschedule notification with new date/time via Telegram, if connected (REQ-229)                       | None (owner acted directly)              | Existing payment remains attached (REQ-107); higher difference handled manually (REQ-108) | Old slot released; new slot allocated subject to availability                    |
| T8  | Owner cancels a Payment Pending booking (before verification)    | Payment Pending          | Cancelled                               | Owner             | Manual (REQ-104)                  | Owner action (SM-08)                                                                                                                                           | No customer notification required (SM-08)                                                             | None (owner acted directly)              | Pending (unchanged); proof no longer processed                                            | Slot remains blocked until the owner explicitly releases it (SM-08, REQ-104)     |
| T9  | Owner releases/cancels a rejected booking                        | Rejected                 | Cancelled                               | Owner             | Manual (REQ-104, REQ-123)         | Owner releases the booking for the slot (SM-09 option A)                                                                                                       | None required                                                                                         | None (owner acted directly)              | Rejected (unchanged)                                                                      | Slot released                                                                    |
| T10 | Customer submits new valid proof after rejection                 | Rejected                 | Payment Pending                         | Customer / System | Automatic (on valid resubmission) | New valid proof submitted (SM-09 option B)                                                                                                                     | Proof-received / verification-pending via Telegram, if connected (REQ-060)                            | New payment-proof notification (REQ-065) | Rejected → Pending                                                                        | Slot remains blocked (REQ-123, REQ-230)                                          |

**Terminal states (resolved by SM-10):** **Completed** and **No Show** are permanently terminal — no outgoing transition exists. Cancelled is also terminal (no transition out).

**Unsupported / invalid transitions** (explicitly not valid; none may be assumed):

- **Completed → any state** — permanently terminal (SM-10).
- **No Show → any state** — permanently terminal (SM-10).
- **Cancelled → any state** — not defined; terminal.
- Customer-initiated cancel or modify — explicitly prohibited (REQ-058); not a valid transition.
- Booking created directly in any state other than Payment Pending — not defined.
- Rejected → Confirmed directly (without a valid resubmission) — not defined; the only path out of Rejected is T9 (owner release) or T10 (valid resubmission to Payment Pending).

### 26.2 Payment State Machine

Booking status and payment status are distinct (REQ-100). The payment status model covers only what the approved facts support; **no refund states are modeled, and no automatic refund mechanism exists** (REQ-122).

Confirmed payment-statement concepts:

| Concept                                | Meaning (per approved facts)                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No payment proof submitted             | Booking not yet submitted; slot still available (REQ-052).                                                                                                                |
| Proof submitted (verification pending) | Customer uploaded an image/PDF proof during booking (REQ-117, REQ-118); awaiting owner verification.                                                                      |
| Proof accepted / verified              | Owner verified the proof in the dashboard or via Telegram (REQ-119, REQ-120).                                                                                             |
| Proof rejected                         | Owner rejected the proof; reason may be supplied and the customer receives it (REQ-124); slot stays blocked until owner release or valid resubmission (REQ-123, REQ-230). |
| Payment attached                       | Accepted proof/payment is attached to the confirmed booking and remains attached after rescheduling (REQ-107).                                                            |

Confirmed mapping to the booking state machine:

- **None → Pending:** customer submits proof during booking (T1) — payment enters **Pending** and the booking enters Payment Pending.
- **Pending → Accepted:** owner accepts the proof (T2) — payment status **Accepted**; booking passed to Confirmed.
- **Pending → Rejected:** owner rejects with reason (T3) — payment status **Rejected**; booking becomes Rejected.
- **Rejected → Pending:** customer submits new valid proof (T10) — payment returns to **Pending** (SM-09 option B).
- **Accepted → Attached:** payment is attached to the booking on confirmation and remains attached across rescheduling (REQ-107).

**Payment-status enumeration (resolved by SM-12):** the payment status is exactly **Pending, Accepted, Rejected** (REQ-100). No other value — including **Refund, Partially Refunded, Failed** — exists.

**Manual refund handling (business process, not an automated state):** refunds are handled manually by the owner (REQ-122). No refund state, refund event, or automatic refund transition exists in the payment model.

### 26.3 Slot-Lock State

Slot availability and the slot lock are defined by REQ-121, REQ-123, and the Prompt 05-FIX decisions (OQ-SLOT-001 resolved: **no automatic expiry**; SM-08/SM-09 resolved: who releases).

| Phase                        | Behavior (per approved facts and resolved decisions)                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Before submission            | Slot remains available to other customers after a customer selects a time; availability changes only at successful proof submission (REQ-051, REQ-052).                                                                                    |
| Lock (submission)            | A successful payment-proof submission locks the slot (KF-BOOK-08). The lock has **no automatic expiry** — no timeout, no TTL, no automatic unlock (OQ-SLOT-001 RESOLVED; REQ-121).                                                         |
| Concurrent claim             | Concurrent proof-submission attempts for the same slot are decided atomically: exactly one winner; every losing attempt receives an unavailable result; never two successful bookings for the same slot (REQ-121).                         |
| Rejection                    | A rejected proof keeps the slot blocked until the owner releases/cancels the booking or the customer submits valid new proof (back to Payment Pending) (REQ-123, SM-09, REQ-230).                                                          |
| Payment Pending cancellation | If the owner cancels a Payment Pending booking, the slot stays blocked until the owner explicitly releases it (SM-08, REQ-104).                                                                                                            |
| Lifecycle end                | The slot is released when the confirmed booking completes, is marked No Show, is cancelled (Confirmed), or is rescheduled away (Section 26.1 T4–T7). Rejected/Payment-Pending cancellations require explicit owner release (SM-08, SM-09). |

**Affected requirements:** REQ-051, REQ-052, REQ-053, REQ-089, REQ-104, REQ-105/REQ-106 (rescheduling uses the same slot-availability semantics), REQ-121, REQ-123, REQ-227–REQ-230, and this Section 26.

> **Resolved decision:** OQ-SLOT-001 — the slot lock has **no automatic expiry**. The lock persists until an allowed workflow action releases it. There is no timeout, TTL, or automatic unlock of any kind.

---

## 27. Requirement Classification

Requirements are classified as:

| Class    | Meaning                      |
| -------- | ---------------------------- |
| FUNC     | Functional behavior          |
| SEC      | Security                     |
| DATA-INT | Data integrity / correctness |
| AUDIT    | Auditability / history       |
| UX       | Usability / experience       |
| AVAIL    | Availability / performance   |

**No numerical performance or availability targets exist.** No requirement in this specification is inferred with invented numbers (e.g., uptime %, latency, concurrency). AVAIL is intentionally unused unless a later approved decision establishes targets.

---

## 28. Definition of Done

A requirement is considered **done** when all of the following hold:

1. **Approved basis** — derived from an approved `KF-*` fact (or confirmed requirement) with traceability.
2. **Traceable** — mapped in [requirements-traceability.md](requirements-traceability.md) (REQ → KF → DEC → document → test).
3. **Testable** — objective acceptance criteria exist and can be PASS/FAIL verified.
4. **Consistent** — no unresolved contradiction with any other approved requirement; CONF-001 is resolved and its history preserved (see [consistency-audit.md](consistency-audit.md)).
5. **Implemented** — coded behavior matches the requirement (checked after implementation).
6. **Covered by tests** — automated tests verify the acceptance criteria.

---

## 29. Maintenance and Change Control

### 29.1 Principles

- **Documentation is the source of truth** for implementation.
- Do **not** invent business requirements.
- Do **not** silently make product decisions.
- If a requirement is missing, ambiguous, or contradictory, record it as an **open question** before proceeding.
- **Never overwrite an established decision** without explicitly identifying the conflict.

### 29.2 Procedure for Changing an Approved Decision

1. Identify the conflict explicitly (state the old decision/requirement and the new one).
2. Record the change and its rationale.
3. Update every affected requirement, preserving or updating traceability.
4. Mark superseded requirements as `SUPERSEDED`, referencing their replacement.
5. Re-evaluate dependent requirements for consistency.
6. Update the open-questions log if applicable.

### 29.3 Versioning

- Each documentation file carries a version number and `Last Updated` date in its header.
- A change to a decision increments the impacted document versions.

### 29.4 Decision Precedence and Conflict Handling

> **Rule: "Later approved decisions supersede earlier conflicting decisions only when the chronology/source is clear. Otherwise, the conflict must remain explicitly documented until resolved."**

When a conflict between decisions is found:

1. **Record — never silently discard — the earlier decision.**
2. **Record the later decision.**
3. **State the conflict** explicitly.
4. **Record the proposed precedence** (default: the later approved decision when chronology/source is clear).
5. **Record the final behavior after consistency review** (PENDING until the review completes).

**Known conflict CONF-001 (secondary sort key for identical Booking IDs)** is recorded in [250-approved-decisions.md](250-approved-decisions.md) and reflected in REQ-190. The earlier rule (Actor name A–Z) and the later rule (date/time secondary key) are both preserved. The chronology of the two approved decisions is clear, so the conflict is **RESOLVED — LATER DECISION SUPERSEDES EARLIER RULE**; final behavior is Primary = Booking ID, Secondary = Date/time, Final tie-breaker = Actor A–Z. See [consistency-audit.md](consistency-audit.md).

---

## 30. Domain 22 — Approved Decisions — Prompt 05-FIX (Functional Requirements)

> **Purpose:** Requirements derived from the **final approved decisions** of Prompt 05-FIX (8 state-machine decisions SM-05 … SM-10/SM-12/SM-13 and 6 open-question resolutions OQ-SLOT-001/OQ-PROD-001/OQ-CUST-001/OQ-BOOK-001/OQ-PUB-001/OQ-PAY-001). Where a decision refines an existing requirement, the existing REQ was updated in place (see change log); the requirements below are the **new** behaviors introduced by those decisions. Numbering begins at REQ-227 to preserve the stability of every existing REQ ID.

### REQ-227 — Customer notified on No Show

- **Statement:** When the owner marks a Confirmed booking as No Show, the customer SHALL receive a No Show notification on Telegram **if the customer is connected to Telegram**; a customer without Telegram receives no notification.
- **Source:** KF-BOOK-05, KF-TG-03 | **Decision Source:** RESOLVED — PROMPT 05-FIX SM-05 | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: On owner No Show (T5), a connected customer receives the No Show notification.
  - AC2: A customer without Telegram receives no notification and no other part of the workflow changes.
- **Dependencies:** REQ-103, REQ-056

### REQ-228 — Customer notified on owner cancellation

- **Statement:** When the owner cancels a **Confirmed** booking, the customer SHALL receive a cancellation notification on Telegram **if the customer is connected to Telegram**; a customer without Telegram receives no notification. (Cancelling a Payment Pending booking, SM-08, requires no customer notification.)
- **Source:** KF-BOOK-06, KF-TG-03 | **Decision Source:** RESOLVED — PROMPT 05-FIX SM-06 | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: On owner Cancellation of a Confirmed booking (T6), a connected customer receives the cancellation notification.
  - AC2: A customer without Telegram receives no notification.
- **Dependencies:** REQ-104, REQ-056

### REQ-229 — Customer notified on reschedule with new date/time

- **Statement:** When the owner reschedules a Confirmed booking, the customer SHALL receive a reschedule notification containing the **new date and time** on Telegram **if the customer is connected to Telegram**; the existing payment remains attached (REQ-107).
- **Source:** KF-BOOK-11, KF-BOOK-12, KF-TG-03 | **Decision Source:** RESOLVED — PROMPT 05-FIX SM-07 | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: On reschedule (T7), a connected customer receives the notification with the new date and time.
  - AC2: The previously received payment stays attached to the booking (REQ-107).
  - AC3: A customer without Telegram receives no notification.
- **Dependencies:** REQ-105, REQ-107, REQ-056

### REQ-230 — Rejected booking: customer may resubmit proof (Rejected → Payment Pending)

- **Statement:** After a payment proof is Rejected, the customer SHALL be able to submit **new payment proof**, returning the booking to **Payment Pending** while the slot remains blocked; alternatively, the owner MAY release/cancel the booking and release the slot. Rejection SHALL require a reason (REQ-068). The booking and payment states SHALL remain distinct (REQ-100).
- **Source:** KF-BOOK-10, KF-PAY-12 | **Decision Source:** RESOLVED — PROMPT 05-FIX SM-09 | **Priority:** MUST | **Class:** FUNC
- **Acceptance criteria:**
  - AC1: After rejection, the customer can submit new proof; a valid submission returns the booking to Payment Pending (T10).
  - AC2: During resubmission, the slot remains blocked (REQ-123).
  - AC3: The owner can alternatively release/cancel the rejected booking, releasing the slot (T9).
  - AC4: The payment status transitions Rejected → Pending on valid resubmission; the booking status is tracked separately.
- **Dependencies:** REQ-123, REQ-068, REQ-100

### REQ-231 — Failed automatic resume event recorded in history

- **Statement:** When an automatic resume event occurs, the system SHALL record the resume event and its outcome in history (e.g., in audit history). If the subscription is expired at the scheduled resume time, new bookings SHALL remain disabled, and the recorded event SHALL NOT be interpreted as the business accepting bookings. New bookings SHALL be accepted only when the subscription is active and all other applicable conditions permit booking.
- **Source:** KF-PAUSE-01, KF-PAUSE-02 | **Decision Source:** RESOLVED — PROMPT 05-FIX SM-13 | **Priority:** MUST | **Class:** AUDIT
- **Acceptance criteria:**
  - AC1: At the scheduled resume time, the resume attempt and its outcome are recorded in history.
  - AC2: With an expired subscription, bookings remain closed after the recorded event.
  - AC3: No UI, API, or workflow treats a recorded resume event as evidence that bookings are available.
  - AC4: Bookings become available only when the subscription is active and the other applicable conditions permit booking (REQ-154, REQ-155, REQ-157, REQ-158).
- **Dependencies:** REQ-153, REQ-154, REQ-155, REQ-157, REQ-158, REQ-173

### REQ-232 — Product name "Werefa"

- **Statement:** The product SHALL be branded and identified as **"Werefa"** in all user-facing contexts. No other name is used as the product name in this phase.
- **Source:** (approved decision OQ-PROD-001) | **Decision Source:** RESOLVED — PROMPT 05-FIX OQ-PROD-001 | **Priority:** MUST | **Class:** UX
- **Acceptance criteria:**
  - AC1: All user-facing surfaces (public booking page, dashboard, notifications, emails) display "Werefa" as the product name.
  - AC2: No other product name is presented to users.
- **Dependencies:** —

> **Change log entry (Prompt 05-FIX):** Added Domain 22 (Section 30) with REQ-227 … REQ-232. Existing requirements updated in place: REQ-056, REQ-060–REQ-064, REQ-100–REQ-104, REQ-109, REQ-112–REQ-115, REQ-121, REQ-123, REQ-154, REQ-215. REQ-115 was superseded (no custom payment methods this phase). Total requirements: 226 → 232. No existing REQ ID renumbered or deleted. All 14 decisions applied per `PROMPT 05-FIX`.
