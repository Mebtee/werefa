# 50 — Complete mock/demo removal and real-data enforcement

**Date:** 2026-09-27
**Branch / HEAD:** `master` @ `50cfb70` (unchanged — no commit created)
**Scope:** remove every runtime mock/demo/fallback path from the frontend so that
frontend → real HTTP API → backend → PostgreSQL is the only authoritative path.

---

## 1. Executive summary

The frontend carried a complete parallel demo application behind a single accepted
seam. The demo businesses (`addis-beauty-lounge`, `marathon-auto-care`,
`riverside-dry-cleaning`), a hard-coded home slug, fabricated bank/Telebirr account
details, a client-generated QR code, a browser-only logo uploader and a set of
invented owner-booking placeholder values were all reachable at runtime.

All of it is now gone. The `frontend/src/mock/` fixture library remains exactly as
it is — it is a legitimate test asset — but no production source can import it any
more, and that is now enforced in three independent places (acceptance gate,
frontend regression suite, production bundle inspection).

The backend required **no changes**: it already had no mock/demo/fake data source,
no seed script and no automatic demo-business creation. Every production
repository is Prisma-backed.

**Net effect:** 38 files changed, +763 / −1137 lines, 3 files deleted, 2 added.
All 20 acceptance-gate checks pass.

---

## 2. Canonical specification integrity

| Item | Value |
| --- | --- |
| Spec file | `docs/WEREFA-COMPLETE-SPECIFICATION.md` |
| Required SHA-256 | `5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b` |
| SHA-256 at start | `5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b` ✅ |
| SHA-256 at end | `5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b` ✅ |
| Spec modified | **No** |

No requirement was re-classified, no product decision was taken, and none of the
explicitly out-of-scope items (REQ-094, REQ-095, REQ-139, owner booking PDF export,
§46 decisions, deferred features, unapproved providers, Prompt 38 Item 6) were
implemented.

---

## 3. Complete inventory of mock/demo/fallback paths found

### 3.1 Frontend — runtime-reachable (all removed)

| # | Path | File | Disposition |
| --- | --- | --- | --- |
| F1 | `SITE_HOME_SLUG = 'addis-beauty-lounge'` | `frontend/src/config/site.ts` | Removed |
| F2 | `PAYMENT_METHOD_FALLBACK` (fake bank + Telebirr instructions) | `frontend/src/config/site.ts` | Removed |
| F3 | `/` redirects into the demo business | `frontend/src/routes/router.tsx` | Removed; `/` now falls through to the honest not-found route |
| F4 | "Go to the demo business" link on 404 | `frontend/src/pages/NotFoundPage.tsx` | Removed |
| F5 | "Go to the demo business" link on the public booking page | `PublicBookingPage.tsx` | Removed |
| F6 | "Go to the demo business" link on the customer status page | `BookingStatusPage.tsx` | Removed |
| F7 | Fabricated payment instructions rendered to customers | `PaymentStep.tsx` | Removed; replaced with an honest notice |
| F8 | `BusinessPaymentInstructions` / `PaymentMethodInstruction` model + hard-coded `{ methods: [] }` mapper default | `types/models.ts`, `api/business.mapper.ts` | Removed — **the API has no such field** (see §5.2) |
| F9 | `mockOwnerApi` import in production (the one accepted seam) | `BusinessProfilePage.tsx` | Removed |
| F10 | `ImagePicker` — browser-only logo/cover uploader with no endpoint | `owner-portal/components/ImagePicker.tsx` | **Deleted** |
| F11 | `MockQrCode` — QR code drawn client-side from the public link | `owner-portal/components/MockQrCode.tsx` | **Deleted** |
| F12 | `TelegramNotificationsSection` — simulated Telegram notification list | `customer-status/TelegramNotificationsSection.tsx` | **Deleted** |
| F13 | Owner booking placeholders: `1970-01-01`, `00:00`, `bank-transfer`, synthetic proof object | `owner-portal/lib/ownerBooking.ts` | Removed; `date`/`time`/`paymentMethod`/`proof` are now `null` when the backend does not report them |
| F14 | Payment-method label lookup via the fabricated fallback | `BookingDetailPage.tsx` | Replaced with a real backend-enum label map |
| F15 | "mock/demonstration overlay" parameter on the business mapper | `api/business.mapper.ts` | Removed |
| F16 | Stale comments describing production files as mock-backed | 7 files | Rewritten to describe the real source |

