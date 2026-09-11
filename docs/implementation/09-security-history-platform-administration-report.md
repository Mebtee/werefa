# 09 — Security History & Platform Administration (Prompt 15) — Section 38 Final Report

Status: **IMPLEMENTED** · Final quality-gate run: **all green** · This report is the
Prompt 15 §38 close-out (`docs/01-master-specification.md` REQ-201..206, `docs/architecture/22-audit-logging.md` §2/§3/§5/§6).
Security/activity history is now viewable and filterable per role (Owner/Admin/Super Admin),
retained one year by a scheduled purge, and deletable only by the Super Admin with the
deletion itself audited.

## 1. Conformance summary

| Dimension               | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Requirement coverage    | Owner views own account + owned-business security/activity history with server-side filters and pagination (**REQ-201**); Admin views exactly its own history with no cross-tenant knobs (**REQ-202**); Super Admin views the full platform history plus event detail and role/business filters (**REQ-203**); security events are retained one year via a scheduled bounded purge job (**REQ-204**); only the Super Admin can delete an event (**REQ-205**); every deletion is itself recorded as a fresh `SECURITY_EVENT_DELETED` audit row in the same transaction (**REQ-206**). |
| Partial                 | None required by this prompt. The reviewer queue, retention scheduling, deletion and audit are complete; the dashboard exposes owner/admin/super-admin history panels with filters and Super-Admin delete.                                                                                                                                                                                                                                                                                                                                                                           |
| Deferred (out of scope) | ~~Admin account lifecycle (REQ-217..221) remains on its dedicated later prompt as before~~ — corrected by Prompt 18 (`12-admin-account-lifecycle-platform-administration-report.md`): REQ-217..221 are now IMPLEMENTED (create/deactivate/reactivate with the max-two-active invariant serialized behind a PostgreSQL advisory lock, SA-only password change, strict Admin self-password restriction incl. reset denial, SA force-logout, welcome email, and the SA "Admin accounts" panel). Dashboard shows IP/device/browser at the agent's discretion (server always stores them per REQ-191/197). No status/type trend analytics over security history.                                                                                                                                                                                                                                                                                               |
| Explicitly omitted      | No generic `POST /security/events` (clients never supply actor/role/timestamp/IP/type — all recorded by the server); no IP/device/browser filters (not explicitly required); no soft-delete — deletion removes the row and only the audit trail remains; `metadata` is a sanitized allow-list in all responses; owner/admin responses never include `email` or raw metadata; no weakening of RLS (security_event is platform-level and access is enforced at the service layer for the Owner/Admin windows).                                                                         |

## 2. Quality gate (final, this session)

| Step             | Command                                                                            | Result                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Format        | `npm run format:check` (root)                                                      | PASS (0 files flagged)                                                                                                                                                                                                                                                                                                                                                                                               |
| 2. Lint          | `npm run lint` (api, dashboard, db, shared)                                        | PASS (0 errors). One real failure found and fixed this session: `admin2Token` was assigned but never used in `security-history.test.ts`; the token is now exercised by a strengthened Admin-isolation assertion.                                                                                                                                                                                                     |
| 3. Typecheck     | `npm run typecheck` (api, dashboard, db, shared)                                   | PASS (0 errors)                                                                                                                                                                                                                                                                                                                                                                                                      |
| 4. DB bootstrap  | `node --env-file=.env node_modules/tsx/dist/cli.mjs packages/db/src/test-setup.ts` | PASS — clean `werefa_test` build; migrations incl. `20260907_000000_security_history` + RLS bootstrap applied. The `/health/ready` probe is `{"status":"ok","db":"up"}`.                                                                                                                                                                                                                                             |
| 5. Builds        | `npm run build` (api `nest build`, dashboard `vite build`, db + shared `tsc`)      | PASS                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 6. Unit tests    | `npm run test:unit` (api) + db + shared                                            | PASS — API **183** (19 files, incl. `security-history` 16 + `retention-security-events` 5), DB **5**, Shared **4**                                                                                                                                                                                                                                                                                                   |
| 7. Integration   | `npx vitest run test/integration` (api)                                            | PASS — **214** tests, 12 files. `security-history.test.ts` (19) blocks A–H covers owner scope + filters, cross-owner isolation + spoofed-business-context inertness, admin isolation, SA platform/email/role/business filters + detail, pagination/ordering, validation 400s, SA delete + audit survival + Owner/Admin denial + 404 + concurrency-safe double-delete, retention purge boundaries + idempotent retry. |
| 8. Startup smoke | `node --env-file=.env apps/api/dist/main.js` → `GET /api/v1/health/ready`          | PASS — `{"status":"ok","db":"up"}`; all six owner/admin/super-admin security-history routes mapped; secret masking confirmed (`DATABASE_URL":"***"`, `S3_SECRET_ACCESS_KEY":"***"`). The compiled `dist` entrypoint is the verified run path.                                                                                                                                                                        |

