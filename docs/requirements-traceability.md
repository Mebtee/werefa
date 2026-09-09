# Requirements Traceability Matrix

> **Status:** TRACED (KF FACTS + PROMPT 05-FIX DECISIONS → REQ-*) — DEC SOURCE MAPPING PENDING
> **Version:** 0.5.0
> **Last Updated:** 2026-09-05
>
> **PURPOSE:** Maps every requirement (REQ-001 … REQ-232) to its approved product facts (`KF-*`) from the canonical register (`250-approved-decisions.md`) and, where applicable, to the final approved decisions of Prompt 05-FIX.
>
> **Change note (Prompt 04):** Continuity preserved after the consistency audit — REQ numbering and source facts are unchanged. CONF-001 (affecting REQ-190) is **RESOLVED** (later decision supersedes earlier rule). See [consistency-audit.md](consistency-audit.md).
>
> **Change note (Prompt 05-FIX):** The 14 final approved decisions (SM-05 … SM-10/SM-12/SM-13; OQ-SLOT-001/OQ-PROD-001/OQ-CUST-001/OQ-BOOK-001/OQ-PUB-001/OQ-PAY-001) were applied. Six new requirements (REQ-227 … REQ-232, Domain 22, Section 30) were added, and the Decision Source of 22 requirements is now `RESOLVED — PROMPT 05-FIX <ID>`. No REQ ID was renumbered or deleted.
>
> **Change note (Prompts 07–09):** This matrix remains the DEC-level requirement index; `TEST-PENDING` reflects the design-stage acceptance reference (rows are unchanged). Serialized IMPLEMENTATION traceability — code paths, endpoint tables, per-requirement code→test mapping, verified test counts — lives in `docs/implementation/` (`01-foundation-traceability.md`, `02-identity-traceability.md`, `03-business-tenant-management.md`). See `docs/implementation/README.md`.
>
> **RELATED FILES:**
>
> - [01-master-specification.md](01-master-specification.md) — authoritative requirement statements (REQ-001 … REQ-232)
> - [250-approved-decisions.md](250-approved-decisions.md) — canonical register (`KF-*` facts, DEC slots, CONF-001, Appendix C Prompt 05-FIX decisions)
> - [decision-traceability.md](decision-traceability.md) — high-level chain overview and reverse mapping
> - [requirements-quality-check.md](requirements-quality-check.md) — per-requirement quality checklist
> - [consistency-audit.md](consistency-audit.md) — conflict resolution and audit record

---

## Summary

| Metric                                               | Count                                                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Requirements (REQ-001 … REQ-232)                     | 232                                                                                                                                  |
| Distinct KF facts referenced as sources              | 242                                                                                                                                  |
| Requirements with source fact(s)                     | 232 (100%)                                                                                                                           |
| Requirements needing interpretation (no source fact) | 0                                                                                                                                    |
| Decision Source: `PENDING DECISION REGISTER MAPPING` | 208                                                                                                                                  |
| Decision Source: `RESOLVED — PROMPT 05-FIX`          | 22 (REQ-056, REQ-060–064, REQ-100, REQ-103, REQ-104, REQ-109, REQ-112, REQ-115, REQ-121, REQ-123, REQ-154, REQ-215, REQ-227–REQ-232) |
| Decision Source: `DEC-175` (formal mapping pending)  | 2 (REQ-159, REQ-160)                                                                                                                 |
| Test references                                      | 232 × `TEST-PENDING`                                                                                                                 |
| Open conflicts affecting requirements                | 0 (CONF-001 → REQ-190: **RESOLVED** — later decision supersedes earlier rule; see [consistency-audit.md](consistency-audit.md))      |

## Rules

- One row per requirement, one requirement per row.
- `Source Fact` matches Appendix A identifiers in `250-approved-decisions.md`.
- `Decision Source` reflects the effective chain `[PENDING DEC] → KF-* → REQ-* → SPEC → TEST`. Where the register will provide exact DEC wording, the value is `PENDING DECISION REGISTER MAPPING`; it is **not** a statement that a decision is missing.
- `Test/Acceptance Reference` uses `TEST-PENDING` placeholders; the acceptance criteria live in `01-master-specification.md` (§5–§30).
- `Status` is `TRACED` when a source fact is recorded. This is a requirement-level status; the DEC-level import progress is tracked in `decision-import-checklist.md`.

---

## DOMAIN 1 — PLATFORM / SAAS (Specification §5)

| Requirement                                                           | Source Fact | Decision Source                   | Domain   | Specification Section | Test/Acceptance Reference | Status |
| --------------------------------------------------------------------- | ----------- | --------------------------------- | -------- | --------------------- | ------------------------- | ------ |
| REQ-001 — Multi-tenant SaaS platform                                  | KF-BIZ-01   | PENDING DECISION REGISTER MAPPING | PLATFORM | §5                    | TEST-PENDING              | TRACED |
| REQ-002 — Business as separate tenant                                 | KF-BIZ-02   | PENDING DECISION REGISTER MAPPING | PLATFORM | §5                    | TEST-PENDING              | TRACED |
| REQ-003 — Any business type may register                              | KF-BIZ-03   | PENDING DECISION REGISTER MAPPING | PLATFORM | §5                    | TEST-PENDING              | TRACED |
| REQ-004 — Generic architecture not restricted to initial target types | KF-BIZ-04   | PENDING DECISION REGISTER MAPPING | PLATFORM | §5                    | TEST-PENDING              | TRACED |
| REQ-005 — Self-service Business Owner registration                    | KF-BIZ-05   | PENDING DECISION REGISTER MAPPING | PLATFORM | §5                    | TEST-PENDING              | TRACED |
| REQ-006 — 30-day free trial per new business                          | KF-BIZ-06   | PENDING DECISION REGISTER MAPPING | PLATFORM | §5                    | TEST-PENDING              | TRACED |

## DOMAIN 2 — TENANT / BUSINESS (Specification §6)

| Requirement                                                      | Source Fact            | Decision Source                   | Domain | Specification Section | Test/Acceptance Reference | Status |
| ---------------------------------------------------------------- | ---------------------- | --------------------------------- | ------ | --------------------- | ------------------------- | ------ |
| REQ-007 — One public booking URL per business                    | KF-BIZ-07, KF-PUB-01   | PENDING DECISION REGISTER MAPPING | TENANT | §6                    | TEST-PENDING              | TRACED |
| REQ-008 — One QR code per business                               | KF-BIZ-08, KF-PUB-07   | PENDING DECISION REGISTER MAPPING | TENANT | §6                    | TEST-PENDING              | TRACED |
| REQ-009 — One shared queue/schedule per business                 | KF-BIZ-09              | PENDING DECISION REGISTER MAPPING | TENANT | §6                    | TEST-PENDING              | TRACED |
| REQ-010 — No individual staff/barber booking links               | KF-BIZ-10              | PENDING DECISION REGISTER MAPPING | TENANT | §6                    | TEST-PENDING              | TRACED |
| REQ-011 — Owners configure their own business                    | KF-BIZ-11              | PENDING DECISION REGISTER MAPPING | TENANT | §6                    | TEST-PENDING              | TRACED |
| REQ-012 — One business has one owner relationship                | KF-ACCT-01             | PENDING DECISION REGISTER MAPPING | TENANT | §6                    | TEST-PENDING              | TRACED |
| REQ-013 — One owner may manage multiple businesses               | KF-ACCT-02             | PENDING DECISION REGISTER MAPPING | TENANT | §6                    | TEST-PENDING              | TRACED |
| REQ-014 — Per-business dashboard context                         | KF-ACCT-03             | PENDING DECISION REGISTER MAPPING | TENANT | §6                    | TEST-PENDING              | TRACED |
| REQ-015 — Independent subscription per business                  | KF-ACCT-04, KF-BIZ-12  | PENDING DECISION REGISTER MAPPING | TENANT | §6                    | TEST-PENDING              | TRACED |
| REQ-016 — Post-login selection when multiple businesses          | KF-ACCT-05, KF-ACCT-07 | PENDING DECISION REGISTER MAPPING | TENANT | §6                    | TEST-PENDING              | TRACED |
| REQ-017 — Direct open when exactly one business                  | KF-ACCT-06             | PENDING DECISION REGISTER MAPPING | TENANT | §6                    | TEST-PENDING              | TRACED |
| REQ-018 — Show Create Business when no business exists           | KF-ACCT-08             | PENDING DECISION REGISTER MAPPING | TENANT | §6                    | TEST-PENDING              | TRACED |
| REQ-019 — Business switcher from main dashboard                  | KF-ACCT-09             | PENDING DECISION REGISTER MAPPING | TENANT | §6                    | TEST-PENDING              | TRACED |
| REQ-020 — Active business identity visible                       | KF-ACCT-10             | PENDING DECISION REGISTER MAPPING | TENANT | §6                    | TEST-PENDING              | TRACED |
| REQ-021 — Last selected business remembered                      | KF-ACCT-11             | PENDING DECISION REGISTER MAPPING | TENANT | §6                    | TEST-PENDING              | TRACED |
| REQ-022 — Automatic open of last selected business on next login | KF-ACCT-12             | PENDING DECISION REGISTER MAPPING | TENANT | §6                    | TEST-PENDING              | TRACED |
| REQ-023 — Deactivated/expired businesses openable by owner       | KF-ACCT-13             | PENDING DECISION REGISTER MAPPING | TENANT | §6                    | TEST-PENDING              | TRACED |

