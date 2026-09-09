# 20 — Admin & Super Admin Dashboards

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06
> Binding: REQ-036–044, REQ-140, REQ-165–181, REQ-205, REQ-217–221.

## 1. Role summary (REQ-036–044)

| Role        | Count (REQ)               | Business-scoped? | Notes                          |
| ----------- | ------------------------- | ---------------- | ------------------------------ |
| Owner       | ≥1 per business (R001)    | yes              | owns the businesses (R015/23)  |
| Admin       | **exactly 2** (R037/R038) | no               | platform staff                 |
| Super Admin | **exactly 1** (R037)      | no               | elevated; created by system    |
| Viewer      | none (R044)               | —                | explicitly excluded this phase |

R046 is a super-admin action (review username). R047–049 (admin accounts) covered under endpoints.

## 2. Admin dashboard

| Capability                                              | Detail                                                                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subscription review queue (R140)                        | pending `subscription_payment` proof rows only; show proof + owner identity; **approve** extends 30 d (R130/R137), **reject** requires reason (R138) |
| Current bookings view (R176)                            | list/status of bookings by business, **current status only** — no status-history column, no schedule-history tab (R168)                              |
| Own security records (R202) + own audit (R206-adjacent) | limited to own scope (R202)                                                                                                                          |
| Allowed account surfaces                                | no owner account creation; only assigned review actions                                                                                              |

Rules: the two Admins are the **only** reviewers (R140). Approvals are audited (doc 22). Admin cannot change own password (R218); cannot view owner schedule-history reports (R168).

## 3. Super Admin dashboard

| Capability                                       | Detail                                                                                                                                                                                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manage Admins                                    | create/update/delete the 2 Admin accounts (R217); delete guard keeps ≥2 (R038); switch/manager role actions audited                                                                                                                    |
| Change an Admin's password (R219)                | via Super Admin credentials; audited                                                                                                                                                                                                   |
| Force a user's logout (R220)                     | revoke sessions + immediate email (R221); audited                                                                                                                                                                                      |
| Full booking schedule history by business (R177) | all statuses + owner actions; PDF export (R178) scoped all-or-one business (R181), grouping by business + date (R179), customer/contact + service + status + date-time + owner-action (R180), **excludes actor/details/reason** (R183) |
| Schedule history PDFs (R167)                     | includes owner/date-time (R169); detects kept occupants (R171); shows modified fields (R172); user edits (R174)                                                                                                                        |
| Security event management (R205)                 | view/delete retained security records; deletion itself audited (R206)                                                                                                                                                                  |
| Emergency recovery (R198/199/200)                | one-time recovery code flow to replace a Super Admin's password                                                                                                                                                                        |
| Platform metrics (dev flag)                      | read-only operational views (individual weighting excluded)                                                                                                                                                                            |

## 4. Shared patterns

- Single "role-scoped module" in the dashboard app; route guards = role (doc 19 §2).
- All Super Admin actions that affect accounts/records go through a **dedicated service** that writes `audit_event` unconditionally (doc 22 §4); no view that exposes unrelated tenants' data without scope filter.
- Admin/SuperAdmin screens share the review card component and reporter (doc 21).

## 5. Data access

- Admin review queue query: `subscription_payment` where `status='PENDING_UPLOAD_DONE' ` — waiting; only 2 rows-ish; if > threshold (3) alert. Query reads are full-scope (platform) but every mutation is per-row + guarded.
- Super Admin history: business-scoped filter; joins across `business`, `booking`, `booking_status_history`, `service` (snapshot), `user`.
- PDF exports run in `worker`; the requester gets notified when ready (doc 21).