Numeric deltas vs the Prompt 14 close-out: API unit **162 → 182** (+20), integration
**195 → 213** (+18 `security-history`). The gate commands run with the root `.env` values
exported into the shell (`set -a; . ./.env; set +a`) so `DATABASE_URL`/superuser/migrator
DSNs point at the local (`:5433`) Postgres.

## 3. What was implemented

**Data model** (`packages/db/prisma/migrations/20260907_000000_security_history`):

- `SecurityEvent.metadata` — nullable `JsonB` column for structured context (deletion audit payload, purge summary); never exposed verbatim to owners/admins.
- Indexes reworked for the history queries: `@@index([userId, createdAt])`, `@@index([businessId, createdAt])` (replacing the old single-column user/business indexes) keep the retention purge's `(createdAt)` index intact.

**Service + scoping** (`api/src/iam/security-history.service.ts`, `security-events.service.ts`):

- `SECURITY_EVENT_TYPES` const array is the single source of truth (the message-bus union is derived from it) and accepts the new `SECURITY_EVENT_DELETED` / `SECURITY_EVENT_PURGE` types; `record()` persists optional `metadata`.
- Scope windows are enforced in the service (security_event is platform-level, no RLS — doc 04 §3): Owner window is `userId = actor OR businessId ∈ ownedBusinessIds` (own account **and** own-business activity, REQ-201); Admin window is `userId = actor` only (REQ-202); Super Admin has no window (REQ-203). `ownedBusinessIds` is re-resolved from the ownership table per request by the session guard — never taken from client input.
- `applySecurityHistoryFilters` — type (enum whitelist), result (string equality), from/to (inclusive), plus SA-only businessId/userId/role filters. `page` (0-based, default 0) + `pageSize` (default 50, **max 200**) with `(createdAt, id)` deterministic ordering; response `{ events, total, page, pageSize }`.
- `sanitizeSecurityEventMetadata` — allow-list (`METADATA_ALLOW_LIST`: deletedEventId, deletedType, deletedResult, deletedAt, byUserId, purgedCount, olderThanDays, cutoff) keeps primitives only. Owner/Admin responses never include `userEmail` or `metadata`; Super Admin gets `userEmail` (user table has no RLS) plus sanitized metadata.
- `deleteAsSuperAdmin` — one `$transaction`: read target (404 if absent) → record `SECURITY_EVENT_DELETED` (subject = target userId/businessId; SA ip/device/browser; `byUserId` in metadata) → delete the row. The audit row is a fresh record inside the retention window, so it survives the target's deletion and the purge.

**Controllers** (`security-history.controller.ts`, wired into `iam.module.ts`):

- `GET /api/v1/owner/security-events` (`@RolesExact(Owner)`), `GET /api/v1/admin/security-events` (`@Roles(Admin)`), `GET /api/v1/super-admin/security-events` + `GET /api/v1/super-admin/security-events/:eventId` + `DELETE /api/v1/super-admin/security-events/:eventId` (`@RolesExact(SuperAdmin)`).
- Query validation returns `400 VALIDATION_ERROR` with field-level messages (type/result enums, UUID `businessId`/`userId`, ISO date bounds, integer pagination, role enum). Owner/Admin scopes never parse businessId/userId/role — those knobs are inert for them.

**Retention job** (`jobs/retention-security-events.job.ts`, `jobs.module.ts` now imports `IamModule`):

- `repeatCron '0 2 * * 1'` (weekly, doc 22 §5) with `SECURITY_RETENTION_DAYS=365` (REQ-204) and `SECURITY_RETENTION_BATCH=1000` bounded id/delete loops; a `SECURITY_EVENT_PURGE` audit row (purgedCount/olderThanDays/cutoff) is recorded only when something was actually purged. `runRetention()` takes an optional injectable clock (`now`, default real wall-clock — production behavior unchanged) so boundary semantics are deterministically testable. `runRetention()` is exported and unit-tested.
- Boundary semantics: the 1-year cutoff is **exclusive** (`created_at < cutoff`). Strictly-older rows are purged; an event exactly at the cutoff is retained by this run.

