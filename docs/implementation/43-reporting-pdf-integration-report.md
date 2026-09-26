# 43 - Reporting / PDF Integration Report (Prompt 59)

## 1. Objective

Audit the canonical reporting/history requirements and implement the ones that
are fully specified, reusing the existing history tables and authorization, with
a single deterministic reporting/PDF boundary. The owner booking-report PDF
export (§46 item 4) remains unresolved and MUST NOT be implemented.

## 2. Starting specification SHA-256

`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`

## 3. Ending specification SHA-256

`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`

(Identical — the specification was not modified.)

## 4. Canonical requirements audited

Read directly from the canonical specification: Domain 16 (REQ-162…174), Domain
17 (REQ-175…190), the Section 19.2 delivery guarantees, the Section 24
history/reporting separation, Section 25 (Reporting, incl. 25.3 owner PDF
pending clarification), the role/permission matrix (Section 27), and the §46
unresolved list.

## 5. Scope classification (Prompt 59 Phase 2)

| REQ | Requirement | Classification | Outcome |
| --- | --- | --- | --- |
| 162 | Schedule versions retained | B — already implemented | audited (`schedule_version`) |
| 163 | History records who/when/what/reason | B — already implemented | audited |
| 164 | Manual reason optional | B — already implemented | audited |
| 165 | Automatic changes use System actor + automatic reason | B — already implemented | audited |
| 166 | Owner views own schedule history | B — already implemented | `GET /owner/.../schedule/versions` |
| 167 | Super Admin views schedule history | B — already implemented | `GET /admin/.../schedule/versions` |
| 168 | Admin cannot view schedule history | B — enforced | 403 tested |
| 169 | Owner cannot restore; view-only | B — enforced | no restore endpoint |
| 170 | Schedule history exportable as PDF | D — missing infra, fully specified | **implemented** (owner + SA) |
| 171 | Schedule-history PDF custom start/end range | D | **implemented** (was previously deferred) |
| 172 | Schedule-history PDF: versions + dates only | D | **implemented** (actor/change/reason omitted) |
| 173 | Full booking status history retained internally | B — already implemented | `booking_status_history` |
| 174 | Owner views own bookings' full history | B — already implemented | owner booking detail |
| 175 | Booking reports show current status | B — already implemented | owner bookings list |
| 176 | Admin sees current status only (no history) | B — constraint | Admin denied on history surfaces (403) |
| 177 | Super Admin views full booking status history | D | **implemented** (JSON report) |
| 178 | Super Admin exports full history to PDF | D | **implemented** |
| 179 | Export custom date range | D | **implemented** |
| 180 | Export covers all businesses or one | D | **implemented** (optional single `businessId`) |
| 181 | Business multi-select not allowed | D | **implemented** (single UUID; comma-joined rejected 400) |
| 182 | PDF: Booking ID, customer, business, status changes, dates/times, actor | D | **implemented** (typed row, 6 columns) |
| 183 | PDF excludes reasons/notes | D | **implemented** (structurally impossible) |
| 184 | Filters: status, actor, date range, business | D | **implemented** |
| 185 | AND across categories / OR within a category | D | **implemented** |
| 186 | Filters not remembered; default 30-day window | D | **implemented** (stateless; server-side window) |
| 187 | Default sort newest first | D | **implemented** |
| 188 | Sortable columns (date/bookingId/customer/business/status/actor) | D | **implemented** |
| 189 | Date/time exact sorting | D | **implemented** |
| 190 | Booking ID numeric + CONF-001 tie-break | D | **implemented** (total, deterministic order) |
| §25.3 / §46(4) | Owner booking-report PDF export | **C — blocked (unresolved)** | **NOT implemented** (no route/UI) |

## 6. Existing history infrastructure (reused, not duplicated)

- `booking_status_history` (`BookingStatusHistory`): `bookingId`, `businessId`,
  `fromStatus`, `toStatus`, `actorType`, `actorUserId`, `reason`, `occurredAt`
  (REQ-173). Written by the booking repository and the Keep-Booking exception.
- `schedule_version`: `versionNo`, `status`, `appliedBy`, `appliedAt`, `reason`,
  `autoReason`, `replacedAt`, `createdAt` plus immutable child snapshots
  (REQ-162/163).
- Authorization via the existing `TenantGuard` (`requireSuperAdmin`,
  `requireOwnedBusiness`). No new roles, no schema change, no second history
  store, no RLS change.

## 7. Booking status-history implementation

`ReportingService.bookingHistory(...)` reads `booking_status_history` (with the
booking customer name and business name) and returns a typed
`BookingHistoryRow[]`. It is exposed as:

- `GET /api/v1/admin/reports/booking-history` (Super Admin) → JSON
  (`BookingHistoryReportView { rows, total, from, to, sortBy, sortDirection }`).
  Each row carries exactly `occurredAt, bookingId, customerName, businessName,
  fromStatus, toStatus, actorType`.

## 8. Schedule-history implementation