### 3.2 Frontend — test-only (deliberately retained)

| Path | Lines | Why it stays |
| --- | --- | --- |
| `frontend/src/mock/**` | ~4,000 | Fixture library for the test suite. Unreachable from production. |
| `frontend/src/test/**` | — | Test helpers, including the stateful HTTP/business API double. |
| `*.test.ts(x)` | — | Unit/integration/UI tests, many of which drive the mock seam on purpose. |

Removing these would have deleted the test suite's data source and provided no
runtime benefit, which is exactly what the task asked not to do.

### 3.3 Backend — nothing found

| Check | Result |
| --- | --- |
| `Mock*/Fake*/Stub*Provider|Transport|Sender` classes | none |
| Mock/demo/fake repository implementations | none — all production repositories are Prisma-backed |
| Prisma seed / demo-data script | none exists in the repository |
| Automatic demo-business creation on boot | none |
| `DisabledEmailProvider` / `DisabledTelegramProvider` | **legitimate** — they report `isConfigured() = false` and `accepted: false`, so they can never claim a delivery |
| `https://t.me/werefademo` in Swagger examples / verification-code fixtures | documentation and test fixtures, not a runtime sender |
| `BUSINESS_CATEGORIES` enum | a validation constant, not mock data |

No backend source file was modified.

---

## 4. Real API path used by each surface

| Surface | Client | Endpoint | Real? |
| --- | --- | --- | --- |
| Public business page | `getPublicBusiness` | `GET /public/businesses/:slug` | ✅ |
| Public service catalogue | `getPublicServices` | `GET /public/businesses/:slug/services` | ✅ |
| Public schedule | `getPublicSchedule` | `GET /public/businesses/:slug/schedule` | ✅ |
| Availability + deposit | `postPublicAvailability` | `POST /public/businesses/:slug/availability` | ✅ |
| Booking submission | `createCustomerBooking` | `POST /public/businesses/:slug/bookings` | ✅ |
| Customer status lookup | `getCustomerBookingStatus` | `GET /public/businesses/:slug/bookings?phone=` | ✅ (phone-scoped, no internal ids exposed) |
| Owner businesses / profile | `listOwnedBusinesses`, `updateBusiness` | `/owner/businesses…` | ✅ |
| Owner bookings | `ownerBookings.ts` | `/owner/businesses/:id/bookings…` | ✅ |
| Owner proof review | `acceptOwnerBooking` / `rejectOwnerBooking` / `downloadOwnerBookingProof` | `/owner/businesses/:id/proofs/…` | ✅ |
| Owner Telegram | `getOwnerTelegramStatus` / `connectOwnerTelegram` | `/owner/businesses/:id/telegram/…` | ✅ |
| Owner subscription | `subscription.ts` | `/owner/businesses/:id/subscription` | ✅ |
| Admin | `admin` clients | `/admin/…` | ✅ |
| Auth | `auth.ts` | `/auth/…` | ✅ |

`frontend/src/api/business.ts` keeps a request-collapse cache. That is real-data
caching (it memoises an in-flight HTTP request), not a fallback, and was retained.

`OwnerBusinessProvider` writes only the **selected business id** to `localStorage`
— a UI preference pointer to a real row, not cached business data. Verified.

---

## 5. Public lookup chain — verified against the real database

### 5.1 Chain

```
GET /api/v1/public/businesses/:slug
  → OwnerPublicController (public.controller.ts)
  → BusinessService / catalog + schedule + settings queries
  → PrismaBusinessRepository (Prisma → PostgreSQL)
  → publicBusinessProjection()  (backend/src/api/dto/projections.ts:42)
```

### 5.2 Two API facts discovered during verification

1. **`branding` is always null.** `publicBusinessProjection()` hard-codes
   `branding: { logoUrl: null, coverUrl: null }` with the comment *"Media urls are
   always null until the real file storage service lands"*. There is no upload
   endpoint, so the previous `ImagePicker` could only ever have written to browser
   memory. Rendering branding read-only is the only truthful behaviour.
2. **There is no payment-instructions field anywhere in the API.** Not in
   `PublicBusinessView`, not in the Prisma schema (`business` has only
   `prepayment_mode`, `prepayment_percent`, `prepayment_fixed_minor`). The old
   `paymentInstructions` object was therefore frontend-only scaffolding, and the
   `PAYMENT_METHOD_FALLBACK` was the sole source of its content. Both are gone; the
   customer is now told plainly that no payment details are published online and
   must ask the business where to send the deposit. The deposit **amount** is still
   the backend-computed value from the availability response.