## DOMAIN 3 — AUTHENTICATION (Specification §7)

| Requirement                                                     | Source Fact           | Decision Source                   | Domain | Specification Section | Test/Acceptance Reference | Status |
| --------------------------------------------------------------- | --------------------- | --------------------------------- | ------ | --------------------- | ------------------------- | ------ |
| REQ-024 — Phase 1 email/password login                          | KF-AUTH-01            | PENDING DECISION REGISTER MAPPING | AUTH   | §7                    | TEST-PENDING              | TRACED |
| REQ-025 — Google login not part of Phase 1                      | KF-AUTH-02            | PENDING DECISION REGISTER MAPPING | AUTH   | §7                    | TEST-PENDING              | TRACED |
| REQ-026 — Owner email verification required                     | KF-AUTH-03            | PENDING DECISION REGISTER MAPPING | AUTH   | §7                    | TEST-PENDING              | TRACED |
| REQ-027 — Unverified users blocked from normal dashboard access | KF-AUTH-09            | PENDING DECISION REGISTER MAPPING | AUTH   | §7                    | TEST-PENDING              | TRACED |
| REQ-028 — Verification links time-limited                       | KF-AUTH-10            | PENDING DECISION REGISTER MAPPING | AUTH   | §7                    | TEST-PENDING              | TRACED |
| REQ-029 — Expired verification link replacement                 | KF-AUTH-11            | PENDING DECISION REGISTER MAPPING | AUTH   | §7                    | TEST-PENDING              | TRACED |
| REQ-030 — Verification request rate limiting                    | KF-AUTH-12            | PENDING DECISION REGISTER MAPPING | AUTH   | §7                    | TEST-PENDING              | TRACED |
| REQ-031 — New verification link invalidates previous links      | KF-AUTH-13            | PENDING DECISION REGISTER MAPPING | AUTH   | §7                    | TEST-PENDING              | TRACED |
| REQ-032 — Successful verification may auto-authenticate         | KF-AUTH-14            | PENDING DECISION REGISTER MAPPING | AUTH   | §7                    | TEST-PENDING              | TRACED |
| REQ-033 — Forgot-password via email reset                       | KF-AUTH-04            | PENDING DECISION REGISTER MAPPING | AUTH   | §7                    | TEST-PENDING              | TRACED |
| REQ-034 — 2FA-ready Phase 1 architecture                        | KF-AUTH-05            | PENDING DECISION REGISTER MAPPING | AUTH   | §7                    | TEST-PENDING              | TRACED |
| REQ-035 — Password change logs the user out everywhere          | KF-AUTH-06, KF-SEC-08 | PENDING DECISION REGISTER MAPPING | AUTH   | §7                    | TEST-PENDING              | TRACED |

## DOMAIN 4 — USERS / ROLES / PERMISSIONS (Specification §8)

| Requirement                                           | Source Fact             | Decision Source                   | Domain | Specification Section | Test/Acceptance Reference | Status |
| ----------------------------------------------------- | ----------------------- | --------------------------------- | ------ | --------------------- | ------------------------- | ------ |
| REQ-036 — Confirmed role set                          | KF-ROLE-01              | PENDING DECISION REGISTER MAPPING | ROLES  | §8                    | TEST-PENDING              | TRACED |
| REQ-037 — Exactly one Super Admin                     | KF-ROLE-02, KF-SUB-18   | PENDING DECISION REGISTER MAPPING | ROLES  | §8                    | TEST-PENDING              | TRACED |
| REQ-038 — Exactly two Admin accounts                  | KF-ROLE-03              | PENDING DECISION REGISTER MAPPING | ROLES  | §8                    | TEST-PENDING              | TRACED |
| REQ-039 — Only Super Admin manages Admin accounts     | KF-ROLE-04              | PENDING DECISION REGISTER MAPPING | ROLES  | §8                    | TEST-PENDING              | TRACED |
| REQ-040 — Customers have no platform account          | KF-CUST-01, KF-ROLE-05  | PENDING DECISION REGISTER MAPPING | ROLES  | §8                    | TEST-PENDING              | TRACED |
| REQ-041 — Super Admin platform-wide access            | KF-ROLE-06              | PENDING DECISION REGISTER MAPPING | ROLES  | §8                    | TEST-PENDING              | TRACED |
| REQ-042 — Admin restricted administrative access      | KF-ROLE-07              | PENDING DECISION REGISTER MAPPING | ROLES  | §8                    | TEST-PENDING              | TRACED |
| REQ-043 — Owner operates only within owned businesses | KF-ROLE-08              | PENDING DECISION REGISTER MAPPING | ROLES  | §8                    | TEST-PENDING              | TRACED |
| REQ-044 — System actor for automatic changes          | KF-ROLE-09, KF-SCHED-18 | PENDING DECISION REGISTER MAPPING | ROLES  | §8                    | TEST-PENDING              | TRACED |

## DOMAIN 5 — PUBLIC BOOKING (Specification §9)

| Requirement                                                                  | Source Fact           | Decision Source                   | Domain   | Specification Section | Test/Acceptance Reference | Status |
| ---------------------------------------------------------------------------- | --------------------- | --------------------------------- | -------- | --------------------- | ------------------------- | ------ |
| REQ-045 — Public booking page is the booking entry point                     | KF-CUST-05, KF-PUB-01 | PENDING DECISION REGISTER MAPPING | PUB-BOOK | §9                    | TEST-PENDING              | TRACED |
| REQ-046 — QR points to public URL                                            | KF-PUB-07             | PENDING DECISION REGISTER MAPPING | PUB-BOOK | §9                    | TEST-PENDING              | TRACED |
| REQ-047 — Public URL slug unique                                             | KF-PUB-05             | PENDING DECISION REGISTER MAPPING | PUB-BOOK | §9                    | TEST-PENDING              | TRACED |
| REQ-048 — Invalid/reserved slugs rejected                                    | KF-PUB-06             | PENDING DECISION REGISTER MAPPING | PUB-BOOK | §9                    | TEST-PENDING              | TRACED |
| REQ-049 — Slug change updates QR target                                      | KF-PUB-08             | PENDING DECISION REGISTER MAPPING | PUB-BOOK | §9                    | TEST-PENDING              | TRACED |
| REQ-050 — Available times computed from schedule, duration, bookings, blocks | KF-PUB-21             | PENDING DECISION REGISTER MAPPING | PUB-BOOK | §9                    | TEST-PENDING              | TRACED |
| REQ-051 — Selecting a time does not lock it                                  | KF-PUB-22             | PENDING DECISION REGISTER MAPPING | PUB-BOOK | §9                    | TEST-PENDING              | TRACED |
| REQ-052 — Slot remains available until payment proof submitted               | KF-PUB-23             | PENDING DECISION REGISTER MAPPING | PUB-BOOK | §9                    | TEST-PENDING              | TRACED |
| REQ-053 — Second customer receives unavailable result for claimed slot       | KF-PUB-24             | PENDING DECISION REGISTER MAPPING | PUB-BOOK | §9                    | TEST-PENDING              | TRACED |

