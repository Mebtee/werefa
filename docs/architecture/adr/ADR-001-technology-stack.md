# ADR-001 — Technology Stack

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** ACCEPTED — PROMPT 06

## Context

Werefa is a multi-tenant booking SaaS with public + dashboard frontends, a shared backend, async notifications, email, subscription billing review, and reporting. Stack must favor developer velocity, correctness (REQ-121), and a small team.

## Decision

- Frontend: **React 18 + TypeScript + Vite** (two SPAs: public + dashboard), React Router, TanStack Query, Zustand, Tailwind.
- Backend: **Node.js 20 LTS + NestJS modular monolith**, TypeScript strict.
- DB: PostgreSQL 16 + Prisma ORM/Migrate; raw SQL only for locking (doc 08).
- Infra: Redis 7 (cache/queues), BullMQ (jobs), S3-compatible storage (MinIO local), Email via `MailProvider` (SES default/SMTP adapter), Telegram Bot API (webhook prod / long-poll dev).
- Test: Vitest, Supertest, Testcontainers, Playwright.

## Alternatives considered

- Next.js full-stack (rejected: couples frontend to backend, muddles public/dashboard split); Express/Fastify (rejected: no modular structure for 20 modules); MySQL (rejected: weak advisory locks, RLS, JSON/test infra); separate microservices (rejected: premature); Go/Rails (rejected: team/velocity + desired ecosystem).
- GraphQL: REST + OpenAPI chosen (predictable, cacheable, simple role-scoped surface, doc 18).

## Consequences

- Modular monolith keeps clear module boundaries (doc 03) while avoiding distributed complexity (doc 25).
- Prisma raw-SQL escape hatch required for advisory locks and partial unique index (doc 07/08).
- Node 20 LTS aligns tooling across NestJS + Vite; single language for the whole team.
- Serialization of slot claims is intentional (correctness first, doc 08).

## Linked docs

01-Architecture Overview §4; 03-Logical Architecture; 25-Performance & Scalability.