### 5.3 Runtime evidence (backend running on `:3000`, real PostgreSQL on `:5433`)

| Request | Result |
| --- | --- |
| `GET /api/v1/system/health` | `200` |
| `GET /api/v1/system/ready` | `200` |
| `GET /api/v1/public/businesses/addis-beauty-lounge` | `404 NOT_FOUND` |
| `GET /api/v1/public/businesses/marathon-auto-care` | `404 NOT_FOUND` |
| `GET /api/v1/public/businesses/riverside-dry-cleaning` | `404 NOT_FOUND` |
| `GET /api/v1/owner/businesses` (no session) | `401` |

The demo slugs are not special-cased anywhere; they 404 because the database has no
such rows, which is the required honest outcome. A business cannot be fabricated to
make them resolve.

---

## 6. Real database truth (`werefa_dev`, PostgreSQL 16 in Docker, port 5433)

| Table | Rows |
| --- | --- |
| `business` | **0** |
| `user` | 1 (`tamenebehailu@gmail.com`, role `OWNER` — a real registered owner) |
| `business_category` | **0** |
| `service` | 0 |
| `booking` | 0 |
| `business` with `public_slug = 'addis-beauty-lounge'` | **0** |

No demo or seed rows exist. The single user row predates this task and is real
account data, not a fixture; it was left untouched.

The correct consequence is that **no public page can be demonstrated end-to-end**,
because there is no business to demonstrate. The 387 DB-gated backend tests, which
do exercise the public chain against real rows, are the evidence that the chain
works.

### 6.1 Deployment blocker found: `business_category` ships empty

`business.category_code` has a `RESTRICT` foreign key to `business_category(code)`,
but no migration or script ever populates that table. Verified directly:

```
BEGIN;
INSERT INTO business (id, public_slug, category_code, name, updated_at)
VALUES (gen_random_uuid(),'probe-slug','SALON_AND_BARBER','Probe',now());
ERROR:  insert or update on table "business" violates foreign key constraint
        "business_category_code_fkey"
DETAIL:  Key (category_code)=(SALON_AND_BARBER) is not present in table "business_category".
ROLLBACK;
```

`POST /owner/businesses` validates `categoryCode` against the `BUSINESS_CATEGORIES`
enum (`@IsIn(BUSINESS_CATEGORIES)` in `backend/src/api/dto/payloads.ts:159`), so a
valid enum value passes DTO validation and then fails at the database. There is no
`P2003` mapping anywhere in `backend/src`, so this surfaces as an unmapped server
error rather than a clean validation message.

**Impact:** on a freshly provisioned database the first business cannot be created
at all. **Not fixed here** — populating a reference table is new data and a schema
concern outside this task's scope, and manufacturing rows was explicitly excluded.
It is recorded as a release blocker in §12.

### 6.2 Environment note: `werefa_test` had never been migrated

`npm run db:reset` / `db:provision` create both databases but do not apply
migrations to `werefa_test`, so `npm run test:db` failed at setup with
`relation "notification_delivery" does not exist` (9 suites failed before running
a single assertion). Fixed in the environment (not in code) by deploying the
migrations to the test database with the repository's own tooling:

```
MIGRATOR_DATABASE_URL=postgresql://werefa_migrator:…@localhost:5433/werefa_test \
  npm run prisma:deploy
```

After that, both required `test:db` runs passed. A fresh clone following only
`README.md` §"requires the provisioned werefa_test DB" will hit the same wall;
this is documented in §12 as a setup-doc gap.

---

## 7. Owner surfaces

* Business profile: real `OwnerBusinessView` fields over rendering-only defaults
  (label, accent colour, blank description). Branding is **read-only** and states
  plainly that no upload endpoint exists. QR code removed; the real public link and
  a copyable URL are shown instead.
* Bookings list/detail: no fabricated slot, payment method or proof. A value the
  backend did not report renders as an explicit "not available" marker. The type
  model was changed to make this honest (`date`, `time`, `paymentMethod`, `proof`
  are nullable) rather than papering over it with placeholders.