`ReportingService.scheduleHistory(businessId, range)` reads `schedule_version`
for one business, selecting only `versionNo, createdAt, appliedAt, replacedAt`.
Exposed as PDF at:

- `GET /api/v1/admin/businesses/:businessId/schedule-history.pdf` (Super Admin).
- `GET /api/v1/owner/businesses/:businessId/schedule-history.pdf` (owner, own business).

## 9. Reporting filters

Canonical filters only (REQ-184): `status`, `actorType`, `actorUserId`,
`businessId`, `from`, `to`. `status`/`actorType` are comma-separated lists (OR
within the category, REQ-185); a status filter matches either side of the change
(`fromStatus`/`toStatus`). Categories combine with AND. A `businessId` is a
single validated UUID (all businesses when absent). Unknown values, non-UUIDs
and comma-joined business ids yield `400` (never a silent scope widening).
Date-only bounds are interpreted in the fixed global timezone (start of day /
end of day), never the server's local timezone. Filters are stateless; omitting
the range applies the server-side most-recent-30-days window (REQ-186).

## 10. Reporting sorting

Default: newest first by exact `occurredAt` (REQ-187/189). Sortable by
`date | bookingId | customer | business | status | actor` with `asc|desc`. The
comparator applies the direction to the primary key only, then a
direction-independent total tie-break chain **Booking ID → date/time → Actor
A–Z** (REQ-190 / CONF-001), so the order is always deterministic. Booking ID
sorting is numeric (10 does not sort before 9).

## 11. Role / authorization behavior

- Booking-history view/PDF: **Super Admin only**. Admin → 403 (REQ-176);
  Owner → 403; unauthenticated → 401. All tested.
- Schedule-history PDF: Super Admin (any business) and Owner (own business
  only). Admin → 403 (REQ-168). Another owner → 404. Tested.

## 12. Tenant / business isolation

Scope is resolved server-side before the projection runs; the service never
widens the scope it is given. The optional `businessId` only narrows to one
business (no multi-select, REQ-180/181). Cross-owner schedule access returns
404; the report business filter returns only that business's rows. Tested.

## 13. PDF architecture

A dependency-free deterministic Type-1 PDF 1.4 writer
(`backend/src/domain/reports/pdf-document.ts`): A4 portrait, Helvetica, WinAnsi
escaping, A4 `MediaBox`, fixed footer, greedy word-wrap and pagination. It knows
nothing about Prisma, HTTP, auth or the clock; callers pass an already-authorized,
already-sorted document model. Output is byte-deterministic for the same input
(no random ids, no environment paths, no wall-clock metadata).

> Interpretation note: architecture doc 21 (written against the earlier
> `v0.5.0` spec) describes an **async** `report_job` + S3 pipeline and a PDF
> column contract that **omits Actor**. The canonical specification is the sole
> product authority: REQ-182 requires Actor in the booking-history PDF and
> REQ-183 excludes only reasons/notes — the implementation follows the canonical
> spec. Per the prompt's "smallest deterministic PDF generation boundary", PDFs
> are generated synchronously and streamed; no `report_job` job was added. This
> divergence is recorded here rather than silently resolved.

## 14. PDF field matrix

Booking-history PDF (`renderBookingHistoryPdf`):

| Field | Source | Required | Included | Reason |
| --- | --- | --- | --- | --- |
| Date & Time | `occurredAt` | REQ-182 | yes | exact timestamp, global tz |
| Booking ID | `bookingId` | REQ-182 | yes | numeric |
| Customer | `booking.customerName` | REQ-182 | yes | |
| Business | `business.name` | REQ-182 | yes | |
| Status change | `fromStatus -> toStatus` | REQ-182 | yes | |
| Actor | `actorType` | REQ-182 | yes | label only, no actor user id |
| Reason / Note | `reason` | excluded | **no** | REQ-183; not in the typed row |
| Payment / metadata / ids | — | not required | **no** | never selected |

Schedule-history PDF (`renderScheduleHistoryPdf`):

| Field | Source | Required | Included |
| --- | --- | --- | --- |
| Version | `versionNo` | REQ-170/172 | yes |
| Created / Applied / Replaced | `createdAt`/`appliedAt`/`replacedAt` | REQ-170/172 | yes |
| Actor (`appliedBy`) / Change / Reason | — | excluded | **no** (REQ-172) |

## 15. PDF security

Authorization runs before generation (guard + `TenantGuard`); the client cannot
expand scope via ids/params (single validated UUID). Responses use
`Content-Type: application/pdf`, a safe
`Content-Disposition: attachment; filename="<report>-YYYY-MM-DD.pdf"` derived only
from the report date, `X-Content-Type-Options: nosniff`, and stream the bytes —
no server paths, no stack traces, no secrets. PDFs are generated in memory and
never written to a public directory.

## 16. API endpoints

- `GET /api/v1/admin/reports/booking-history` (Super Admin, REQ-177).
- `GET /api/v1/admin/reports/booking-history.pdf` (Super Admin, REQ-178…183).
- `GET /api/v1/admin/businesses/:businessId/schedule-history.pdf` (Super Admin, REQ-170).
- `GET /api/v1/owner/businesses/:businessId/schedule-history.pdf` (Owner, REQ-170).

