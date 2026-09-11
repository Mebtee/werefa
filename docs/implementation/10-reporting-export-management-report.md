# 10 — Reporting & Export Management (Prompt 16) — Section 38 Final Report

Status: **IMPLEMENTED** · Final quality-gate run: **all green** · This report is the
Prompt 16 §38 close-out (`docs/01-master-specification.md` REQ-162..190, Domain 17 Reports/Exports,
`docs/architecture/21-reporting-pdf.md`, `docs/architecture/22-audit-logging.md` §2/§4).
Booking reports, the SA booking-status-history report and its PDF export, filters (status, actor,
date range, business), CONF-001 sorting, pagination, the strict PDF column contract, and the SA
dashboard report panel are complete; schedule-history PDF export (REQ-170/172, Prompt 12) is
retained and verified alongside.

## 1. Conformance summary

| Dimension               | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Requirement coverage    | Booking reports show current status (**REQ-175**); Admin sees current status only (**REQ-176**); Super Admin views full booking status history (**REQ-177**); Super Admin exports full booking status history to PDF (**REQ-178**) with custom date range (**REQ-179**), all-businesses-or-one-business scope (**REQ-180**), no business multi-select (**REQ-181**), PDF contains exactly Booking ID / customer / business / status changes / dates-times / actor (**REQ-182**) and never reasons/notes (**REQ-183**); filters for status, actor, date range and business (**REQ-184**) combine AND-between-categories / OR-within-category (**REQ-185**), are stateless with a 30-day default window (**REQ-186**); default sort newest-first (**REQ-187**) with all six sortable columns (**REQ-188**), exact date/time sorting (**REQ-189**) and Booking-ID chronological + CONF-001 tie-breaking (**REQ-190**). The SA dashboard hosts a dedicated "Booking history report" panel (status/actor multi-select, actor user ID + business UUID inputs, date range, sorting, pagination, reset, PDF export honoring the current filters); `businessId`/`actorUserId` values are UUID-validated server-side. Schedule-history view + PDF for owner/SA (REQ-166/167/170/172) verified green. |
| Partial                 | REQ-171 (custom start/end range on the **schedule-history** PDF) remains deferred exactly as recorded in Prompt 12 — the export codepath exists but range input is not exposed; booking-history PDF/JSON reporting fully honor the date range.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Deferred (out of scope) | No chart/aggregate/static reports (arch doc 21: R185 — reports are read-only exports); no email-pasting of PDFs; no report_job async queue row added (export is generated synchronously from the approved history tables like the schedule PDF, R178/179); REQ-171 schedule range input; no analytics/statistics dashboards over history.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Explicitly omitted      | PDF rows carry no `reason`, `note`, metadata, credentials or audit text (REQ-183 enforced by a strictly-typed generator that never receives those fields); no client-supplied scope ever — SA export scope is server-validated `businessId` or all businesses; no multi-select (single business only, REQ-181); Admin cannot reach the history/export surfaces (REQ-176, 403-integration-tested); no RLS weakening — the reporting surface reads through the existing elevated `app_superadmin` client exactly like the Prompt-15 admin/SA booking views, and each read/export records a security event.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## 2. Quality gate (final, this session)

| Step             | Command                                                                     | Result                                                                                                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Format        | `npm run format:check` (root)                                               | PASS (0 files flagged)                                                                                                                                                                                                                                               |
| 2. Lint          | `npm run lint` (api, dashboard, db, shared)                                 | PASS (0 errors)                                                                                                                                                                                                                                                      |
| 3. Typecheck     | `npm run typecheck` (api, dashboard, db, shared)                            | PASS (0 errors)                                                                                                                                                                                                                                                      |
| 4. DB bootstrap  | `npm run db:test:setup`                                                     | PASS — clean `werefa_test` build; no schema change this prompt (reporting reads existing `booking_status_history`/`booking` via the elevated connection)                                                                                                             |
| 5. Builds        | `npm run build` (api `nest build`, dashboard `vite build`, db + shared tsc) | PASS                                                                                                                                                                                                                                                                 |
| 6. Unit tests    | `npm run test:unit` (api) + db + shared                                     | PASS — API **189** (20 files; +6 from new `booking-history-pdf.test.ts`), DB **5**, Shared **4**                                                                                                                                                                     |
| 7. Integration   | `npx vitest run test/integration` (api)                                     | PASS — **221** tests, 12 files (+7 `booking-management` block I: history report fields/filters/sort, SA-only denial, PDF stream + six columns + no-reason leak, Admin PDF denial, filter validation 400s incl. UUID-format rejection for `businessId`/`actorUserId`) |
| 8. Startup smoke | `node apps/api/dist/main.js` → `GET /api/v1/health/ready`                   | PASS — `{"status":"ok","db":"up"}`; new SA routes mapped (`GET …/super-admin/bookings/history`, `…/history/pdf`); secret masking confirmed (`DATABASE_URL":"***"`, `S3_SECRET_ACCESS_KEY":"***"`).                                                                   |

