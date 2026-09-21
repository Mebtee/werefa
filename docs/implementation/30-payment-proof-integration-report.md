# 30 — Payment Proof Integration Report (Prompt 50; REQ-114/115/118/123/230)

## Scope

Payment proof becomes a real, stored artifact on the wire and on disk. Booking creation and
rejected-booking resubmission now **transmit the customer's proof file** (multipart) instead of
merely displaying it client-side; the backend authoritatively validates the bytes (magic-byte
sniffing, never the declared MIME), stores them behind a `PaymentProofStorage` port, links them
to a `FileObject` + `PaymentProof` row inside the booking slice transaction, and exposes a
tenant-scoped binary download for owners. The rejected-booking resubmission workflow (REQ-230) is
wired end to end: one-time expiring phone-scoped code → fresh proof → `REJECTED → PAYMENT_PENDING`
with proof lineage, the slot staying **LOCKED** throughout (REQ-123).

**Owner-portal scope (user directive): "Customer side only; owner stays mock."** The owner booking
UI keeps using `mockOwnerApi` in this prompt (deep mock coupling: string ids, a rich mock
`Booking` shape, 16 call sites; the real owner API uses numeric ids and has a different
reschedule/cancel/no-show/release surface). The already-built backend owner proof endpoints
(`GET …/bookings/:bookingId/proofs/:proofId`, proof timeline on the detail projection) are covered
by backend tests; migrating the owner UI onto `api/ownerBookings.ts` is recorded as a deferred
slice. Orphaned upload cleanup, proof lineage and download authorization are backend-verified.

## Verification results (final, run locally)

| Layer | Command | Result |
|---|---|---|
| Backend | `npm run typecheck` | PASS |
| Backend | `npm run lint` | PASS |
| Backend | `npm test` (no DB) | 142 passed / 184 skipped (21 files passed, 6 skipped) |
| Backend | `npm run test:db` (live Postgres) | **273 passed (16 files)** |
| Frontend | `npx vitest run` | **399 passed / 31 files, exit 0** (parallel run twice + `--fileParallelism=false` once, all clean) |
| Frontend | `npm run typecheck` (`tsc -b`) | PASS |
| Frontend | `npm run lint` | PASS |
| Spec | `docs/WEREFA-COMPLETE-SPECIFICATION.md` | unchanged — worktree blob `acb32c9b4defc6662fed8883af912ac4ea295021` equals `git rev-parse HEAD:` blob |