## DOMAIN 6 — CUSTOMERS (Specification §10)

| Requirement                                                                  | Source Fact                        | Decision Source                      | Domain   | Specification Section | Test/Acceptance Reference | Status |
| ---------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------ | -------- | --------------------- | ------------------------- | ------ |
| REQ-054 — Customer provides name and phone                                   | KF-CUST-02                         | PENDING DECISION REGISTER MAPPING    | CUSTOMER | §10                   | TEST-PENDING              | TRACED |
| REQ-055 — Booking note optional                                              | KF-CUST-03                         | PENDING DECISION REGISTER MAPPING    | CUSTOMER | §10                   | TEST-PENDING              | TRACED |
| REQ-056 — Customer may connect Telegram during booking; Telegram is optional | KF-CUST-04, KF-TG-01               | RESOLVED — PROMPT 05-FIX OQ-CUST-001 | CUSTOMER | §10                   | TEST-PENDING              | TRACED |
| REQ-057 — Customer booking history not exposed on public page                | KF-CUST-10                         | PENDING DECISION REGISTER MAPPING    | CUSTOMER | §10                   | TEST-PENDING              | TRACED |
| REQ-058 — Customer cannot cancel or modify booked appointments               | KF-CUST-08                         | PENDING DECISION REGISTER MAPPING    | CUSTOMER | §10                   | TEST-PENDING              | TRACED |
| REQ-059 — No booking creation via Telegram; bookings only from public flow   | KF-CUST-06, KF-CUST-07, KF-CUST-05 | PENDING DECISION REGISTER MAPPING    | CUSTOMER | §10                   | TEST-PENDING              | TRACED |

## DOMAIN 7 — TELEGRAM (Specification §11)

| Requirement                                                                    | Source Fact        | Decision Source                      | Domain | Specification Section | Test/Acceptance Reference | Status |
| ------------------------------------------------------------------------------ | ------------------ | ------------------------------------ | ------ | --------------------- | ------------------------- | ------ |
| REQ-060 — Customer receives proof-received / verification-pending notification | KF-TG-02           | RESOLVED — PROMPT 05-FIX OQ-CUST-001 | TG     | §11                   | TEST-PENDING              | TRACED |
| REQ-061 — Customer receives accepted/confirmed notification                    | KF-TG-03           | RESOLVED — PROMPT 05-FIX OQ-CUST-001 | TG     | §11                   | TEST-PENDING              | TRACED |
| REQ-062 — Customer receives rejection notification with reason                 | KF-TG-03, KF-TG-09 | RESOLVED — PROMPT 05-FIX OQ-CUST-001 | TG     | §11                   | TEST-PENDING              | TRACED |
| REQ-063 — Customer reminder 24 hours before appointment                        | KF-TG-04           | RESOLVED — PROMPT 05-FIX OQ-CUST-001 | TG     | §11                   | TEST-PENDING              | TRACED |
| REQ-064 — Customer reminder 1 hour before appointment                          | KF-TG-04           | RESOLVED — PROMPT 05-FIX OQ-CUST-001 | TG     | §11                   | TEST-PENDING              | TRACED |
| REQ-065 — Owner notified on new payment proof submission                       | KF-TG-05           | PENDING DECISION REGISTER MAPPING    | TG     | §11                   | TEST-PENDING              | TRACED |
| REQ-066 — Owner Telegram notification content                                  | KF-TG-06           | PENDING DECISION REGISTER MAPPING    | TG     | §11                   | TEST-PENDING              | TRACED |
| REQ-067 — Owner can Accept from Telegram                                       | KF-TG-07           | PENDING DECISION REGISTER MAPPING    | TG     | §11                   | TEST-PENDING              | TRACED |
| REQ-068 — Owner can Reject from Telegram; reason required                      | KF-TG-07, KF-TG-08 | PENDING DECISION REGISTER MAPPING    | TG     | §11                   | TEST-PENDING              | TRACED |
| REQ-069 — Owner does not receive appointment reminders                         | KF-TG-10           | PENDING DECISION REGISTER MAPPING    | TG     | §11                   | TEST-PENDING              | TRACED |

## DOMAIN 8 — SERVICES / PRICING (Specification §12)

| Requirement                                                               | Source Fact           | Decision Source                   | Domain  | Specification Section | Test/Acceptance Reference | Status |
| ------------------------------------------------------------------------- | --------------------- | --------------------------------- | ------- | --------------------- | ------------------------- | ------ |
| REQ-070 — Multiple services selectable                                    | KF-BOOK-01            | PENDING DECISION REGISTER MAPPING | SERVICE | §12                   | TEST-PENDING              | TRACED |
| REQ-071 — Base service price and duration                                 | KF-SVC-01             | PENDING DECISION REGISTER MAPPING | SERVICE | §12                   | TEST-PENDING              | TRACED |
| REQ-072 — Variations/options supported                                    | KF-SVC-02             | PENDING DECISION REGISTER MAPPING | SERVICE | §12                   | TEST-PENDING              | TRACED |
| REQ-073 — Add-ons may change price and duration                           | KF-SVC-03             | PENDING DECISION REGISTER MAPPING | SERVICE | §12                   | TEST-PENDING              | TRACED |
| REQ-074 — Total duration is the sum of selected components                | KF-BOOK-02            | PENDING DECISION REGISTER MAPPING | SERVICE | §12                   | TEST-PENDING              | TRACED |
| REQ-075 — Total price derived from selected components                    | KF-SVC-01, KF-SVC-03  | PENDING DECISION REGISTER MAPPING | SERVICE | §12                   | TEST-PENDING              | TRACED |
| REQ-076 — Existing bookings preserve price/duration snapshots             | KF-BOOK-03, KF-SVC-06 | PENDING DECISION REGISTER MAPPING | SERVICE | §12                   | TEST-PENDING              | TRACED |
| REQ-077 — Services with future bookings cannot be hard-deleted            | KF-SVC-04             | PENDING DECISION REGISTER MAPPING | SERVICE | §12                   | TEST-PENDING              | TRACED |
| REQ-078 — Such services can be deactivated                                | KF-SVC-05             | PENDING DECISION REGISTER MAPPING | SERVICE | §12                   | TEST-PENDING              | TRACED |
| REQ-079 — Deactivated services not selectable and hidden from public page | KF-SVC-05, KF-SVC-07  | PENDING DECISION REGISTER MAPPING | SERVICE | §12                   | TEST-PENDING              | TRACED |
| REQ-080 — Existing bookings unchanged by deactivation                     | KF-SVC-06             | PENDING DECISION REGISTER MAPPING | SERVICE | §12                   | TEST-PENDING              | TRACED |
| REQ-081 — Deactivated services can be reactivated                         | KF-SVC-08             | PENDING DECISION REGISTER MAPPING | SERVICE | §12                   | TEST-PENDING              | TRACED |

