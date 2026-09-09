# 21 — Reporting & PDF

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06
> Binding: REQ-162–186, REQ-205. Reports are **non-editable, read-only exports** (R186); no chart-based static reports (R185).

## 1. Report types

| Report                   | Audience                         | Scope                     | Columns                                                                                                                            | Exclusions                                                  |
| ------------------------ | -------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Booking schedule history | Owner (R170), Super Admin (R178) | one/all businesses (R181) | customer name/contact, service description, booking status + date-time, owner action (R180); grouping by business then date (R179) | `ACTOR`, `DETAILS`, `REASON` **explicitly excluded** (R183) |
| Schedule history         | Owner (R165), Super Admin (R167) | one business              | owner name + date-time (R169), modified fields (R172), kept-booking occupants (R171), user edits (R174)                            | details per R172 exclusions only                            |
| Security retention       | Super Admin (R205)               | platform                  | security event rows                                                                                                                | deletion audited                                            |

- Reports are generated **asynchronously** (report job) and delivered as a PDF in the dashboard; never a live chart (R185), never pasted into email (except links, doc 13 keeps to catalog).
- No aggregate/chart reports exist (R185); any future usage-reporting must be explicitly approved (architectural notes; excluded from phase).

## 2. Generation pipeline

```
request(report, jobId)                       Owner/SuperAdmin
   → report_job row (status=PENDING, scope)
   → BullMQ worker (doc 17)
   → query scoped by tenant/scope
   → build PDF (PDFKit) — vertical layout, brand Werefa
   → upload to S3 (category REPORT_PDF, signed)  (doc 16)
   → mark job COMPLETE → notify owner/SuperAdmin in-dashboard link
failure → job FAILED with reason; requester sees retry (never partial PDF)
```

- Large-output streaming chunked to disk; PDF row caps with cycle-based pagination (TBD; page-sets).
- PDFs are immutable snapshots: history rows appended afterwards do not alter an already-generated file.

## 3. File storage & access

`REPORT_PDF` objects are private (doc 16); download = presigned GET scoped to the requester; issuance is an audited action. Old generated PDFs pruned per retention (default 30 days).

## 4. Exact column contracts (R180/R183)

Booking-history PDF row:
`Date & Time | Booking ID | Customer | Contact | Service(s) | Status | Owner Action`

- `Status` = booking status label (Confirmed/Completed/…) at export time snapshot.
- Excluded columns: `Actor`, `Details`, `Reason` — even if the master spec mentions them in §History (R183 override).
  Schedule-history PDF row:
  `Date & Time | Owner | Modified Fields | Previous | New` (+ kept-occupant marker). `Details/Reason` excluded (R183 analog for schedule-history per approved behavior from doc 20).

## 5. Ordering (REQ-190/CONF-001)

Report rows sort: **Booking ID** primary; then date/time ascending; then **Actor A–Z** as the tie-breaker.

## 6. Performance

- Async avoids blocking dashboard; queries bounded (page-size dependent, cursor streaming); jobs monitorably; test with large business histories (doc 28 perf cases).

## 7. Test focus

Column exclusion per R183/R172/R169; ordering per R190; scope isolation (owner sees own; nothing cross-tenant); immutability after generation; failure retry path (no duplicate or partial PDFs); presigned-link expiry and permission checks on download.
