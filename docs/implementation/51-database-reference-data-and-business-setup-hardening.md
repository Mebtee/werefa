# 51 — Database Reference Data & Business Setup Hardening

Prompt: **Prompt 67 — Werefa Fresh-Database Reference Data & Business Setup Hardening**
Status: **COMPLETE** — one new migration, one new provisioning helper, one new regression suite
Report date: 2026-09-27
Repository: Werefa (`master`, uncommitted working tree; no commit made)

> A fresh database can now create its first real business. The canonical
> specification was not modified, no product decision was made, no demo/mock
> runtime data was added, and no provider, §46 item or Prompt 38 Item 6 concern
> was touched.

---

## 1. Root cause

The owner setup form returned:

```
Setup failed
Internal server error
```

The failure was **not** in the frontend, the DTO layer, the controller or the
service. It was a missing database invariant:

1. `business_category` is a **lookup table**, and every migration created it
   **empty**. Verified: `rg -n "^INSERT" backend/prisma/migrations/` returned
   *no matches* across all eight pre-existing migrations — the reference rows
   had never been provisioned by anything.
2. `business.category_code` is `NOT NULL` and references
   `business_category(code)` `ON DELETE RESTRICT`.
3. `POST /api/v1/owner/businesses` therefore failed on a fresh database with a
   Prisma **`P2003` foreign-key violation** on `business_category_code_fkey`.
4. `AllExceptionsFilter` (`backend/src/common/errors/all-exceptions.filter.ts`)
   only recognises `AppError`, `MulterError` and `HttpException`. A raw
   `PrismaClientKnownRequestError` matches none of them, so it fell through to
   the generic `else` branch and was serialised as a safe-but-opaque
   `500 INTERNAL_ERROR / "An unexpected error occurred."`

The full request chain was traced and reproduced live, not assumed:

```
frontend CreateBusinessPage setup form
  → frontend/src/api/business.ts (createBusiness)
  → POST /api/v1/owner/businesses
  → BusinessController.create           (src/api/owner/business.controller.ts:53)
  → CreateBusinessPayload               (@IsIn(BUSINESS_CATEGORIES) — validation PASSES)
  → BusinessService.createBusiness      (src/domain/services/business.service.ts:65)
  → BusinessRepository.createForOwner
  → Prisma $transaction
  → PostgreSQL: INSERT INTO business … → ERROR 23503
  → PrismaClientKnownRequestError P2003 (constraint business_category_code_fkey)
  → AllExceptionsFilter else-branch → HTTP 500 INTERNAL_ERROR
```

Note that the DTO layer **accepted** the request correctly. `SALON_AND_BARBER` is
a valid enum value; the database simply had no row for it. That is precisely why
the failure surfaced as a 500 rather than a validation error.

### Observed reproduction (before the fix)

```
POST /api/v1/owner/businesses
{"slug":"tame-hair-studio","categoryCode":"SALON_AND_BARBER","name":"Tame Hair Studio"}
→ HTTP 500 {"error":{"code":"INTERNAL_ERROR","title":"Internal server error", …}}
```

Server log:

```json
{ "code": "P2003",
  "meta": { "modelName": "Business", "constraint": "business_category_code_fkey" },
  "clientVersion": "6.19.3",
  "name": "PrismaClientKnownRequestError" }
```

## 2. Exact failing foreign key

Read from `pg_constraint` (not inferred):

| Property | Value |
| --- | --- |
| Constraint name | `business_category_code_fkey` |
| Table | `business` |
| Column | `category_code` |
| Referenced table | `business_category` |
| Referenced column | `code` (primary key `business_category_pkey`) |
| Full definition | `FOREIGN KEY (category_code) REFERENCES business_category(code) ON UPDATE CASCADE ON DELETE RESTRICT` |
| Prisma error code | `P2003` (PostgreSQL `23503`) |
| Attempted category value | `SALON_AND_BARBER` (valid per `BUSINESS_CATEGORIES`) |
| Reference-data contents before fix | **0 rows** |
| Businesses before fix | 0 |