Class-validator DTOs, the standard error envelope, `ApiAuthGuard`, `TenantGuard`
and typed projections are all reused. No owner booking-report PDF route exists.

## 17. Frontend reporting changes

Reused the existing admin portal (`AdminLayout`, guards, API client, route tree):

- `frontend/src/api/reports.ts` — typed client for the report + PDF downloads
  (real endpoint via the authenticated `apiDownload` helper; no mock data).
- `frontend/src/features/admin/BookingHistoryReportPage.tsx` — Super Admin
  booking-history view with status/actor multi-select, single-business UUID
  input, date range, sorting, Reset (→ server 30-day default) and a real PDF
  export of the current filters. Mounted at `/admin/reports` under
  `RequireSuperAdmin` with a Super-Admin-only nav entry.
- `ScheduleHistory` (owner) gained an **Export PDF** action wired to the real
  owner endpoint; `frontend/src/lib/download.ts` saves the returned Blob.

No fake export buttons, no client-side PDF generation, no mock history, no new
admin portal, no owner booking-report PDF surface.

## 18. PDF download behavior

Downloads use the real API (`apiDownload`, session cookie, `response.blob()`)
and save under the server-provided filename; the owner schedule PDF and the SA
report PDF both go through the real endpoints. Filenames leak no tokens/ids.

## 19. Tests

- Unit (`backend/src/domain/reports/report.spec.ts`, 8): PDF 1.4 structure,
  byte-determinism, pagination without truncation, six canonical columns,
  `from -> to` rendering, reason/note absence, schedule PDF version/date columns
  with actor/reason absence, default newest-first, exact-timestamp tie-break,
  numeric Booking-ID ordering and the CONF-001 actor tie-break, direction applied
  to the primary key only.
- DB/HTTP (`backend/src/api/reporting.db.spec.ts`, 11): default 30-day window +
  newest-first + exact field allowlist; status OR / category AND; one-business vs
  all-business scope; explicit date range; numeric deterministic sorting;
  malformed-filter 400s (incl. comma-joined business id); Admin/owner/anon
  denial; SA PDF content-type/disposition/nosniff + six headers + no reason;
  empty-range PDF; SA schedule PDF; owner schedule PDF + cross-tenant 404 +
  Admin 403; history immutability after read/export.
- Frontend (`frontend/src/features/admin/BookingHistoryReport.test.tsx`, 4):
  real rows render; a status filter reaches the request; export hits the real PDF
  endpoint; Admin is blocked.

## 20. DB results

- Run 1: **376 passed / 26 files**.
- Run 2: **376 passed / 26 files**.
- Consecutive clean DB runs: **2**.

(357 before this prompt + 8 unit + 11 DB.)

## 21. Frontend results

- `npx vitest run`: **504 passed / 44 files**.
- Typecheck: **PASS**. Lint: **PASS**. Build: **PASS** (the bundle grew to
  527.38 kB; the pre-existing >500 kB chunk warning remains).

Backend: `npm test` **187 passed / 245 skipped** (38 files); typecheck, lint and
build all **PASS**.

## 22. Browser-QA status

No automated browser harness exists (no Playwright/Cypress/Puppeteer scripts;
`frontend/qa-shot/` holds only ad-hoc screenshots). No harness was added for this
prompt. The reporting UI is covered by component tests against the real route
tree; browser QA is documented as unavailable.

## 23. Known limitations

- Report reads/exports are not audited: the canonical specification does not
  require it, and the prompt forbids inventing audit events, so none were added.
  (Architecture doc 22 mentions auditing report reads; that is not a canonical
  product requirement.)
- PDF layout is a fixed text-table (one wrapped line per row), not a styled
  grid; the canonical requirements specify columns/content, not visual layout.
- The SA business filter takes a business UUID (no business-list API exists in
  the active tree); no list endpoint was invented.

## 24. Explicit owner booking-report PDF deferral

Per §46 item 4 / Section 25.3, the owner-facing booking-report PDF export is
**unresolved** and was **not** implemented: no route, no UI, no shared code path
that defines it. The owner receives the dashboard booking report (current status,
REQ-175) and per-booking history (REQ-174) only. The shared PDF boundary is
deliberately generic and does not encode any owner-report behavior.

## 25. Other unresolved §46 decisions left untouched

All six remain unresolved and were not invented: (1) subscription monthly price,
(2) global timezone identity, (3) subscription-reminder lead time, (4) owner
booking-report PDF export, (5) owner "modify" scope, (6) timezone-abbreviation
display. Prompt 38 Item 6 was not reconstructed.

## 26. Confirmation the specification was not modified

SHA-256 unchanged: `5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`.

## 27. Confirmation no commit was made

**NO COMMIT WAS MADE.** No history was rewritten; no reverts/resets/squashes; no
generated PDFs or temporary artifacts were left in the repository.
