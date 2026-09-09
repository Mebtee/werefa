# ADR-006 — Background Jobs (BullMQ on Redis)

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** ACCEPTED — PROMPT 06

## Context

Need asynchronous, retryable, durable processing for reminders (R63/R64), completion (R102), pause/resume (R153/154/155), subscription transitions, notification delivery, reporting, and cleanup — all idempotent, retry-safe, observable, tenant-aware (doc 17).

## Decision

**BullMQ on Redis 7** as the job broker/worker library. Jobs carry deterministic job ids and every job is written to be safe under duplicate execution (guarded transitions + idempotency keys + time-window checks). `notification_delivery` rows are the durable intent; provider sends are deduplicated by `idempotency_key`. Dead-letter queue + reconciler for failures (doc 17 §2/§4).

## Alternatives considered

- Node built-in timers + DB poll: rejected — no distribution/retry instrumentation, hard deadlines across replicas.
- Kafka/SQS: rejected — overkill for this scale; BullMQ gives delayed jobs, worker pools, stalled-job detection for free.

## Consequences

- Correct-by-construction under retries/duplicates (documented "run twice" behavior, doc 17 §4).
- Redis is disposable for queues (rebuildable), but that is acceptable because domain correctness lives in Postgres (doc 26 §1).
- Enables horizontal worker scaling later (doc 25 §3).

## Linked docs

17-Background Jobs; 13-Notification; 15-Subscription.