> **Prompt 10 note:** REQ-070 … REQ-081 (Domain 8) and REQ-214 are implemented at the
> service-catalog foundation — schema, RLS, owner API, dashboard management UI, and the
> public active-services projection. Composition/totals (REQ-070/074/075) and booking
> snapshots (REQ-076/080) land with the Bookings module; the future-booking hard-delete
> guard (REQ-077) is a seam returning no blockers until bookings exist. See
> `implementation/04-service-management.md` for the requirement → implementation → test map.

## DOMAIN 9 — SCHEDULING (Specification §13)

| Requirement                                                                  | Source Fact              | Decision Source                   | Domain | Specification Section | Test/Acceptance Reference | Status |
| ---------------------------------------------------------------------------- | ------------------------ | --------------------------------- | ------ | --------------------- | ------------------------- | ------ |
| REQ-082 — Weekly working hours configurable                                  | KF-SCHED-06              | PENDING DECISION REGISTER MAPPING | SCHED  | §13                   | TEST-PENDING              | TRACED |
| REQ-083 — Multiple working periods per day                                   | KF-SCHED-06              | PENDING DECISION REGISTER MAPPING | SCHED  | §13                   | TEST-PENDING              | TRACED |
| REQ-084 — Specific periods can be blocked                                    | KF-SCHED-08              | PENDING DECISION REGISTER MAPPING | SCHED  | §13                   | TEST-PENDING              | TRACED |
| REQ-085 — Whole days can be blocked                                          | KF-SCHED-08              | PENDING DECISION REGISTER MAPPING | SCHED  | §13                   | TEST-PENDING              | TRACED |
| REQ-086 — Special dates can override weekly schedules                        | KF-SCHED-07              | PENDING DECISION REGISTER MAPPING | SCHED  | §13                   | TEST-PENDING              | TRACED |
| REQ-087 — Special dates may be closed or have custom hours                   | KF-SCHED-34              | PENDING DECISION REGISTER MAPPING | SCHED  | §13                   | TEST-PENDING              | TRACED |
| REQ-088 — Booking interval configurable                                      | KF-SCHED-09              | PENDING DECISION REGISTER MAPPING | SCHED  | §13                   | TEST-PENDING              | TRACED |
| REQ-089 — Full service duration must fit available working time              | KF-SCHED-10              | PENDING DECISION REGISTER MAPPING | SCHED  | §13                   | TEST-PENDING              | TRACED |
| REQ-090 — Existing bookings unchanged when schedule changes                  | KF-SCHED-11              | PENDING DECISION REGISTER MAPPING | SCHED  | §13                   | TEST-PENDING              | TRACED |
| REQ-091 — Schedule changes allowed despite conflicts                         | KF-SCHED-24, KF-SCHED-12 | PENDING DECISION REGISTER MAPPING | SCHED  | §13                   | TEST-PENDING              | TRACED |
| REQ-092 — System warns about affected bookings                               | KF-SCHED-13              | PENDING DECISION REGISTER MAPPING | SCHED  | §13                   | TEST-PENDING              | TRACED |
| REQ-093 — Warning identifies affected booking, date/time and reason          | KF-SCHED-25              | PENDING DECISION REGISTER MAPPING | SCHED  | §13                   | TEST-PENDING              | TRACED |
| REQ-094 — Affected-booking email generated                                   | KF-SCHED-26              | PENDING DECISION REGISTER MAPPING | SCHED  | §13                   | TEST-PENDING              | TRACED |
| REQ-095 — Close schedule changes may be grouped into a five-minute window    | KF-SCHED-27              | PENDING DECISION REGISTER MAPPING | SCHED  | §13                   | TEST-PENDING              | TRACED |
| REQ-096 — Every affected booking individually listed                         | KF-SCHED-28              | PENDING DECISION REGISTER MAPPING | SCHED  | §13                   | TEST-PENDING              | TRACED |
| REQ-097 — Notification contains customer name, phone, date/time and services | KF-SCHED-29              | PENDING DECISION REGISTER MAPPING | SCHED  | §13                   | TEST-PENDING              | TRACED |
| REQ-098 — Direct access to affected bookings                                 | KF-SCHED-30              | PENDING DECISION REGISTER MAPPING | SCHED  | §13                   | TEST-PENDING              | TRACED |
| REQ-099 — Quick actions: Reschedule, Cancel, Keep Booking                    | KF-SCHED-31              | PENDING DECISION REGISTER MAPPING | SCHED  | §13                   | TEST-PENDING              | TRACED |

## DOMAIN 10 — BOOKING LIFECYCLE (Specification §14)

| Requirement                                                                              | Source Fact            | Decision Source                       | Domain    | Specification Section | Test/Acceptance Reference | Status |
| ---------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------- | --------- | --------------------- | ------------------------- | ------ |
| REQ-100 — Booking status modeled separately from payment status                          | KF-BOOK-07             | RESOLVED — PROMPT 05-FIX SM-12        | LIFECYCLE | §14                   | TEST-PENDING              | TRACED |
| REQ-101 — Confirmed booking state set                                                    | KF-BOOK-15, KF-BOOK-17 | PENDING DECISION REGISTER MAPPING     | LIFECYCLE | §14                   | TEST-PENDING              | TRACED |
| REQ-102 — Confirmed becomes Completed automatically                                      | KF-BOOK-04             | PENDING DECISION REGISTER MAPPING     | LIFECYCLE | §14                   | TEST-PENDING              | TRACED |
| REQ-103 — Owner can manually mark No Show                                                | KF-BOOK-05             | RESOLVED — PROMPT 05-FIX SM-10        | LIFECYCLE | §14                   | TEST-PENDING              | TRACED |
| REQ-104 — Owner can manually cancel                                                      | KF-BOOK-06, KF-CUST-09 | RESOLVED — PROMPT 05-FIX SM-06, SM-08 | LIFECYCLE | §14                   | TEST-PENDING              | TRACED |
| REQ-105 — Owner can reschedule confirmed bookings                                        | KF-BOOK-11             | PENDING DECISION REGISTER MAPPING     | LIFECYCLE | §14                   | TEST-PENDING              | TRACED |
| REQ-106 — Reschedule requires an available date/time                                     | KF-BOOK-16             | PENDING DECISION REGISTER MAPPING     | LIFECYCLE | §14                   | TEST-PENDING              | TRACED |
| REQ-107 — Existing payment remains attached after reschedule                             | KF-BOOK-12             | PENDING DECISION REGISTER MAPPING     | LIFECYCLE | §14                   | TEST-PENDING              | TRACED |
| REQ-108 — Higher new price handled manually by owner                                     | KF-BOOK-13             | PENDING DECISION REGISTER MAPPING     | LIFECYCLE | §14                   | TEST-PENDING              | TRACED |
| REQ-109 — Customer identifies booking by phone number; no customer-facing reference/code | KF-BOOK-14             | RESOLVED — PROMPT 05-FIX OQ-BOOK-001  | LIFECYCLE | §14                   | TEST-PENDING              | TRACED |

## DOMAIN 11 — PAYMENTS (Specification §15)

