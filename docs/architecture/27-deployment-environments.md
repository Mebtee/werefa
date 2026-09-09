# 27 — Deployment

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06
> Cross-cutting. Companion to ADR-012 (Docker + managed services). Deployment artifacts and runbooks live in the `deploy/` companion, not `docs/architecture/` (documentation-only deliverable).

## 1. Target topology

```
[ Edge/CDN (static SPA + TLS) ]
        │
[ Load Balancer / ingress ]
        │
   ┌────┴─────────────┐
[ API (NestJS) xN ]  [ Worker (BullMQ) xN ]
        │                    │
   ┌────┴──────────┐    ┌────┴────────┐
[ PostgreSQL 16 ]  [ Redis 7 ]      [ S3 (MinIO local) ]
   (managed, RLS, PITR)   (queues/cache)
[ MailProvider (SES/SMTP) ] [ Telegram Bot webhook ] [ Sentry/OTel/Grafana/Prometheus ]
```

Units: `api`, `worker`, `frontend-public`, `frontend-dashboard`, `migrator` (one-shot DDL), plus infra services. Migrations run explicitly via the `migrator` container before API rollout (Prisma Migrate).

## 2. Environments

| Env       | Purpose                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------- |
| `local`   | Docker Compose: Postgres+Redis+MinIO+SES-SMTP (MailHog); long-poll Telegram; dev SPAs; Vite HMR   |
| `dev`     | temporary; feature verification; seeded data; MinIO                                               |
| `staging` | production-like (managed infra, webhook, real secrets-adjacent) — CI deploy on merge to `staging` |
| `prod`    | guarded deploys; migrations staged; feature-flag launcher                                         |

Config via 12-factor env; a single root config reader validates required vars with typed keys (never build-time SPA secrets).

## 3. Deployment flow (CI/CD)

1. CI: `npm ci` → `lint` → `typecheck` → unit → integration (Testcontainers) → e2e (Playwright) → build.
2. Migrations: `prisma migrate deploy` (idempotent up) via `migrator` **before** API rollout; rollback for `down` migrations documented separately (reversible steps), never automatic destructive `down` in prod.
3. Publish static SPAs to object storage/CDN; invalidate cache.
4. Rollout API/worker replicas (rolling; health-gated) — zero-downtime for API; workers drain gracefully.
5. Post-deploy smoke probes hit health endpoints (doc 24).

## 4. Runtime configuration (architectural)

`APP_ENV`, `DATABASE_URL`, `REDIS_URL`, `S3_*`, `MAIL_*` (provider), `TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET`, `SESSION/SECURITY` params, `OTEL_ENDPOINT`, `SENTRY_DSN`, feature-flag gates (availability cache, notification flags, upload scanning). All secrets from env/secrets manager (doc 14 §5).

## 5. Health & readiness

- `/health/live` (process) and `/health/ready` (DB+Redis+queue reachability) on API and worker; k8s/compose liveness/readiness probes wired.
- Exposed metrics `/metrics` (Prometheus) guarded.

## 6. Observability & logging in prod

pino stdout captured to log backend; Prometheus scraping; Sentry release tagging; OTel optional export (doc 24). Rotation of application logs independent of audit/history.

## 7. Security hardening at deploy

- TLS everywhere (HSTS); CSP; S3 private defaults (doc 16); webhook secret rotation runbook; least-privilege DB roles (`app` RLS / `migrator` DDL, doc 07 §roles); secrets never in images; image scans + SBOM; dependency patch cadence.
- Public booking origin allowed-list; CSRF header enforcement for dashboard writes (doc 14/18).

## 8. Disaster recovery / failover

Managed Postgres failover (read replica → region B) per doc 26; Redis failover (managed); S3 cross-region replication; runbooks in `ops/` (doc 24 §7). RTO/RPO targets from doc 26.

## 9. Release & versioning

SemVer; releases carry migration plan + runbook + changelog; canary for API; no data-affecting migration without a documented, reversible step; PR checklist requires the deployment-impact note.