Created in `20260916123842_init_domain_schema/migration.sql:723`. Because the
referential action is `RESTRICT`, the rows cannot be silently deleted later while
a business references them.

## 3. Existing category model

`business_category` is a **table, not a Prisma enum** — which is exactly why it
can be empty at runtime, and why this failure was possible:

```prisma
model BusinessCategory {          // backend/prisma/schema.prisma:229
  code       String     @id @db.VarChar(32)
  label      String     @db.VarChar(128)
  businesses Business[]
  @@map("business_category")
}
```

The canonical codes already existed in exactly one authoritative place, and were
**not** changed by this task:

```ts
// backend/src/api/dto/payloads.ts:148
export const BUSINESS_CATEGORIES = ['SALON_AND_BARBER', 'OTHER'] as const;
```

Both `CreateBusinessPayload.categoryCode` and `UpdateBusinessPayload.categoryCode`
validate with `@IsIn(BUSINESS_CATEGORIES)`, so the API can only ever accept these
two codes. The canonical labels (`'Salon & Barber'`, `'Other'`) were taken from the
pre-existing `PublicCategoryView` Swagger example and from the hand-written seeds
the DB specs already used — they were not invented here.

**No category was added, renamed or extended.** Exactly `SALON_AND_BARBER` and
`OTHER` are provisioned, and a test asserts that no third row exists.

## 4. Reference-data provisioning mechanism

**Chosen mechanism: a Prisma migration.** The prompt asked to prefer the
repository's existing provisioning architecture, and for `business_category` — a
`String`-keyed lookup table, not an enum — a migration is the correct and
conventional Prisma mechanism. It was chosen over a seeding script or a
startup-time bootstrap because:

- it is part of the **versioned schema history**, so every environment (dev,
  test, CI, staging, production) receives it through the single existing
  `prisma:deploy` path with **no new bootstrap system**;
- it runs in the **migrator** role, which already owns DDL; the non-privileged
  runtime `app` role is never asked to write;
- it is applied **before** the application ever serves a request, so no window
  exists in which setup can fail;
- the acceptance gate's existing `db-safety` check already validates migration
  completeness, so the mechanism is covered by the release gate.

Explicitly **not** used, and why:

| Rejected option | Reason |
| --- | --- |
| Insert rows into the current dev DB by hand | Would fix one machine only; not reproducible (prompt forbids it) |
| Seed on application boot | `db-safety` forbids application sources running migrations/seeding at startup; also reintroduces a startup failure window |
| `prisma db seed` | Introduces a second, un-gated provisioning path that `prisma:deploy` does not run |
| Change the column to a Prisma enum | A schema/product change, and far riskier than adding two rows |

## 5. Migrations added

One new migration; **no existing migration was modified or rewritten**.

`backend/prisma/migrations/20260927120000_seed_business_category_reference_data/migration.sql`

```sql
INSERT INTO "business_category" ("code", "label")
VALUES
  ('SALON_AND_BARBER', 'Salon & Barber'),
  ('OTHER', 'Other')
ON CONFLICT ("code") DO NOTHING;
```

The migration carries a header comment recording the failure it fixes, the
constraint involved, and each of the required properties. It contains **only**
reference data — no DDL, no schema change, no business/owner/service/booking row.

| Requirement | How it is met |
| --- | --- |
| Deterministic | Explicit `VALUES`; no clock, random, environment or locale input |
| Idempotent | `ON CONFLICT ("code") DO NOTHING` |
| Safe on a fresh database | Table is created by the earlier init migration; this runs after it |
| Safe when rows already exist | `DO NOTHING`; an existing label is never overwritten |
| Safe when deployment repeats | `prisma migrate deploy` records it in `_prisma_migrations`; even if re-executed manually it is a no-op |
| Migrator/app role model | Runs as `werefa_migrator` (DDL owner); `DATABASE_URL` pinning in `prisma-migrate.mjs` unchanged |
| PostgreSQL 16 | `INSERT … ON CONFLICT` is long-standing standard SQL |
| Prisma 6.19.3 | Plain SQL migration; no Prisma-version-sensitive feature |

