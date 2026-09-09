# 01 — Architecture Overview

> **Architecture Version:** 1.0.1 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06 (+ Prompt 06-CORRECTION: §7.2 wording adjusted to match corrected concurrency model)
> **Related:** [02-system-context.md](02-system-context.md) · [03-logical-architecture.md](03-logical-architecture.md) · [30-architecture-traceability.md](30-architecture-traceability.md)

## 1. Purpose and scope

This document set converts the approved **Werefa v0.5.0** functional requirements (REQ-001 … REQ-232, Master Specification `docs/01-master-specification.md`) into an **implementation-ready architecture**. It is documentation only:

- **No** application code, migrations, deployment files, or implementation.
- **No** product decisions are reopened; the 14 Prompt 05-FIX decisions and all 232 requirements are the fixed baseline.
- If an architectural concern exposes a genuinely unresolved product point, it is recorded as an **ARCHITECTURE ISSUE** (§8) — product requirements are never silently changed to make architecture easier.

## 2. Product baseline (binding)

The following are **fixed** and every design decision below complies with them:

| Area            | Binding decision                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Product         | Werefa — multi-tenant SaaS scheduling/queue platform (REQ-232)                                                                   |
| Tenancy         | Shared-schema multi-tenancy; one business = one tenant; per-tenant rows bounded by `business_id`                                 |
| Booking entry   | Public booking page only; QR/slug; no Telegram bookings (REQ-045, REQ-059)                                                       |
| Customers       | No platform account (REQ-040); identified by phone (REQ-109)                                                                     |
| Telegram        | Optional for customers (REQ-056); notifications only if connected                                                                |
| Booking states  | Payment Pending, Confirmed, Rejected, Completed, No Show, Cancelled (REQ-101)                                                    |
| Payment states  | Pending, Accepted, Rejected only (REQ-100, SM-12)                                                                                |
| Slot lock       | Created only on successful proof submission; atomic first-wins; **no expiry/TTL**; explicit release rules (REQ-121, OQ-SLOT-001) |
| Terminal states | Completed and No Show permanently terminal (SM-10)                                                                               |
| Roles           | Super Admin (1), Admin (2), Business Owner, Customer, System (REQ-036–044)                                                       |
| Subscription    | Standard monthly; 30-day trial; 3-d trial grace; 30-d paid; 5-d paid grace; proof review by the 2 Admins                         |
| Timezone        | One global fixed timezone; 24h; YYYY-MM-DD; minute precision; timezone abbrev only in dashboard displays                         |
| Categories      | Salon & Barber, Other (REQ-215)                                                                                                  |
| Payment methods | Bank Transfer, Telebirr / mobile money; no custom methods this phase (OQ-PAY-001)                                                |

## 3. Architecture principles

1. **Modular monolith, clear boundaries.** One deployable backend with strongly separated modules (bounded contexts). Microservices are not justified at this product's scale and would add distributed-consistency cost.
2. **Database is the source of truth for risks.** Booking slots, locks, payments, history, and subscriptions are transactional and auditable; Redis is a cache/queue, never the source of truth.
3. **Availability and booking decisions are transactional.** Availability is computed by the scheduling engine; claiming a slot is an atomic database operation (see `08-booking-concurrency.md`).
4. **Async side effects.** Notifications, emails, PDFs, reminders are asynchronous and must **never** block booking/payment transactions. External delivery failure never corrupts bookings.
5. **Tenant isolation by construction.** Every tenant-owned read/write path filters by `business_id`; RLS is defense-in-depth; background jobs carry tenant context.
6. **Idempotency everywhere.** Booking submission, webhooks, and every job tolerate duplicates.
7. **Auditability is a feature.** Every state transition and sensitive action writes an immutable history record with actor/timestamp/previous/new state.
8. **Simplicity before scale.** No premature sharding, event sourcing frameworks, or serverless sprawl.

## 4. Technology selection (final stack)

