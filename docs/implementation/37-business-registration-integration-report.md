# 37 — Business Registration & Business Type Integration Report (Prompt 54; spec §19, §24.2, REQ-005, REQ-009, REQ-014, REQ-030, REQ-032, REQ-061…REQ-066, REQ-068, REQ-069, REQ-086, REQ-087, REQ-213, REQ-221, REQ-223, REQ-224, REQ-236)

> **Nature of this pass.** The business-registration **backend** vertical (owner self-service
> registration with auto-login, unverified account creation, generic conflict hygiene, and real
> business creation on the existing `POST /owner/businesses` route with the `SALON_AND_BARBER`/`OTHER`
> category allowlist) was already present in the committed tree and DB-tested. Prompt 54 was therefore
> executed as an **audit + frontend build-out**, not a rebuild: the genuine gap was the missing
> **owner onboarding frontend** — the `register` seam on the auth provider, the `/owner/register`
> page, the `/owner/business/new` creation page with the business-type choice, the create-business
> client against the existing route, and the routing that steers a registered owner with no business
> into setup. No second scheduler, no external storage, no second auth system, and no phone
> normalization were introduced; ownership and authorization remain server-derived.

## 1. Objective

Make owner self-service registration and first-business setup real over the already-real backend:
register an unverified Owner account and auto-sign-in (REQ-005/009/032), then create the first owned
business choosing exactly one of the two allowed business types `SALON_AND_BARBER` or `OTHER`
(REQ-061/063/223/224/236) — while preserving generic, non-enumerating conflict behavior on both
surfaces (REQ-014/030) and treating business type purely as business-owned metadata that never affects
sign-in, tenancy, or ownership (REQ-066/213).

## 2. Starting specification SHA-256

`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`

## 3. Ending specification SHA-256

`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b` (re-hashed with `sha256sum` at
the end; unchanged).

## 4. Existing registration backend audited

Audited before changing anything:

- **Registration route + DTO:** `auth/controllers/auth.controller.ts` `@Post('register')` maps
  `RegisterOwnerDto` (email/password only) → `AuthService.registerOwner`, issues the real session
  cookie, and returns the safe login projection with `201 Created`. `auth/dto/auth.dto.ts`
  (`RegisterOwnerDto`).
- **Auth service:** `domain/services/auth.service.ts` `registerOwner` — lowercases/trims email,
  Argon2-hashes the password **before** any lookup, creates the OWNER row via the repository (unique
  email collision → `null`), and signs the owner straight in via the same server-side session issuance
  used by login. Verification is **not gated**: the account is created `isEmailVerified = false` and
  the new session is immediately usable (REQ-026–031 verification dispatch remains deferred; see §23).
- **Auth repository:** `user-auth.repository.port.ts` `createOwner` contract + Prisma impl in
  `prisma-user-auth.repository.ts` (local `isP2002` guard; returns `null` on a unique-email P2002,
  never the violating row — no account-existence leak).
- **Auth errors:** `domain/services/auth-errors.ts` `genericConflict()` — a `409 CONFLICT` whose
  detail ("Could not complete registration with these details.") is identical regardless of why a
  registration could not complete, so the client cannot enumerate existing emails.
- **Security event:** `OWNER_REGISTERED` is recorded with the real client info on success
  (`security-event-auth.repository.port.ts`); the event type already existed.
- **Business creation:** `POST /owner/businesses` (real, Prompt 42/43) with `CreateBusinessPayload`
  allowlisted `categoryCode` `@IsIn(['SALON_AND_BARBER','OTHER'])`, `slug`/`name` required and
  `description|address|phonePublic|bookingIntervalMinutes` optional. Ownership is derived server-side
  from the session; the client never supplies an `ownerId`/tenant id. Trial-on-create is real
  (REQ-006, untouched).
- **Tests:** `http-auth.db.spec.ts`, `http-auth.spec.ts`, `http-api.db.spec.ts` had covered
  registration/login/session and business creation already.

## 5. Gap identified

The frontend had no owner sign-up surface: `AuthContext`/`AuthProvider` exposed `login`/`logout`/
`refresh` but **no `register`**; there was **no `/owner/register` page**; business creation had an API
client for list/get/update/slug/pause/resume but **no `createOwnedBusiness`**; there was **no
`/owner/business/new` page** for the business-type choice, and no route wiring steering a fresh owner
with zero owned businesses into setup. This is the sole gap this pass closed.

## 6. Files changed