## Wire contract

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/v1/customer/bookings` | `multipart/form-data`: `payload` (JSON text) + `proof` (file, required iff computed prepaid > 0) | idempotent by `submissionKey` (REQ-121) |
| POST | `/api/v1/customer/resubmission/request-code` | JSON `{ businessSlug, phone }` | 200; code delivered out-of-band, never returned |
| POST | `/api/v1/customer/resubmission/verify` | `multipart/form-data`: `payload` (JSON: `businessSlug`, `phone`, `code`, `submissionKey`) + `proof` (file, required) | 200 `{ booking, outcome: 'PROOF_RECEIVED' }` |
| GET | `/api/v1/owner/businesses/:businessId/bookings/:bookingId/proofs/:proofId` | — | binary stream, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, tenant+booking scoped |

Both multipart controllers read the JSON from `@Body('payload')` (a **string**) and the file from
`@UploadedFile()`; the `payload`/`proof` parts are deliberately not in `@Body()` as a DTO. The
global `ValidationPipe` cannot validate a JSON *string*, so `parseMultipartPayload` re-runs the
exact class-validator rules (whitelist + `firstConstraint` field mapping) to emit the same error
envelope as JSON endpoints.

## What changed

### Backend

- `domain/lib/proof-file.ts` (new) — allow-list `PROOF_ALLOWED_MIME_TYPES`
  (`image/bmp,gif,jpeg,png,webp`, `application/pdf`), `PROOF_MAX_BYTES = 5*1024*1024`, magic-byte
  `sniffProof()` (PNG/JPEG/GIF/BMP/WebP/PDF), and deterministic `PROOF_SAMPLES` for tests.
- `domain/repositories/proof-storage.port.ts` (new) — `PaymentProofStorage` with
  `store({ businessId, bytes, mimeType, extension })`, `read(storageKey) → { bytes } | null`,
  idempotent `delete(storageKey)`.
- `domain/repositories/local-proof-storage.ts` (new) — filesystem adapter. Keys are
  `<businessId>/<uuid>.<ext>` under `proofStorageDir`; `isSafeKey` rejects traversal via a
  two-segment check and `KEY_SEGMENT = /^[a-z0-9-]+(\.[a-z0-9]+)?$/i` (the extension suffix is
  required — a stricter segment regex must still admit `.<ext>`). Swap-in-able for object storage.
- `domain/repositories/file.repository.port.ts` + `prisma-file.repository.ts` (new) — `FileObject`
  rows are created **inside** the owning slice transaction alongside the linking `PaymentProof`;
  bytes are managed separately through the storage port.
- `api/dto/multipart-payload.ts` (new) — `parseMultipartPayload(raw, dto)`.
- `types/multer.d.ts` (new) — multer 2.2.0 ships no bundled types; ambient declaration for
  `MulterError` + `memoryStorage()`.
- `config/app-config.ts` — new `proofStorageDir` (`PROOF_STORAGE_DIR`, default `./storage/proofs`).
- `domain/errors/domain-errors.ts` — `proofFileTooLarge` (413 `FILE_TOO_LARGE`),
  `proofFileTypeInvalid` (415 `FILE_TYPE_INVALID`), `proofRequired` (400 validation envelope).
- `common/errors/all-exceptions.filter.ts` — maps `MulterError` `LIMIT_FILE_SIZE` → 413; any other
  multer error → 400 malformed request.
- `common/validation/validation-setup.ts` — exports `firstConstraint` (shared by the multipart
  parser so field errors match the global pipe).
- `domain/services/booking.service.ts` — `createBooking` now takes an optional `proof`; when a
  deposit is due proof is required **before** any claim; bytes are sniffed, stored, and the
  `FileObject` + `proofFileObjectId` are written inside the advisory-lock tx. Orphan handling:
  staged object is deleted in `finally` when not consumed (idempotent replay, unavailable slot,
  aborted claim). New `getOwnerProofDownload()` (tenant-guard → booking → proof → `read`,
  missing → `businessNotFound` 404; storage key never leaves the domain).
- `domain/services/resubmission.service.ts` — resubmit now accepts a proof, validates + stages it
  **before** the transition tx (bad file never takes the booking out of `REJECTED`), then
  transitions booking `REJECTED→PAYMENT_PENDING` + payment `REJECTED→PENDING`, creates the
  `FileObject`, adds the new proof, marks the prior proof replaced (lineage), marks the code used,
  and publishes `PAYMENT_PROOF_RECEIVED`. Same orphan-cleanup + idempotent fast-path contract.
- `api/customer/customer.controller.ts` — **rewritten**: `POST bookings` and `POST
  resubmission/verify` are `multipart/form-data` with a shared `proofUploadInterceptor()`
  (`memoryStorage`, 5 MB `limits`, cheap declared-MIME `fileFilter` → 415); `request-code` and
  `status` stay JSON.
- `api/owner/booking.controller.ts` — new `GET :businessId/bookings/:bookingId/proofs/:proofId`
  streaming download; `ProofIdParamDto` (`bookingId` + UUID `proofId`).
- `api/dto/projections.ts` — `proofFileName(id, mimeType)` = `payment-proof-<id8>.<ext>`; detail
  projection emits the proof timeline (`replaced` flag from `replacedByProofId`).
- `api/dto/payloads.ts` — `ResubmissionRequestPayload`, `ResubmissionVerifyPayload`
  (6-digit `code` + `submissionKey`), `ProofIdParamDto`.
- Payment/booking repository ports + Prisma impls — `addProof`, `markProofReplaced`,
  `findProofForBooking`, `findBySubmissionKey(…, tx)`, proof timeline on the detail read.
- Tests — `api/http-api.db.spec.ts` new `describe('payment-proof uploads, download and lineage
  (Prompt 50)')` (6 cases: owner download + cross-tenant/unknown 404, deposit-with/without proof,
  declared-MIME text/plain → 415, text-mislabeled-as-PNG sniffed-rejected while the slot stays
  claimable, >5 MiB → 413, idempotent replay never orphans a file). `domain-services.db.spec.ts`
  updated for the new ctor arg order + an `InMemoryProofStorage`. `proof-file.spec.ts` (10 tests,
  incl. `it.each`), `local-proof-storage.spec.ts` (5 tests).

