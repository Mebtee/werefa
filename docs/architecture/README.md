# Werefa — Architecture & Technical Design

> **Architecture Version:** 1.0.1
> **Source Functional-Spec Version:** Werefa v0.5.0
> **Date:** 2026-09-05
> **Status:** APPROVED — PROMPT 06, corrected by PROMPT 06-CORRECTION (Oracle elected architecture documentation)
> **Docs Index:** [03-documentation-index.md](../03-documentation-index.md)

This directory is the **architecture and technical design documentation** for Werefa. It is produced from the approved v0.5.0 functional requirements. It does not implement or change product behavior; it specifies how the approved requirements are to be built.

## How to read this set

| Order | Document                                                             | Content                                                        |
| ----- | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| 0     | [README.md](README.md)                                               | This index                                                     |
| 1     | [01-architecture-overview.md](01-architecture-overview.md)           | Scope, principles, key decisions, doc map, ADR index           |
| 2     | [02-system-context.md](02-system-context.md)                         | Actors, external systems, containers, data flows               |
| 3     | [03-logical-architecture.md](03-logical-architecture.md)             | Bounded contexts / modules, owned data, interfaces, invariants |
| 4     | [04-tenant-isolation.md](04-tenant-isolation.md)                     | Multi-tenant isolation model, safeguards, failure modes        |
| 5     | [05-domain-architecture.md](05-domain-architecture.md)               | Domain model, aggregates, boundaries                           |
| 6     | [06-data-architecture.md](06-data-architecture.md)                   | Conceptual data model and rationale for each entity            |
| 7     | [07-database-design.md](07-database-design.md)                       | Physical schema, constraints, indexes, RLS, migrations         |
| 8     | [08-booking-concurrency.md](08-booking-concurrency.md)               | **Critical** — slot-lock + first-wins concurrency design       |
| 9     | [09-state-machines.md](09-state-machines.md)                         | Implementation strategy for all state machines                 |
| 10    | [10-scheduling-engine.md](10-scheduling-engine.md)                   | Availability algorithm and explicit precedence                 |
| 11    | [11-payment-architecture.md](11-payment-architecture.md)             | Customer booking payment and subscription payment              |
| 12    | [12-telegram-architecture.md](12-telegram-architecture.md)           | Telegram integration (optional to customers)                   |
| 13    | [13-notification-architecture.md](13-notification-architecture.md)   | Async notification delivery, retries, idempotency              |
| 14    | [14-auth-security-architecture.md](14-auth-security-architecture.md) | Identity, sessions, account security, RBAC, threats            |
| 15    | [15-subscription-architecture.md](15-subscription-architecture.md)   | Subscription states, pauses, booking eligibility               |
| 16    | [16-file-storage.md](16-file-storage.md)                             | Secure object storage, uploads, access, retention              |
| 17    | [17-background-jobs.md](17-background-jobs.md)                       | Scheduled/idempotent jobs                                      |
| 18    | [18-api-architecture.md](18-api-architecture.md)                     | REST API boundaries, authorization, errors                     |
| 19    | [19-frontend-architecture.md](19-frontend-architecture.md)           | Public booking app, owner/admin dashboards                     |
| 20    | [20-admin-architecture.md](20-admin-architecture.md)                 | Admin and Super Admin surfaces and permissions                 |
| 21    | [21-reporting-pdf.md](21-reporting-pdf.md)                           | Reports, exports, PDF generation rules                         |
| 22    | [22-audit-logging.md](22-audit-logging.md)                           | History/audit stores, retention, deletion rules                |
| 23    | [23-error-handling.md](23-error-handling.md)                         | Error taxonomy and exposure rules                              |
| 24    | [24-observability.md](24-observability.md)                           | Logs, metrics, tracing, alerting                               |
| 25    | [25-performance-scalability.md](25-performance-scalability.md)       | Performance principles, indexes, caching, limits               |
| 26    | [26-backup-recovery.md](26-backup-recovery.md)                       | Backups, restore, DR (recommended targets)                     |
| 27    | [27-deployment-environments.md](27-deployment-environments.md)       | Environments, config, releases, rollback                       |
| 28    | [28-testing-strategy.md](28-testing-strategy.md)                     | Test strategy incl. mandatory concurrency tests                |
| 29    | [29-security-threat-model.md](29-security-threat-model.md)           | Practical threat model                                         |
| 30    | [30-architecture-traceability.md](30-architecture-traceability.md)   | REQ-001 … REQ-232 → architecture mapping + audit               |

## Decision records

Architecture Decision Records live in [`adr/`](adr/README.md) — ADR-001 … ADR-012 — each linked to the design doc it drives.

## Version history

| Version             | When       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.0.0               | 2026-09-05 | Prompt 06: initial architecture & technical design set (30 docs + 12 ADRs).                                                                                                                                                                                                                                                                                                                                                                                        |
| **1.0.1** (current) | 2026-09-05 | Prompt 06-CORRECTION: (1) unique slot-lock index reworded as defense-in-depth for duplicate exact identities — advisory lock + in-transaction overlap re-check are the primary overlap controls (docs 07/08, ADR-004); (2) ALLOCATED slot-lock state formally defined (doc 09 §4.1); (3) customer rejected-booking resubmission secured via phone-scoped one-time verification + rate limiting/abuse controls (docs 06/07/08/11/18). No product decisions changed. |

Corrected documents carry `Architecture Version: 1.0.1`. Others remain 1.0.0.

## Technology stack (summary — see 01-architecture-overview §4 and ADR-001)

- **Frontend:** React 18 + TypeScript + Vite, React Router, TanStack Query, Zustand, Tailwind CSS
- **Backend:** Node.js 20 LTS + NestJS (modular monolith), TypeScript
- **API:** REST/JSON (OpenAPI 3.1), mounted under `/api/v1`
- **Database:** PostgreSQL 16
- **ORM / migrations:** Prisma ORM + Prisma Migrate; raw SQL for lock-sensitive operations
- **Cache:** Redis 7 (rate limits, session tokens, idempotency keys, short-TTL caches)
- **Queue:** BullMQ on Redis
- **Object storage:** S3-compatible (AWS S3; MinIO in local/dev)
- **Email:** `MailProvider` abstraction (Amazon SES default; SMTP adapter)
- **Telegram:** Telegram Bot API (webhook in hosted envs, long-polling in dev)
- **PDF:** PDFKit (server-side)
- **Auth:** opaque hashed session tokens in DB + Argon2id + HTTP-only cookies; TOTP-ready
- **Observability:** pino (JSON logs), Prometheus + Grafana, optional OpenTelemetry, Sentry
- **Testing:** Vitest, Supertest, Testcontainers, Playwright, concurrency harness
- **Deployment:** Docker containers; managed Postgres/Redis/S3 in production

## Cross-cutting rules

1. **No product rule is introduced, weakened, or reopened.** Any unavoidable ambiguity is reported as an **ARCHITECTURE ISSUE** in `01-architecture-overview.md §8` and the traceability doc, never silently resolved as a product decision.
2. **Documentation is the source of truth** (`01-master-specification.md`, v0.5.0).
3. All architecture docs carry architecture version, source spec version, date, status.
4. Traceability target: `232/232` REQ mapped or explicitly "no architectural impact".
