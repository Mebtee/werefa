# 02 — Open Questions

> **Status:** ALL PRODUCT QUESTIONS RESOLVED (PROMPT 05-FIX DECISIONS APPLIED)
> **Version:** 0.5.0
> **Last Updated:** 2026-09-05
>
> **PURPOSE:** Track every requirement that is **missing, ambiguous, or contradictory**. Open questions are **explicitly recorded here** rather than silently resolved. When resolved, a question is moved to the **Resolved** list with its identifier preserved.
>
> **Change note (Prompt 03):** Master specification derived (REQ-001 … REQ-226). Open questions are now expressed in terms of concrete requirements.
>
> **Change note (Prompt 04):** After the full consistency audit, **CONF-001 was RESOLVED** (not an open question) and **OQ-SLOT-001 was confirmed as a genuine pending product decision** (the temporary slot-lock duration). The remaining five open questions were unresolvable from the approved facts and stayed open.
>
> **Change note (Prompt 05-FIX):** The **final approved decisions of Prompt 05-FIX** resolved **all six remaining open questions** (OQ-PROD-001, OQ-CUST-001, OQ-BOOK-001, OQ-PUB-001, OQ-PAY-001, OQ-SLOT-001) and **all eight state-machine decisions** (SM-05 … SM-10, SM-12, SM-13). All questions below are moved to **Resolved** with their approved resolutions. **There are no open product questions.**

---

## How to Use This Log

- Each open question has a stable identifier: `OQ-<DOMAIN>-NNN`.
- When a question is resolved, it is moved from the **Open** list to the **Resolved** list, preserving its identifier and recording the resolution and source decision (if any).
- If a decision supplied later resolves an open question, the question is closed and cross-referenced to the decision number.
- Removal without resolution is **not** allowed; questions may only be closed via the change-control procedure in `01-master-specification.md` §29.
- Where an item was previously logged as an open question but is actually a **documentation/import task**, it is reclassified (not silently dropped) and a pointer to the import tracking is recorded.

---

## Open Questions

**None.** All open questions were resolved by the final approved decisions of Prompt 05-FIX. See the **Resolved Questions** section below.

---

## Resolved Questions (closed by Prompt 05-FIX final approved decisions)

### OQ-SLOT-001 — Temporary slot-lock duration before owner decision — RESOLVED

- **Status:** RESOLVED — 2026-09-05 (Prompt 05-FIX approved decision)
- **Resolution:** The slot lock has **no automatic expiry**. A locked slot remains blocked until an **allowed workflow action** releases it (owner acceptance → allocated to the confirmed booking; owner release/cancel; or valid resubmission returning the booking to Payment Pending). **No timeout, TTL, or automatic unlock exists.**
- **Source:** PROMPT 05-FIX — approved decision **OQ-SLOT-001**.
- **Consequences:** REQ-121 (AC5 — no expiry), REQ-123, §26.3 Slot-Lock State updated. The lock's existence (KF-BOOK-08) is unchanged; only the expiry behavior is now defined. Priority: MUST. Class: DATA-INT.

### OQ-PROD-001 — Product name and positioning — RESOLVED

- **Status:** RESOLVED — 2026-09-05 (Prompt 05-FIX approved decision)
- **Resolution:** Product name is **"Werefa"** for all user-facing contexts.
- **Source:** PROMPT 05-FIX — approved decision **OQ-PROD-001**.
- **Consequences:** Expressed as new requirement **REQ-232** (Section 30, Domain 22). The working title "Scheduler" is superseded; `00-project-overview.md` and `README.md` updated.

### OQ-CUST-001 — Behavior when a customer cannot or will not connect Telegram during booking — RESOLVED

- **Status:** RESOLVED — 2026-09-05 (Prompt 05-FIX approved decision)
- **Resolution:** Telegram is **optional**. A booking can complete without Telegram; if the customer is not connected, no Telegram notification is sent to that customer and nothing else changes.
- **Source:** PROMPT 05-FIX — approved decision **OQ-CUST-001**.
- **Consequences:** REQ-056 rewritten (Telegram optional); REQ-060 … REQ-064 in force "if the customer is connected to Telegram"; booking-flow steps and notification requirements updated.

### OQ-BOOK-001 — How a booking is identified to the customer without a reference/code — RESOLVED

- **Status:** RESOLVED — 2026-09-05 (Prompt 05-FIX approved decision)
- **Resolution:** The customer identifies their booking by **phone number**. No customer-facing booking reference/code is issued. The internal **Booking ID** is retained for administration, reporting, audit, sorting, and internal traceability.
- **Source:** PROMPT 05-FIX — approved decision **OQ-BOOK-001**.
- **Consequences:** REQ-109 rewritten to phone-number identification with internal Booking ID retained.