| Requirement                                                                     | Source Fact                       | Decision Source                                                | Domain  | Specification Section | Test/Acceptance Reference | Status |
| ------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------- | ------- | --------------------- | ------------------------- | ------ |
| REQ-110 — Prepayment required per business configuration                        | KF-PAY-01                         | PENDING DECISION REGISTER MAPPING                              | PAYMENT | §15                   | TEST-PENDING              | TRACED |
| REQ-111 — Owner configures percentage or fixed prepayment                       | KF-PAY-02                         | PENDING DECISION REGISTER MAPPING                              | PAYMENT | §15                   | TEST-PENDING              | TRACED |
| REQ-112 — Multiple payment methods supported                                    | KF-PAY-03                         | RESOLVED — PROMPT 05-FIX OQ-PAY-001                            | PAYMENT | §15                   | TEST-PENDING              | TRACED |
| REQ-113 — Manual bank transfer supported                                        | KF-PAY-04                         | PENDING DECISION REGISTER MAPPING                              | PAYMENT | §15                   | TEST-PENDING              | TRACED |
| REQ-114 — Mobile-money (e.g., Telebirr) supported                               | KF-PAY-05                         | PENDING DECISION REGISTER MAPPING                              | PAYMENT | §15                   | TEST-PENDING              | TRACED |
| REQ-115 — Custom payment methods NOT configured in this phase                   | KF-PAY-05                         | RESOLVED — PROMPT 05-FIX OQ-PAY-001 (supersedes prior wording) | PAYMENT | §15                   | TEST-PENDING              | TRACED |
| REQ-116 — Customer selects a payment method                                     | KF-PAY-10                         | PENDING DECISION REGISTER MAPPING                              | PAYMENT | §15                   | TEST-PENDING              | TRACED |
| REQ-117 — Customer uploads payment proof                                        | KF-PAY-11                         | PENDING DECISION REGISTER MAPPING                              | PAYMENT | §15                   | TEST-PENDING              | TRACED |
| REQ-118 — Payment proof supports image and PDF                                  | KF-PAY-06, KF-SUB-06              | PENDING DECISION REGISTER MAPPING                              | PAYMENT | §15                   | TEST-PENDING              | TRACED |
| REQ-119 — Owner verifies proof in dashboard                                     | KF-PAY-07                         | PENDING DECISION REGISTER MAPPING                              | PAYMENT | §15                   | TEST-PENDING              | TRACED |
| REQ-120 — Owner verifies proof via Telegram                                     | KF-PAY-07                         | PENDING DECISION REGISTER MAPPING                              | PAYMENT | §15                   | TEST-PENDING              | TRACED |
| REQ-121 — Slot claim is atomic; exactly one winner (race condition)             | KF-BOOK-08, KF-BOOK-09, KF-PUB-24 | RESOLVED — PROMPT 05-FIX OQ-SLOT-001                           | PAYMENT | §15                   | TEST-PENDING              | TRACED |
| REQ-122 — No automatic refunds; refund handling manual                          | KF-PAY-08, KF-PAY-09              | PENDING DECISION REGISTER MAPPING                              | PAYMENT | §15                   | TEST-PENDING              | TRACED |
| REQ-123 — Rejected proof keeps slot blocked until release or valid resubmission | KF-BOOK-10                        | RESOLVED — PROMPT 05-FIX SM-09, OQ-SLOT-001                    | PAYMENT | §15                   | TEST-PENDING              | TRACED |
| REQ-124 — Proof rejection may include a reason sent to the customer             | KF-PAY-12, KF-TG-09               | PENDING DECISION REGISTER MAPPING                              | PAYMENT | §15                   | TEST-PENDING              | TRACED |

## DOMAIN 12 — SUBSCRIPTION (Specification §16)

| Requirement                                                                      | Source Fact                                           | Decision Source                   | Domain       | Specification Section | Test/Acceptance Reference | Status |
| -------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------- | ------------ | --------------------- | ------------------------- | ------ |
| REQ-125 — One standard monthly price                                             | KF-SUB-01                                             | PENDING DECISION REGISTER MAPPING | SUBSCRIPTION | §16                   | TEST-PENDING              | TRACED |
| REQ-126 — No subscription tiers initially                                        | KF-SUB-02                                             | PENDING DECISION REGISTER MAPPING | SUBSCRIPTION | §16                   | TEST-PENDING              | TRACED |
| REQ-127 — Independent subscription state per business                            | KF-SUB-03, KF-BIZ-12                                  | PENDING DECISION REGISTER MAPPING | SUBSCRIPTION | §16                   | TEST-PENDING              | TRACED |
| REQ-128 — Trial is 30 days                                                       | KF-SUB-03                                             | PENDING DECISION REGISTER MAPPING | SUBSCRIPTION | §16                   | TEST-PENDING              | TRACED |
| REQ-129 — Trial grace is 3 days                                                  | KF-SUB-09                                             | PENDING DECISION REGISTER MAPPING | SUBSCRIPTION | §16                   | TEST-PENDING              | TRACED |
| REQ-130 — Paid subscription period is 30 days                                    | KF-SUB-08                                             | PENDING DECISION REGISTER MAPPING | SUBSCRIPTION | §16                   | TEST-PENDING              | TRACED |
| REQ-131 — Paid grace is 5 days                                                   | KF-SUB-10                                             | PENDING DECISION REGISTER MAPPING | SUBSCRIPTION | §16                   | TEST-PENDING              | TRACED |
| REQ-132 — Bookings continue during grace                                         | KF-SUB-11                                             | PENDING DECISION REGISTER MAPPING | SUBSCRIPTION | §16                   | TEST-PENDING              | TRACED |
| REQ-133 — After grace, new bookings disabled                                     | KF-SUB-12                                             | PENDING DECISION REGISTER MAPPING | SUBSCRIPTION | §16                   | TEST-PENDING              | TRACED |
| REQ-134 — Public page remains visible (expired/grace states)                     | KF-SUB-13, KF-PUB-20                                  | PENDING DECISION REGISTER MAPPING | SUBSCRIPTION | §16                   | TEST-PENDING              | TRACED |
| REQ-135 — Subscription paid via manual bank transfer                             | KF-SUB-04                                             | PENDING DECISION REGISTER MAPPING | SUBSCRIPTION | §16                   | TEST-PENDING              | TRACED |
| REQ-136 — Owner uploads subscription payment proof                               | KF-SUB-05, KF-SUB-06                                  | PENDING DECISION REGISTER MAPPING | SUBSCRIPTION | §16                   | TEST-PENDING              | TRACED |
| REQ-137 — Admin/Super Admin reviews subscription proof; approval extends 30 days | KF-SUB-07, KF-SUB-08                                  | PENDING DECISION REGISTER MAPPING | SUBSCRIPTION | §16                   | TEST-PENDING              | TRACED |
| REQ-138 — Rejection requires a reason; sent to owner                             | KF-SUB-14, KF-SUB-15                                  | PENDING DECISION REGISTER MAPPING | SUBSCRIPTION | §16                   | TEST-PENDING              | TRACED |
| REQ-139 — Reminders use email and business Telegram                              | KF-SUB-16                                             | PENDING DECISION REGISTER MAPPING | SUBSCRIPTION | §16                   | TEST-PENDING              | TRACED |
| REQ-140 — Exactly two Admin accounts receive subscription payment notifications  | KF-SUB-17                                             | PENDING DECISION REGISTER MAPPING | SUBSCRIPTION | §16                   | TEST-PENDING              | TRACED |
| REQ-141 — Owner retains access and data after expiration; warning until renewal  | KF-SUB-19, KF-SUB-20, KF-SUB-21, KF-SUB-22, KF-SUB-23 | PENDING DECISION REGISTER MAPPING | SUBSCRIPTION | §16                   | TEST-PENDING              | TRACED |

## DOMAIN 13 — NOTIFICATIONS (Specification §17)

| Requirement                                            | Source Fact                                                       | Decision Source                   | Domain | Specification Section | Test/Acceptance Reference | Status |
| ------------------------------------------------------ | ----------------------------------------------------------------- | --------------------------------- | ------ | --------------------- | ------------------------- | ------ |
| REQ-142 — Notification channels are email and Telegram | KF-SUB-16, KF-TG-02 … KF-TG-10, KF-SCHED-26, KF-SEC-05, KF-SEC-18 | PENDING DECISION REGISTER MAPPING | NOTIF  | §17                   | TEST-PENDING              | TRACED |

## DOMAIN 14 — PAUSE / RESUME (Specification §18)

