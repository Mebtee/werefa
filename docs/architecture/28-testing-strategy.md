# 28 — Testing Strategy

> **Architecture Version:** 1.0.1 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06 (+ Prompt 06-CORRECTION: §2 scenario 5 wording aligned with corrected concurrency model)
> Cross-cutting; ADR-001 tooling (Vitest, Supertest, Testcontainers, Playwright). **Concurrency testing is mandatory** (per Prompt 06).

## 1. Test pyramid

| Layer            | Tool                                                              | Scope                                                                                                                                        | Runs                       |
| ---------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Unit             | Vitest                                                            | pure functions: availability algorithm (doc 10), state machine transitions (doc 09), validation rules, reporting column builders, money math | CI each commit             |
| Integration (DB) | Vitest + Testcontainers (Postgres 16)                             | repository/service seams, RLS, guarded transitions, idempotency, tenant scope                                                                | CI each commit             |
| API contract     | Supertest against real NestJS app + Postgres/Redis testcontainers | endpoint behavior from doc 18                                                                                                                | CI each commit             |
| E2E (SPA)        | Playwright                                                        | public booking flow, dashboard flows, role routes                                                                                            | CI (staging-of-dockerized) |
| Perf             | k6 (optional) + targeted                                          | doc 25 SLOs; availability/booking hot paths                                                                                                  | nightly where scheduled    |
| Concurrency      | Vitest + Postgres                                                 | **mandatory** scenarios (below)                                                                                                              | CI each commit             |

## 2. Mandatory concurrency scenarios (doc 08)

Running against a real Postgres (state persisted; RLS real):

1. **Successful first submission:** N parallel customers submit for the **same free slot(s)** with different picks → exactly 1 wins per slot; winners Produce booking + slot_lock + payment rows; losers get `SLOT_UNAVAILABLE`; no lost updates.
2. **Losing concurrent submission:** a second booking for the same slot that arrives into the same window is rejected (retry won't help); guard ensures no double booking (REQ-121).
3. **Rejected → resubmission:** pending booked → rejected; resubmission with new valid proof succeeds and slot remains occupied (SM-09).
4. **Owner cancellation while Payment Pending:** cancel (SM-08) vs a concurrent claim of the freed slot → no conflicting state; slot remains blocked after cancel.
5. **Owner release of blocked slot:** explicit release vs overlapping claim → only one succeeds (advisory lock serializes; overlap re-check rejects; index defends duplicate identities).
6. **Owner reschedule:** concurrent reschedule of a booking while a different customer tries the same new slot → serialization correct (T7).
   Verification: assert row-level invariants (slot_lock uniqueness, booking set, payment statuses) plus no 500s / no insertion conflicts surfacing as user-level errors.

## 3. RLS/tenant tests

Cross-tenant access matrix: owner → own only; admin → configured scope; super-admin → all; direct DB client with `app` role must respect RLS for every tenant table (list of tables from doc 07). No id-only lookups leak rows (doc 04 §5 §6).

## 4. Idempotency tests

- `submission_key` duplicates: second POST is no-op/safe.
- Job double-run: each job in doc 17 §2 re-run → no duplicate notifications (delivery dedup), no double transitions, no double emails (doc 13 §3).
- Telegram `update_id` duplicates.

## 5. State machine tests

Full test for T1–T10: legal transitions succeed + history appended; illegal transitions return `INVALID_TRANSITION` and leave state unchanged (doc 09).

## 6. Scheduling tests

Doc 10 §7: precedence table row-by-row; special-date vs weekly; blocked overlays; duration fits; global-TZ conversions; date-boundary crossing.

## 7. Targeted perf suite (nightly)

- Availability window 60 days × slotted grid; booking burst on one slot; long-history report generation; 1k businesses regression on common queries (doc 25 §4).

## 8. Backup-restore test

Doc 26 §7: CI-style drill in staging — snapshot, PITR restore to T-5m, verify counts + RLS + smoke.

## 9. Security test links

Doc 14 §6/29 threats → OWASP-style focused tests: unauthorized tenant access, auth bypass, upload boundary, webhook spoof, session fixation/revocation, brute-force lockout, rate limiting codes.

## 10. Coverage gates (architectural)

- Domain transitions (doc 09) and scheduling engine: 100% branch coverage gate.
- Tenant-scope matrix: every endpoint has a cross-tenant test.
- Reporting column exclusions (doc 21 §4) covered by contract tests.
- Fake/earning fixtures never cross-test-boundaries (isolated per-tenant test data).