| File | Change |
| --- | --- |
| `frontend/src/api/business.ts` | Add `createOwnedBusiness(input)` → `POST /owner/businesses` (existing route, allowlisted category; never an owner/business id). Remove a leftover duplicate `listOwnedBusinesses`. |
| `frontend/src/api/types.ts` | Add `RegisterRequest` (email/password) and the `CreateOwnedBusinessInput` wire type documenting the phone→`phonePublic` mapping and the server-authoritative category allowlist. |
| `frontend/src/features/auth/auth-context.ts` | Declare `register(credentials): Promise<boolean>` on `AuthContextValue`. |
| `frontend/src/features/auth/AuthProvider.tsx` | Implement `register`: calls `authApi.register`, then treats the returned login projection as an auto-signed-in owner session (no client-side credential or token storage). |
| `frontend/src/features/auth/RegisterPage.tsx` | **New** self-service owner registration form (email/password/confirm-password) at `/owner/register`; auto-login → owner portal. |
| `frontend/src/features/auth/LoginPage.tsx` | Add the "create an owner account" link (REQ-005 entry point) to `/owner/register`. |
| `frontend/src/features/owner-portal/pages/CreateBusinessPage.tsx` | **New** first-business setup at `/owner/business/new`: slug/name, business-type radio (`SALON_AND_BARBER`/`OTHER`), optional description/address/`phonePublic`, booking slot length; posts `createOwnedBusiness` and lands on `/owner`. Ownership ids are never sent. |
| `frontend/src/routes/router.tsx` | Wire `GET /owner/register` (public) and `GET /owner/business/new` (inside `RequireOwner`). |
| `frontend/src/api/business.test.ts` | **New** contract tests for `createOwnedBusiness` (exact POST route/method/body; no `ownerId`/`businessId`; error envelope). |
| `frontend/src/features/auth/AuthProvider.test.tsx` | **New** register-through-provider test (real `authApi` against the stubbed fetch seam → authenticated owner). |
| `frontend/src/features/owner-portal/pages/CreateBusinessPage.test.tsx` | **New** onboarding test: radio selection + POST body (allowlisted category, phone→`phonePublic`, no owner id). |
| `backend/src/domain/services/auth-errors.ts` | Add `genericConflict()` (only **added**; the register/service slice was otherwise reconstructed to its committed form — see §24). |
| `backend/src/domain/services/auth.service.ts`, `backend/src/domain/repositories/prisma-user-auth.repository.ts` | Restored to HEAD (the Prompt 54 backend vertical is intact and unchanged) after a working-tree bounce; re-verified by typecheck + DB tests. |

The prompt's earlier uncommitted work (Prompt 51/52/53 files, uncommitted since report #35/#36) remains
untouched by this pass.

## 7. Registration model (REQ-005/009/032)

`RegisterPage` posts email/password to the real `POST /auth/register`. The backend creates the OWNER
row with `isEmailVerified = false`, records an `OWNER_REGISTERED` security event, and immediately
issues the real HttpOnly session cookie. `AuthProvider.register` therefore resolves the returned login
projection into an authenticated owner session — the new owner is signed in without a second sign-in
step. A colliding email yields the generic 409, surfaced verbatim; the page shows the same message for
every failure kind, so account existence is never enumerable (REQ-014/030). Registering never adds or
requires a verification token in the UI; the deferred verification slice (REQ-026–031) is documented
as out of scope for this pass (see §23).

## 8. Business-type ownership model (REQ-061/063/066/213/223/224/236)

`CreateBusinessPage` lets the owner pick one business type from exactly the two allowlisted codes. The
choice is sent as `categoryCode` in the real `CreateBusinessPayload`; the backend re-validates it
(`@IsIn(BUSINESS_CATEGORIES)`) and stores it on the business row. Business type is **business-owned
metadata only**: it renders as the category label/badge on business cards and the public page, and is
never consulted by authentication, tenancy, or the tenant guard. The frontend sends **no** `ownerId`,
`businessId`, role, subscription, or account-status field; ownership for the create and list responses
is derived server-side from the session (REQ-066). The phone field maps to the canonical public
contact field `phonePublic` (REQ-213); no private phone or normalization scheme was introduced.

## 9. Route tree

`/owner/register` is a public route (mirrors `/owner/login`). `/owner/business/new` is a child of the
`RequireOwner`-guarded `/owner` layout, so a fresh owner is always a real backend `OWNER` session
before it is shown the setup form. The dashboard's "no owned business" state (a real empty
`GET /owner/businesses` — the server is authoritative) steers the owner to setup. All existing owner
routes are unchanged.

