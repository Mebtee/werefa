# ADR-011 — Observability (pino / Prometheus / Grafana / OTel / Sentry)

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** ACCEPTED — PROMPT 06

## Context

Distributed-ish (API + workers + Redis + Postgres + S3) system with async notifications and background jobs needs logs, metrics, tracing, and error tracking that respect tenant boundaries and PII (doc 24).

## Decision

- **pino** structured JSON logs with redaction of secrets/PII (doc 24 §1).
- **Prometheus** metrics + **Grafana** dashboards (HTTP, booking funnel, concurrency, notifications, workers, infra) + Alertmanager rules (doc 24 §2/§5).
- **Sentry** for both SPAs and the NestJS API for error tracking with PII scrubbing (doc 24 §4).
- **OTel** tracing enabled via `OTEL_ENDPOINT` config (optional export; disabled by default in self-host).
- Health probes `/health/live`, `/health/ready` (doc 27 §5).

## Alternatives considered

- Single vendor APM only: rejected — cost + we need open dashboards/data locality options.
- Log-only observability: rejected — no SLO/metrics story.

## Consequences

- Ops can answer "which tenant/queue/job" questions; alerts wired to runbooks (doc 24 §7).
- Redaction is centralized; audit/history data is never sampled (doc 24 §1).

## Linked docs

24-Observability; 27-Deployment; 29-Threat Model.