Numeric deltas vs the Prompt 15 close-out: API unit **183 → 189** (+6), integration
**214 → 221** (+7). The gate runs with the root `.env` exported (`set -a; . ./.env; set +a`) so
`DATABASE_URL`/superuser/migrator DSNs point at the local (`:5433`) Postgres.

## 3. Gap analysis (Prompt 16 §4) — evidence before code

Applied to the real implementation before any change (no fabricated mappings):

| REQ | Description                                  | Verdict              | Evidence                                                                                   |
| --- | -------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------ |
| 175 | Booking reports show current status          | IMPLEMENTED          | `listStatus` current-status aggregate (`booking-admin.service.ts`)                         |
| 176 | Admin sees current status only (no history)  | IMPLEMENTED          | admin controller never includes `statusHistory`; no history tables queried                 |
| 177 | SA views full booking status history         | IMPLEMENTED          | `superAdminDetail` returns statusHistory + paymentStatusHistory + proofs                   |
| 178 | SA exports full history to PDF               | NOT-IMPLEMENTED      | no PDF route existed → added `GET …/history/pdf` + generator                               |
| 179 | Export supports custom date range            | NOT-IMPLEMENTED      | added `from`/`to` on the export + report                                                   |
| 180 | Export covers all or one business            | NOT-IMPLEMENTED      | added optional `businessId` (one) server-validated scope                                   |
| 181 | Business multi-select not allowed            | NOT-IMPLEMENTED      | single-string `businessId` only; UI cannot select more than one                            |
| 182 | PDF has the six named fields                 | NOT-IMPLEMENTED      | enforced by `booking-history-pdf.ts` typed row (6 columns)                                 |
| 183 | PDF excludes reasons/notes                   | NOT-IMPLEMENTED      | generator never receives reason/note; integration asserts no `reason` text                 |
| 184 | Filters: status, actor, date range, business | PARTIAL              | status/business/date existed; **actor filter missing** → added `actorType`+`actorUserId`   |
| 185 | Filter AND/OR semantics                      | NOT-IMPLEMENTED      | added `in`-clauses (OR within category) across separate AND filters                        |
| 186 | Filters stateless; default 30-day window     | PARTIAL              | default window added when `from`/`to` omitted (`bookingStatusRange`/`bookingStartAtRange`) |
| 187 | Default sort newest first                    | IMPLEMENTED          | default `sortBy=date` `desc` maps to `startAt desc` / `occurredAt desc`                    |
| 188 | Sortable columns                             | NOT-IMPLEMENTED      | added `sortBy` for date, bookingId, customer, business, status, actor                      |
| 189 | Date/time exact sorting                      | NOT-IMPLEMENTED      | exact timestamp keys, chronological secondary                                              |
| 190 | Booking-ID + CONF-001 tie-breaking           | NOT-IMPLEMENTED      | `bookingSort`/`historySort` implement primary/secondary/final per CONF-001                 |
| 170 | Schedule-history PDF export                  | IMPLEMENTED          | verified green from Prompt 12 (owner + SA routes)                                          |
| 171 | Schedule-history range input                 | DEFERRED (as before) | export path exists; range input not exposed (unchanged)                                    |
| 172 | Schedule-history PDF: versions + dates only  | IMPLEMENTED          | `schedule-pdf.ts` neutral contract (unit + integration green)                              |

## 4. What was implemented