### OQ-PUB-001 — Exact list of predefined business-type categories — RESOLVED

- **Status:** RESOLVED — 2026-09-05 (Prompt 05-FIX approved decision)
- **Resolution:** Initial business-type categories are exactly **"Salon & Barber"** and **"Other"**.
- **Source:** PROMPT 05-FIX — approved decision **OQ-PUB-001**.
- **Consequences:** REQ-215 updated to the exact two-category set.

### OQ-PAY-001 — Exact approved set of payment methods / providers — RESOLVED

- **Status:** RESOLVED — 2026-09-05 (Prompt 05-FIX approved decision)
- **Resolution:** Initial customer payment methods are exactly **Bank Transfer** and **Telebirr / mobile money**. No custom payment methods in this phase.
- **Source:** PROMPT 05-FIX — approved decision **OQ-PAY-001**.
- **Consequences:** REQ-112, REQ-113, REQ-114 updated; REQ-115 (custom methods) superseded for this phase.

---

## Resolved Questions (closed by approved facts or reclassification)

### OQ-PROD-002 — Complete set of user roles — RESOLVED

- **Status:** RESOLVED — 2026-09-05
- **Resolution (approved role model):**
  - Roles: **Super Admin, Admin, Business Owner, Customer, System** (KF-ROLE-01).
  - **Customers do not have platform accounts** (KF-CUST-01 / KF-ROLE-05).
  - Exactly **1 Super Admin** (KF-ROLE-02 / KF-SUB-18).
  - Exactly **2 Admin accounts** (KF-ROLE-03).
  - Only the **Super Admin** can create/deactivate/manage Admin accounts (KF-ROLE-04).
- **Source:** Approved decision content — [250-approved-decisions.md — Appendix A.3](250-approved-decisions.md#a3-roles-kf-role).
- **Consequences:** Requirement set REQ-036 … REQ-044 derived; OQ-PROD-002 closed.

### OQ-DOM-001 — Are Conflict Handling and Exceptions separate domains or one? — RESOLVED

- **Status:** RESOLVED — 2026-09-05
- **Resolution:** Schedule conflicts and exceptions are **part of the scheduling/booking architecture**; organizational grouping in separate documents is allowed but no functional split is implied.
- **Consequence:** Expressed as Scheduling (§13), Pause/Resume (§18), and Schedule Exceptions (§19) sections; REQ-150 … REQ-161 trace the behavior.

### OQ-DEC-001 — When will the 250-decision list be supplied? — RECLASSIFIED (not a product-design question)

- **Status:** CLOSED — 2026-09-05 (reclassified)
- **Resolution:** Absence of requested DEC wording is a **documentation-import task**, NOT a product-design open question; tracked by [decision-import-checklist.md](decision-import-checklist.md), [decision-traceability.md](decision-traceability.md), and [250-approved-decisions.md](250-approved-decisions.md).
- **Consequence:** No longer tracked as an open product question.

---

## Cross-Reference: Open Items That Are NOT Open Questions

| Item                                                                                              | Type                                                                         | Where tracked                                            |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| Exact DEC-001 … DEC-250 wording                                                                   | Import task                                                                  | decision-import-checklist.md                             |
| Per-requirement DEC mapping                                                                       | Import task                                                                  | requirements-traceability.md, decision-traceability.md   |
| CONF-001 identical-Booking-ID sort                                                                | **RESOLVED** during Prompt 04 audit (later decision supersedes earlier rule) | consistency-audit.md, 250-approved-decisions.md, REQ-190 |
| Booking/payment state transitions beyond the confirmed set (8 items: SM-05 … SM-10, SM-12, SM-13) | **RESOLVED** — Prompt 05-FIX final approved decisions                        | 01-master-specification.md §26, consistency-audit.md §7  |

---

## Related Documents

- [00-project-overview.md](00-project-overview.md)
- [01-master-specification.md](01-master-specification.md)
- [02-user-roles-permissions.md](02-user-roles-permissions.md)
- [03-documentation-index.md](03-documentation-index.md)
- [250-approved-decisions.md](250-approved-decisions.md)
- [requirements-traceability.md](requirements-traceability.md)
- [decision-traceability.md](decision-traceability.md)
- [decision-import-checklist.md](decision-import-checklist.md)
- [consistency-audit.md](consistency-audit.md)
