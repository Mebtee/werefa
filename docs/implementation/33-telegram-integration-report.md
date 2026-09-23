# 33 — Telegram Integration Report (Prompt 51; §23.3, REQ-056/065/066/067/068 + N09/R/security-events)

## Scope

Prompt 51 vertical: real Telegram webhook/connect API + notification delivery on the backend, and
replacement of the frontend's mock-only Telegram state with live client behavior for the public
booking Done step, the customer status page and the owner Dashboard.

**Explicit non-scope:** no disconnect endpoint (backends have none — do not invent); code
conveyance solely via the one-time deep link (the plain 10-minute single-use code is never exposed);
the six unresolved product decisions in the spec remain unresolved.

## Verification results (final, local)

| Layer | Command | Result |
|---|---|---|
| Backend | `npm run typecheck` | PASS |
| Backend | `npm run lint` | PASS |
| Backend | `npm run build` | PASS |
| Backend | `npm test` (no DB) | **168 passed / 210 skipped** (24 files passed, 7 skipped) |
| Backend | `npm run test:db` (throwaway PostgreSQL 18, port 5433) | **322 passed / 19 files** — confirmed green again in this session |
| Frontend | `npx vitest run` | **430 passed / 35 files, exit 0** (baseline 416/34; +14 tests/+1 file) |
| Frontend | `npm run typecheck` (`tsc -b`) | PASS |
| Frontend | `npm run lint` | PASS |
| Frontend | `npm run build` (vite) | PASS |
| Spec | `docs/WEREFA-COMPLETE-SPECIFICATION.md` | unchanged — SHA-256 `5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b` |

## What changed — backend (Prompt 51, summed here)

- New `backend/src/domain/notifications/` module: tenant-scoped notification delivery, single-use
  SHA-256 10-minute connect codes, `update_id` dedupe, constant-time secret comparison, N09
  PAYMENT_PROOF_RECEIVED with Accept/Reject callbacks, 1h/24h reminder delivery.
- New connect/status endpoints: `POST /public/businesses/:slug/telegram/connect` (customer, by
  phone), `GET`/`POST /owner/businesses/:id/telegram/status|connect` (acting owner). All return
  `{ status: 'ready'|'connected', deepLink, expiresInMs }`; `/customer/status` gained
  `telegramConnected`. Security events `TELEGRAM_CALLBACK` / `TELEGRAM_REJECT_REASON` deliberately
  carry no `businessId` (best-effort telemetry).
- Migrations `20260923115000_telegram_notifications` + `20260923120000_telegram_code_hash_unique`.
- Tests: `telegram.db.spec.ts` (20 tests, green) covering the connect contract, deep-link-only code
  conveyance, single-use/expiry, dedupe/idempotency, tenant scoping, reminders and white-box
  remediation; `domain-services.db.spec.ts` REQ-121 concurrent same-key race assertion aligned to the
  real contract (`fulfilled >= 1`, exactly one proof, booking `PAYMENT_PENDING`).

## What changed — frontend (this session)

### Real API client
- `src/api/telegram.ts` (new): `connectCustomerTelegram(slug, phone)`, `getOwnerTelegramStatus(bizId)`,
  `connectOwnerTelegram(bizId)` against exactly the implemented routes; `telegramLinkFromView` maps
  the wire view into `TelegramLinkState` (`connected` | `ready { deepLink, expiresAtMs }`) — the
  absolute expiry is derived at response time so the UI counts down without trusting a client clock.
- `src/api/booking.mapper.ts`: `telegramConnectedFromView`.
- `src/api/types.ts`: `telegramConnected: boolean` on `CustomerStatusView`; added
  `TelegramCustomerConnectInput`, `TelegramConnectionView`, `OwnerTelegramStatusView`.
- `src/api/business.mapper.ts`: removed the fabricated `telegramConnected: false` from the production
  business projection; `src/types/models.ts` marks `BusinessDetails.telegramConnected` optional,
  documented as mock-seam only (owner connection state now comes from the owner status endpoint).