* Proof review, conflict/exception handling, pause/resume, schedule editor, services:
  unchanged behaviour, all real API.

## 8. Customer surfaces

* Booking flow: real availability, real deposit, real submission, real status
  lookup by phone.
* No demo links, no simulated Telegram list, no invented payment details.

## 9. Payment / proof

* Deposit amount: backend-computed (`requiredPrepaidMinor`).
* Method codes: only the two the booking API accepts (`BANK_TRANSFER`,
  `TELEBIRR`), labelled from a new `frontend/src/lib/paymentMethods.ts`.
* Proof: real file validation, real upload, real owner review. No fabricated
  account numbers anywhere in production source (enforced by a regression test).

## 10. Telegram / email / subscription / file storage

* Telegram: real connect/status endpoints; no simulated notification component.
* Email: `DisabledEmailProvider` unchanged — it cannot report a delivery.
* Subscription: real `OwnerSubscriptionView`; the legacy `subscriptionStatus` field
  on `BusinessDetails` remains removed.
* File storage: **absent by design** (Prompt 28). No upload UI, no data-URL
  "storage", no placeholder image. Reported, not faked.

---

## 11. Test-only mocks retained (and why)

`frontend/src/mock/**` + `frontend/src/test/**` are untouched in substance and
remain the fixture source for ~500 tests. What changed is reachability: production
code can no longer import them. A dedicated test
(`frontend/src/test/noRuntimeMockData.test.ts`) asserts both halves of that — the
prohibition *and* that the fixture library still exists, so a future "no mocks"
cleanup cannot quietly delete the suite's data source.

---

## 12. Limitations, gaps and release notes

1. **Release blocker — empty `business_category`.** First-business onboarding fails
   with an unmapped FK error on any fresh database (§6.1). Needs a migration that
   seeds the reference table, plus a `P2003` → validation-error mapping.
2. **No owner-reachable business.** With 0 businesses there is no way to exercise
   the owner portal or a successful public booking against real data without
   creating data, which was out of scope.
3. **No file storage.** Logo/cover upload and the QR code are genuinely missing
   features, not bugs; the UI now says so instead of pretending.
4. **No owner-published payment instructions in the API.** The customer payment step
   is honest but cannot be completed end-to-end from the web alone; the business
   must be contacted out-of-band. Adding an instructions field is a new contract
   decision, deliberately not made here.
5. **`werefa_test` migration step is undocumented** in `README.md` (§6.2).
6. **No browser QA.** The repository contains no Playwright/Puppeteer harness
   (`rg -l "playwright|puppeteer"` over all package manifests → no match), and
   building one was out of scope, so runtime UI verification was done through jsdom
   tests and direct HTTP calls only.

### Pre-existing issues found and fixed (not caused by this work)

Each was confirmed against a clean `git stash` baseline before being touched.

| Issue | Root cause | Fix |
| --- | --- | --- |
| `http.test.ts` "throws when no base URL is configured for a production build" failed | the test passed `undefined`, which selects the parameter default and therefore read the developer's real `VITE_API_BASE_URL` from `.env.local` | pass an explicit blank value; the assertion is unchanged and now hermetic |
| `OwnerBusinessSelection.test.tsx` "restores a valid remembered business" failed **only while a backend was running on :3000** | the API test double delegated unstubbed URLs to the real `globalThis.fetch`; the real backend answered `401`, which fired the app's global 401 handler and logged the user out mid-test | the suite's global `fetch` now rejects loudly instead of touching the network (`src/test/setup.ts`), so the suite is hermetic. A genuine secondary bug was fixed too: an unmounted `OwnerBusinessProvider` could still write `localStorage` from a late async `reload()` (`mountedRef` guard) |
| `BookingStatus.test.tsx` "creates a booking, finds it by phone…" timed out under the acceptance gate | the test takes ~4.4 s against vitest's default 5 s budget — it was already borderline before this task (measured on the clean baseline) | explicit `{ timeout: 30_000 }`, matching the other UI end-to-end tests in the repo. No assertion was changed |

---

## 13. Exact commands run and their results

### Backend (`backend/`)

| Command | Result |
| --- | --- |
| `npm run typecheck` | ✅ pass |
| `npm run lint` | ✅ pass (`--max-warnings=0`) |
| `npm test` | ✅ **199 passed**, 246 skipped (10 DB-gated files skipped by design), 40 files |
| `npm run test:db` (1st run) | ✅ **387 passed**, 28 files |
| `npm run test:db` (2nd run) | ✅ **387 passed**, 28 files — idempotent, as required |
| `npm run build` | ✅ pass |

