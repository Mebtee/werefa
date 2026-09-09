# 09 — State Machines (Implementation Strategy)

> **Architecture Version:** 1.0.1 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06 (+ Prompt 06-CORRECTION: formal definition of the ALLOCATED slot-lock state, §4.1)
> Functional source: Master Spec §26 (T1–T10 confirmed transitions; SM-10/SM-12/SM-13; OQ-SLOT-001; SM-08/SM-09).

## 1. Implementation pattern

Every state machine is implemented as:

- **Current state** on the aggregate row (`booking.status`, `payment.status`, `slot_lock.status`, `subscription.status`, pause flag).
- **Immutable history** per transition (append-only tables from doc 06/07).
- **Transition functions** that:
  1. take an `ActorContext` and an explicit expected current state,
  2. run inside a transaction under the **per-business advisory lock** (doc 08 §5) for booking/payment/slot/subscription mutations,
  3. issue a **guarded update**: `UPDATE … SET status=$new WHERE id=$id AND status=$expected [AND business_id=$tenant]` and require `rowcount = 1`,
  4. write history rows (previous/current/actor/timestamp/reason),
  5. **after commit**, enqueue async notification events.
- A central **transition table** (regex of allowed `from → to`, per machine) as the single authorization point; unknown transitions throw a domain `INVALID_TRANSITION`.

Terminal states are enforced by the transition table (no outgoing edge) **and** by guarded updates refusing to move them.

## 2. Booking state machine (from §26.1)

Auto/Manual noted per T-row. All transitions except T1/T10 initiation are owner or system driven (REQ-058).

| T   | Trigger                       | from → to                                 | Actor           | Preconditions                         | Side effects                                                                                            | Notifications (async)                                            | Audit/History                  | Next allowed          | Forbidden    |
| --- | ----------------------------- | ----------------------------------------- | --------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------ | --------------------- | ------------ |
| T1  | Proof submitted               | (new) → PAYMENT_PENDING                   | Customer/System | name, phone, slot free, method, proof | slot locked (R8), payment→PENDING                                                                       | customer proof-received (R60 if Telegram), owner new proof (R65) | booking + payment history      | T2,T3,T8              | none earlier |
| T2  | Accept proof                  | PAYMENT_PENDING → CONFIRMED               | Owner           | slot_lock active for window           | slot_lock→ALLOCATED; payment→ACCEPTED (attached)                                                        | customer confirmed (R61 if Telegram)                             | booking + payment history      | T4,T5,T6,T7           | T3,T8,T9,T10 |
| T3  | Reject proof (reason)         | PAYMENT_PENDING → REJECTED                | Owner           | reason present (R68)                  | payment→REJECTED; slot stays blocked (R123)                                                             | customer rejection+reason (R62/R124 if Telegram)                 | booking + payment history      | T9,T10                | T2,T4–T8     |
| T4  | End time passed               | CONFIRMED → COMPLETED                     | System          | job fires after end_at                | slot released; **terminal** (SM-10)                                                                     | none                                                             | booking history                | none                  | all          |
| T5  | Mark No Show                  | CONFIRMED → NO_SHOW                       | Owner           | none                                  | slot released; **terminal** (SM-10)                                                                     | customer No-Show (R227 if Telegram)                              | booking history                | none                  | all          |
| T6  | Cancel Confirmed              | CONFIRMED → CANCELLED                     | Owner           | none                                  | slot released; refund manual only (R122)                                                                | customer cancelled (R228 if Telegram)                            | booking history                | none                  | all          |
| T7  | Reschedule                    | CONFIRMED → CONFIRMED (same id, new time) | Owner           | new window free (R106)                | old slot released, new slot locked/allocated; payment stays attached (R107); higher price manual (R108) | customer reschedule with new dt (R229 if Telegram)               | booking history                | T4–T7 (post-T7)       | all others   |
| T8  | Cancel Payment Pending        | PAYMENT_PENDING → CANCELLED               | Owner           | none (SM-08)                          | **slot stays blocked** until explicit release (R104)                                                    | none (SM-08)                                                     | booking history                | (—) then slot release | T2,T3,T9,T10 |
| T9  | Owner release/cancel rejected | REJECTED → CANCELLED                      | Owner           | owner action (SM-09 option A)         | slot released                                                                                           | none                                                             | booking history + slot history | (—)                   | all          |
| T10 | Valid resubmission            | REJECTED → PAYMENT_PENDING                | Customer/System | new valid proof (SM-09 option B)      | payment REJECTED→PENDING; slot stays blocked (R123/R230)                                                | customer proof-received (R60 if Telegram); owner new proof (R65) | booking + payment history      | T2,T3,T8              | T1,T4–T7,T9  |

**Terminal states (SM-10):** COMPLETED, NO_SHOW, CANCELLED — no outgoing transitions. Enforced in transition table + guarded updates.

## 3. Payment state machine (from §26.2)

`payment.status ∈ {PENDING, ACCEPTED, REJECTED}` only (REQ-100/SM-12). Separate from booking status.

| Trigger                 | from → to          | Side effects (sync)                | Async         | Notes                          |
| ----------------------- | ------------------ | ---------------------------------- | ------------- | ------------------------------ |
| Proof submitted (T1)    | None → PENDING     | —                                  | notif R60/R65 | Booking enters PAYMENT_PENDING |
| Accept (T2)             | PENDING → ACCEPTED | payment attached to booking (R107) | R61           | Only path to ACCEPTED          |
| Reject with reason (T3) | PENDING → REJECTED | slot remains blocked (R123)        | R62/R124      | reason mandatory (R68)         |
| Resubmission (T10)      | REJECTED → PENDING | slot remains blocked (R123/R230)   | R60/R65       | new proof replaces old         |