| Concern            | Selected                                                                                          | Why (primary rationale)                                                                                                  | Alternatives considered                | Tradeoff / implication                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| Frontend framework | **React 18 + TypeScript + Vite**                                                                  | Large ecosystem; type safety; two apps (public + dashboard) share one UI kit; rapid iteration                            | Next.js, Vue, Svelte                   | SPA + REST is a good fit; needs explicit session handling (cookie-based)                     |
| Backend runtime    | **Node.js 20 LTS + NestJS**                                                                       | Structured modular monolith; DI + module boundaries fit the bounded-context model; TypeScript shared types with frontend | Fastify, Express raw, Go, Django       | Heavier than minimal Express; gained structure for auditing/tenancy safeguards               |
| Language           | **TypeScript** (strict)                                                                           | Shared types FE/BE; safety on domain invariants; ecosystem                                                               | JavaScript, Java, C#                   | Compile-time safety; runtime perf acceptable for workload                                    |
| Database           | **PostgreSQL 16**                                                                                 | ACID transactions, row/advisory locks, unique partial indexes, RLS, JSONB for flexible settings, PITR                    | MySQL, SQLite, Mongo                   | Chosen for concurrency + RLS + audit quality                                                 |
| ORM                | **Prisma ORM**                                                                                    | Type-safe queries, schema-driven, first-class migrations                                                                 | TypeORM, Drizzle, Knex                 | Lock-critical operations use raw SQL (`SELECT … FOR UPDATE`, advisory locks) via `$queryRaw` |
| Migrations         | **Prisma Migrate**                                                                                | Schema ↔ migration diffing, reviewable SQL                                                                               | node-pg-migrate, Flyway                | Applied in CI/staging before prod; never auto-run in prod                                    |
| Cache              | **Redis 7**                                                                                       | Rate limiting, idempotency keys, session token cache, short-TTL availability snippets                                    | in-memory only, Memcached              | Not a source of truth; cache loss must never corrupt bookings                                |
| Queue              | **BullMQ** (Redis)                                                                                | Durable delayed jobs (reminders, resume, completion, retries), retry/backoff, stalled-job handling                       | pg-boss, RabbitMQ                      | Adds Redis dependency; mitigated because Redis is already present                            |
| Object storage     | **S3-compatible** (AWS S3; MinIO local)                                                           | Proof images/PDFs, logos, cover, generated PDFs; presigned URLs; versioning/lifecycle                                    | local disk, DB blobs                   | DB stays lean; object lifecycle/retention handled by S3                                      |
| Email              | **`MailProvider` interface**; Amazon SES default, SMTP adapter                                    | Provider-agnostic; SES simple and cheap; outbox pattern for reliability                                                  | SendGrid, Postmark                     | Unified outbox → provider adapter; provider swap is config-only                              |
| Telegram           | **Telegram Bot API** (webhook; long-poll fallback)                                                | Only sanctioned channel for a defined notification set; simple HTTP                                                      | (no realistic alternative)             | Treated as secondary channel; customer-optional                                              |
| PDF                | **PDFKit** (server-side)                                                                          | Structured tabular reports (history, schedule versions); no headless-browser dependency                                  | Playwright, weasyprint                 | Enough for deterministic tables; fonts embedded for portability                              |
| Auth/session       | **Argon2id + opaque DB-backed session token in Hashed form (SHA-256) in HTTP-only Secure cookie** | Strong hashing; revocable server-side sessions (needed for logout-everywhere & force logout); TOTP-ready                 | JWT, Passport-local w/ express-session | DB round-trip per request is acceptable; sessions revocable                                  |
| API style          | **REST/JSON, OpenAPI 3.1** under `/api/v1`                                                        | Simple, cacheable, versioned; matches SPA needs; webhook-friendly                                                        | GraphQL, gRPC                          | Fine-grained authz per endpoint upheld by guards + tenant scope                              |
| Deployment         | **Docker containers; managed Postgres/Redis/S3; nginx/CDN for web**                               | Reproducible envs; manageable ops                                                                                        | Lambda, Kubernetes                     | K8s deferred until scale demands; compose + managed services now                             |
| Observability      | **pino JSON logs, Prometheus + Grafana, optional OTel traces, Sentry**                            | Structured logs avoid secrets; metrics for jobs/externals; alerting                                                      | ELK, Datadog                           | Keep audit logs separate from app logs                                                       |
| Testing            | **Vitest, Supertest, Testcontainers, Playwright, concurrency harness**                            | Fast unit + real-Postgres integration + E2E; concurrency tests mandatory                                                 | Jest, Cypress, k6                      | Concurrency verified against real Postgres (locking behavior)                                |
| Rate limiting      | Redis-based fixed/IP + per-account                                                                | Public booking abuse control (threat model)                                                                              | nginx-only                             | App-level so webhooks/APIs share limits                                                      |