### Frontend

- `api/http.ts` — `body` is now `BodyInit`; a `FormData` body passes through unchanged **without**
  a forced `Content-Type` (multipart sets its own boundary); JSON bodies keep
  `Content-Type: application/json`. The FormData branch runs before the JSON stringify path.
- `api/types.ts` — `ResubmissionRequestInput`, `ResubmissionVerifyInput`, `ResubmissionRequestCodeView`,
  `CustomerResubmissionResultView`.
- `api/booking.ts` — `multipartPayload(payload, proof?)` (`payload` text field + `proof` file
  field); `createCustomerBooking(payload, proof?, signal?)` and `verifyResubmission(payload, proof,
  signal?)` are multipart; `requestResubmissionCode(payload, signal?)` stays JSON.
- `types/models.ts` — `ProofFile.file?: File` carries the raw file to the upload.
- `lib/validation.ts` — `validateProofFile` now sets `proof.file = file`.
- `features/public-booking/state/useBookingFlow.ts` — submit forwards `proof?.file ?? null` and
  requires `proof?.file` when a deposit is due.
- `features/public-booking/components/steps/PaymentStep.tsx` — copy de-mocked (no “nothing is
  really uploaded”).
- `features/customer-status/ResubmissionPanel.tsx` (new) — two-phase (`idle` → `code-requested`)
  panel: request a code, then 6-digit code + fresh proof → verify. Honest about delivery (“the
  code is delivered separately from this page…”), one stable `submissionKey` per attempt.
- `features/customer-status/BookingStatusCard.tsx` — optional `onResubmit`; renders “Resubmit
  payment proof” only for `rejected` bookings.
- `features/customer-status/BookingStatusPage.tsx` — `performLookup` extracted; `resubmitting` +
  `resubmitNotice`; success closes the panel, shows a notice, and re-runs the lookup.
- `test/businessApi.ts` (render-test wire double) — parses multipart bodies (`payload` JSON +
  `proof` File), records `RecordedRequest.proof`, adds the resubmission `request-code`/`verify`
  routes (`RESUBMISSION_TEST_CODE = '123456'`, 404 when no rejected booking, proof required),
  requires proof on create when deposit > 0, and `validationEnvelope` takes an optional detail.
- Tests — `api/booking.test.ts` create is multipart (`payload` assertion, no JSON Content-Type,
  `multipartProofOf`) + new resubmission API describe; `lib/validation.test.ts` asserts
  `result.proof.file`; `BookingStatus.test.tsx` new `rejected-booking resubmission (Prompt 50,
  REQ-230)` describe; **new** `test/customerProofNoMock.test.ts` (6 boundary tests: multipart
  client, `http` FormData ordering, `useBookingFlow` real API, `ResubmissionPanel` real API + no
  “code sent” copy, status page uses the panel not the mock, upload copy honest).
- `features/owner-portal/BookingManagement.test.tsx` — one unrelated, pre-existing timing flake
  fixed: the accept assertion now awaits the transition (`await findAllByText('Confirmed')`)
  instead of asserting synchronously after the async accept. Owner UI behavior unchanged.

## Storage & security

- **Authoritative validation is content-based.** The multer declared-MIME `fileFilter` is only a
  cheap first gate; `sniffProof` runs in the application service before any slot claim, so a
  spoofed header cannot persist a non-image/PDF, and an invalid file never locks a slot.
