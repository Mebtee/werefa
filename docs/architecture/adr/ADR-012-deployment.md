# ADR-012 — Deployment (Docker + Managed Services)

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** ACCEPTED — PROMPT 06

## Context

Consistent dev→CI→staging→prod environments with managed data services, migrations run explicitly, zero-downtime API rollout, and DR obligations.

## Decision

**Docker** for all units (`api`, `worker`, `public`, `dashboard`, `migrator`); **managed services** for Postgres (16, PITR), Redis 7, S3 (with cross-region replication) in prod, with MinIO/MailHog/long-poll Telegram in `local`/`dev` (doc 27 §2). Migrations run via `migrator` using `prisma migrate deploy` **before** API rollout; rolling deploy with health gates; HSTS/CSP/secret hygiene; observability wired (ADR-011).

## Alternatives considered

- Full serverless (Lambda etc.): rejected — long-running BullMQ workers and long queries don't fit well; ops model for stateful services grows.
- Manual/staged DB management: rejected — migration safety and RLS/role correctness favor declarative, tested DDL.

## Consequences

- Local/CI equal: Postgres+Redis+MinIO run in containers; feature-flaggable behavior (availability cache, upload scanning).
- Managed Postgres delivers snapshots + PITR for the RPO/RTO targets (doc 26 §2).
- Disaster recovery + failover runbooks live in `ops/` (deploy companion), verified quarterly (doc 26 §6).

## Linked docs

27-Deployment Environments; 26-Backup & Recovery; 24-Observability.