## 6. Idempotency behaviour

Verified empirically, not asserted:

| Scenario (prompt §6) | Observed |
| --- | --- |
| **A.** Completely empty database | `db:migrate` → 38 tables + 2 category rows |
| **B.** Schema present, no category rows | Rows inserted |
| **C.** Category rows already exist | `INSERT 0 0`, row count unchanged |
| **D.** Deployment executed repeatedly | `No pending migrations to apply.` (twice), row count unchanged |

Direct evidence:

```
# seed SQL executed 3x in a row against a populated table
INSERT 0 0
INSERT 0 0
 total_rows | distinct_codes
------------+----------------
          2 |              2
```

Non-destructive behaviour was also confirmed: after setting `OTHER`'s label to
`Pre-existing Custom Label`, re-running the seed left that label untouched and
inserted nothing. The seed never overwrites operator- or locale-specific text.

## 7. Business setup verification

`werefa_dev` was driven to a genuinely fresh state (`db:reset` → 0 users, 0
businesses, 2 categories from the migration), then the **real** flow was invoked
over HTTP — no direct SQL insert, no hard-coded startup business.

1. `POST /api/v1/auth/register` → `201` (real owner account created through the
   public endpoint, not inserted by hand)
2. `POST /api/v1/auth/login` → `200` + session cookie
3. `POST /api/v1/owner/businesses` → **`201 Created`**

Verified in PostgreSQL:

```
 public_slug    |  category_code   |    category_label   |    owner_email              | role  | subscription
----------------+------------------+---------------------+----------------------------+-------+-------------
 tame-auto-care | OTHER            | Other               | tamenebehailu@gmail.com    | OWNER | TRIAL
 tame-hair-studio | SALON_AND_BARBER | Salon & Barber    | tamenebehailu@gmail.com    | OWNER | TRIAL
```

- business row exists — **yes**
- `category_code` valid — **yes** (resolves against `business_category`)
- owner relationship correct — **yes** (`business_owner` → the registering user, `role=OWNER`; trial subscription started automatically)
- slug persisted — **yes** (`tame-hair-studio`, `tame-auto-care`)
- public lookup retrieves it — **yes**, `GET /api/v1/public/businesses/<slug>` → `200` for both, with no `id` or owner data in the payload

The business was created **only** because the setup flow was invoked. Nothing in
the application creates a business at boot, and no such code was added.

## 8. SALON_AND_BARBER verification

`POST /api/v1/owner/businesses` with `categoryCode: "SALON_AND_BARBER"` → **201**,
persisted as `category_code = SALON_AND_BARBER`, label resolved to
`Salon & Barber` on both the owner and public projections. Public lookup → 200.
This is the exact request that previously returned 500; the new regression test
`creates a business with SALON_AND_BARBER and no longer fails with P2003` covers
it and **fails with `expected 500 to be 201`** when the reference rows are absent
(see §12).

## 9. OTHER verification

`POST /api/v1/owner/businesses` with `categoryCode: "OTHER"` → **201**, persisted
as `category_code = OTHER`, label `Other`, public lookup → 200. No additional
category was added, and a test asserts the table contains exactly the two
canonical codes.

## 10. Error-handling verification

**Decision: do not map P2003.** The prompt offered two options — map P2003
generally, or prevent the situation entirely by provisioning — and the second is
the correct one here.

Rationale:

- After this change the P2003 is **unreachable through the API**. The DTO
  `@IsIn(BUSINESS_CATEGORIES)` rejects every code that is not one of the two, and
  both of those are now guaranteed present by the migration. A generic
  `P2003 → 400` mapping would be dead code on the setup path.
- A blanket P2003 mapper would be **actively harmful**: it would convert genuine
  data-integrity violations elsewhere in the schema (a broken order, a deleted
  parent row, a bad migration) into a plausible-looking user-facing
  `VALIDATION_ERROR`, masking real corruption as a client mistake.