**PDF generator** (`apps/api/src/booking/booking-history-pdf.ts`):

- Dependency-free Type 1 PDF writer (same conventions as `schedule-pdf.ts`): `%PDF-1.4`, A4
  `595.28 × 841.89`, Helvetica/Helvetica-Bold, WinAnsi-only escaping, Addis wall clock (UTC+3).
- Each history row renders one wrapped line with the six approved columns (REQ-182) separated by
  `|`. The typed input (`BookingHistoryRow`) carries only `occurredAt, bookingId, customerName,
businessName, fromStatus, toStatus, actorType, actorUserId|null` so reason/note/metadata text is
  impossible to include (REQ-183). Long content wraps, never truncates identifiers.
- `buildBookingHistoryPdfExport` (unit-testable) + `bookingHistoryPdf` download contract
  (`application/pdf`, dated `booking-history-YYYY-MM-DD.pdf`).

**Service** (`apps/api/src/booking/booking-admin.service.ts`):

- `AdminListParams` gains `statuses[]`, `actorUserId`, `actorTypes[]`, `sortBy`, `sortDirection`.
- `listStatus` (current-status report, REQ-175/176): status `in`-filter (OR), default 30-day
  `startAt` window when no range given, sortable via `bookingSort` (date/bookingId/customer/
  business/status), business-name sort via the `business` include.
- `listHistory` (SA-only JSON report, REQ-177/184..190): reads `bookingStatusHistory` cross-business
  through the elevated client; filters status (OR on from/to), actor (userId and/or actorType list),
  business, date range (default 30 days); deterministic `historySort` (CONF-001), pagination
  `skip/take`; returns `{ history: HistoryRowDto[], total }` with the six fields. Records
  `BOOKING_HISTORY_VIEW`.
- `exportHistoryPdf` (SA-only, REQ-178..183): same filters/scope, ordered chronological,
  streams the PDF; records `BOOKING_HISTORY_EXPORT`.

**Controllers** (`apps/api/src/booking/booking-admin.controller.ts`, wired into the existing module):

- `GET /api/v1/super-admin/bookings/history` and `GET /api/v1/super-admin/bookings/history/pdf`
  (`@RolesExact(Role.SuperAdmin)` — Admin gets 403 on both, REQ-176/168 analog). Admin list route
  now accepts `status=a,b`, `sortBy`, `sortDirection`.
- Query validation: status/actorType enum whitelists, ISO date bounds, integer pagination.
  `businessId`/`actorUserId` are validated as UUIDs (mirrors the security-history controller; REQ
  29 parameter validation — a malformed value is a 400, never silently accepted). `status`/
  `actorType` accept comma-separated lists (OR within category, REQ-185).

**Audit types** (`apps/api/src/iam/security-events.service.ts`):

- Added `BOOKING_HISTORY_VIEW` and `BOOKING_HISTORY_EXPORT` to the exhaustive `SECURITY_EVENT_TYPES`
  (doc 22 §2: report reads/exports are audited).

**Dashboard — Super Admin report panel** (`apps/dashboard`):

- `lib/booking-report-api.ts` — typed client for `GET /api/v1/super-admin/bookings/history` and a
  `pdfUrl()` builder that carries the **current filters** into the export (REQ-179 honors the range).
- `business/BookingHistoryReportPanel.tsx` — status multi-select (OR within category), actor-type
  multi-select, actor-user-ID + business UUID inputs, Addis day-range boundaries (fixed
  UTC+3 system timezone — never browser-local), sort by column + direction, pagination with
  total, Reset (returns to the server-side 30-day default window), and an authorize-via-cookie
  "Export PDF" link. Mounted in `AdminPanel.tsx` behind a **Super Admin-only** button (Admin never
  sees the surface; the API additionally enforces 403).

**No schema/RLS change** — the reporting surface reuses `booking_status_history`/`booking` and the
existing `app_superadmin` elevated client (exactly the Prompt-15 admin/SA pattern), so tenant
isolation is unchanged.

## 5. Tests added

- Unit `apps/api/test/unit/booking-history-pdf.test.ts` (6): PDF 1.4 structure, six column headers
  (REQ-182), status `FROM->TO`, Addis wall-clock time, no reason/note/metadata leak (REQ-183),
  multi-page pagination, download contract/filename.
