# Requirements Quality Check

> **Status:** APPLIED TO ALL 232 REQUIREMENTS (REQ-001 … REQ-232) + PROMPT 04 RE-CHECK + PROMPT 05-FIX DECISIONS
> **Version:** 0.5.0
> **Last Updated:** 2026-09-05
>
> **PURPOSE:** Records the per-requirement quality checklist that was applied when the master specification was derived, and the summary results. Every row in `requirements-traceability.md` corresponds to one requirement in `01-master-specification.md` that has been checked against this checklist.
>
> **Change note (Prompt 04):** Quality re-check performed as part of the full consistency audit. Fixed: REQ-036 title typo; REQ-121 strengthened (slot integrity; `MAY win` → `SHALL win`; temporary lock existence without invented duration); REQ-160 extended (schedule-exception semantics); REQ-190 finalized (CONF-001 resolved). Section 26 split into Booking/Payment/Slot state machines. No requirements renumbered or deleted.
>
> **Change note (Prompt 05-FIX):** 14 final approved decisions applied. Six new requirements (REQ-227 … REQ-232, Domain 22 / Section 30) pass the full checklist (checks 1–12). In-place updates to REQ-056/060–064/100–104/109/112–115/121/123/154/215 re-verified as PASS. All 8 state-machine decision items are now RESOLVED; **0 open product decisions remain**.
>
> **RELATED FILES:**
>
> - [01-master-specification.md](01-master-specification.md) — the requirements being checked
> - [requirements-traceability.md](requirements-traceability.md) — the traceability matrix
> - [250-approved-decisions.md](250-approved-decisions.md) — source of `KF-*` facts and the Prompt 05-FIX decisions (Appendix C)
> - [consistency-audit.md](consistency-audit.md) — full consistency audit (Prompt 04, updated by Prompt 05-FIX)

---

## Checklist (applied per requirement)

Each requirement MUST satisfy every item before it is accepted as `TRACED`/`APPROVED`:

| #   | Check                        | Rule                                                                                                                                      |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Unique identifier            | ID is `REQ-NNN`, unique, sequential in document order, no reassignment.                                                                   |
| 2   | Clear statement              | One precise, testable behavior per requirement; no vague terms ("fast", "nice", "etc.").                                                  |
| 3   | Source fact                  | At least one `KF-*` fact is cited in `Source`; the cited content supports the statement exactly.                                          |
| 4   | No unsupported assumptions   | Nothing invented beyond the cited facts; `MAY`/`SHOULD` only where a fact qualifies it.                                                   |
| 5   | Testable acceptance criteria | Each AC is objective and pass/fail, verifiable without implementation detail.                                                             |
| 6   | Correct domain               | Placed in the domain whose section matches its subject; section and domain key agree with `requirements-traceability.md`.                 |
| 7   | Dependencies identified      | Cross-references to other REQ-* that must hold are listed (or `—`).                                                                       |
| 8   | Tenant implications          | Where business data is involved, tenant isolation semantics are stated or implied by the statement.                                       |
| 9   | Security implications        | Authentication/authorization consequences are explicit (which role may act).                                                              |
| 10  | Audit implications           | State changes or data modifications note whether history/audit is produced.                                                               |
| 11  | State/status implications    | Where the booking or payment state model is touched, the requirement is consistent with §26 of the master specification.                  |
| 12  | No invented technology       | No database, API, framework, or vendor is introduced by the requirement (brand names in facts, e.g., "Telebirr", are preserved as facts). |

## Consistency Constraints (checked once per spec)

| #   | Constraint                                                                                                                     | Result                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| C1  | Every REQ-001 … REQ-232 appears in the matrix exactly once                                                                     | PASS                                                                               |
| C2  | No REQ number outside REQ-001 … REQ-232 exists in the spec                                                                     | PASS                                                                               |
| C3  | Every `KF-*` fact cited in the spec exists in `250-approved-decisions.md` Appendix A                                           | PASS (verified by identifier scan)                                                 |
| C4  | No `KF-*` fact is cited with invented content not in the register                                                              | PASS                                                                               |
| C5  | Priority defaults to MUST and only uses MAY/SHOULD where facts qualify                                                         | PASS                                                                               |
| C6  | Class assignments stay within {FUNC, SEC, DATA-INT, AUDIT, UX, AVAIL}; AVAIL unused (no targets defined)                       | PASS                                                                               |
| C7  | Every requirement cites a source fact (no requirement is interpretation-only)                                                  | PASS (231/232 cite a `KF-*` fact; REQ-232 cites the approved decision OQ-PROD-001) |
| C8  | Every Prompt 05-FIX decision is expressed as a testable requirement or an in-place update with traceability to the decision ID | PASS (14/14 decisions)                                                             |