- **Path safety.** `LocalProofStorage` accepts only two-segment keys matching `KEY_SEGMENT`, so a
  crafted `storageKey` cannot escape `proofStorageDir`.
- **Least exposure.** Storage keys stay internal; projections expose only a synthesized
  `payment-proof-<id8>.<ext>` filename. Downloads are tenant-guarded and additionally scoped to the
  owning booking; unknown/cross-tenant ids return 404. Responses set `nosniff`.
- **Limits.** 5 MB cap enforced at multer (→ 413 `LIMIT_FILE_SIZE`) and re-checked in the service.
- **No plaintext codes.** Resubmission codes are stored sha256-hashed, single-use, expiring, capped
  by active-count + attempt count; every request/failure is recorded as a `security_event`.

## Seam audit

- **HTTP+DB seam (`http-api.db.spec.ts`, RUN_DB_TESTS-gated)** — 273/273 over 16 files on live
  Postgres, incl. the 6 new proof cases: real multipart `.field('payload', …).attach('proof', …)`
  uploads, binary download headers, cross-tenant 404, spoofed-MIME rejection with slot preservation,
  413, and idempotent-replay orphan-freedom.
- **Backend domain** — bytes never trusted from the client; snapshot/lineage driven by service
  logic behind the storage port.
- **Frontend fetch seam** — wizard + status page go through `api/booking.ts` only; the render-test
  double implements the same multipart contract and still reads the shared mock store so
  seeded/live-store lifecycle tests keep working.
- **Remaining mock seams (documented)** — owner booking UI (`mockOwnerApi`) not migrated in this
  prompt; Telegram/notification delivery of the resubmission code remains out of scope.

## Req trace

- REQ-118 (proof uploads are images/PDF, size-limited, content-validated): allow-list + 5 MB cap +
  magic-byte sniffing; enforced in unit, service and DB tests.
- REQ-114/115 (owner proof review + download): proof timeline on the owner detail projection;
  streaming download endpoint with attachment headers; tenant/booking-scoped.
- REQ-123 (rejected proof does not release the slot): resubmission transition leaves the slot
  `LOCKED`; no release path is triggered by rejection.
- REQ-230 (one-time expiring phone-scoped resubmission code + fresh proof): request-code + verify
  multipart endpoints; hashed single-use codes; proof lineage via `markProofReplaced`.
- REQ-121 (idempotent submission): booking-create and resubmission-verify both short-circuit a
  replayed `submissionKey`; replayed uploads never orphan a stored object.

## Notes / knowns

- **Owner-portal scope (user decision):** owner booking UI stays on `mockOwnerApi`; the real owner
  proof endpoints are backend-tested but not yet consumed by the UI. Migration to
  `api/ownerBookings.ts` (numeric ids, real reschedule/cancel/no-show/release) is a deferred slice.
- **Resubmission code delivery** is out of scope (spec §23.3); the UI never claims the code was
  sent — it says the code is delivered separately and to contact the business if missing.
- **Prisma fact:** `PaymentProof.fileObjectId` is a scalar `String` with no relation to
  `FileObject`; the `FileObject` is queried separately in the repository.
- **Flake fixed:** `BookingManagement.test.tsx` accept assertion was racing under parallel load; it
  now awaits the async transition. Confirmed green in three consecutive full frontend runs
  (two parallel + one serial).
- **Browser QA not run** — no Playwright/Cypress tooling exists in this repo; the deterministic
  plan is covered at the seam level by `customerProofNoMock.test.ts`, `BookingStatus.test.tsx`,
  `BookingFlow.test.tsx` and the DB proof suite.
- No commit was made (task rule: do not commit without explicit request). The working tree carries
  the accumulated prompts #25–#50 working set only.

## Close

- Repo status = expected working set only. Canonical spec unchanged (blob `acb32c9b4def…` identical
  to HEAD). NO commit made.
- Green command chain (all local, exit 0):
  backend `npm run typecheck && npm run lint && npm test` and `npm run test:db` (273 passed);
  frontend `npx vitest run` (399 passed, ×3 consecutive) `&& npm run typecheck && npm run lint`.