| Requirement                                                            | Source Fact              | Decision Source                   | Domain | Specification Section | Test/Acceptance Reference | Status |
| ---------------------------------------------------------------------- | ------------------------ | --------------------------------- | ------ | --------------------- | ------------------------- | ------ |
| REQ-143 — Business can pause bookings                                  | KF-PUB-13                | PENDING DECISION REGISTER MAPPING | PAUSE  | §18                   | TEST-PENDING              | TRACED |
| REQ-144 — Pause can be indefinite or with automatic resume date        | KF-PUB-14                | PENDING DECISION REGISTER MAPPING | PAUSE  | §18                   | TEST-PENDING              | TRACED |
| REQ-145 — Resume date can be changed, removed or extended              | KF-PAUSE-09              | PENDING DECISION REGISTER MAPPING | PAUSE  | §18                   | TEST-PENDING              | TRACED |
| REQ-146 — Public page visible while paused                             | KF-PUB-15                | PENDING DECISION REGISTER MAPPING | PAUSE  | §18                   | TEST-PENDING              | TRACED |
| REQ-147 — New bookings disabled while paused                           | KF-PUB-16                | PENDING DECISION REGISTER MAPPING | PAUSE  | §18                   | TEST-PENDING              | TRACED |
| REQ-148 — Optional pause message shown                                 | KF-PUB-17                | PENDING DECISION REGISTER MAPPING | PAUSE  | §18                   | TEST-PENDING              | TRACED |
| REQ-149 — Optional reopening date shown                                | KF-PUB-17                | PENDING DECISION REGISTER MAPPING | PAUSE  | §18                   | TEST-PENDING              | TRACED |
| REQ-150 — Schedule changes while paused are pending and versioned      | KF-SCHED-14, KF-PAUSE-07 | PENDING DECISION REGISTER MAPPING | PAUSE  | §18                   | TEST-PENDING              | TRACED |
| REQ-151 — Latest pending schedule becomes active on resume             | KF-SCHED-15, KF-PAUSE-08 | PENDING DECISION REGISTER MAPPING | PAUSE  | §18                   | TEST-PENDING              | TRACED |
| REQ-152 — Multiple changes while paused retained in history            | KF-PAUSE-07, KF-SCHED-16 | PENDING DECISION REGISTER MAPPING | PAUSE  | §18                   | TEST-PENDING              | TRACED |
| REQ-153 — Automatic resume only if subscription active                 | KF-PAUSE-01              | PENDING DECISION REGISTER MAPPING | PAUSE  | §18                   | TEST-PENDING              | TRACED |
| REQ-154 — Expired subscription prevents automatic reopening            | KF-PAUSE-02              | RESOLVED — PROMPT 05-FIX SM-13    | PAUSE  | §18                   | TEST-PENDING              | TRACED |
| REQ-155 — Renewal after pause period ended permits automatic reopening | KF-PAUSE-03              | PENDING DECISION REGISTER MAPPING | PAUSE  | §18                   | TEST-PENDING              | TRACED |
| REQ-156 — Indefinite pause stays paused on renewal                     | KF-PAUSE-04              | PENDING DECISION REGISTER MAPPING | PAUSE  | §18                   | TEST-PENDING              | TRACED |
| REQ-157 — Manual resume opens immediately if subscription active       | KF-PAUSE-05              | PENDING DECISION REGISTER MAPPING | PAUSE  | §18                   | TEST-PENDING              | TRACED |
| REQ-158 — Resume checks current schedule/availability                  | KF-PAUSE-06              | PENDING DECISION REGISTER MAPPING | PAUSE  | §18                   | TEST-PENDING              | TRACED |

## DOMAIN 15 — SCHEDULE EXCEPTIONS (Specification §19)

| Requirement                                                   | Source Fact              | Decision Source                   | Domain    | Specification Section | Test/Acceptance Reference | Status |
| ------------------------------------------------------------- | ------------------------ | --------------------------------- | --------- | --------------------- | ------------------------- | ------ |
| REQ-159 — Owner may choose Keep Booking on conflict           | KF-SCHED-31              | DEC-175 (formal mapping pending)  | EXCEPTION | §19                   | TEST-PENDING              | TRACED |
| REQ-160 — Kept booking becomes an approved schedule exception | KF-SCHED-31, KF-SCHED-11 | DEC-175 (formal mapping pending)  | EXCEPTION | §19                   | TEST-PENDING              | TRACED |
| REQ-161 — Exception creation is recorded and visible          | KF-SCHED-16, KF-SCHED-17 | PENDING DECISION REGISTER MAPPING | EXCEPTION | §19                   | TEST-PENDING              | TRACED |

## DOMAIN 16 — AUDIT / HISTORY (Specification §20)

| Requirement                                                           | Source Fact                | Decision Source                   | Domain | Specification Section | Test/Acceptance Reference | Status |
| --------------------------------------------------------------------- | -------------------------- | --------------------------------- | ------ | --------------------- | ------------------------- | ------ |
| REQ-162 — Schedule versions retained                                  | KF-SCHED-16                | PENDING DECISION REGISTER MAPPING | AUDIT  | §20                   | TEST-PENDING              | TRACED |
| REQ-163 — Schedule history records who/when/what/reason               | KF-SCHED-17                | PENDING DECISION REGISTER MAPPING | AUDIT  | §20                   | TEST-PENDING              | TRACED |
| REQ-164 — Manual reason optional                                      | KF-SCHED-33                | PENDING DECISION REGISTER MAPPING | AUDIT  | §20                   | TEST-PENDING              | TRACED |
| REQ-165 — Automatic changes use System actor and automatic reason     | KF-SCHED-18, KF-ROLE-09    | PENDING DECISION REGISTER MAPPING | AUDIT  | §20                   | TEST-PENDING              | TRACED |
| REQ-166 — Owner can view schedule history                             | KF-SCHED-19                | PENDING DECISION REGISTER MAPPING | AUDIT  | §20                   | TEST-PENDING              | TRACED |
| REQ-167 — Super Admin can view schedule history                       | KF-SCHED-19                | PENDING DECISION REGISTER MAPPING | AUDIT  | §20                   | TEST-PENDING              | TRACED |
| REQ-168 — Admin cannot view schedule history                          | KF-SCHED-20                | PENDING DECISION REGISTER MAPPING | AUDIT  | §20                   | TEST-PENDING              | TRACED |
| REQ-169 — Owner cannot restore/revert; history view-only              | KF-SCHED-21                | PENDING DECISION REGISTER MAPPING | AUDIT  | §20                   | TEST-PENDING              | TRACED |
| REQ-170 — Schedule history export as PDF                              | KF-SCHED-22                | PENDING DECISION REGISTER MAPPING | AUDIT  | §20                   | TEST-PENDING              | TRACED |
| REQ-171 — Schedule-history export supports custom start/end date      | KF-SCHED-32                | PENDING DECISION REGISTER MAPPING | AUDIT  | §20                   | TEST-PENDING              | TRACED |
| REQ-172 — Schedule-history PDF contains versions and dates/times only | KF-SCHED-23                | PENDING DECISION REGISTER MAPPING | AUDIT  | §20                   | TEST-PENDING              | TRACED |
| REQ-173 — Full booking status history retained internally             | KF-REPORT-02, KF-REPORT-03 | PENDING DECISION REGISTER MAPPING | AUDIT  | §20                   | TEST-PENDING              | TRACED |
| REQ-174 — Owner can view full history for own bookings                | KF-REPORT-04               | PENDING DECISION REGISTER MAPPING | AUDIT  | §20                   | TEST-PENDING              | TRACED |

## DOMAIN 17 — REPORTS / EXPORTS (Specification §21)

