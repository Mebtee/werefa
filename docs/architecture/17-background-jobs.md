# 17 — Background Jobs

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06
> Binding: REQ-063/064 (reminders), REQ-102 (completion), REQ-153/154/155/231 (auto-resume), subscription processing, notification retries, cleanup.

## 1. Infrastructure

- **BullMQ on Redis** (ADR-006); jobs have `attempts`, `backoff`, `removeOnComplete`.
- Workers run in the `worker` deployment unit (doc 02); each job also has **in-queue idempotency** (job id = deterministic key), plus **guarded domain transitions** as the real source of idempotency.
- Every job is: **idempotent, retry-safe, observable, tenant-aware**, safe under duplicate execution.

## 2. Job catalog

| Job                             | Schedule/Trigger                            | Action (tenant-scoped)                                                                      | Duplicate-run behavior                                     |
| ------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `booking-reminder-24h`          | delayed at `start_at - 24h`                 | enqueue customer Telegram reminder (R63) if connected + CONFIRMED                           | 2nd run: reminder-deadline check (`now` in window) → no-op |
| `booking-reminder-1h`           | delayed at `start_at - 1h`                  | enqueue customer Telegram reminder (R64) same conditions                                    | same                                                       |
| `booking-complete`              | delayed at `end_at`                         | guarded CONFIRMED→COMPLETED (R102/T4), release slot, history                                | 2nd run: guard fails (terminal) → no-op                    |
| `pause-auto-resume`             | delayed at `resume_at`; repeat on approvals | doc 15 resume logic incl. event recording (R154/R231)                                       | resume idempotency key; 2nd run no-op                      |
| `subscription-state-transition` | daily scan                                  | trial→grace, grace→expired, expiry join (R128–133)                                          | guarded; timestamp-based → no-op                           |
| `subscription-reminder`         | daily scan for imminent expiry              | email + business Telegram (R139), warning flag (R141)                                       | reads `next_attempt_at`                                    |
| `notification-retry`            | every minute                                | process `notification_delivery` rows where `next_attempt_at < now` → SMTP/Telegram (doc 13) | worker-level claim; at-most-once per provider send         |
| `orphan-file-cleanup`           | hourly                                      | delete STAGED objects older than grace (doc 16)                                             | key-based; deletes are idempotent                          |
| `security-retention`            | weekly                                      | purge `security_event` > 1 year (R204); audit the purge (platform-level)                    | guarded by `created_at` bounds                             |
| `report-pdf-generation`         | on demand (SuperAdmin/Owner)                | build PDF → S3 → `report_job` done → notify requester (doc 21)                              | idempotency key on `report_job` row                        |
| `dead-letter-reconciler`        | hourly                                      | inspect failed deliveries beyond max attempts → flag, alert (doc 13)                        | no-op safe                                                 |

## 3. Design guarantees

| Guarantee              | Mechanism                                                                                                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Idempotent             | Deterministic job ids + guarded transitions (expected-state) + unique keys (`submission_key`, `update_id`, resume key, report job key)                                                                                      |
| Retry-safe             | Attempts with exponential backoff; a retried job re-enters the same guarded transition; external calls (email/Telegram) have their own dedup (`idempotency_key`) so send duplication is prevented at the delivery row level |
| Observable             | Structured logs with `jobId`, `businessId`, attempt; Prometheus counters (succeeded/failed/duration); heartbeat stall detection via BullMQ stalled-job handling                                                             |
| Tenant-aware           | Payload carries `businessId`; service methods re-scope to it; RLS applies in worker DB sessions (doc 04 §8)                                                                                                                 |
| Safe under duplication | Two workers may pick the same job → guarded updates mean one wins, other no-ops; provider dedup keys prevent double emails                                                                                                  |

## 4. "What happens if a job runs twice?"

- **Automatic completion:** first run completes (terminal). Second run: `UPDATE … WHERE status='CONFIRMED'` → 0 rows → returns success, no side effect. Notification (if any) is deduped by delivery key.
- **Auto-resume:** first run transitions + records event. Second run: resume guard already `false` → no-op (no second event).
- **Notification retry:** delivery row has a worker claim (`attempting_at` + attempt count); a duplicate claim is skipped; provider send is guarded by `idempotency_key`.
- **Cleanup/reminders:** key- or time-window-based; duplicate execution deletes/skips the same items.

## 5. Observability & alerting

Per job: duration, attempts, results, business distribution; BullMQ stalled-job alerts; dead-letter reconciler alerts; integration failures (Telegram/Email) at threshold; Redis/queue depth metrics. Sensitive fields (tokens, proofs, PII payloads) never logged (doc 24).

## 6. Configuration (architectural parameters — not product requirements)

Job concurrency, backoff schedule, retry counts, orphan grace, security retention lag, reminder lead times (24h/1h are product-fixed), subscription reminder lead days (default 3) — the lead **day count** is an architectural parameter where the product fixes duration/grace only.
