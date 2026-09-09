# ADR-007 — S3-Compatible File Storage

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** ACCEPTED — PROMPT 06

## Context

Files: customer payment proofs (R117/118), subscription proofs (R136), business logo/cover (R208/209), generated report PDFs (R170/178). Proofs must **never** be publicly accessible (doc 16 §6); uploads must be safe; local dev must not depend on a commercial provider.

## Decision

**S3-compatible object storage** — AWS S3 in prod, **MinIO** locally/in CI (doc 27). Categories partition buckets/prefixes; private categories (proofs, report PDFs) are only ever reachable via short-lived presigned GETs re-authorized per request; public kinds (logo/cover) serve via CDN. Uploads are staged then committed with the domain transaction (orphan cleanup, doc 16 §5). Type allow-list + magic-byte checks (doc 16 §3).

## Alternatives considered

- Filesystem/DB blob storage: rejected — weak scaling, backup coupling, awkward CDN; DB stays lean.
- Full-blown malware-scanning gate as mandatory: deferred to a configurable hook (doc 16 §4) to keep flow simple while allow-lists materially reduce risk.

## Consequences

- Proofs are not URL-guessable nor public (hard rule, doc 16 §6); report PDFs are request-scoped.
- Versioning + lifecycle rules give retention control (doc 16 §7).
- Tests use Testcontainers' MinIO; no provider dependency in CI.

## Linked docs

16-File Storage; 26-Backup & Recovery; 27-Deployment.