- It would **invent a public error contract** the specification does not define,
  which the prompt forbids "unless required" — and it is not required.

The normal setup path no longer produces HTTP 500 because required reference data
is missing: reference data is now guaranteed by the migration.

**Verified error behaviour (all from the real running API):**

| Request | Before | After |
| --- | --- | --- |
| Valid category, missing reference row | `500 INTERNAL_ERROR` | `201 Created` (impossible now) |
| Unknown category `NOT_A_CATEGORY` | — | `400 VALIDATION_ERROR`, `categoryCode must be one of the following values: SALON_AND_BARBER, OTHER` |
| Duplicate slug | `409 CONFLICT` | `409 CONFLICT` (unchanged) |
| Unauthenticated create | `401` | `401` (unchanged) |

No raw Prisma error is ever exposed: the global filter still serialises every 5xx
to a safe `INTERNAL_ERROR` envelope, and a new test asserts the FK remains
`RESTRICT` so a future migration cannot quietly drop the guarantee this fix
depends on.

## 11. Test-database provisioning status

**A real reproducibility gap was found and fixed.** It is the same gap that
forced manual intervention in the previous audit, and it is now closed.

Before:

- `npm run db:provision` created the roles and the two databases but **never ran
  migrations**, so a fresh environment's `werefa_test` had **0 tables** and
  `npm run test:db` failed at setup with a confusing missing-relation error.
- `npm run db:reset` had the same defect.
- `README.md` documented `db:provision` followed by `prisma:dev` — which migrates
  **dev only** — and line 170 claimed `test:db` "requires the provisioned
  werefa_test DB", which was misleading: a *provisioned* database had no schema.
- The test-runner header comment documented the intended sequence
  `db:up && db:provision && test:db`, which did not actually work.

Changes:

| File | Change |
| --- | --- |
| `backend/scripts/db-migrate.mjs` | **new** — applies the migration history to `werefa_dev` **and** `werefa_test` by running `prisma migrate deploy` through the existing `prisma-migrate.mjs` (migrator role). Idempotent. Derives the test URL from `MIGRATOR_DATABASE_URL` via the `URL` API, so **no new environment variable** is required. |
| `backend/package.json` | added `db:migrate` |
| `backend/scripts/db-provision.mjs` | runs `db-migrate.mjs` after creating roles/databases |
| `backend/scripts/db-reset.mjs` | runs `db-migrate.mjs` after recreating the databases |
| `README.md` | documents that `db:provision` migrates both databases, documents `db:migrate`, records that migrations are the only source of the category rows, and corrects the `test:db` prerequisite |

**No fake business data was added to the test database.** The only test rows
created are the pre-existing fixture users, businesses and bookings that the
existing architecture already required; the new suite creates two businesses and
deletes them in teardown, and never seeds categories.

Verified end to end: `werefa_test` was dropped and recreated from nothing, then
one `npm run db:migrate` produced **38 tables + 2 category rows**, and
`npm run db:reset` does the same in a single command.

## 12. Tests and exact counts

**New regression suite** — `backend/src/api/business-category-reference-data.db.spec.ts`
(9 tests, DB-gated, uses the existing `createTestApp` / `TEST_DATABASE_URL`
architecture):

| # | Test | Prompt §10 item |
| --- | --- | --- |
| 1 | provisions the `SALON_AND_BARBER` reference row | 1 |
| 2 | provisions the `OTHER` reference row | 2 |
| 3 | provisions no categories beyond the canonical two | 1, 2 |
| 4 | creates a business with `SALON_AND_BARBER` and no longer fails with P2003 | 4, 8 |
| 5 | creates a business with `OTHER` | 5 |
| 6 | public business lookup returns the newly created business | 7 |
| 7 | rejects a category code that is not provisioned (400, not 500) | 9 |
| 8 | keeps the `business_category` foreign key in place (`RESTRICT`) | 8 |
| 9 | reference provisioning is idempotent (re-seeding creates no duplicates) | 3, 6 |

