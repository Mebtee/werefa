# 10 — Scheduling Engine

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06
> Binding: REQ-050, REQ-082–099, REQ-143–158, REQ-159–161, REQ-222–226. Pure-function core documented for testability.

## 1. Inputs to availability

| Input                    | Source                                               | Notes                                                                                                       |
| ------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Active schedule version  | `schedule_version(status='ACTIVE')`                  | Only the active version is considered for new bookings (R150/R151).                                         |
| Working periods          | `working_period`                                     | Multiple per weekday (R082/R083).                                                                           |
| Blocked periods / days   | `blocked_period`                                     | (R084/R085).                                                                                                |
| Special dates            | `special_date`                                       | Override weekly (R086); closed or custom hours (R087).                                                      |
| Booking interval         | `business_settings.booking_interval_minutes`         | Grid step (R088).                                                                                           |
| Service total duration   | snapshot combination (R074)                          | Must fit (R089).                                                                                            |
| Existing bookings        | `booking` (PAYMENT_PENDING/CONFIRMED)                | Occupies `[start,end)`; R090 (unchanged by schedule edits).                                                 |
| Active slot locks        | `slot_lock` (LOCKED/ALLOCATED)                       | Occupies window (R52/R121).                                                                                 |
| Schedule exceptions      | `schedule_exception`                                 | Exists only where the owner kept a booking; affects **warnings/reporting**, never makes a slot "available". |
| Pause state              | `business_settings.is_paused`                        | Disables new bookings (R147).                                                                               |
| Subscription eligibility | doc 15                                               | Gates new bookings (R133/R153).                                                                             |
| Timezone / precision     | global TZ, minute grid, date `YYYY-MM-DD` (R222–226) | All math in global TZ.                                                                                      |

## 2. Availability algorithm (pure function)

Input: `businessId, activeScheduleVersion, from, until, serviceCombination → totalDuration`, plus gates.
Output: sorted list of eligible slot starts `[date, start, end]` and (for single-service selection) the services included.

1. **Gate check**: paused? → return []. Subscription not booking-eligible → return []. (Public page still renders R134/R146.)
2. **Day expansion**: for each calendar date in `[from,until]` (minute grid, global TZ).
3. **Daily window resolution** (precedence): if a `special_date` exists → use it (closed ⇒ no window; custom ⇒ its hours). Else weekly `working_period` for that weekday. Subtract `blocked_period` overlays.
4. **Grid**: generate candidate starts at `interval` steps within windows, aligned to `:00` seconds.
5. **Fit check**: `[start, start+totalDuration)` must lie fully inside a resolved window (R089).
6. **Overlap filter**: reject candidates whose window overlaps any active `booking` or active `slot_lock`.
7. **Sort** ascending by date/start (display in dashboard uses global TZ + abbrev per R222).
   Return candidates.

This is a read-only pure computation; no locks acquired for reads (REQ-051). Availability ≠ a reservation.

## 3. Explicit precedence rules (nothing implicit)

| Situation                                           | Winner                                                                                 | Reference                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------ |
| Weekly hours vs special date                        | **Special date** (custom hours or closed)                                              | R086/R087                |
| Special date closed vs weekly periods               | **Closed** (no availability)                                                           | R087                     |
| Custom hours vs blocked period                      | **Blocked period** (blocked overlays custom hours)                                     | R084 + R087              |
| Weekly period vs blocked period/day                 | **Blocked period/day**                                                                 | R084/R085                |
| Working time vs service duration                    | **Duration must fit**; otherwise no slot                                               | R089                     |
| Candidate slot vs existing booking                  | **Existing booking** (no overlap)                                                      | R090/R121/overlap filter |
| Candidate slot vs active slot lock                  | **Slot lock** (blocked)                                                                | R52/R121                 |
| Any slots vs paused business                        | **Paused** → no new slots                                                              | R147                     |
| Any slots vs expired subscription                   | **Expired** → no new slots (after grace)                                               | R133/R153                |
| Grace (trial/paid) vs subscriptions                 | **Bookings continue during grace**                                                     | R132                     |
| Schedule change vs existing booking                 | **Existing bookings unchanged**; system warns, owner resolves (reschedule/cancel/keep) | R090/R092/R099/R159      |
| New schedule while paused                           | **Applied as PENDING version**, becomes active on resume                               | R150/R151                |
| Blocked period vs schedule exception (kept booking) | **Kept booking remains** (never silently moved); exception recorded                    | R159/R160                |
| Multiple paused-period changes                      | **All retained in history**; latest pending active on resume                           | R152/R151                |
| Automatic resume with expired subscription          | **Stay closed**; event recorded                                                        | R153/R154/R231           |
| Renewed subscription with expired scheduled pause   | **Reopen** (scheduled end already passed)                                              | R155                     |
| Renewal with indefinite pause                       | **Stay paused**                                                                        | R156                     |
| Resume (manual/auto)                                | **Recompute availability** against current active version                              | R158                     |

## 4. Schedule-edit flow (owner)

1. Owner edits working periods/blocks/special dates → produces a **new ScheduleVersion** (R162).
2. If paused → new version is stored `PENDING` (R150); no warnings; becomes active on resume (R151).
3. If running → version becomes `ACTIVE`. Within the same transaction, evaluate affected existing bookings:
   - Compute each occupancy vs the new windows; build **warnings** (R092/R093): affected booking, date/time, reason.
   - Save the version regardless (R091) — conflicts never block the save.
4. After commit, send **affected-booking email** (R094) listing each affected booking individually (R096) with customer name, phone, date/time, services (R097), and deep links (R098). Optional five-minute grouping window for close changes (R095, `MAY` — config flag).
5. Owner resolves each affected booking via quick actions **Reschedule / Cancel / Keep Booking** (R099). Keep Booking creates a `schedule_exception` recorded and visible (R159–161).

## 5. Timezone and precision

- All computation in the single global timezone constant (R222), never user-selected or per-business (R223).
- Grid in whole minutes; seconds forced to 0 (R226). Dates = business-local date derived from the global TZ calendar; display `HH:mm` (R224) and `YYYY-MM-DD` (R225).
- Dashboard displays include the timezone abbreviation; emails/PDFs do not (R222 residual behavior from master spec — verify text wording; master spec R222 covers global TZ; abbrev display rule is documented in doc 21/25 as per approved report behavior).

## 6. Performance

- Availability queries hit `(business_id, start_at)` indexes; per-day windows are cheap.
- Public availability responses may be cached in Redis for a short TTL (`AVAILABILITY_CACHE_TTL_SECONDS`, default 30–60) **for display only**. Slot claims always re-validate in the transactional path (doc 08), so stale cache never causes double booking (REQ-121).
- Heavy history computations (reports) are out of the scheduling path (doc 21).

## 7. Test focus

Pure-function tests: precedence table rows above, duration-fit edges (starts/straddling), interval alignment, closed/custom special dates, blocked overlays, pause/expired gates, multi-service durations (R074), and one "changed schedule around an existing booking" test verifying REQ-090 (bookings unchanged) + R093 warning content.