| Requirement                                                                               | Source Fact                                            | Decision Source                   | Domain | Specification Section | Test/Acceptance Reference | Status |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------- | ------ | --------------------- | ------------------------- | ------ |
| REQ-175 — Booking reports show current status                                             | KF-REPORT-01                                           | PENDING DECISION REGISTER MAPPING | REPORT | §21                   | TEST-PENDING              | TRACED |
| REQ-176 — Admin sees current status only                                                  | KF-REPORT-05                                           | PENDING DECISION REGISTER MAPPING | REPORT | §21                   | TEST-PENDING              | TRACED |
| REQ-177 — Super Admin can view full booking history                                       | KF-REPORT-06                                           | PENDING DECISION REGISTER MAPPING | REPORT | §21                   | TEST-PENDING              | TRACED |
| REQ-178 — Super Admin can export full booking status history to PDF                       | KF-REPORT-07                                           | PENDING DECISION REGISTER MAPPING | REPORT | §21                   | TEST-PENDING              | TRACED |
| REQ-179 — Export supports custom date range                                               | KF-REPORT-08                                           | PENDING DECISION REGISTER MAPPING | REPORT | §21                   | TEST-PENDING              | TRACED |
| REQ-180 — Export covers all businesses or one selected business                           | KF-REPORT-09                                           | PENDING DECISION REGISTER MAPPING | REPORT | §21                   | TEST-PENDING              | TRACED |
| REQ-181 — Business multi-select not allowed                                               | KF-REPORT-10                                           | PENDING DECISION REGISTER MAPPING | REPORT | §21                   | TEST-PENDING              | TRACED |
| REQ-182 — PDF contains Booking ID, customer, business, status changes, dates/times, actor | KF-REPORT-11                                           | PENDING DECISION REGISTER MAPPING | REPORT | §21                   | TEST-PENDING              | TRACED |
| REQ-183 — PDF excludes reasons/notes                                                      | KF-REPORT-12                                           | PENDING DECISION REGISTER MAPPING | REPORT | §21                   | TEST-PENDING              | TRACED |
| REQ-184 — Filters: status, actor, date range, business                                    | KF-REPORT-13                                           | PENDING DECISION REGISTER MAPPING | REPORT | §21                   | TEST-PENDING              | TRACED |
| REQ-185 — Filter AND/OR semantics                                                         | KF-REPORT-14                                           | PENDING DECISION REGISTER MAPPING | REPORT | §21                   | TEST-PENDING              | TRACED |
| REQ-186 — Filters not remembered; reset defaults to 30 days                               | KF-REPORT-15, KF-REPORT-16                             | PENDING DECISION REGISTER MAPPING | REPORT | §21                   | TEST-PENDING              | TRACED |
| REQ-187 — Default sort newest first                                                       | KF-REPORT-17                                           | PENDING DECISION REGISTER MAPPING | REPORT | §21                   | TEST-PENDING              | TRACED |
| REQ-188 — Sortable columns                                                                | KF-REPORT-18                                           | PENDING DECISION REGISTER MAPPING | REPORT | §21                   | TEST-PENDING              | TRACED |
| REQ-189 — Date/time sorting rules                                                         | KF-REPORT-19, KF-REPORT-20                             | PENDING DECISION REGISTER MAPPING | REPORT | §21                   | TEST-PENDING              | TRACED |
| REQ-190 — Booking ID and other-column sorting rules (CONF-001 recorded)                   | KF-REPORT-21, KF-REPORT-22, KF-REPORT-23, KF-REPORT-24 | PENDING DECISION REGISTER MAPPING | REPORT | §21                   | TEST-PENDING              | TRACED |

> **REQ-190 note:** CONF-001 is **RESOLVED** — final sort rule is Primary = Booking ID, Secondary = Date/time, Final tie-breaker = Actor A–Z (earlier Actor-A–Z-secondary rule is preserved as history). Final wording: `01-master-specification.md` REQ-190; resolution record: [consistency-audit.md](consistency-audit.md).

## DOMAIN 18 — SECURITY (Specification §22)

| Requirement                                                              | Source Fact | Decision Source                   | Domain   | Specification Section | Test/Acceptance Reference | Status |
| ------------------------------------------------------------------------ | ----------- | --------------------------------- | -------- | --------------------- | ------------------------- | ------ |
| REQ-191 — Login success and failure recorded                             | KF-SEC-09   | PENDING DECISION REGISTER MAPPING | SECURITY | §22                   | TEST-PENDING              | TRACED |
| REQ-192 — Login records include date/time, IP, device/browser and result | KF-SEC-10   | PENDING DECISION REGISTER MAPPING | SECURITY | §22                   | TEST-PENDING              | TRACED |
| REQ-193 — Five consecutive failed attempts cause a 15-minute lock        | KF-SEC-11   | PENDING DECISION REGISTER MAPPING | SECURITY | §22                   | TEST-PENDING              | TRACED |
| REQ-194 — Successful password reset clears the lock                      | KF-SEC-12   | PENDING DECISION REGISTER MAPPING | SECURITY | §22                   | TEST-PENDING              | TRACED |
| REQ-195 — Lockout generates an immediate email                           | KF-SEC-18   | PENDING DECISION REGISTER MAPPING | SECURITY | §22                   | TEST-PENDING              | TRACED |
| REQ-196 — Lockout email includes IP and device/browser                   | KF-SEC-13   | PENDING DECISION REGISTER MAPPING | SECURITY | §22                   | TEST-PENDING              | TRACED |
| REQ-197 — New/unrecognized successful devices recorded                   | KF-SEC-14   | PENDING DECISION REGISTER MAPPING | SECURITY | §22                   | TEST-PENDING              | TRACED |
| REQ-198 — Super Admin emergency recovery email                           | KF-SEC-01   | PENDING DECISION REGISTER MAPPING | SECURITY | §22                   | TEST-PENDING              | TRACED |
| REQ-199 — Emergency recovery sends a one-time code                       | KF-SEC-02   | PENDING DECISION REGISTER MAPPING | SECURITY | §22                   | TEST-PENDING              | TRACED |
| REQ-200 — Recovery code permits immediate password replacement           | KF-SEC-03   | PENDING DECISION REGISTER MAPPING | SECURITY | §22                   | TEST-PENDING              | TRACED |
| REQ-201 — Owner views own security/activity history                      | KF-SEC-15   | PENDING DECISION REGISTER MAPPING | SECURITY | §22                   | TEST-PENDING              | TRACED |
| REQ-202 — Admin views own security history                               | KF-SEC-16   | PENDING DECISION REGISTER MAPPING | SECURITY | §22                   | TEST-PENDING              | TRACED |
| REQ-203 — Super Admin views all relevant security history                | KF-SEC-17   | PENDING DECISION REGISTER MAPPING | SECURITY | §22                   | TEST-PENDING              | TRACED |
| REQ-204 — Security/activity records retained one year                    | KF-AUTH-07  | PENDING DECISION REGISTER MAPPING | SECURITY | §22                   | TEST-PENDING              | TRACED |
| REQ-205 — Super Admin can delete security/activity records               | KF-AUTH-08  | PENDING DECISION REGISTER MAPPING | SECURITY | §22                   | TEST-PENDING              | TRACED |
| REQ-206 — Deletion itself audited                                        | KF-AUTH-08  | PENDING DECISION REGISTER MAPPING | SECURITY | §22                   | TEST-PENDING              | TRACED |

## DOMAIN 19 — PUBLIC BUSINESS PAGE (Specification §23)

