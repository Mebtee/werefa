# 25 — Performance & Scaling

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06
> Cross-cutting. Target: correctness-first (REQ-121 integrity, REQ-169/170 history) with defined scaling levers.

## 1. Bottlenecks by subsystem

| Subsystem          | Hot path                               | Limiter                                                     |
| ------------------ | -------------------------------------- | ----------------------------------------------------------- |
| Booking submission | availability + overlap + lock + attach | DB tx + advisory lock (doc 08) — per-business serialization |
| Availability reads | public slot query                      | DB + optional Redis TTL cache (doc 10 §6)                   |
| Slot locking       | unique index + advisory lock           | DB                                                          |
| Notifications      | delivery worker                        | provider rate limits (Telegram ≤20/s chat)                  |
| Report generation  | big history scans                      | async jobs + chunked streaming (doc 21)                     |
| Auth               | login/reset                            | rate limiting + lock (doc 14)                               |

## 2. Targets (architectural, not product REQ)

- p95 API < 300 ms at 2× peak est. per business; booking submission p95 < 500 ms including proof upload staging.
- Availability read p95 < 200 ms for a business with ≤60-day window.
- Slot claim correctness is invariant: no double booking ever (REQ-121).
- Bursty: many customers booking the same popular slot → all but one return `SLOT_UNAVAILABLE` (409) quickly.

## 3. Scaling levers (with tradeoffs)

| Lever                               | What it buys                   | Tradeoff                                                                 | When                 |
| ----------------------------------- | ------------------------------ | ------------------------------------------------------------------------ | -------------------- |
| Read replicas (Postgres)            | availability reads scale out   | replication lag — **never** for booking claims (must read leader + lock) | high display traffic |
| Redis availability cache            | offload reads                  | stale display possible (safe; claims revalidate)                         | doc 10 §6 flag on    |
| Vertical DB sizing                  | simpler                        | cost cap                                                                 | default              |
| Worker horizontal scale             | notification/report throughput | distributed locks for job idempotency                                    | on queue depth       |
| Horizontal API replicas (stateless) | request scale                  | none — sessions in DB, cache shared Redis                                | as needed            |
| Partition/shard by business         | extreme growth                 | multi-tenant RLS complexity high; **not for phase 1**                    | future, out of scope |
| CDN                                 | logo/cover                     | cache versions                                                           | always               |

## 4. Query & index strategy

- Indexes in doc 07: `(business_id, start_at)`, `(business_id, status)`, `(business_id, created_at)` for history, `slot_lock` partial unique, `submission_key` unique, `notification_delivery` claim index.
- `EXPLAIN ANALYZE` verified at scale in perf suite (doc 28).
- History/audit queries are report-bound (async), not in request path.

## 5. Concurrency/limits

- Per-business booking tx serialized by `pg_advisory_xact_lock` — geared to correct, not maximum throughput (business-scale is modest; REQ-121 correctness is the binding constraint).
- Availability cache TTL 30–60s; slot claim never cached.
- Rate limits per doc 18; worker concurrency per-doc 17.

## 6. Message/queue profile

- Redis/BullMQ handles delayed reminders, retries; queue preserved across API restarts; dead-letter + reconciler.
- No cross-tenant queued data sent anywhere (doc 04 §8; doc 13 §4).

## 7. Capacity model (phase-1 assumptions)

Modest multi-business (K-tens of businesses, hundreds of bookings/day each) is the design corridor; everything is built to that with documented levers above rather than NoSQL-scale assumptions. Prove SLOs in perf test (doc 28 §7) before enabling replicas/cache at high traffic.
