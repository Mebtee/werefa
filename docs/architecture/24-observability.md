# 24 — Observability

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06
> Binding: cross-cutting; ADR-011 (pino + Prometheus/Grafana + optional OTel + Sentry).

## 1. Logging

- **pino** JSON structured logs across APIs and workers; `requestId` correlation (generated at the edge, propagated via async-context).
- Fields: `ts`, `level`, `msg`, `service`, `requestId`, `businessId` (only when in-scope), `actorId` (id, not email), `job` (worker), `code`.
- **Never logged:** passwords, password hashes, raw session tokens, reset/recovery links, TOTP secrets, bot/webhook secrets, proof object contents, full credit/channel details. Data is redacted at the serializer level (`redact` config) and again in worker error objects.
- Levels: debug (dev), info (normal), warn (retries/rate limits), error (unexpected/5xx), fatal (panics). Request logs at info; 4xx at warn; 5xx at error.
- Sampling for high-volume public endpoints; audit/history **never** sampled.

## 2. Metrics (Prometheus)

| Metric                                                             | Purpose            | Basis          |
| ------------------------------------------------------------------ | ------------------ | -------------- |
| `http_requests_total{route,status}`                                | traffic mix        | edge           |
| `http_request_duration_seconds{route}`                             | latency SLOs       | edge           |
| `booking_submissions_total{result}`                                | booking funnel     | domain service |
| `slot_claim_conflicts_total`                                       | concurrency health | doc 08         |
| `payment_reviews_total` / `subscription_renewals_total`            | review throughput  | services       |
| `notification_delivery_total{channel,status}`                      | integration health | doc 13         |
| `job_run_*` (scheduled/active/failed/duration)                     | workers            | BullMQ         |
| `db_pool_*`, `redis_*`, `s3_*`                                     | infra              | clients        |
| `business_subscriptions_total{status}` / `businesses_paused_total` | product health     | domain         |
| `error_5xx_total`, `sentry_*`                                      | reliability        | Sentry         |

## 3. Tracing (optional)

- OTel collector as an optional export; spans on `http → service → db/redis/bullmq/s3`.
- Session id correlation; context propagation across queue producers/consumers. Disabled by default in self-host; enabled with `OTEL_ENDPOINT` config.

## 4. Error tracking

- **Sentry** in both SPAs + NestJS; source-mapped; environment + release tagging; PII scrubbed by default (email regex/phone redaction in `beforeSend`).
- Error alerts route to ops channel (doc 17 reconciler) + dashboards.

## 5. Dashboards & alerting

- Grafana dashboards: API (request rate/errors/latency), Booking funnel, Concurrency, Notifications, Workers, Business health (subscriptions/pause), Infra (Postgres/Redis/S3).
- Alert rules (Prometheus/Alertmanager): 5xx rate > threshold; slot-conflict burst; dead-letter queue non-empty; worker stalled; notification failure threshold; queue depth; cache/DB latency SLO breach; expired-business gate anomalies.
- Health endpoints exported for probes (doc 27).

## 6. Business-level observability

Pause/resume, subscription, and slot events are first-class metrics; the business gate for bookings is measured so product decisions don't regress (phase-1 datapoints, no revenue).

## 7. Runbooks (summary)

Per-alert runbook pointers: Redis failover, Postgres failover (doc 26), worker stall, dead-letter, notification provider outage, S3 rekey. Step-by-step books stored under `ops/runbooks` (deployment companion — not product-facing).