### UI
- `features/public-booking/components/steps/TelegramConnectCard.tsx` (new): optional by-phone connect
  on the Done step — prefilled from booking details, fires the real `public/telegram/connect` only on
  click, never blocks or re-routes the booking on success/failure, renders the one-time deep link +
  live mm:ss countdown (expiry → retry) using the existing `.telegram panel/status` styles; wired into
  `DoneStep.tsx` created branch, keeping the "Do you use Telegram?" headline.
- `features/customer-status/BookingStatusPage.tsx`: results now project the live `telegramConnected`
  as a separate page-level `.telegram-status` line (never inside a booking card).
- `features/owner-portal/components/TelegramOwnerCard.tsx` (new) + `DashboardPage.tsx`: owner
  Telegram card keyed by real `businessId`, initial status via `GET owner telegram/status`, connect
  issues the one-time link; connected state hides actions (no disconnect).

### Tests
- `src/api/telegram.test.ts` (new, 9): wire routes/methods/body, ready-vs-connected mapping, no-plain-
  code contract, error envelope → `ApiError`.
- `BookingFlow.test.tsx` (new e2e): links Telegram on the Done step through the real public route,
  prefilled phone, deep link + countdown, boundary proof the POST carried the phone.
- `BookingStatus.test.tsx` (+2): `Not connected` / `Telegram connected` page-level line via the live
  `/customer/status` projection (tests seed `setCustomerTelegramConnected` in the shared store).
- `OwnerPortal.test.tsx` (+2): REQ-065 deep-link connect flow; REQ-066 seeded connected state.
- `src/test/businessApi.ts`: double now serves `public/telegram/connect`, owner `telegram/status`+
  `connect` (ready→connected lifecycle modeled), customer-status `telegramConnected` via the shared
  store; `ownerTelegramConnected` seeding option.

## Seam audit

- **HTTP+DB seam (`http-api.db.spec.ts`/`telegram.db.spec.ts`, RUN_DB_TESTS-gated)** — 322/322 over
  19 files on the throwaway PostgreSQL 18; DB suite shares one `werefa_test` database with no
  per-test reset, so assertions are scoped per business/test with before/after lookups.
- **Frontend** — real-API boundary tests (`BookingFlow.test.tsx`, `BookingStatus.test.tsx`,
  `OwnerPortal.test.tsx`, `api/telegram.test.ts`) gate the client contract; no production page reads
  a mock Telegram field anymore.
- **Browser QA not run** — no Playwright/Cypress tooling exists in this repo (consistent with
  reports #28–32); deterministic seam-level coverage is the substitute and is green. The demo booking
  for `addis-beauty-lounge` was therefore not created.

## Req trace

- REQ-056 (customer connect by phone): public connect endpoint + optional Done-step card; status page
  projects `telegramConnected` per business+phone.
- REQ-065/066 (owner connect one-time link / connected status): owner status + connect endpoints,
  Dashboard card, no disconnect.
- REQ-067/068 (N09 proof-notification Accept/Reject callbacks): unchanged backend delivery, surfaced
  textually on the owner Telegram card.
- N01–N08 (deliver only when connected), R (1h/24h reminders), `update_id` dedupe, constant-time
  comparison, security events: covered by the 20 backend DB tests.

## Notes / knowns

- No commit was made (task rule). The working tree carries the intended Prompt 51 set plus the
  frontend files listed above; report #32 (itself uncommitted) documents the previous item.
- Spec unchanged — SHA-256 `5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`.
- Frontend gate numbers moved from 416/34 to **430/35**; backend npm test stayed 168/210 with the DB
  suite at **322/19**. All green in this session.

## Close

- Repo status = expected working set only (listing captured from `git status --porcelain`). Canonical
  spec unchanged. **NO commit made.**
- Green chain (all local, exit 0): backend `npm run typecheck && npm run lint && npm run build &&
  npm test` (**168 passed/210 skipped**) and `npm run test:db` (**322 passed**); frontend
  `npx vitest run` (**430 passed/35 files**) `&& npm run typecheck && npm run lint && npm run build`.