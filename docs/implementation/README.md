# Implementation documentation

Implementation-focused docs that map the approved requirement & architecture
set (`docs/*.md`, `docs/architecture/*.md`, `docs/architecture/adr/*.md`) to the
codebase, record build/prod decisions behind code, and explain the developer
workflow.

## Index

| Doc                                     | Scope                                                                                                                                                                                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-foundation-traceability.md`         | Prompt 07 foundation: source-path mapping, what was built, test A–F mapping, quality gate, known gaps                                                                                                                                               |
| `02-identity-traceability.md`           | Prompt 08 identity & auth: login/lockout/reset/recovery/Admin lifecycle, CSRF, emails, test mapping                                                                                                                                                 |
| `03-business-tenant-management.md`      | Prompt 09 business & tenant management: ownership matrix, RLS windows, profiles, pause/resume/deactivate, media + QR, public page, admin platform tier, tests                                                                                       |
| `04-service-management.md`              | Prompt 10 service catalog & pricing: service/variation/add-on schema + RLS, integer-minor money, delta invariants, lifecycle, deletion seam (REQ-077), public catalog, tests                                                                        |
| `04-service-management-traceability.md` | Prompt 10 requirement → architecture → implementation → test traceability matrix                                                                                                                                                                    |
| `04-service-management-report.md`       | Prompt 10 Section 38 close-out: quality gate results, new coverage (REQ-077 deletion + child-table RLS), IMPLEMENTED/PARTIAL/DEFERRED summary, Prompt-11 boundary                                                                                   |
| `05-booking-management-report.md`       | Prompt 11 Section 38 close-out: booking/payment/notification module (public + owner flows), quality gate, concurrency fixes, IMPLEMENTED/PARTIAL/DEFERRED status, deferred schedule tables                                                          |
| `06-scheduling-management-report.md`    | Prompt 12 Section 38 close-out: schedule engine + gate, pause/resume reactivation, keep-exceptions + affected sweep, history/PDF (REQ-166/167/170/172), RLS, dashboard, quality-gate numbers                                                        |
| `07-notifications-telegram-report.md`   | Prompt 13 Section 38 close-out: EMAIL+TELEGRAM pipeline, delivery statuses + idempotency, reminder re-validation, REQ-060 Telegram connect/status/disconnect, webhook binding, notifications RLS (+ superadmin INSERT policy), quality-gate numbers |

## Path note

Requirements and architecture do NOT live under `docs/requirements/*` — the
prompts reference paths that do not exist in this repository. Authoritative
sources are:

- Requirements: `docs/01-master-specification.md` (+ `docs/00-project-overview.md`, `docs/250-approved-decisions.md`, traceability indexes under `docs/`)
- Architecture: `docs/architecture/*.md` (01–30) and `docs/architecture/adr/*.md`

See `01-foundation-traceability.md §Path mapping` for the explicit reconciliation.