| Requirement                                                                               | Source Fact                                | Decision Source                     | Domain   | Specification Section | Test/Acceptance Reference | Status |
| ----------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------- | -------- | --------------------- | ------------------------- | ------ |
| REQ-207 — Public page customizable                                                        | KF-PUB-02                                  | PENDING DECISION REGISTER MAPPING   | PUB-PAGE | §23                   | TEST-PENDING              | TRACED |
| REQ-208 — One main cover photo; no gallery                                                | KF-PUB-03, KF-PUB-04                       | PENDING DECISION REGISTER MAPPING   | PUB-PAGE | §23                   | TEST-PENDING              | TRACED |
| REQ-209 — Page includes business name and logo                                            | KF-PUB-27                                  | PENDING DECISION REGISTER MAPPING   | PUB-PAGE | §23                   | TEST-PENDING              | TRACED |
| REQ-210 — Page includes business description                                              | KF-PUB-28                                  | PENDING DECISION REGISTER MAPPING   | PUB-PAGE | §23                   | TEST-PENDING              | TRACED |
| REQ-211 — Location includes address and latitude/longitude                                | KF-PUB-09                                  | PENDING DECISION REGISTER MAPPING   | PUB-PAGE | §23                   | TEST-PENDING              | TRACED |
| REQ-212 — Map access (Google Maps / OpenStreetMap)                                        | KF-PUB-10                                  | PENDING DECISION REGISTER MAPPING   | PUB-PAGE | §23                   | TEST-PENDING              | TRACED |
| REQ-213 — Public contact is phone                                                         | KF-PUB-11                                  | PENDING DECISION REGISTER MAPPING   | PUB-PAGE | §23                   | TEST-PENDING              | TRACED |
| REQ-214 — Page content: services, prices, durations, variations, add-ons, available times | KF-PUB-29                                  | PENDING DECISION REGISTER MAPPING   | PUB-PAGE | §23                   | TEST-PENDING              | TRACED |
| REQ-215 — Business type categories are exactly Salon & Barber and Other                   | KF-PUB-12                                  | RESOLVED — PROMPT 05-FIX OQ-PUB-001 | PUB-PAGE | §23                   | TEST-PENDING              | TRACED |
| REQ-216 — Business deactivation/closure by owner                                          | KF-PUB-18, KF-PUB-19, KF-PUB-25, KF-PUB-26 | PENDING DECISION REGISTER MAPPING   | PUB-PAGE | §23                   | TEST-PENDING              | TRACED |

## DOMAIN 20 — ADMINISTRATION (Specification §24)

| Requirement                                              | Source Fact | Decision Source                   | Domain | Specification Section | Test/Acceptance Reference | Status |
| -------------------------------------------------------- | ----------- | --------------------------------- | ------ | --------------------- | ------------------------- | ------ |
| REQ-217 — Super Admin admin-account lifecycle operations | KF-ROLE-04  | PENDING DECISION REGISTER MAPPING | ADMIN  | §24                   | TEST-PENDING              | TRACED |
| REQ-218 — Admin cannot change own password               | KF-SEC-06   | PENDING DECISION REGISTER MAPPING | ADMIN  | §24                   | TEST-PENDING              | TRACED |
| REQ-219 — Super Admin can change Admin passwords         | KF-SEC-07   | PENDING DECISION REGISTER MAPPING | ADMIN  | §24                   | TEST-PENDING              | TRACED |
| REQ-220 — Super Admin can force-log-out Owners/Admins    | KF-SEC-04   | PENDING DECISION REGISTER MAPPING | ADMIN  | §24                   | TEST-PENDING              | TRACED |
| REQ-221 — Forced logout sends immediate email            | KF-SEC-05   | PENDING DECISION REGISTER MAPPING | ADMIN  | §24                   | TEST-PENDING              | TRACED |

## DOMAIN 21 — CROSS-CUTTING DATE / TIME RULES (Specification §25)

| Requirement                                    | Source Fact | Decision Source                   | Domain   | Specification Section | Test/Acceptance Reference | Status |
| ---------------------------------------------- | ----------- | --------------------------------- | -------- | --------------------- | ------------------------- | ------ |
| REQ-222 — One global system timezone           | KF-SCHED-01 | PENDING DECISION REGISTER MAPPING | DATETIME | §25                   | TEST-PENDING              | TRACED |
| REQ-223 — Businesses cannot choose a timezone  | KF-SCHED-02 | PENDING DECISION REGISTER MAPPING | DATETIME | §25                   | TEST-PENDING              | TRACED |
| REQ-224 — 24-hour time format                  | KF-SCHED-03 | PENDING DECISION REGISTER MAPPING | DATETIME | §25                   | TEST-PENDING              | TRACED |
| REQ-225 — Date format YYYY-MM-DD               | KF-SCHED-04 | PENDING DECISION REGISTER MAPPING | DATETIME | §25                   | TEST-PENDING              | TRACED |
| REQ-226 — Minute precision; seconds not stored | KF-SCHED-05 | PENDING DECISION REGISTER MAPPING | DATETIME | §25                   | TEST-PENDING              | TRACED |

## DOMAIN 22 — APPROVED DECISIONS — PROMPT 05-FIX (Specification §30)

| Requirement                                                                          | Source Fact                      | Decision Source                      | Domain       | Specification Section | Test/Acceptance Reference | Status |
| ------------------------------------------------------------------------------------ | -------------------------------- | ------------------------------------ | ------------ | --------------------- | ------------------------- | ------ |
| REQ-227 — Customer notified on No Show                                               | KF-BOOK-05, KF-TG-03             | RESOLVED — PROMPT 05-FIX SM-05       | DEC-APPROVED | §30                   | TEST-PENDING              | TRACED |
| REQ-228 — Customer notified on owner cancellation                                    | KF-BOOK-06, KF-TG-03             | RESOLVED — PROMPT 05-FIX SM-06       | DEC-APPROVED | §30                   | TEST-PENDING              | TRACED |
| REQ-229 — Customer notified on reschedule with new date/time                         | KF-BOOK-11, KF-BOOK-12, KF-TG-03 | RESOLVED — PROMPT 05-FIX SM-07       | DEC-APPROVED | §30                   | TEST-PENDING              | TRACED |
| REQ-230 — Rejected booking: customer may resubmit proof (Rejected → Payment Pending) | KF-BOOK-10, KF-PAY-12            | RESOLVED — PROMPT 05-FIX SM-09       | DEC-APPROVED | §30                   | TEST-PENDING              | TRACED |
| REQ-231 — Failed automatic resume event recorded in history                          | KF-PAUSE-01, KF-PAUSE-02         | RESOLVED — PROMPT 05-FIX SM-13       | DEC-APPROVED | §30                   | TEST-PENDING              | TRACED |
| REQ-232 — Product name "Werefa"                                                      | (approved decision OQ-PROD-001)  | RESOLVED — PROMPT 05-FIX OQ-PROD-001 | DEC-APPROVED | §30                   | TEST-PENDING              | TRACED |

> **REQ-232 note:** Derived directly from the approved Prompt 05-FIX decision OQ-PROD-001 (no `KF-*` fact). KF-count unaffected.

---

## Reverse Index (KF → REQ)

The inverse map (given a `KF-*` fact, which requirements depend on it) is obtained by scanning the Source Fact column above. Known duplicate-coverage pairs are recorded here; both facts are preserved and reconciled at DEC import:

| Fact                                   | Also covered by | Note                                       |
| -------------------------------------- | --------------- | ------------------------------------------ |
| KF-CUST-01 (customers have no account) | KF-ROLE-05      | Same statement; both referenced by REQ-040 |
| KF-ROLE-02 (exactly one Super Admin)   | KF-SUB-18       | Same statement; both referenced by REQ-037 |

## Maintenance

- Rerun after any change to REQ numbering, domain membership, or register facts.
- `TEST-PENDING` placeholders are replaced when test cases are authored (later stage; see `01-master-specification.md` §28 Definition of Done).
- Decision Source values flip to `DEC-<n>` as the exact DEC wording is imported (`decision-import-checklist.md`).
- This matrix is generated manually but must stay in lockstep with `01-master-specification.md`; a drift in either file is a defect.