**Requirement impact:** the stack adds no new product requirements; it satisfies REQ-001 (SaaS), REQ-024 (email/password), REQ-100/102/103 (state), REQ-121 (atomic slot), REQ-177/178 (reports), REQ-014/019 (multi-business context), REQ-026–035 (auth), REQ-142 (email+Telegram), REQ-222–226 (timezone/precision).

## 5. ADR index

Full records in `docs/architecture/adr/` (12 ADRs): **ADR-001** technology stack · **ADR-002** PostgreSQL as primary store · **ADR-003** shared-schema multi-tenancy + RLS · **ADR-004** booking concurrency (advisory xact lock + unique partial index) · **ADR-005** slot-lock implementation · **ADR-006** background-job architecture (BullMQ) · **ADR-007** S3 file storage with presigned URLs · **ADR-008** DB-backed sessions + Argon2id (no JWT) · **ADR-009** Telegram webhook integration (secondary, never transactional) · **ADR-010** REST API + modular monolith · **ADR-011** PDFKit report generation · **ADR-012** deployment: containers + managed services. See `docs/architecture/adr/README.md`.

## 6. Document map

`02` system context · `03` logical modules · `04` tenancy · `05` domains · `06–07` data/DB · `08` concurrency (critical) · `09` state machines · `10` scheduling · `11` payments · `12` Telegram · `13` notifications · `14` auth/security · `15` subscription/pause · `16` files · `17` jobs · `18` API · `19` frontend · `20` admin · `21` reporting/PDF · `22` audit · `23` errors · `24` observability · `25` performance · `26` backup · `27` deployment · `28` testing · `29` threat model · `30` traceability.

## 7. Key decisions snapshot

1. **Shared-schema tenancy** with `business_id` on every tenant row + RLS (ADR-003).
2. **Advisory transaction lock per business** serializes booking-proof submissions and the authoritative in-transaction overlap re-check prevents overlapping windows; the unique partial index is **defense-in-depth** for duplicate exact slot identities (ADR-004).
3. **Slot lock is a durable DB row**, no expiry, no TTL — released only by workflow actions (ADR-005).
4. **State transitions are transactional + idempotent** with an append-only history event per transition.
5. **Availability is computed** from the active schedule version + bookings + locks; never cached as truth beyond short TTL snippets (REQ-050).
6. **Notifications/emails/PDFs/reminders are async**; external failures never roll back bookings (ADR-006).
7. **DB-backed sessions** for revocable logout-everywhere and force-logout (ADR-008).

## 8. Architecture issues requiring product decision

**None raised by this architecture pass.** Product requirements (v0.5.0, 232 REQs, 14 Prompt 05-FIX decisions) are implementable without inventing or reopening product rules. Where implementation detail is configurable (file-size limits, retry counts, min/max report ranges), it is marked as a **configurable architectural parameter** and defaults are explicitly not product decisions. Any future finding will be logged here before any product requirement is touched.