### Frontend (`frontend/`)

| Command | Result |
| --- | --- |
| `npm run typecheck` | ✅ pass |
| `npm test` | ✅ **512 passed** (503 pre-existing + 9 new), 44 files |
| `npm run lint` | ✅ pass |
| `npm run build` | ✅ pass — 140 modules |

### Repository root

| Command | Result |
| --- | --- |
| `npm run acceptance` | ✅ **PASS — 20 of 20 checks** |
| `npm run acceptance:static` | ✅ **PASS — 11 of 11 checks** |

### Production-bundle inspection (`frontend/dist/`)

| Probe string | Result |
| --- | --- |
| `addis-beauty-lounge` | absent |
| `Demo Bank` | absent |
| `werefademo` | absent |
| `PRIMARY_BUSINESS_SLUG` | absent |
| `Book a slot at Addis` | absent |

The mock fixture library is not in the shipped bundle at all.

---

## 14. Guards added (each one verified to fail when violated)

1. **`scripts/acceptance.mjs` — `provider-safety` check.** The
   `ACCEPTED_MOCK_SEAMS` exception is **deleted**; there is now no accepted seam.
   Four new assertions:
   * no production frontend source imports `@/mock/*`;
   * no production source hard-codes a demo business slug;
   * no production source declares `SITE_HOME_SLUG` / `PAYMENT_METHOD_FALLBACK`;
   * no production source generates a QR code, and the branding page contains no
     mock upload editor.

   Verified by temporarily injecting each violation into
   `frontend/src/config/site.ts` — all four failed the gate with the expected
   message, and the gate returned to PASS after restoring the file.
2. **`frontend/src/test/noRuntimeMockData.test.ts` (new, 9 tests).** Prohibits
   `@/mock/*` imports, `@/test/*` imports, demo slugs, the removed config keys,
   client-side QR generation and invented account details in production source; it
   also closes the relative-path bypass (`../../mock/store`) and asserts the fixture
   library still exists. Verified by injecting both an alias import and a relative
   import — each failed as expected.
3. **Production bundle check** (§13) as an end-to-end confirmation.

---

## 15. Complete list of changed files

### Deleted (3)

```
frontend/src/features/customer-status/TelegramNotificationsSection.tsx
frontend/src/features/owner-portal/components/ImagePicker.tsx
frontend/src/features/owner-portal/components/MockQrCode.tsx
```

### Added (2)

```
frontend/src/lib/paymentMethods.ts               real backend method-id → label map
frontend/src/test/noRuntimeMockData.test.ts      no-runtime-mock regression guard
```

### Modified (35)

```
frontend/src/api/availability.mapper.ts          stale "still-mock" comment corrected
frontend/src/api/business.mapper.ts              demo overlay + fabricated paymentInstructions removed
frontend/src/api/http.test.ts                    hermetic base-URL assertion
frontend/src/api/schedule.mapper.ts              stale "mock availability fixture" comment corrected
frontend/src/api/types.ts                        stale mock-seam comment corrected
frontend/src/config/site.ts                      SITE_HOME_SLUG + PAYMENT_METHOD_FALLBACK removed
frontend/src/features/customer-status/BookingStatus.test.tsx        timeout headroom (§12)
frontend/src/features/customer-status/BookingStatusPage.tsx         demo link removed
frontend/src/features/owner-portal/BookingManagement.test.tsx       nullable booking fields
frontend/src/features/owner-portal/BookingsPage.test.tsx            nullable booking fields
frontend/src/features/owner-portal/OwnerPortal.test.tsx             branding/QR tests → honest read-only tests
frontend/src/features/owner-portal/PaymentProofReview.test.tsx      nullable proof field
frontend/src/features/owner-portal/lib/bookingQuery.ts             nullable slot handling
frontend/src/features/owner-portal/lib/ownerBooking.ts              placeholder values removed
frontend/src/features/owner-portal/pages/BookingDetailPage.tsx      honest nulls + real method labels
frontend/src/features/owner-portal/pages/BookingsPage.tsx           honest nulls
frontend/src/features/owner-portal/pages/BusinessProfilePage.tsx    mock API import + upload UI + QR removed
frontend/src/features/owner-portal/state/OwnerBusinessProvider.tsx  unmounted-write guard
frontend/src/features/public-booking/BookingFlow.test.tsx           demo-link + fake-instruction tests
frontend/src/features/public-booking/PublicBookingPage.tsx         demo link removed
frontend/src/features/public-booking/components/steps/PaymentStep.tsx  honest payment notice
frontend/src/mock/api.ts                         nullable-safe customer projection
frontend/src/mock/availability.test.ts           fixture updated
frontend/src/mock/bookings.test.ts               nullable-safe assertions
frontend/src/mock/data.ts                        fabricated fixture instructions removed
frontend/src/mock/lifecycle.test.ts              nullable-safe assertions
frontend/src/mock/store.ts                       nullable-safe guards
frontend/src/pages/NotFoundPage.tsx              demo link removed
frontend/src/routes/router.tsx                   demo redirect removed
frontend/src/styles/tokens.css                   stale "(mock)" comment corrected
frontend/src/test/businessApi.ts                 nullable-safe test helpers
frontend/src/test/customerBookingNoMock.test.ts  demo-identity + payment-fallback guards
frontend/src/test/setup.ts                       hermetic global fetch
frontend/src/types/models.ts                     nullable booking fields; paymentInstructions removed
scripts/acceptance.mjs                           accepted seam removed; 4 new guards
```

