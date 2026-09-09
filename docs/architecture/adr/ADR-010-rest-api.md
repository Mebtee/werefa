# ADR-010 — REST/JSON + Modular Monolith API

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** ACCEPTED — PROMPT 06

## Context

A single backend serves the public booking flow, the owner dashboard, the Admin and Super Admin dashboards, the Telegram webhook, and reporting. Multiple actor types + clear scope rules (R036–044) need an explicit, testable surface.

## Decision

**REST/JSON** under `/api/v1`, OpenAPI 3.1 generated, typed clients regenerated per change; **NestJS modular monolith** with 20 modules (doc 03) mapped to domains. Envelope error format, role guards, tenant guards, idempotency keys where needed, Redis rate limiting (doc 18 §1/§4).

## Alternatives considered

- Microservices: premature distribution cost; monolith keeps transaction boundaries and the one-authority rule simple (doc 25 §3).
- GraphQL: rejected for role-scoped, cacheable, auditable REST surface and simplicity of contract tests.

## Consequences

- One deployable API + workers; single place for guards and audit; OpenAPI acts as the contract (doc 18 §5).
- Breaking change path = `/api/v2` later; no version churn now.

## Linked docs

18-API; 03-Logical Architecture; 23-Error Handling; 28-Testing.
