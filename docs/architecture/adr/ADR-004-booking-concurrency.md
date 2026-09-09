# ADR-004 — Booking Concurrency (Advisory Lock + Unique Partial Index)

> **Architecture Version:** 1.0.1 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** ACCEPTED — PROMPT 06 (+ Prompt 06-CORRECTION 1 — unique-index role clarified to defense-in-depth for duplicate exact slot identities; advisory lock + in-transaction overlap re-check are the primary controls for overlapping windows)

## Context

REQ-121: slot claim must be atomic — exactly one winner. Multiple customers can submit the same slot concurrently; we need a race-proof, single-winner guarantee plus a clear loser result (`SLOT_UNAVAILABLE`), not an error.

## Decision

In the booking-submission transaction (READ COMMITTED):

1. Take `pg_advisory_xact_lock(hashtext(business_id::text))` — serializes booking mutations **per business** to bound contention to one tenant's hot spot (doc 08 §3). This is the **mandatory primary** serialization control.
2. Re-check overlaps across active bookings and active slot_locks for the candidate window **inside the transaction after acquiring the lock** (doc 08 §4). This authoritative check is what prevents two different-but-overlapping windows.
3. Insert `slot_lock` + booking + payment; the **defense-in-depth partial unique index** `uq_slot_lock_active (business_id, slot_date, start_at) WHERE status IN ('LOCKED','ALLOCATED')` guarantees at most one active lock _per exact slot identity_ (duplicate slot-lock identities) — it does **not** detect different-but-overlapping windows (doc 08 §1).
4. Idempotency: unique `payment_proof.submission_key` so retries/submission_key reuse never double-books (doc 08 §6).
5. Bounded retries on serialization errors (`40001`/`40P01`); guarded transitions (rowcount=1) for all owner actions using the same advisory lock (doc 08).

## Alternatives considered

- Pure optimistic retry on the partial index alone: rejected — an index on an exact window cannot prevent two _different-but-overlapping_ windows; the advisory lock is the primary control giving deterministic winner/failure semantics and a single serialization source for all slot mutations (claims, cancellations, releases, reschedules).
- Per-slot row lock (SELECT FOR UPDATE on a locks table): practical but fragile to write and less explicit than a lock+guard pair; the partial index still adds the defense-in-depth duplicate-identity guarantee.

## Consequences

- Deterministic exactly-one-winner semantics: the advisory lock serializes mutations and the authoritative in-transaction overlap check prevents overlapping windows; the partial unique index is the defense-in-depth constraint for duplicate exact slot identities. Concurrency is intentionally serialized per business (doc 25 §5).
- Proof-of-work tests mandatory (doc 28 §2) with six scenario diagrams (doc 08 §7.1–7.6).
- Traceability PRE-REQUirement REQ-121 met; no double booking possible.

## Linked docs

08-Booking Concurrency; 07-Database Design; 28-Testing §2.