### Unchanged

`backend/**` — no source change was necessary; the backend had no runtime mock path.
`docs/WEREFA-COMPLETE-SPECIFICATION.md` — untouched, hash verified.

---

## 16. Working-tree status and commit statement

```
 M frontend/src/api/availability.mapper.ts
 M frontend/src/api/business.mapper.ts
 M frontend/src/api/http.test.ts
 M frontend/src/api/schedule.mapper.ts
 M frontend/src/api/types.ts
 M frontend/src/config/site.ts
 M frontend/src/features/customer-status/BookingStatus.test.tsx
 M frontend/src/features/customer-status/BookingStatusPage.tsx
 D frontend/src/features/customer-status/TelegramNotificationsSection.tsx
 M frontend/src/features/owner-portal/BookingManagement.test.tsx
 M frontend/src/features/owner-portal/BookingsPage.test.tsx
 M frontend/src/features/owner-portal/OwnerPortal.test.tsx
 M frontend/src/features/owner-portal/PaymentProofReview.test.tsx
 D frontend/src/features/owner-portal/components/ImagePicker.tsx
 D frontend/src/features/owner-portal/components/MockQrCode.tsx
 M frontend/src/features/owner-portal/lib/bookingQuery.ts
 M frontend/src/features/owner-portal/lib/ownerBooking.ts
 M frontend/src/features/owner-portal/pages/BookingDetailPage.tsx
 M frontend/src/features/owner-portal/pages/BookingsPage.tsx
 M frontend/src/features/owner-portal/pages/BusinessProfilePage.tsx
 M frontend/src/features/owner-portal/state/OwnerBusinessProvider.tsx
 M frontend/src/features/public-booking/BookingFlow.test.tsx
 M frontend/src/features/public-booking/PublicBookingPage.tsx
 M frontend/src/features/public-booking/components/steps/PaymentStep.tsx
 M frontend/src/mock/api.ts
 M frontend/src/mock/availability.test.ts
 M frontend/src/mock/bookings.test.ts
 M frontend/src/mock/data.ts
 M frontend/src/mock/lifecycle.test.ts
 M frontend/src/mock/store.ts
 M frontend/src/pages/NotFoundPage.tsx
 M frontend/src/routes/router.tsx
 M frontend/src/styles/tokens.css
 M frontend/src/test/businessApi.ts
 M frontend/src/test/customerBookingNoMock.test.ts
 M frontend/src/test/setup.ts
 M frontend/src/types/models.ts
 M scripts/acceptance.mjs
?? frontend/src/lib/paymentMethods.ts
?? frontend/src/test/noRuntimeMockData.test.ts
```

```
38 files changed, 763 insertions(+), 1137 deletions(-)
```

**No commit was created.** Branch `master` is still at `50cfb70`; every change above
is staged in the working tree only, exactly as requested. The only file added to
disk outside the repository tree is the gitignored `frontend/.env.local`
(`VITE_API_BASE_URL=http://localhost:3000/api/v1`), which the dev server needs and
which is excluded from version control.