The suite deliberately **does not seed `business_category` itself** — it reads
the rows the migration produced, which is what makes it a provisioning regression
test rather than a restatement of the seed. The idempotency test is placed **last**
on purpose: it re-inserts the rows, so running it earlier would mask the
missing-reference-data failure of the creation tests.

**Negative test — the suite provably catches the original bug.** With
`business_category` emptied (simulating the reported state), **7 of 9 tests
fail**, including:

```
FAIL … > creates a business with SALON_AND_BARBER and no longer fails with P2003
AssertionError: expected 500 to be 201 // Object.is equality
FAIL … > creates a business with OTHER
AssertionError: expected 500 to be 201 // Object.is equality
FAIL … > public business lookup returns the newly created business
AssertionError: expected 404 to be 200 // Object.is equality
```

**Also strengthened: the test suites no longer own reference data.** Nine
`*.db.spec.ts` files each hand-seeded `business_category` and included it in
their `DELETE_ORDER`, so the reference rows were duplicated in **10 places** and
could silently drift from the migration. All 10 seeds and all 9 `DELETE_ORDER`
entries were removed (39 lines deleted, no test weakened, no assertion changed);
migrations are now the single source of truth, which also makes all 29 DB spec
files implicit provisioning regression tests.

**Full verification — every gate:**

| Gate | Result |
| --- | --- |
| `backend/ npm test` | **PASS** — 199 passed / 255 skipped (454); 30 passed / 11 skipped (41 files) |
| `backend/ npm run test:db` — **run 1** | **PASS** — 396 passed (396); 29 files |
| `backend/ npm run test:db` — **run 2** | **PASS** — 396 passed (396); 29 files |
| `backend/ npm run typecheck` | **PASS** |
| `backend/ npm run lint` | **PASS** |
| `backend/ npm run build` | **PASS** |
| `frontend/ npm test` | **PASS** — 512 passed (512); 45 files |
| `frontend/ npm run typecheck` | **PASS** |
| `frontend/ npm run lint` | **PASS** |
| `frontend/ npm run build` | **PASS** — 503.00 kB chunk (pre-existing >500 kB Vite advisory, non-blocking) |

Counts versus the previous audit: DB tests **387 → 396** (+9, the new suite) and
DB spec files **28 → 29**. `npm test` skipped went 246 → 255 (+9, the new file's
tests skip without `RUN_DB_TESTS`). **No test was weakened, deleted or skipped to
obtain green results.** DB tests were run **twice consecutively**; both clean.

**Acceptance gate hardened.** `scripts/acceptance.mjs` `db-safety` now asserts:
the reference-data migration exists; it contains an executable
`INSERT INTO "business_category"`; it provisions both canonical codes; it carries
an `ON CONFLICT … DO NOTHING` guard; `db-migrate.mjs` targets both databases; and
`db-provision.mjs` / `db-reset.mjs` invoke it. SQL comments are stripped before
matching so a guard can never be satisfied by prose.

Both new guards were **negative-tested** and correctly fail:

| Probe | Observed |
| --- | --- |
| Rename the reference-data migration away | `FAIL Database release safety — no migration seeds business_category; a fresh database cannot create its first business (P2003)` |
| Remove `ON CONFLICT … DO NOTHING` (comment retained) | `FAIL … has no ON CONFLICT guard, so repeated provisioning can duplicate rows` — *this probe is what exposed that the first version of the guard was satisfied by a comment; the guard was fixed, not the expectation* |

## 13. Acceptance results

```
npm run acceptance:static   →  ACCEPTANCE GATE: PASS   (11/11 static checks)
npm run acceptance          →  ACCEPTANCE GATE: PASS   (11 static + 9 command gates)
```

```
PASS  Canonical specification hash        5494658e…f00b
PASS  Canonical requirement inventory     232 requirements (REQ-001 … REQ-232)
PASS  Requirement classification baseline  A=214 B=12 C=3 D=3 total=232
PASS  Production auth safety
PASS  Frontend API base URL safety
PASS  Mock / test provider safety
PASS  Environment documentation contract  37 backend variables documented
PASS  Database release safety              11 DB-gated spec files
PASS  Worker / outbox safety
PASS  Secret / logging safety
PASS  Forbidden-regression guards          18 guarded requirement ids, none claimed implemented
PASS  Backend tests / Backend DB tests / Frontend tests
PASS  Backend typecheck / lint / build
PASS  Frontend typecheck / lint / build
```

