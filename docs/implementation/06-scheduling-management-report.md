# 06 — Scheduling Management (Prompt 12) — Section 38 Final Report

Status: **IMPLEMENTED** (core) · Final quality-gate run: **all green** · This report is the
Prompt 12 §38 close-out. Advance notices (REQ-160 … REQ-164) and the scheduling-notifications
leading-time workflow are tracked as **DEFERRED / PARTIAL** and recorded honestly below.

## 1. Conformance summary

| Dimension               | Result                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement coverage    | REQ-086/087/088/089/090/091/092/093/095/096/097/098, REQ-165/166/167/168/170, REQ-089 availability seam, REQ-153–158 (resume/reactivate gate), REQ-226 whole-minute integration, REQ-229 (affected-booking serial stays in existing booking pipeline) — **implemented**                                                                                                                                                            |
| Partial                 | REQ-094 and REQ-097: affected-booking notifications are recorded as platform notification rows (`tenant_scope` = `SCHEDULE`, grouped per REQ-095, with the REQ-096/097 payload + REQ-098 `managementUrl`); **email/Telegram provider dispatch is still deferred** (same seam as Prompt 11 — outbox rows are written, dispatch is a future provider task). REQ-172 does **not** cover 171 (see Deferred)                            |
| Deferred (out of scope) | REQ-160 … REQ-164 (advance notice / reminder content, days-ahead, advance-notice default); REQ-099 (customer confirm/deny of affected booking — depends on deferred REQ-056 customer accounts); REQ-171 (custom start/end date range for the schedule-history PDF export — the export codepath exists and is wired for both owner and super-admin, but range input is not exposed); REQ-150/151 (slot-hold expiry parametrization) |
| Explicitly omitted      | No invented schedule statuses (exactly `ACTIVE` / `SUPERSEDED` / `PENDING` / `KEPT` per SM-14); no owner restore/revert (REQ-169 honourCode — history is view-only); no hard-delete of versions; bookings are never silently deleted when a schedule changes (REQ-090 semantics — owners keep via `POST …/keep` or conflicts persist on the surface)                                                                               |

## 2. Quality gate (final, this session)

| Step                 | Command                                                   | Result                                                                                                                                                                                   |
| -------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Format            | `npm run format` then `npm run format:check`              | PASS (0 files flagged)                                                                                                                                                                   |
| 2. Lint              | `npm run lint` (all workspaces)                           | PASS (0 errors)                                                                                                                                                                          |
| 3. Typecheck         | `npm run typecheck` (all workspaces)                      | PASS (0 errors)                                                                                                                                                                          |
| 4. DB bootstrap      | `npm run db:test:setup`                                   | PASS — clean `werefa_test` build incl. `20260905_000700_schedule_management` migration + RLS                                                                                             |
| 5. Builds            | `npm run build` (all workspaces)                          | PASS — API `nest build`, dashboard + public `vite build`, db + shared `tsc`                                                                                                              |
| 6. Unit tests        | `npm run test:unit`                                       | PASS — API **104** (12 files, incl. 3 new schedule files + engine), DB **5**, Shared **4**                                                                                               |
| 7. Integration tests | `npm run test:integration`                                | PASS — **155** tests, 9 files, fileParallelism=false. `schedule-management.test.ts` (14) new; `rls-isolation.test.ts` extended 15 → 20 with the schedule RLS block                       |
| 8. Startup smoke     | `node apps/api/dist/main.js` → `GET /api/v1/health/ready` | PASS — `{"status":"ok","db":"up"}`; schedule routes mapped (`ScheduleController`, `ScheduleSuperAdminController`); unauth owner schedule GET → 401; secret masking confirmed (env block) |

Numeric deltas vs the Prompt 11 close-out: API unit **54 → 104** (+50 schedule unit tests
`-engine`/`-input`/`-pdf`), integration **136 → 155** (+14 `schedule-management` +5 schedule RLS).

## 3. What was implemented this session

**Data model** (migration `20260905_000700_schedule_management` + RLS in
`packages/db/prisma/migrations/20260905_000000_foundation/rls.sql`):

- `schedule_version` — `ACTIVE | SUPERSEDED | PENDING`, `actor_type` (`OWNER|SYSTEM|ADMIN`),
  `booking_interval_minutes`, monotonic `version` per business, explicit `activated_at`.
- `working_period`, `special_date` (+ `special_date_period`), `blocked_period`,
  `schedule_conflict` (open rows, `reason` = human label `Outside weekly working hours`),
  `schedule_exception` (owner "keep"), `schedule_version_context` (payload+signature,
  `Content-Type` snake_case). Raw `business` gains `is_paused` / `paused_until`.
- RLS on all schedule tables: owner windows (business-owner membership), PUBLIC
  SELECT-only ACTIVE projection (`scope=PUBLIC AND booking_public=1 AND business_id AND status='ACTIVE'`),
  SUPER_ADMIN all.

**Engine** (`apps/api/src/schedule/schedule-availability.ts`) — pure functions:
`localDateOf`/`resolveDayWindows` (weekly, blocked splitting, midnight-crossing clipping,
closed-special `[]`, special-override), `evaluateFit` precedence (blocked > closed > special >
weekly; full-duration fit per REQ-089), `candidateStarts` (anchor-at-window-start, step =
`booking_interval_minutes`, `to` bound, REQ-089 crossing drop). Addis UTC+3, no DST.