- Integration `apps/api/test/integration/booking-management.test.ts` block I (7): SA history report
  fields + newest-first, business/status filters + customer desc sort (REQ-184/185/188..190),
  Admin 403 on history, SA PDF stream + headers + no `reason`, Admin 403 on PDF, enumeration
  whitelist 400s (bogus status/actorType), and UUID-format 400s for `businessId`/`actorUserId` on
  the report and PDF surfaces.

## 6. IMPLEMENTED / PARTIAL / DEFERRED summary

| Area                                                  | Status       | Where / note                                                            |
| ----------------------------------------------------- | ------------ | ----------------------------------------------------------------------- |
| Booking reports show current status (REQ-175)         | IMPLEMENTED  | admin list report, filtered + sorted + default window                   |
| Admin current status only, no history (REQ-176)       | IMPLEMENTED  | admin surface never touches history tables; SA-only proven by 403 tests |
| SA views full history (REQ-177)                       | IMPLEMENTED  | JSON report + existing single-booking audit detail                      |
| SA full-history PDF export (REQ-178)                  | IMPLEMENTED  | `GET …/history/pdf` + dependency-free generator                         |
| Custom date range on export (REQ-179)                 | IMPLEMENTED  | `from`/`to` inclusive on report + PDF                                   |
| All-businesses or one-business scope (REQ-180/181)    | IMPLEMENTED  | optional single `businessId`; no multi-select                           |
| PDF six columns only (REQ-182)                        | IMPLEMENTED  | typed generator; unit-tested                                            |
| PDF excludes reasons/notes (REQ-183)                  | IMPLEMENTED  | generator cannot receive them; integration asserts absence              |
| Filters status/actor/date/business (REQ-184)          | IMPLEMENTED  | actor added this prompt; all four wired                                 |
| Filter AND/OR semantics (REQ-185)                     | IMPLEMENTED  | OR-within-category `in`; AND across categories                          |
| Stateless filters; 30-day default (REQ-186)           | IMPLEMENTED  | no persistence; default window when range omitted                       |
| Default newest-first + sortable columns (REQ-187/188) | IMPLEMENTED  | `sortBy`+`sortDirection`; default date desc                             |
| Exact date/time + CONF-001 sorting (REQ-189/190)      | IMPLEMENTED  | `bookingSort`/`historySort` chronological + tie-break order             |
| SA dashboard report panel (REQ-177/178/184..190)      | IMPLEMENTED  | `BookingHistoryReportPanel` (SA-only button in the admin panel)         |
| Server-side filter validation (REQ 29)                | IMPLEMENTED  | enum whitelists, ISO dates, ints, UUID checks on both report surfaces   |
| Schedule-history PDF + neutral content (REQ-170/172)  | IMPLEMENTED  | retained from Prompt 12, re-verified green                              |
| Schedule-history custom range input (REQ-171)         | DEFERRED     | unchanged seam as recorded in Prompt 12                                 |
| Chart/aggregate/static reports, analytics dashboards  | OUT OF SCOPE | arch doc 21 R185 — reports are read-only exports; no charts             |
| Original-250 KF-DEC mapping for REQ-175..190          | DEFERRED     | `PENDING DECISION REGISTER MAPPING` as before; no fabricated mappings   |

## 7. Prompt-17 boundary

Not started. Natural seams left for later prompts: Admin account lifecycle + forced logout
(REQ-217..221); the schedule-history PDF range input (REQ-171); the async `report_job` pipeline
(arch doc 21 §2) if live-generation becomes insufficient; applied-decision (KF/DEC) mappings for
the REQ-162..190 reporting facts remain pending the decision-register import. Requirements file and
architecture docs were **not** modified.

Final quality gate (this session, canonical commands run from the `apps/api` workspace for the
integration suite): format:check, lint, typecheck, build, db:test:setup, API unit **189** / DB unit
**5** / Shared unit **4**, integration **221** / 12 files, and startup smoke
`{"status":"ok","db":"up"}` with secret masking confirmed — all PASS. Prompt 16 is complete after
the full quality gate; Prompt 17 was not started.
