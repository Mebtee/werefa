# Architecture Decision Records (ADR)

> **Architecture Version:** 1.0.1 (ADR-001…003, 005…012 remain 1.0.0; **ADR-004 corrected to 1.0.1** by Prompt 06-CORRECTION)
> **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06

## What is here

ADRs capture the **why** behind key architectural choices. Each links to the design doc(s) it drives. Status: `ACCEPTED` (adopted for Prompt 06). If a decision is revisited, the old ADR is superseded, never edited in place.

## Index

| ADR     | Title                                                      | Primary design doc          |
| ------- | ---------------------------------------------------------- | --------------------------- |
| ADR-001 | Technology stack                                           | 01-Architecture Overview §4 |
| ADR-002 | PostgreSQL 16 + Prisma                                     | 07-Database Design          |
| ADR-003 | Shared-schema tenancy + RLS                                | 04-Tenant Isolation         |
| ADR-004 | Booking concurrency (advisory lock + partial unique index) | 08-Booking Concurrency      |
| ADR-005 | Slot lock as durable row (no TTL)                          | 08-Booking Concurrency      |
| ADR-006 | Background jobs (BullMQ)                                   | 17-Background Jobs          |
| ADR-007 | S3-compatible file storage                                 | 16-File Storage             |
| ADR-008 | DB-backed opaque session tokens                            | 14-Auth & Security          |
| ADR-009 | Telegram webhook integration                               | 12-Telegram                 |
| ADR-010 | REST/JSON modular monolith API                             | 18-API Architecture         |
| ADR-011 | Observability stack                                        | 24-Observability            |
| ADR-012 | Deployment (Docker + managed services)                     | 27-Deployment Environments  |

## Decision linkage

Every ADR is mapped to requirements in `30-Architecture Traceability` (the "Design document" column), and the decisions appear as **Architecture Issues = 0** in `01-Architecture Overview §8` — meaning no product requirement was changed by these choices.

## Corrections applied (Prompt 06-CORRECTION)

| ADR                         | 1.0.1 change                                                                                                                                                                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-004 booking concurrency | Unique partial index reworded from "backstop"/"durable guarantee" to **defense-in-depth for duplicate exact slot identities**; advisory lock + in-transaction overlap re-check are the primary controls for overlapping windows. Decision otherwise unchanged; REQ-121 guarantee intact. |

No other ADR was materially affected (ADR-005's reference to LOCKED/ALLOCATED remains valid under the formal ALLOCATED definition in doc 09 §4.1).