**API surface** (`ScheduleController`, `ScheduleSuperAdminController`, `ScheduleModule`, wired in `AppModule`):

- `GET|PUT /businesses/:businessId/schedule` — load / full save (create-or-supersede,
  `SCHEMA`-level code + signature `app.schedule`; keeps client pre-image, asserts
  `prev.id` to make "conflict on version" safe).
- `GET …/schedule/conflicts` (open + kept), `POST …/bookings/:bookingId/keep`
  (closes conflict → `schedule_exception`, booking bumps to `KEPT` with `RESOLVED_KEPT`
  history row, slot stays non-available to fresh creations but the booking itself remains).
- `GET …/schedule/history` (+ `?pageSize`, floors) and `GET …/schedule/history/pdf` for owners;
  super-admin mirrors both (`/super-admin/businesses/:businessId/schedule/history[/pdf]`);
  Admin (non-owner, non-SA) → 403 on both surfaces (REQ-168). PDF is strictly `REQ-172`
  neutral (versions, dates/times, no customer data / no `reason` leak).

**Booking gate** — public availability and booking creation now consume the ACTIVE schedule
(weekly windows, special dates, blocked periods, booking interval, REQ-089 full-duration fit);
`SLOT_UNAVAILABLE` segmentation. Resume (manual `POST …/resume`, `reactivate`, and the
auto-resume sweep in `business-scheduled-resume.job.ts` → `autoResumeDueBusinesses`) reactivates
the previously ACTIVE version and recomputes affected bookings under the new gate.

**Affected sweep** (REQ-090/091/092/093/095/096) — on activating a version, bookings outside
the new availability are registered as OPEN `schedule_conflict` rows and the owner receives
`SCHEDULE_AFFECTED_OWNER` platform notifications (first alert `grouped:false`; subsequent saves
within the 5-minute window merge into one `grouped:true` row with deduped entries: version id,
bookings each with customer name/phone, start/end, duration, services, reason, and
`managementUrl`). After resume, conflicts are re-evaluated (booking restored as available).

**Dashboard** — owner "Schedule" management panel (weekly windows, special dates, blocked
periods, booking interval, history + neutral PDF export). Public booking panel unaffected but
availability now schedule-driven.

**Seeds** — dev seed adds an ACTIVE schedule for seeded businesses with weekly + special +
blocked fixtures so the public booking flow has a realistic gate.

## 4. IMPLEMENTED / PARTIAL / DEFERRED summary

| Requirement                                          | Status      | Where / note                                                                                                           |
| ---------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| REQ-086/087 weekly + special override                | IMPLEMENTED | engine `resolveDayWindows`, special override + closed `[]`                                                             |
| REQ-088 booking interval configurable                | IMPLEMENTED | `booking_interval_minutes` on version; `candidateStarts` steps by it (not slot duration)                               |
| REQ-089 full duration fits                           | IMPLEMENTED | `evaluateFit` + `candidateStarts` crossing-drop; unit + integration                                                    |
| REQ-090/091/092 changes warn, never block/drop       | IMPLEMENTED | OPEN conflicts surface; `keep` flow; reservation                                                                       |
| REQ-093 warning identifies booking/date/reason       | IMPLEMENTED | conflict row carries booking id + human reason label                                                                   |
| REQ-094/096/097 affected-booking notifications       | PARTIAL     | platform notification rows (grouped REQ-095, payload REQ-096/097, `managementUrl` REQ-098); provider dispatch deferred |
| REQ-098 direct access to affected bookings           | IMPLEMENTED | `managementUrl` per entry                                                                                              |
| REQ-095 5-minute grouping                            | IMPLEMENTED | same-window saves merge to one `grouped:true` row                                                                      |
| REQ-158 resume checks current schedule               | IMPLEMENTED | resume/reactivate/sweep re-gate + recompute                                                                            |
| REQ-165 System actor for automatic changes           | IMPLEMENTED | auto-resume sweep records `BUSINESS_AUTO_RESUME` with System actor (Prompt-09 seam preserved)                          |
| REQ-166/167/169/170 history (owner/SA/view-only/PDF) | IMPLEMENTED | history GET + neutral PDF both surfaces                                                                                |
| REQ-168 Admin cannot view history                    | IMPLEMENTED | 403 on both owner and super-admin surfaces                                                                             |
| REQ-171 custom date-range PDF                        | DEFERRED    | export path exists; range input not exposed                                                                            |
| REQ-099 … REQ-160 … REQ-164                          | DEFERRED    | customer confirm/deny (needs REQ-056 accounts); advance-notice workflow                                                |

## 5. Prompt-13 boundary

Not started. Next prompt may build on: `packages/shared` error-code / schema additions did not
expire, seeds remain idempotent, and the deferral seams documented in 05 (notification provider
dispatch) and here (REQ-094/097 dispatch, REQ-099, REQ-160–164, REQ-171) are the intended
extension points. No metrics/analytics work was started. Requirements file `v0.5.0` and
architecture `v1.0.1` were not modified.