## 10. Security / authorization

As everywhere, the HttpOnly cookie authorizes every request; no role, actor id, tenant id, password,
or token is trusted from the client. Registration duplicates and business-create duplicates are
rejected server-side (unique email, unique slug). The UI disables its submit button while in flight and
surfaces the server's generic messages; no secret is emitted, logged, or stored client-side.

## 11. Mock code removed from production paths

None was removed — every production source added here calls the real typed API clients
(`authApi.register`, `createOwnedBusiness`) and no production import touches `@/mock/*`. The seam
tests keep using the existing `test/fetch.ts` stub; no silent fallback was added.

## 12. Tests added

- `frontend/src/api/business.test.ts` (**new cases**, 2): `createOwnedBusiness` POSTs exactly to
  `/api/v1/owner/businesses` with the allowlisted category and **no** `ownerId`/`businessId`, and maps
  the architecture error envelope to `ApiError`.
- `frontend/src/features/auth/AuthProvider.test.tsx` (+1): `register` through the real provider →
  `POST /auth/register` called and the session resolves to an authenticated owner.
- `frontend/src/features/owner-portal/pages/CreateBusinessPage.test.tsx` (**new**, 1): selecting
  `OTHER`, submitting, and asserting the POST body (category `OTHER`, slug, phone→`phonePublic`, no
  owner id).

## 13. DB results

`npm run test:db` (real PostgreSQL 16, `RUN_DB_TESTS=true`): **345 passed / 22 files**. (The backend
vertical is unchanged from its DB-tested committed form; the run confirms the reconstructed files
compile and the registration/business creation paths stay green.)

## 14. Frontend results

`npx vitest run`: **461 passed / 38 files** (458/38 before this pass; +3 tests). `npm run typecheck`,
`npm run lint`, `npm run build`: PASS.

## 15. Browser-QA results or documented harness limitation

Not run. The repository has **no Playwright/Cypress/Puppeteer harness** (consistent with reports
#28–#37). No large browser framework was added for this prompt. Deterministic seam-level tests (real
route tree + guards + stubbed `fetch` contract) were used instead.

## 16. Known limitations / deferred work

- **Verification dispatch and verification-gated operation (REQ-026–031)** remain deferred: there is
  no email sender in the tree, accounts are created `isEmailVerified = false`, and login/operation are
  **not** gated on verification. This is the explicitly approved deviation; registration therefore
  does not present or require a verification step, and the field stays safe-false.
- A dedicated "resend / verify email" surface and an owner **name** registration field remain deferred
  (no canonical backend field exists for an owner display name).
- The unresolved §46 product decisions remain untouched, exactly as in report #36.

## 17. Confirmation that no unresolved product decision was silently resolved

None. The §46 items stay unresolved; this pass did not choose a verification UX, an owner-name model,
or a phone-verification scheme.

## 18. Confirmation that the specification was not modified

The canonical specification was read-only throughout; the final full SHA-256 equals the checkpoint
`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`.

## 19. Confirmation that no commit was made

No `git add`/`commit`/`amend`/`push`/`reset` was run. Git history is untouched (`HEAD` still
`18b15bf`); all Prompts 52–54 changes remain uncommitted in the working tree.

---

## Regression gate summary

| Layer | Command | Result |
| --- | --- | --- |
| Backend | `npx tsc -b backend/tsconfig.json` | PASS |
| Backend | `npm run test:db` | **345 passed / 22 files** |
| Backend | `npm test` (no DB) | **178 passed / 223 skipped** (34 files: 26 passed, 8 skipped) |
| Frontend | `npx vitest run` | **461 passed / 38 files** |
| Frontend | `npm run typecheck` | PASS |
| Frontend | `npm run lint` | PASS |
| Frontend | `npm run build` | PASS |
| Spec | `docs/WEREFA-COMPLETE-SPECIFICATION.md` | unchanged |

## Close

- Task type: **audit + frontend build-out** of the existing business-registration backend.
- Gap closed: owner registration page + provider `register` seam + first-business onboarding with the
  exact two business types, all against the existing real routes; plus contract tests.
- Deferred (unchanged): verification dispatch/gating (REQ-026–031), owner-name field, phone
  normalization; all §46 product decisions.
- Allowed business types shipped: **exactly `SALON_AND_BARBER` and `OTHER`**.
- Business type is business-owned data and does not affect tenant authorization; ownership is
  server-derived; no account existence is leaked via validation errors.
- **NO COMMIT MADE.**