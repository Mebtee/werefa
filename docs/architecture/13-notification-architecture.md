# 13 — Notification Architecture

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06
> Binding: REQ-060–069, REQ-094–098, REQ-139, REQ-140, REQ-142, REQ-195/196, REQ-221, REQ-227–229.

## 1. Model

Notifications are **asynchronous, event-driven, channel-abstracted**. A domain transaction never depends on external delivery success (explicit rule; matches REQ-056 AC3 and booking integrity).

```
Domain event → Notification row (business-scoped) → NotificationDelivery rows (per recipient × channel)
             → BullMQ worker → provider adapters (MailProvider / TelegramBot) → status update
```

- Channels are exactly **EMAIL** and **TELEGRAM** (REQ-142). No other channel.
- Delivery table is the durable intent; retries are driven by `next_attempt_at`.

## 2. Notification catalog (approved set)

| Event                                                      | Recipient          | Channel                   | Conditions                                                                                                   |
| ---------------------------------------------------------- | ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Proof received / verification pending (R60)                | Customer (booking) | Telegram                  | TG connected (R56)                                                                                           |
| Booking confirmed (R61)                                    | Customer           | Telegram                  | TG connected                                                                                                 |
| Rejection + reason (R62/R124)                              | Customer           | Telegram                  | TG connected; reason present (R68)                                                                           |
| Reminder 24h (R63)                                         | Customer           | Telegram                  | TG connected; booking CONFIRMED before start                                                                 |
| Reminder 1h (R64)                                          | Customer           | Telegram                  | TG connected; booking CONFIRMED                                                                              |
| No Show (R227)                                             | Customer           | Telegram                  | TG connected; T5                                                                                             |
| Owner cancellation (R228)                                  | Customer           | Telegram                  | TG connected; T6                                                                                             |
| Reschedule w/ new date/time (R229)                         | Customer           | Telegram                  | TG connected; T7                                                                                             |
| New payment proof (R65)                                    | Owner              | Telegram/Dashboard        | content per R66 (booking/customer/service/date/time/payment/proof)                                           |
| Affected-booking email (R94/R96/R97)                       | Owner              | Email                     | schedule change with affected bookings; individual listing + deep links (R98); optional 5-min grouping (R95) |
| Subscription reminders (R139)                              | Owner              | Email + business Telegram | per subscription schedule                                                                                    |
| Subscription proof pending (R140)                          | The two Admins     | Email/Dashboard           | subscription payment submitted                                                                               |
| Lockout immediate email (R195/R196)                        | Account holder     | Email                     | 5 consecutive failures (R193); includes IP + device/browser                                                  |
| Password change (R35) + forced logout (R221)               | Account holder     | Email                     | immediate                                                                                                    |
| Verification / reset / recovery emails (R26/R33/R198/R199) | Account owner      | Email                     | time-limited link/code                                                                                       |
| **No owner appointment reminders** (R69)                   | —                  | —                         | explicitly not sent                                                                                          |

## 3. Delivery semantics

| Property       | Design                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Statuses       | PENDING → SENDING → SENT; FAILED (retryable); DEAD_LETTERED; SUPPRESSED (recipient not connected / channel unavailable).                                           |
| Retry          | Exponential backoff (default: 5 attempts, 1m→2m→4m→8m→16m), configurable; FAILED after max → Dead-letter queue inspected by ops (doc 17).                          |
| Idempotency    | `notification_delivery.idempotency_key` unique — reruns of a job or webhook are no-ops.                                                                            |
| Reminders      | Scheduled via delayed BullMQ jobs computed from `booking.start_at` (run twice → guarded/no-op, and second run skipped since reminder deadline logic checks `now`). |
| Dead-letter    | Only for systemic provider failures; alerts + dashboard snippet; never retried infinitely.                                                                         |
| Tenant context | Notifications carry `business_id` + recipient scope; workers never leak across tenants (doc 04 §8).                                                                |

## 4. Outbox pattern (email reliability)

On commit of a domain transaction, a `notification` row is written **in the same transaction** (or via a post-commit hook with its own idempotency key). The worker reads pending rows solely from the delivery table; provider calls are retried independently. This decouples external I/O from correctness without losing events (best-effort ordering acceptable).

## 5. Channels and adapters

- **Email**: `MailProvider` interface — `send(to, subject, bodyHtml, refs)` → SES adapter (default) / SMTP adapter. Templates centralized (verification, reset, lockout, affected bookings, subscription, forced logout). No solicitation beyond the approved catalog.
- **Telegram**: `TelegramProvider` — wraps bot sendMessage with throttling (doc 12).
- **PDFs/reports**: generated asynchronously via report job; the "notification" of availability is the in-app list + download link (doc 21).

## 6. Security of notification content

- Only the minimal data needed (customer name/phone in owner notifications R66/R97; booking/date/time/services).
- Never include password reset links for other tenants, never include proof file URLs to unauthorized principals (proofs private — doc 16).
- Content templates are parameterized; no free-form HTML from users injected into emails.
- Email subjects/from-address fixed and brand "Werefa" (R232).

## 7. Failure isolation

- Booking/Payment/Subscription transactions: **commit regardless** of notification insertion availability (insert is best-effort with its own tx + job); a notification outage cannot roll back a booking.
- `notification` writes use a short-circuit: if enqueue fails, log + metrics; the domain operation still succeeds.