**No refund state.** Manual refund = external business operation documented by the owner; the data model exposes no `REFUND` status and no automated refund transition (REQ-122, SM-12).

## 4. Slot-lock state machine (from §26.3)

### 4.1 Formal definition of ALLOCATED

`ALLOCATED` is a **required** slot-lock state. It marks a lock that is no longer merely _held pending payment verification_ (LOCKED) but is **attached to a booking that has been confirmed** (payment ACCEPTED, booking CONFIRMED). It exists because a slot occupied by a confirmed booking must remain unavailable to others for the booking's full window until the appointment reaches a terminal lifecycle state (completed, no-show, cancelled-confirmed) or is rescheduled away.

| Attribute                              | `ALLOCATED`                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Meaning**                            | Lock is bound to a confirmed booking; the window is firmly occupied for that booking's `[start_at, end_at)`.                                                                                                                                                                                   |
| **Entry transition**                   | `LOCKED → ALLOCATED` on **T2** (owner accepts proof): booking `PAYMENT_PENDING → CONFIRMED`, payment `PENDING → ACCEPTED` (attached, REQ-107).                                                                                                                                                 |
| **Exit transition**                    | `ALLOCATED → RELEASED` on **T4** (auto completion), **T5** (no-show), **T6** (cancel confirmed), or **T7** (reschedule-away releases the old window). No direct exit to LOCKED.                                                                                                                |
| **Actor**                              | Entry: **Owner** (the acting reviewer, REQ-119/120); Exit: System (T4) or Owner (T5/T6/T7).                                                                                                                                                                                                    |
| **Allowed operations while ALLOCATED** | Reserved for the owning booking's lifecycle: T4/T5/T6/T7 and read-only views. No new customer claim can target an ALLOCATED window (it is excluded by the overlap re-check and by the availability engine).                                                                                    |
| **Relationship to LOCKED**             | Immediate successor. LOCKED holds a window pending verification; ALLOCATED holds it once confirmed. Both are "active" locks (see below); the difference is attachment to a confirmed booking.                                                                                                  |
| **Relationship to booking states**     | ALWAYS accompanied by a booking in **CONFIRMED**. Any booking reaching a terminal state releases its ALLOCATED lock immediately (T4/T5/T6) or the lock is reassigned to the rescheduled slot (T7). A CONFIRMED booking always has an ALLOCATED (or newly LOCKED-after-reschedule) active lock. |
| **Active for availability?**           | **Yes.** ALLOCATED (like LOCKED) marks the window as occupied — excluded by the authoritative overlap re-check (doc 08 §4) and hidden from the availability engine (doc 10).                                                                                                                   |
| **Database representation**            | `slot_lock.status = 'ALLOCATED'` (CHECK-constrained set `LOCKED/ALLOCATED/RELEASED`, doc 07 §2); `booking_id` set (non-null) pointing to the confirmed booking; included in the partial unique index predicate `WHERE status IN ('LOCKED','ALLOCATED')`.                                       |
| **Audit behavior**                     | `booking_status_history` records T2 (including the lock becoming ALLOCATED); `slot_lock.released_by`/`released_at` and slot history capture the eventual release. No separate public-facing ALLOCATED concept exists; reports use booking status.                                              |

### 4.2 State table

| Phase/Status | Entered by                        | Exit                      | Released by                                                                                                                                             |
| ------------ | --------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (no lock)    | —                                 | —                         | slot free; selection doesn't lock (R51/R52)                                                                                                             |
| LOCKED       | T1 submission (atomic)            | ALLOCATED (T2) · RELEASED | no TTL ever (OQ-SLOT-001). T8: stays LOCKED until explicit release (SM-08). Rejected (T3/T10): stays LOCKED until release or resubmission (SM-09/R123). |
| ALLOCATED    | T2 accept                         | RELEASED at T4/T5/T6/T7   | lifecycle end (completion, no-show, cancel-confirmed) or reschedule-away                                                                                |
| RELEASED     | T9/T4/T5/T6/T7 / explicit release | (none)                    | workflow actions only                                                                                                                                   |

Rules: exactly one active lock per exact window (partial unique index, defense-in-depth); release actions are explicit owner actions (T8/T9) or terminal lifecycle events; nothing expires (no TTL).

## 5. Subscription state machine (see doc 15 for eligibility rules)

States: `NONE → TRIAL → TRIAL_GRACE → EXPIRED`, and `ACTIVE → PAID_GRACE → EXPIRED`; `EXPIRED → ACTIVE` on approved renewal (extends 30 d, R130). Duration constants (R128/129/130/131) are config-free fixed values (data, not user-editable). Auto-resume events (R154/R231) are recorded in `subscription_status_history` even when expired prevents reopening.

## 6. Pause / resume state (see doc 15)

`RUNNING → PAUSED_INDEFINITE` or `PAUSED_SCHEDULED (reopen_at=timestamp)`. Manual resume (R157) and auto-resume (R153) require active subscription; indefinite pause never auto-resumes on renewal (R156); scheduled pause whose end preceded renewal reopens on renewal (R155).

## 7. Concurrency and idempotency of transitions

- All booking/payment/subscription mutations run under the per-business advisory transaction lock (short). Stale actions fail the guarded update (0 rows → `STALE_STATE`).
- Jobs (completion, resume) are idempotent: they run the same guarded transition; running twice is a no-op on the second run (doc 17).
- History writes happen inside the same transaction as the transition (single atomic unit), never appended after a partial failure.

## 8. Machine test map

Every T-row is unit/integration-tested (doc 28): happy path, forbidden transition, stale-state race, terminal refusal, and the concurrency scenarios listed in §37 of the functional prompt.
