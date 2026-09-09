# 22 — Audit & History Logging

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06
> Binding: REQ-162–186, REQ-205/206, REQ-217–221. History = immutable domain facts. Audit = mutable control records. **Audit record visibility is platform-controlled, never public** (R163/164/187).

## 1. History (immutable append-only)

Append-only facts for compliance and reporting; never modified after write.

| Table                                    | Scope                     | Owner    |
| ---------------------------------------- | ------------------------- | -------- |
| `booking_status_history`                 | per booking               | business |
| `payment_status_history`                 | per payment               | business |
| `subscription_status_history`            | per business subscription | business |
| `schedule_version` (history rows)        | per business              | business |
| `payment_proof` (versioning/replacement) | per payment               | business |

Records persist for **all time** (R175); reports may use them (doc 21); never deleted by business owners; never exposed to other businesses (R163/164/187). Write-once: row mutations after insert are only NULL-out of transient columns (`notified_at`); business-identity fields never change.

## 2. Audit events (control records)

Mutable by design: Super Admin (R205/206) and certain platform events. Logged alongside `audit_event` rows (separate from domain history) for admin actions.

| Action type                                                       | Scope                            | Notes                             |
| ----------------------------------------------------------------- | -------------------------------- | --------------------------------- |
| Account create/update/delete (Admins by SuperAdmin, R217/219/220) | platform (user)                  | with actor + timestamp            |
| Password change (R219), forced logout (R220), unlock (R221)       | platform                         | email confirmation tied           |
| Export PDF generation/download                                    | business or business-wide (R181) | report job record in `report_job` |
| Security record deletion (R205)                                   | platform (security_event rows)   | deletion itself is audited (R206) |
| Subscription review approval/rejection                            | business                         | review actor + result             |
| Subscription renewal proof reviewed                               | business                         | approval/30 d extend (R137)       |

Audit record content: `Actor` (user/system), `Tenant` (business if applicable), `Action`, `Entity`, `EntityId`, `Timestamp`, `Result`, `Actor`'s `IpAddress`/`UserAgent` where feasible. No free-text user-supplied content in audit subjects.

## 3. Permissions

| Viewer      | What they see                                                                          |
| ----------- | -------------------------------------------------------------------------------------- |
| Owner       | their own business audit/history (R201)                                                |
| Admin       | own audit scope (R202); **cannot** access owner schedule-history reports (R168)        |
| Super Admin | all relevant scope (R203); can delete security records (R205); deletion audited (R206) |
| Customers   | never                                                                                  |

## 4. No overlap with reports

Reports are read-only exports with defined column sets (doc 21); history/audit tables are the source. Audit events are never exported in customer-facing PDFs; security retention is not mixed with booking history.

## 5. Purge / retention

- History: **never purged** (R175: for all time).
- Security events: **1 year** retention (R204); weekly purge job + audited platform purge (doc 17).
- Audit events: platform-level retention per compliance settings; archival > purge.

## 6. Observability

All mutations to audit/history tables are observable (idempotent inserts); `audit_event` is tenant-scoped; DB indexes on (business, created_at) and (actor, created_at) drive dashboards and ops queries.

## 7. Test focus

Cross-tenant isolation (R163/164/187); no read leaks from other businesses; immutable after write (no UPDATE allowed in application layer, except allowed NULL-outs); permission checks (Owner vs Admin vs Super Admin); security record deletion → audit row present (R206).