The mock-removal protections are intact — `provider-safety` and
`forbidden-regression` still pass, and no existing check was weakened or removed.
The DB-gated spec count rose 10 → 11 with the new suite.

## 14. Browser QA status

**Not run — no browser harness exists.** The repository contains no Playwright,
Cypress or Puppeteer configuration; `frontend/qa-shot/` holds static screenshots,
not a harness. None was installed or invented for this task, per §14.

The setup flow was therefore verified through **direct HTTP calls against the real
running API and the real PostgreSQL database** (`register` → `login` →
`POST /owner/businesses` → `GET /public/businesses/<slug>`), including the live
reproduction of the original 500 and its `P2003` log line. That covers the
server-side contract exactly but does **not** exercise the rendered React form.

## 15. Spec SHA

Verified before any work and again at the end of this Prompt:

```
5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b  docs/WEREFA-COMPLETE-SPECIFICATION.md
```

Identical to the required digest. The canonical specification was read-only
throughout and is byte-for-byte unchanged.

## 16. Files changed

This Prompt's changes only (the working tree also carries the previous,
already-reported Prompt 66 mock-removal changes).

**New (4):**

| File | Purpose |
| --- | --- |
| `backend/prisma/migrations/20260927120000_seed_business_category_reference_data/migration.sql` | The reference-data migration (29 lines) |
| `backend/scripts/db-migrate.mjs` | Migrates `werefa_dev` **and** `werefa_test` (69 lines) |
| `backend/src/api/business-category-reference-data.db.spec.ts` | 9-test regression suite (190 lines) |
| `docs/implementation/51-database-reference-data-and-business-setup-hardening.md` | This report |

**Modified (14), +172 / −65:**

| File | Change |
| --- | --- |
| `backend/package.json` | +1 — `db:migrate` script |
| `backend/scripts/db-provision.mjs` | runs `db-migrate.mjs` after provisioning |
| `backend/scripts/db-reset.mjs` | runs `db-migrate.mjs` after recreating |
| `backend/src/api/http-api.db.spec.ts` | −2 seed + `DELETE_ORDER` entry |
| `backend/src/api/http-auth.db.spec.ts` | −4 |
| `backend/src/api/http-subscription.db.spec.ts` | −2 |
| `backend/src/api/reporting.db.spec.ts` | −7 (2 seeds + `DELETE_ORDER` entry) |
| `backend/src/domain/auth.db.spec.ts` | −4 |
| `backend/src/domain/domain-services.db.spec.ts` | −4 |
| `backend/src/domain/domain.repositories.db.spec.ts` | −8 (seed, `seedCategories()` helper, `DELETE_ORDER` entry) |
| `backend/src/domain/notifications/email.db.spec.ts` | −4 |
| `backend/src/domain/notifications/telegram.db.spec.ts` | −4 |
| `scripts/acceptance.mjs` | +155/−… — `db-safety` reference-data and provisioning guards |
| `README.md` | +21/−… — provisioning contract and corrected `test:db` prerequisite |

**No application source file was changed.** No controller, service, repository,
DTO, projection or frontend file was modified: the defect was entirely a missing
database invariant, and the fix is entirely a database-provisioning concern.
No product decision, no §46 item, no provider and no Prompt 38 Item 6 concern was
touched.

## 17. Working-tree status

