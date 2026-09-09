# 15 — Subscription & Pause/Resume Architecture

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06
> Binding: REQ-006, REQ-015, REQ-023, REQ-125–141, REQ-143–158, REQ-231.

## 1. Subscription states

`subscription.status ∈ {NONE, TRIAL, TRIAL_GRACE, ACTIVE, PAID_GRACE, EXPIRED}`.

| State       | Meaning               | Entered                                                        | Duration                 |
| ----------- | --------------------- | -------------------------------------------------------------- | ------------------------ |
| NONE        | registered, pre-trial | business created                                               | —                        |
| TRIAL       | free trial            | creation (R006)                                                | 30 d (R128)              |
| TRIAL_GRACE | trial ended, waiting  | R129                                                           | 3 d                      |
| ACTIVE      | paid period           | approval of subscription proof (R137) or trial→paid conversion | 30 d per approval (R130) |
| PAID_GRACE  | paid period ended     | R131                                                           | 5 d                      |
| EXPIRED     | grace exhausted       | auto job                                                       | until approved renewal   |

**Booking eligibility (monetary gate):** `bookingEligible = status ∈ {TRIAL, TRIAL_GRACE, ACTIVE, PAID_GRACE}` (i.e., all except EXPIRED) — bookings continue during any grace (R132); after grace, new bookings disabled (R133); public page still visible in all states (R134). Standard monthly price, no tiers (R125/R126); one Subscription per business, fully independent (R015/R127, REQ's per-tenant).

## 2. Renewal flow

1. Owner (from dashboard) requests renewal → **manual bank transfer instructions** (R135) → upload proof image/PDF (R136).
2. `subscription_payment` rows enter the **review queue**; exactly the two Admin accounts are notified (R140).
3. Admin or Super Admin **approves** → subscription `ACTIVE`, period extended **+30 days from end-of-current-period** (R130/R137); or **rejects** → reason mandatory, delivered to the owner (R138).
4. Reminders by email + business Telegram (R139) at configurable lead times (default 3 d before end); prominent dashboard warning persists until renewal (R141).

No automatic money movement; approval is the only activation event. Rejection does not change the current subscription state (still in grace or expired).

## 3. Pause/resume states

Pause is stored on `business_settings`: `is_paused` + `pause_mode` (`INDEFINITE` | `SCHEDULED`) + `resume_at` (timestamp) + optional `pause_message` (R148) + optional shown `reopen_at` (R149).

| State                         | Behavior                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| RUNNING                       | new bookings accepted (subject to subscription gate + availability)                      |
| PAUSED (INDEFINITE)           | new bookings disabled (R147); public page visible (R146); stays paused on renewal (R156) |
| PAUSED (SCHEDULED, resume_at) | same; auto-resume attempt at `resume_at`                                                 |
| RESUMING (manual or auto)     | recompute availability against the **newly active** schedule (R158)                      |

### Resume logic (exact precedence — R153/154/155/157)

```
attemptAutoResume(business, now):
  if not is_paused(SCHEDULED) or now < resume_at: return NOOP
  record resume event start  (R231: event recorded even if expired)
  if subscription.status == EXPIRED:
      record FAILED (reason: subscription expired)   // R154 / SM-13
      return STAY_CLOSED                              // bookings remain disabled
  # subscription eligible:
  promote latest PENDING schedule version → ACTIVE (R151)
  recompute availability (R158)
  resume → RUNNING
```

```
onSubscriptionApproval(business, approvedUntil):
  apply 30-day extension (R130)
  if pause_mode == SCHEDULED and resume_at <= now:
      automatic reopen (R155)          // renewal after pause period ended
  if pause_mode == INDEFINITE:
      stay paused (R156)               // renewal never reopens indefinite
```

```
manualResume(business):
  if subscription.status == EXPIRED: reject (R157 pre-requires active)
  promote pending schedule; recompute; resume
```

### Pause Δ schedule handling (R150/151/152)

While paused, schedule edits create `PENDING` versions (never auto-activated); multiple edits retained in `schedule_version` history (R152); on resume (any path) the **latest** pending version becomes ACTIVE (R151).

### Auto-resume event recording (R154 + R231)

Every automatic resume attempt — including an expired-subscription refusal — writes a `subscription_status_history`/`pause` event with outcome; nothing in UI/API treats a recorded event as "bookings available" (AC3), only ACTIVE-state + eligibility gate closes the loop.

## 4. Background processing

| Job                    | Behavior                                                                              | Idempotency                           |
| ---------------------- | ------------------------------------------------------------------------------------- | ------------------------------------- |
| Trial state transition | NONE→TRIAL started at business creation; trial→grace→expired transitions by date jobs | guarded transitions; second run no-op |
| Renewal reminders      | at lead time + grace boundaries                                                       | checked by `next_attempt_at`          |
| Expiry                 | EXPIRED at grace end; booking gate closes; warning shown                              | guarded                               |
| Auto-resume            | at `resume_at` (above)                                                                | resume flag/event idempotent          |

All jobs are tenant-scoped, observant of the business advisory lock, and idempotent (doc 17/28).

## 5. Test focus

- bookingEligible for each state; grace continues bookings (R132);
- auto-resume with EXPIRED records event + stays closed (R154/R231);
- renewal after scheduled end reopens (R155); renewal on indefinite pause stays paused (R156);
- manual resume with active subscription opens immediately (R157); pushes pending schedule (R151/R158);
- double-run of resume job is a no-op.
