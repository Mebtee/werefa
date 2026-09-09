# 26 — Backup & Recovery

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06
> Cross-cutting. Design goals: RPO/RTO defensible, integrity to REQ-121/REQ-175 (history for all time), restorable sets aligned with the tenancy model.

## 1. Data to back up

| Store         | Backup                    | Notes                                                                                                           |
| ------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| PostgreSQL 16 | full + PITR (WAL)         | includes history/audit; primary source of truth for bookings/documents                                          |
| Redis 7       | — (disposable derivation) | rebuilt from DB; no durable bookings live in Redis. Back up queue metadata only if ops value; otherwise ignore. |
| S3 objects    | versioning + lifecycle    | proofs, logos/covers, generated PDFs; replication configured.                                                   |
| Env/secrets   | KMS/env store             | external provider copies.                                                                                       |

## 2. PostgreSQL strategy

- **Schedule:** full `pg_dump`/managed snapshot daily (retain 14 d) + **continuous WAL/PITR** (Retention 30 d) enabling point-in-time restore to any minute — critical because booking/history are immutable and penalties for loss are severe (R175).
- **Snapshot storage:** region-paired cold bucket with SSE; restore drills quarterly (tested; doc 28).
- **RPO target:** ≤ 5 min (WAL). **RTO target:** ≤ 1 h for full restore; ≤ 15 min for single-tenant logical restore (rare).
- **Managed Postgres** where available (RDS/Aurora) → automated snapshots + PITR; self-host docs include WAL archiving via archive 2 S3.

## 3. Multi-tenant restore nuance

- Full restore restores all tenants (typical).
- Single-tenant logical restore only when explicitly needed (e.g., audit/legal) — performed under the same RLS-consistent load; never partial-restores that could break cross-tenant referential consistency.
- RLS/BYOK: encrypted columns (TOTP secret) are encrypted at rest; backups of ciphertext are only useful with the KMS key restored separately.

## 4. Restore procedure (runbook outline — companion ops doc)

1. Declare incident; stop writes (read-only gate) if PITR target must be precise.
2. Restore target cluster to the intended instant (snapshot + WAL replay).
3. Verify checksums: `pg_checksums`/restored-data integrity; run a canary query (booking count per business matches last-known).
4. Point app to restored cluster; shrink verification via staging first.
5. Reset any app-side tokens that were not restored (optional; sessions are DB-derived so they restore consistently).
6. Confirm S3 objects stable (or re-export any missing proofs via a documented gap report + owner resubmit path).

## 5. Integrity/immutability guarantees aided by restore

- History/audit never purged (R175) → PITR recoverability matches the "for all time" design.
- Advisory-lock retry and guarded transitions make restore-to-older-point safe for correctness (a restored booking claim that was already committed is reconciled against slot locks; redundancy is worse than loss but PITR window is minutes).

## 6. Retention & DR

- Regional-primary + cross-region replica (managed) with failover procedure (doc 27 deployment/DR).
- Backup copies encrypted (KMS), immutable (object lock) for compliance (proofs, history).
- Restore drills quarterly with a documented restore report in ops.

## 7. Testing the backup

Doc 28 includes backup-restore test: snapshot + PITR restore in CI staging; verify data counts and RLS still pass; app smoke test after restore.