**Dashboard** (`apps/dashboard`):

- `lib/security-history-api.ts` — typed owner/admin/super-admin clients + the curated `SECURITY_FILTER_TYPES` option list.
- `business/SecurityHistoryPanel.tsx` — filter bar (type/result/from/to; business/role only for SA), pagination with total, result pills, IP/device/browser columns, SA `userEmail` column, and SA-only Delete with a client confirm step. Mounted as "Security & activity" in the owner hub and "Security history" in the admin/SA panel. Server-side authorization remains the real boundary.

## 4. Verification pass (this session)

The Prompt 15 commits were re-verified end-to-end this session. Genuine gaps found and fixed:

- **Lint failure:** `admin2Token` was declared and assigned but never used, so `npm run lint` failed. Fixed by exercising the token in a strengthened Admin-isolation assertion (each admin sees only its own rows, and admin 1's rows never appear in admin 2's window).
- **Cross-owner isolation test missing:** §31/§36.3 explicitly require "Tenant A cannot read Tenant B security history" and spoofed-business-context. Added a suite-local second owner (`owner2@werefa.test`) and a test proving Owner A's endpoint never returns Owner B's account or business events and ignores a spoofed `businessId` query. The second owner is seeded **inside the security-history suite** (not the shared identity helper) because `subscription-billing.test.ts` already seeds the same email — a shared-seed change caused a genuine duplicate-key regression, caught and reverted.
- **Retention boundary not exercised against the real DB:** §30/§36.5 require under-year / exact-boundary / over-year behavior, idempotent retry and purge-audit preservation. Added integration tests calling `runRetention(365, fixedNow)` against the test database: a 500-day row is purged, the exact-365-day boundary row is retained, recent rows remain, the `SECURITY_EVENT_PURGE` audit row records `purgedCount: 1`/`olderThanDays: 365`/cutoff, and retries purge nothing and do not duplicate the audit row.
- **Probe file removed:** `_dbg_insert.py` (a tracked debug leftover from the initial commit) was removed so no debug scaffolding or probe files remain.

## 5. IMPLEMENTED / PARTIAL / DEFERRED summary

| Area                                                                  | Status       | Where / note                                                              |
| --------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------- |
| Owner views own security/activity history (REQ-201)                   | IMPLEMENTED  | service window `userId OR businessId∈owned`; owner controller + dashboard |
| Cross-owner isolation (Owner A ≠ Owner B, spoofed context inert)      | IMPLEMENTED  | integration block A; suite-local `owner2` seed                            |
| Admin views own security history (REQ-202)                            | IMPLEMENTED  | `userId = actor` window; no business/user/role knobs in admin scope       |
| Super Admin platform history + filters + detail (REQ-203)             | IMPLEMENTED  | SA controller; role/business filters; event detail; email context         |
| Records retained one year (REQ-204)                                   | IMPLEMENTED  | weekly cron, `SECURITY_RETENTION_DAYS=365`, bounded batches, purge audit  |
| Retention boundary semantics + idempotent retry (REQ-204)             | IMPLEMENTED  | integration block H (exclusive cutoff, no duplicate purge audit)          |
| Super Admin can delete security records (REQ-205)                     | IMPLEMENTED  | SA-only route; Owner/Admin 403 integration-tested                         |
| Deletion itself audited (REQ-206)                                     | IMPLEMENTED  | `SECURITY_EVENT_DELETED` in same transaction, survives purge              |
| IP/device/browser captured and shown in history                       | IMPLEMENTED  | server-records UA/IP at event time; columns surfaced in dashboard         |
| History trend/statistics over security events                         | OUT OF SCOPE | not explicitly required; queue behind the analytics later                 |
| Original-250 decision-register mapping (KF-AUTH-07/08, KF-SEC-15..17) | DEFERRED     | `PENDING DECISION REGISTER MAPPING` as before; no fabricated mappings     |

## 6. Prompt-16 boundary

Not started. Natural seams left for later prompts: Admin account lifecycle + forced logout
(REQ-217..221) — the Super Admin security-history window is already the platform lens over
those events; `SECURITY_EVENT_DELETED`/`SECURITY_EVENT_PURGE` are stable event types ready for
export/reporting prompts; applied-decision (KF/DEC) mappings for the REQ-201..206 facts remain
pending the decision-register import. Requirements file and architecture doc were **not**
modified. Prompt 16 was not started.
