# ADR-005 — Slot Lock as a Durable Row (No TTL / No Cache)

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** ACCEPTED — PROMPT 06

## Context

REQ-052/53: a slot stays available until the customer submits a valid payment proof; a second customer must get "unavailable". There is **no expiry window** in the product (OQ-SLOT-001/REQ-121 related). Slot locks must survive process restarts, be visible in reports, and never be lost by caching.

## Decision

`slot_lock` is a **durable PostgreSQL row** with statuses `LOCKED`/`ALLOCATED`/`RELEASED`, identity `(business_id, slot_date, start_at, end_at)`, keyed by the partial unique index (ADR-004). No TTL, no Redis-based reservation, no ephemeral lock. Availability reads ignore active locks (REQ-051); claims create LOCKED on submission and ALLOCATED on acceptance. Release is explicit (owner action, SM-08/09) and recorded in history (doc 09).

## Alternatives considered

- Redis TTL reservations: rejected — Redis is a disposable cache; losing a reservation could double-book; expiry semantics contradict the "no expiry" product rule.
- In-memory/process-local locks: lost on restart/replica; rejected.

## Consequences

- Locks survive restarts, are tenant-scoped and RLS-covered, and compose with PITR backup (doc 26).
- Avoids stale-cache double booking (doc 08/10); the index guarantees one active lock per slot.
- Slight write amplification (an extra row per claim) is acceptable and testable.

## Linked docs

08-Booking Concurrency; 07-Database Design; 09-State Machines.