- Branch `master`; HEAD `50cfb70 docs(readme): document the acceptance-gate command and repository layout` — **unchanged**.
- `git log --oneline 50cfb70..HEAD` → **0 commits**.
- The index is clean; nothing is staged. All work is uncommitted by design.
- `git status --short` → **58 entries**: 48 modified, 3 deleted, 7 untracked.
  - Untracked (7): `backend/prisma/migrations/20260927120000_seed_business_category_reference_data/`, `backend/scripts/db-migrate.mjs`, `backend/src/api/business-category-reference-data.db.spec.ts` and this report (4 from this Prompt); `docs/implementation/50-…md`, `frontend/src/lib/paymentMethods.ts`, `frontend/src/test/noRuntimeMockData.test.ts` (3 from the previous Prompt).
  - The 3 deletions and 44 of the modified files belong to the **previous**
    Prompt 66 mock-removal work and are unchanged by this Prompt; this Prompt
    modified 14 tracked files.
- **Local development data changed.** `npm run db:reset` (used to validate the
  fresh-environment path) dropped and recreated `werefa_dev`, which removed the
  single local owner row and the two businesses created earlier in this session.
  Both were recreated through the real API afterwards, and the owner account is
  `tamenebehailu@gmail.com` with a temporary development password
  (redacted from this report; change it via `POST /api/v1/auth/password/change`). The two verification
  businesses `tame-hair-studio` and `tame-auto-care` are present and may be
  renamed or deleted freely.
- `frontend/.env.local` remains gitignored and untracked.

## 18. No-commit confirmation

**NO COMMIT CREATED.** No `git add`, `git commit`, `git push`, `tag`, `reset`,
`rebase`, `cherry-pick`, `stash` or `checkout` was performed. No branch, worktree,
subagent or second agent was created. All work exists only as uncommitted
working-tree changes.

## 19. No demo / mock runtime data confirmation

Confirmed, and the distinction the prompt draws is respected:

| Rule | Status |
| --- | --- |
| No runtime mock business data | **Holds.** `addis-beauty-lounge`, `marathon-auto-care`, `riverside-dry-cleaning` all still return **404** against the real API |
| No demo business | **Holds.** The only businesses in `werefa_dev` are the two created by invoking the real setup flow |
| No fake services | **Holds** — none added |
| No fake bookings | **Holds** — none added |
| No fake categories in frontend code | **Holds** — no frontend file was modified; the canonical pair still comes from the API |
| No frontend fallback when business lookup fails | **Holds** — untouched and still guarded |

**`business_category` rows are database reference data, not demo data.** They are
the two canonical product categories the API already accepted
(`BUSINESS_CATEGORIES`), stored as lookup rows. They are not a business, an owner,
a service or a booking, they are not frontend fixtures, and they are not reachable
as mock data — they arrive only through the real HTTP API. The prompt explicitly
requires this distinction, and the acceptance gate's `provider-safety` and
`forbidden-regression` checks continue to pass unchanged.

---

## Appendix A — Why no P2003 error mapping was added

Recorded explicitly because "the 500 is gone" and "the error should be mapped" are
different questions.

The 500 is gone because **the cause is gone**. Mapping P2003 would have:

1. been **unreachable** on the setup path (DTO validation + migration guarantee),
2. **masked** unrelated integrity violations as user input errors, and
3. introduced a **public error contract** the specification does not define.

The residual 500 for a genuinely corrupt database is the *correct* signal: it is
logged server-side with full context and returned as a safe generic envelope, so
it is diagnosable without leaking internals. A fabricated `400` would have made it
undiagnosable.

## Appendix B — Limitations

- **No browser QA** (no harness exists, none added). The React setup form was not
  clicked; the HTTP contract behind it was verified directly.
- **The frontend needed no change**, which is itself the confirmation that the
  failure was never a frontend defect. The form was already sending a valid
  canonical category.
- **Category labels are not owner-editable.** `business_category.label` is
  reference text, and a future label change (e.g. localisation) requires its own
  migration. The seed deliberately never overwrites an existing label, so
  operator-set text is safe.
- **A manually emptied `business_category` would still 500.** The migration
  guarantees the rows at deploy time; it cannot prevent an operator deleting them
  afterwards. The new acceptance guard makes silent removal of the *migration*
  impossible, and `RESTRICT` protects rows that a business references.
- `werefa_dev` local data was reset during verification — see §17.
