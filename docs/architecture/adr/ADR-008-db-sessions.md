# ADR-008 — DB-Backed Opaque Session Tokens

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** ACCEPTED — PROMPT 06

## Context

REQ-024/34/35 + lock/revocation (R193–R197, R220/R221): dashboard sessions must be secure, revocable, revocable-en-masse on password change, and inspectable for security events, without client-visible secrets. 2FA (R34) is phase-1-ready only.

## Decision

No JWT for sessions. On login: generate an **opaque 256-bit token**, store only its **SHA-256** in `session.token_hash`; return the raw token in an **HttpOnly, Secure, SameSite=Lax** cookie. Server resolves by hash; supports revocation (`revoked_at`), password-change revocation (R35), forced logout (R220), `active_business_id` caching, login records (R191/192) and new-device events (R197). DB-backed = instantly revocable and auditable.

## Alternatives considered

- JWT: rejected — cannot revoke pre-expiry (conflicts with R35/R220/R221), harder to reconcile with security-event retention (R191/192/197), secret on client.
- Redis-only sessions: rejected — loss on failover logs everyone out; DB provides durability + audit.

## Consequences

- One extra index lookup per request (acceptable); revocation is instant and global.
- Cookie flags minimize XSS/CSRF exposure (doc 14 §2/§5); TOTP-ready schema is encryption-ready for Phase 2 (doc 14 §1).

## Linked docs

14-Auth & Security; 22-Audit & History; 24-Observability.
