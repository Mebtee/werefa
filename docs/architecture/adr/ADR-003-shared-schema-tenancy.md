# ADR-003 — Shared-Schema Multi-Tenancy + RLS

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** ACCEPTED — PROMPT 06

## Context

REQ-001/002: multi-tenant SaaS, each business a separate tenant. Need isolation guarantees (REQ-163/164/187, booking privacy) while staying operationally simple.

## Decision

**Shared schema, shared database**: every tenant-aware table carries `business_id` UUID; `TenantContext` is set per-request/worker; application queries always filter by `business_id`; **PostgreSQL RLS** is enabled as defense-in-depth (the `app` role is NOT bypass; `migrator` is exempt for DDL/deploy). `public_slug` is globally unique (REQ-047). Owner–business links via `business_owner`.

## Alternatives considered

- Schema-per-tenant / DB-per-tenant: stronger isolation, but migration drift, backup, connection, and per-tenant provisioning costs are prohibitive at this scale; not justified now (scaling lever noted in doc 25 but out of scope).
- Blind reliance on app-layer filtering: rejected (single defect = leak); RLS keeps a guaranteed floor.

## Consequences

- Queries are bulk-tenant, cheap to manage; RLS is an invariant tested with a cross-tenant matrix (doc 28 §3).
- Enum-driven tenant tables (services, schedule versions, bookings, payments, proofs, notifications, audit) must all carry and enforce `business_id`.
- Migrations must remain RLS-aware (policy grants applied by `migrator`).
- Extreme growth would revisit isolation (documented as future lever).

## Linked docs

04-Tenant Isolation; 07-Database Design; 28-Testing Strategy §3.
