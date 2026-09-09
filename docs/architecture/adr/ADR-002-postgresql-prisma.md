# ADR-002 — PostgreSQL 16 + Prisma

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** ACCEPTED — PROMPT 06

## Context

Need a relational, transactional store for immutable history, RLS-able tenants, advisory locks, PITR backup, and minute-precision timestamps (REQ-226).

## Decision

**PostgreSQL 16** as the single system of record; **Prisma ORM** for schema, queries, and migrations (`prisma migrate deploy`, doc 27). Raw SQL (`$queryRaw`) is used where locks and the partial unique index are required (doc 07/08). TIMESTAMPTZ throughout; money in minor units; CHECK constraints enforce payment method and status sets (doc 11).

## Alternatives considered

- MySQL/MariaDB: no `pg_advisory_xact_lock`, weaker partial indexes/RLS support, different PITR story. Rejected.
- NoSQL (document) store: transactional booking integrity + unique cross-row constraints and history would be harder; rejected.

## Consequences

- RLS is available for defense-in-depth (doc 04), advisory locks for slot serialization (doc 08), WAL/PITR for backup (doc 26).
- Prisma Migrate = versioned, reversible-when-designed DDL; `migrator` role has DDL while `app` runs under RLS.
- Slight friction (raw SQL pockets) is contained to a `locking`/`booking` module; documented.

## Linked docs

07-Database Design; 08-Booking Concurrency; 26-Backup & Recovery; 27-Deployment.