## Open Items Surfaced by Quality Check

| Item                                   | Reason                                                                                                                                                                                                                                                                                                                                                        | Referenced in                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| CONF-001 — identical Booking IDs       | Two approved facts disagree on secondary sort key (Actor A–Z vs date/time). **RESOLVED** during the consistency audit — later decision supersedes earlier rule (Primary Booking ID; Secondary date/time; Final tie-breaker Actor A–Z). Historical rule preserved.                                                                                             | REQ-190, [consistency-audit.md](consistency-audit.md)                                   |
| Booking/Payment state machine          | Section 26 defines the Booking State Machine, Payment State Machine, and Slot-Lock State. All previously `STATE-MACHINE DECISION REQUIRED` items (8: SM-05 … SM-10, SM-12, SM-13) were **RESOLVED** by the Prompt 05-FIX final approved decisions and are reflected in §26 (T5–T10, terminal states, payment-status set, slot-lock). **0 items remain open.** | §26 and related lifecycle/payment REQs; [consistency-audit.md](consistency-audit.md) §7 |
| Statements qualified as "may" in facts | REQ-022 (auto-open last business) and REQ-095 (five-minute grouping window) use `MAY`; REQ-032 (auto-authenticate after verification) uses `MAY`. Confirm during DEC import whether these are optional or mandatory.                                                                                                                                          | REQ-022, REQ-032, REQ-095                                                               |

## Conformance Record

| Requirement       | Checks 1–12 | Notes                                                                                                                                    |
| ----------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-001 … REQ-006 | PASS        | Platform/SaaS section 5                                                                                                                  |
| REQ-007 … REQ-023 | PASS        | Tenant/Business section 6                                                                                                                |
| REQ-024 … REQ-035 | PASS        | Authentication section 7                                                                                                                 |
| REQ-036 … REQ-044 | PASS        | Roles section 8                                                                                                                          |
| REQ-045 … REQ-053 | PASS        | Public Booking section 9                                                                                                                 |
| REQ-054 … REQ-059 | PASS        | Customers section 10                                                                                                                     |
| REQ-060 … REQ-069 | PASS        | Telegram section 11                                                                                                                      |
| REQ-070 … REQ-081 | PASS        | Services/Pricing section 12                                                                                                              |
| REQ-082 … REQ-099 | PASS        | Scheduling section 13                                                                                                                    |
| REQ-100 … REQ-109 | PASS        | Booking Lifecycle section 14                                                                                                             |
| REQ-110 … REQ-124 | PASS        | Payments section 15                                                                                                                      |
| REQ-125 … REQ-141 | PASS        | Subscription section 16                                                                                                                  |
| REQ-142           | PASS        | Notifications section 17                                                                                                                 |
| REQ-143 … REQ-158 | PASS        | Pause/Resume section 18                                                                                                                  |
| REQ-159 … REQ-161 | PASS        | Schedule Exceptions section 19                                                                                                           |
| REQ-162 … REQ-174 | PASS        | Audit/History section 20                                                                                                                 |
| REQ-175 … REQ-190 | PASS        | Reports/Exports section 21 (REQ-190 finalized; CONF-001 resolved)                                                                        |
| REQ-191 … REQ-206 | PASS        | Security section 22                                                                                                                      |
| REQ-207 … REQ-216 | PASS        | Public Business Page section 23                                                                                                          |
| REQ-217 … REQ-221 | PASS        | Administration section 24                                                                                                                |
| REQ-222 … REQ-226 | PASS        | Date/Time section 25                                                                                                                     |
| REQ-227 … REQ-232 | PASS        | Domain 22 — Approved Decisions (Prompt 05-FIX), section 30 (added in Prompt 05-FIX; checks 1–12 apply with decision-source=traceability) |

## Re-Run Procedure

- Re-run the checklist and consistency constraints whenever section numbering, REQ numbering, or register facts change.
- The summary counts must agree with `requirements-traceability.md` Summary and `01-master-specification.md` §3.1.
- Any requirement that starts failing a check is a defect: fix the offending file and re-verify, do not silently mark it PASS.
