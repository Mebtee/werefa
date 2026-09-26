# 49 — Release-Candidate Acceptance Gate

Prompt: **Prompt 65 — Werefa Release Candidate Baseline & Automated Acceptance Gate**
Status: **COMPLETE** — one automated acceptance gate + machine-readable baseline + README gate documentation
Report date: 2026-09-26
Repository: Werefa (`master`, uncommitted working tree; no commit made)

> **This is not a product-feature task.** No product behavior changed, no §46
> decision was resolved, no provider or infrastructure was selected, and the
> canonical specification was not modified.

---

## 1. Purpose

Establish the current repository as a **release-candidate baseline** and turn the
objectively verifiable parts of the completed audits into a **repeatable
automated gate**.

The gate answers exactly one question:

> **"Has the repository preserved the verified Werefa release-candidate baseline?"**

It deliberately does **not** answer "are the open product decisions good, bad,
complete or incomplete". Six §46 decisions remain unresolved; a release-candidate
baseline is a statement about *what has been verified*, not a claim that the
product is finished.

Concretely, this Prompt:

1. verified the canonical specification digest before touching anything;
2. declared the audited requirement classification in a small machine-readable
   baseline file;
3. wrote a dependency-free acceptance gate that checks canonical integrity,
   traceability-baseline stability, production-safety invariants, the environment
   contract, database/migration safety, worker/outbox safety, logging safety and
   forbidden-regression guards, and then re-runs **every existing release gate**;
4. proved the gate's own failure paths and restored the repository exactly;
5. documented the command, the checks, and — just as importantly — the checks
   that were **intentionally not automated**.

## 2. Baseline used

The authoritative baseline is the state audited and handed off by Prompts 63/64.
**The current repository state is authoritative over stale historical
classifications** (see §13 below for the corrections that must not be resurrected).

| Artifact | Role |
| --- | --- |
| `docs/WEREFA-COMPLETE-SPECIFICATION.md` | Canonical product specification. Read-only. |
| `docs/implementation/48-final-canonical-traceability-audit.md` | Prompt 63 audit — the classification source. Pinned by SHA-256 in the baseline. |
| `docs/implementation/48-release-handoff-and-reproducible-deployment-contract.md` | Prompt 64 provider-neutral handoff/contract. |
| `docs/implementation/45-production-readiness-audit.md` | Production-safety and provider/deployment boundary. |
| `docs/implementation/44-requirements-coverage-and-gap-audit.md` | **Superseded.** Read for history only; its classifications are obsolete (§13). |
| `README.md`, `backend/.env.example`, `frontend/.env.example` | Configuration contract. |
| `backend/package.json`, `frontend/package.json` | The existing, already-trusted release gates. |

The gate is an **orchestrator**, not a replacement: it calls the existing
`npm test` / `npm run test:db` / `typecheck` / `lint` / `build` scripts unchanged.

## 3. Acceptance-gate command

From the repository root:

```bash
npm run acceptance
```

Fast static-only variant (no sub-gates; useful while iterating):

```bash
npm run acceptance:static
```

Exit code `0` = PASS, `1` = FAIL. The gate **never mutates the repository**.

### Why a root `package.json` was added

The repository had **no root manifest** — only `backend/package.json` and
`frontend/package.json`, each installed independently. To obtain one obvious
invocation without adding a dependency, a minimal root `package.json` was added
that declares **orchestration only**:

- `private: true`, no `dependencies` / `devDependencies`, no `workspaces`;
- `"acceptance"` → `node scripts/acceptance.mjs`.

This does not change how `backend/` or `frontend/` install, build, lint or test
(verified: all gates pass unchanged with the root manifest present). No new
testing framework, no new external dependency, no lockfile change.

The gate itself is plain Node ESM (`scripts/acceptance.mjs`) using only
`node:crypto`, `node:child_process`, `node:fs`, `node:path`, `node:url` — so it
runs with the repository's existing Node range (`>=20 <25`).

## 4. Checks performed

The gate runs 11 static/repo checks and then 9 existing command gates. Sample
output:

```
Werefa Acceptance Gate
======================

PASS  Canonical specification hash
        5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b
PASS  Canonical requirement inventory
        232 requirements (REQ-001 … REQ-232)
PASS  Requirement classification baseline
        classification source: docs/implementation/48-final-canonical-traceability-audit.md; A=214 B=12 C=3 D=3 total=232
PASS  Production auth safety
PASS  Frontend API base URL safety
PASS  Mock / test provider safety
PASS  Environment documentation contract
        37 backend variables documented
PASS  Database release safety
        10 DB-gated spec files
PASS  Worker / outbox safety
PASS  Secret / logging safety
PASS  Forbidden-regression guards
        18 guarded requirement ids, none claimed implemented
PASS  Backend tests
PASS  Backend DB tests
PASS  Frontend tests
PASS  Backend typecheck
PASS  Backend lint
PASS  Backend build
PASS  Frontend typecheck
PASS  Frontend lint
PASS  Frontend build

ACCEPTANCE GATE: PASS
```

| # | Check id | Title | What it enforces |
| --- | --- | --- | --- |
| 1 | `spec-hash` | Canonical specification hash | `docs/WEREFA-COMPLETE-SPECIFICATION.md` SHA-256 equals the pinned digest. |
| 2 | `spec-inventory` | Canonical requirement inventory | 232 unique `#### REQ-### — ` headings, `REQ-001` … `REQ-232`. |
| 3 | `req-baseline` | Requirement classification baseline | 214/12/3/3, total 232; class ids well-formed, unique, disjoint, in range; classification source pinned; six §46 decisions still recorded as unresolved. |
| 4 | `auth-safety` | Production auth safety | `AUTH_TEST_ENABLED=true` rejected in production; `TestAuthContextResolver` hard-fails in production; factory selects the server-side session resolver; test-actor headers readable in exactly one production module; ownership guard present; existing regression coverage intact. |
| 5 | `frontend-api-safety` | Frontend API base URL safety | Unset `VITE_API_BASE_URL` throws outside development; the localhost fallback is reachable only through the `isDev` branch; no production frontend module hard-codes a localhost origin. |
| 6 | `provider-safety` | Mock / test provider safety | `EMAIL_PROVIDER` → `DisabledEmailProvider` (never reports acceptance); `TELEGRAM_PROVIDER` → `DisabledTelegramProvider` when off; no mock/fake provider class in production backend sources; the **only** production frontend `@/mock/*` importer is the accepted branding demo seam. |
| 7 | `env-contract` | Environment documentation contract | Every variable the code reads is documented in `backend/.env.example` (and vice-versa for `VITE_`); required groups present (runtime, auth/security, database, Telegram, proof storage, worker, pending §46 parameters); committed secret variables are value-less; `.env` stays git-ignored. |
| 8 | `db-safety` | Database release safety | `prisma/migrations/` + `migration_lock.toml` present and complete; `prisma:deploy` / `test:db` scripts intact; migrations pinned to the migrator role; **no application source runs migrations at startup**; every `*.db.spec.ts` still gated by `RUN_DB_TESTS` + `TEST_DATABASE_URL`; the runner sets the gate. |
| 9 | `worker-outbox` | Worker / outbox safety | Exactly two `setInterval` owners — the existing `BusinessLifecycleWorker` and `NotificationBackgroundWorker` (no second scheduler); each returns before arming its timer when disabled, uses `unref`, and clears the timer on shutdown; outbox `idempotencyKey` unique; stale-`SENDING` reclaim and `DEAD_LETTERED` present; existing worker test present. |
| 10 | `log-safety` | Secret / logging safety | pino `REDACT_PATHS` covers authorization header, cookie, password, password hash, session token, token and `set-cookie`; the existing targeted redaction test is present; `assertConfigInvariants` interpolates no values; no log call passes a known secret identifier. |
| 11 | `forbidden-regression` | Forbidden-regression guards | The guarded requirement set (REQ-025/026–034/094/095/115/139/195/196/198/221) is never classified as implemented; the owner booking-report PDF parameter stays `nullable().default(null)` and documented-but-empty; no Phase-2 2FA implementation exists. |

Command gates (existing scripts, unchanged): backend `test`, `test:db`, frontend
`test`, backend `typecheck` / `lint` / `build`, frontend `typecheck` / `lint` /
`build`.

## 5. Checks intentionally NOT automated

This is the most important section. The gate validates **release invariants**, not
product semantics. It deliberately does **not**:

- **Prove the 214 implemented requirements.** No source-code regex attempts to
  establish that a requirement's canonical behavior is present. Such a system
  would be brittle and would manufacture false confidence. Detailed behavioral
  coverage remains the responsibility of the existing domain test suites.
- **Re-derive the requirement classification from the repository.** The audited
  reports are human-readable prose and tables. Parsing them would be a fake
  parser with brittle assumptions. Instead the baseline is a small machine-
  readable file whose *provenance* (the audit report) is pinned by SHA-256, so
  drift requires an explicit, visible baseline update.
- **Judge any unresolved product decision.** It neither resolves nor evaluates
  the six §46 items, the subscription price, the timezone identity, the reminder
  lead time, the owner PDF export, the owner "modify" scope or the
  timezone-abbreviation rule.
- **Fail because blocked/deferred/deployment-dependent requirements are not
  implemented.** REQ-094/095/139 (blocked), REQ-025/034/115 (deferred) and
  REQ-026–033/195/196/198/221 (deployment/provider input) are expected to remain
  exactly as classified.
- **Connect to or provision a production database.** `test:db` uses the
  provisioned `werefa_test` database only; the gate never targets production.
- **Select a provider, deployment target, domain, secret or URL.**
- **Add a browser QA harness.** None exists (only static screenshots under
  `frontend/qa-shot/`), and none was added.
- **Run a global secret scanner.** A repo-wide regex produces false positives
  against templates, fixtures and docs. The gate instead reuses the repository's
  existing targeted redaction tests and adds narrow, name-specific checks.
- **Statically assert the *absence* of an owner booking-report PDF endpoint.**
  Negative source scanning for "a route that must not exist" is exactly the
  brittle pattern being avoided. The guard is the classification plus the
  configuration boundary (the §46-4 parameter stays `null`).
- **Check external provider delivery.** Nothing may claim an email or Telegram
  message was delivered; the gate reflects that rather than testing it.

## 6. Canonical spec integrity rule

```
sha256(docs/WEREFA-COMPLETE-SPECIFICATION.md)
  = 5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b
```

The expected digest is written **literally** in `scripts/acceptance.mjs` as
`REQUIRED_SPEC_SHA256`. It is never derived from the file on disk — otherwise the
check would approve whatever the specification happens to contain. The same
digest is mirrored in
`docs/implementation/release-candidate-baseline.json`, and the gate asserts the
two agree, so tampering with the baseline cannot silently approve a changed file.

A mismatch **fails the gate**. Remediation is not "update the hash"; the
specification is read-only for this project. A legitimate future specification
change is a deliberate, separately-approved act that must re-pin the digest in
both places and re-run the audit.

## 7. Requirement classification baseline

Declared in `docs/implementation/release-candidate-baseline.json` (small,
machine-readable, no product-spec duplication, no second source of truth).

| Class | Count | Requirements |
| --- | --- | --- |
| **A — IMPLEMENTED** | **214** | all others |
| **B — PARTIAL / DEPLOYMENT-PROVIDER INPUT** | **12** | REQ-026, 027, 028, 029, 030, 031, 032, 033, 195, 196, 198, 221 |
| **C — BLOCKED / SPECIFICATION INSUFFICIENT** | **3** | REQ-094, 095, 139 |
| **D — DEFERRED BY DESIGN** | **3** | REQ-025, 034, 115 |
| **Total** | **232** | |

Additional blocked reporting item (no dedicated REQ number): **owner
booking-report PDF export** (§25.3 / §46-4).

The gate enforces that the four counts reconcile, that the enumerated B/C/D ids
match their counts, that the ids are canonical `REQ-NNN` strings inside
`REQ-001 … REQ-232`, that no id appears in two classes, and that the audit report
named as the classification source still hashes to its pinned digest.

## 8. Production safety checks

| Invariant | Enforcement |
| --- | --- |
| `AUTH_TEST_ENABLED=true` is rejected in production | static guard in `assertConfigInvariants` + existing `app-config.spec.ts` behaviour |
| Production cannot use the test-header authentication resolver | `TestAuthContextResolver` constructor throws in production; the factory requires `nodeEnv !== 'production'` |
| Production uses the server-side session resolver | factory returns `SessionAuthContextResolver` for every production configuration |
| No production localhost authentication bypass | the `X-Actor-Role` / `X-Actor-Id` headers are readable in exactly **one** production module; ownership is still enforced in-query by `TenantGuard.requireOwnedBusiness` |
| Production frontend never silently falls back to localhost | `resolveApiBaseUrl` throws outside development; the fallback is inside the `isDev` branch; no other production module hard-codes a localhost origin |
| No mock/fake provider is selectable in production | `EMAIL_PROVIDER` → `DisabledEmailProvider` (`isConfigured()=false`, `accepted:false`); `TELEGRAM_PROVIDER` → `DisabledTelegramProvider` when off; no `Mock*/Fake*/Stub*` provider class in production sources |
| Documented demo-only seam is preserved, not rewritten | the only production `@/mock/*` importer must be `BusinessProfilePage.tsx` and stay confined to branding (logo/cover) |
| Secrets are not obviously logged | pino redaction paths; value-free config validation; no log call carrying a known secret identifier |

No second authentication implementation was created; no test was weakened.

## 9. Environment checks

`backend/.env.example` is cross-checked **both ways** against actual code usage
(`app-config.ts`, `backend/scripts/*.mjs`):

- every `env.X` / `envOr('X')` / `PRODUCT_*` key the code reads must be documented;
- every documented variable must belong to a required group: runtime, auth/security,
  database, dev provisioning, Telegram, proof storage, worker, pending §46 parameters;
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_WEBHOOK_SECRET` must be present with
  **empty** values — the gate checks documented names, never real credentials;
- `frontend/.env.example` must document every `VITE_`-prefixed variable the browser
  bundle reads, and must contain **only** `VITE_`-prefixed names (anything else
  risks shipping a secret);
- both `.gitignore` files must keep ignoring `.env`.

Observed: **37** backend variables documented, no gaps in either direction.

## 10. Build / test checks

The gate invokes the existing scripts; it does not duplicate or replace any test
logic and it does not replace the test suites.

| Gate | Command | Result |
| --- | --- | --- |
| Backend tests | `backend/ npm run test` | **PASS** — 30 passed / 10 skipped (40 files); 199 passed / 246 skipped (445) |
| Backend DB tests (run 1) | `backend/ npm run test:db` | **PASS** — 28 passed (28); 387 passed (387) |
| Backend DB tests (run 2) | `backend/ npm run test:db` | **PASS** — 28 passed (28); 387 passed (387) |
| Frontend tests | `frontend/ npm run test` | **PASS** — 44 passed (44); 504 passed (504) |
| Backend typecheck | `backend/ npm run typecheck` | **PASS** |
| Backend lint | `backend/ npm run lint` | **PASS** |
| Backend build | `backend/ npm run build` | **PASS** |
| Frontend typecheck | `frontend/ npm run typecheck` | **PASS** |
| Frontend lint | `frontend/ npm run lint` | **PASS** |
| Frontend build | `frontend/ npm run build` | **PASS** — 527.38 kB JS chunk (pre-existing >500 kB Vite advisory, non-blocking) |

DB tests were run **twice consecutively** against the real provisioned PostgreSQL
test database; both runs clean. No test was weakened, deleted or skipped to
obtain green results. No pre-existing flake recurred.

## 11. Worker / outbox checks

- `BusinessLifecycleWorker` is the single lifecycle worker (booking completion +
  scheduled subscription auto-resume).
- `NotificationBackgroundWorker` is the notification/outbox worker (webhook
  registration + delivery sweep, only when Telegram is enabled).
- **Exactly two** production backend modules own a `setInterval`. Any third file
  introducing a sweep timer fails the gate — this is the "no second
  worker/scheduler" guard.
- Both return before arming the timer when disabled (tests / channel off), use
  `unref`'d timers, and `clearInterval` in `onModuleDestroy`.
- Outbox invariants remain present: `NotificationDelivery.idempotencyKey` is
  unique, stale `SENDING` rows are reclaimed (`STALE_SENDING_MS`), and deliveries
  reach `DEAD_LETTERED` at `TELEGRAM_DELIVERY_MAX_ATTEMPTS`.
- `business-lifecycle.worker.spec.ts` still exists and runs in the DB suite.

## 12. Known blocked requirements

| REQ | Summary | Blocked on |
| --- | --- | --- |
| **REQ-094** | Affected-booking email generated | No canonical deep-link/quick-action or grouping / multi-booking contract is defined. |
| **REQ-095** | Close changes grouped into a five-minute window | Dependent on REQ-094's undefined producer. |
| **REQ-139** | Subscription reminders via email + business Telegram | §46 item 3 (reminder lead time) unresolved; `PRODUCT_REMINDER_LEAD_DAYS` defaults `null`; nothing schedules a reminder. |
| *(no REQ)* | Owner booking-report PDF export | §46 item 4 / §25.3 pending; only the Super Admin PDF (REQ-178) is confirmed. |

These remain unimplemented **by design** and the gate does not fail because of
them. It fails only if something claims they are implemented.

## 13. Known deployment-dependent requirements

Twelve requirements are **PARTIAL — deployment/provider input required** (an
approved external `EmailProvider` is a deployment input, not a product decision):

`REQ-026, REQ-027, REQ-028, REQ-029, REQ-030, REQ-031, REQ-032, REQ-033,
REQ-195, REQ-196, REQ-198, REQ-221`

- REQ-026–033 — owner email verification, unverified-dashboard gating,
  time-limited / replaceable / invalidating links, verification rate limiting,
  optional auto-authentication, and forgot-password reset. These flows are
  **absent**; gating unverified owners with no deliverable verification link
  would lock out every owner, so the network surface intentionally exposes none.
- REQ-195 / REQ-198 / REQ-221 — the in-repo mechanism enqueues the correct outbox
  events, but delivery is `SUPPRESSED` because `EMAIL_PROVIDER` binds to
  `DisabledEmailProvider`, which never claims a false "delivered".
- REQ-196 — additionally has **no** IP/device in its event payload and no email
  body renderer, so it cannot be delivered even with a provider configured.

**Historical-classification corrections that must not be resurrected** (report 44
is obsolete): REQ-026–031 and REQ-033 are **not** implemented; REQ-195, REQ-196
and REQ-221 are **not** fully implemented; REQ-196 is Class B (corrected from the
Prompt 62 baseline, which had left it as A).

## 14. Known deferred requirements

| REQ | Summary | Basis |
| --- | --- | --- |
| **REQ-025** | Google login not part of Phase 1 | §12.2 / §43 — email/password only. |
| **REQ-034** | 2FA-ready Phase 1 architecture | §43 — no 2FA enforcement in Phase 1; the session/credential model is extension-ready. |
| **REQ-115** | Custom payment methods NOT configured | §12.2 / §43 — correctly absent. |

The gate confirms no Phase-2 2FA implementation exists. Also out of Phase-1 scope
by canonical decision: online payment gateway, customer accounts / self-service
cancel-modify, per-tenant timezones, TTL slot locks.

## 15. Unresolved §46 decisions

All six remain **unresolved**. The gate records them; it does not resolve them.

1. **Subscription monthly price** (REQ-125) — single-price model only; no amount
   invented; `PRODUCT_SUBSCRIPTION_MONTHLY_PRICE_MINOR` stays `null`.
2. **Global timezone identity** (REQ-222) — mechanism configurable; value is a
   product fact, not an architecture one.
3. **Subscription-reminder lead time** (REQ-139) — `PRODUCT_REMINDER_LEAD_DAYS`
   defaults `null`; no producer.
4. **Owner booking-report PDF export** (§25.3) — not implemented;
   `PRODUCT_OWNER_BOOKING_REPORT_PDF_ENABLED` stays `nullable().default(null)` and
   is documented-but-empty in `backend/.env.example`.
5. **Owner "modify" scope** (REQ-105/109) — rescheduling only; broader modify
   not inferred.
6. **Timezone-abbreviation display rule** (BR-32) — not implemented.

## 16. How developers should interpret PASS

`ACCEPTANCE GATE: PASS` means **only** this:

> The canonical specification is byte-identical to the audited baseline; the
> audited requirement classification has not drifted; the enumerated production
> safety invariants, the environment contract, the database/migration contract,
> the worker/outbox invariants and the logging-redaction invariants all still
> hold; the forbidden-regression guards hold; and every existing backend and
> frontend release gate (tests, DB tests, typecheck, lint, build) passes.

A PASS additionally means **nothing** about:

- whether the six §46 decisions have been made;
- whether the deployment inputs (production PostgreSQL, packaging/TLS topology,
  durable `PROOF_STORAGE_DIR`, an approved `EmailProvider`, Telegram credentials,
  the production origin for `CORS_ORIGINS` / `VITE_API_BASE_URL`) have been
  supplied;
- whether the 12 deployment-dependent requirements now deliver externally;
- whether a browser session behaves correctly (no harness exists);
- fitness for production deployment.

A PASS is a **necessary, not sufficient**, condition for release.

## 17. How developers should interpret FAIL

A FAIL is precise and actionable, never speculative. For each failed check the
gate prints:

- the **failed check** (title);
- the **expected condition**;
- the **observed condition** (actual digest, actual id, actual file list, or the
  tail of the failing sub-gate's output);
- a **remediation direction** only where it is objectively known.

The remediation categories are deliberately limited to:

1. **Restore** something that was removed or altered (a file, a guard, an
   invariant, a migration, a test).
2. **Fix the regression** an existing gate reports — never weaken the gate.
3. **Re-audit and re-pin** if the audited evidence itself legitimately changed
   (the classification source hash or the specification digest): a human decision,
   not a gate edit.
4. **Document** a newly required environment variable by name only.

The gate never suggests a product change, a provider choice, a §46 resolution or
a speculative refactor. If a FAIL cannot be resolved by restoration, that is a
signal to re-audit — not to relax the gate.

## 18. False-confidence limitations

Read this section before trusting a PASS.

- **A PASS is not a proof of implementation.** The 214 Class-A requirements are
  evidenced by the existing test suites and audits, not by this gate. The gate
  only verifies that specific, named invariants still hold.
- **Static source assertions are textual.** Checks such as "the production guard
  exists" confirm the guard is *present in the source*, not that every runtime
  path honours it. The behavioural half of each invariant is covered by the
  existing unit/DB tests the gate re-runs; where no such test exists, the static
  check is the only guard, and that is a known gap.
- **The classification baseline is a declaration, not a derivation.** It is
  trustworthy because it is pinned to a hash-verified audit, not because the
  gate recomputes it. Editing both the audit and the baseline coherently would
  pass — which is exactly the point: re-classification must be a visible,
  deliberate act.
- **A "no second worker" check is file-scoped.** It detects a third module owning
  a `setInterval`. It would not detect a scheduler built on `setTimeout` chains or
  an external queue.
- **"No mock importer" is import-scoped.** It inspects `@/mock/*` imports in
  frontend production sources; it does not detect a network-level mock, a fetch
  interceptor, or a service-worker stub.
- **Environment checks verify names, not values or correctness.** A documented
  variable can still be misconfigured in a real deployment; that remains a
  deployment-time concern.
- **The gate cannot see production.** No production database, no production
  domain, no external provider, no TLS topology and no browser is exercised.
- **The branding demo seam is deliberately preserved.** It is the one known
  production frontend path that still uses mock data (logo/cover previews,
  pending an image-storage decision). The gate allows it explicitly rather than
  pretending it does not exist.
- **Green is not the same as correct.** The pre-existing limitations recorded in
  report 48 (no DB-level RLS, two migrations sharing a timestamp prefix, the
  >500 kB frontend chunk, single in-process sweep timers without a distributed
  lock, REQ-196 partial) are all still true and are unaffected by a PASS.

## 19. Final verification results

### 19.1 Gate self-test (failure paths)

Four failure conditions were exercised, each restored byte-for-byte, and the
repository was re-verified afterwards. This is how the gate was shown to *fail
loudly* rather than merely to pass.

| Probe | Temporary change | Expected failure | Observed |
| --- | --- | --- | --- |
| **A** | one comment line appended to the canonical specification | `spec-hash` FAIL | `observed: sha256(...) = 291e96ea…f1d47f` vs expected `5494658e…f00b`; gate `FAIL`; inventory still 232 (proving the digest check is independent) |
| **B** | baseline edited to drop REQ-094 from `blockedIds` and raise `implemented` to 215 | `forbidden-regression` FAIL | `observed: claimed implemented: REQ-094`; gate `FAIL` |
| **C** | `TELEGRAM_BOT_WEBHOOK_SECRET` line removed from `backend/.env.example` | `env-contract` FAIL | `observed: missing TELEGRAM_BOT_WEBHOOK_SECRET` (both the group check and the reverse cross-check fired); gate `FAIL` |
| **D** | a temporary third module with a `setInterval` added under `backend/src/domain/services/` | `worker-outbox` FAIL | `observed: …acceptance-probe.worker.ts` listed as a third timer owner; gate `FAIL` |

After each probe the file was restored from a copy taken outside the repository,
and afterwards:

- `sha256sum docs/WEREFA-COMPLETE-SPECIFICATION.md` → the required digest;
- `sha256sum backend/.env.example` → identical to the pre-probe backup;
- `git status --porcelain` → the probe module gone, no leftover artifacts;
- the gate re-run → `ACCEPTANCE GATE: PASS`.

The gate's own development defects were also caught this way (a mis-normalized
§46 comparison, a double path prefix, test files counted as production sources,
an unsorted comparison and a stale substring marker). They were fixed in the
gate, **not** by relaxing any expectation.

### 19.2 Acceptance gate

```
ACCEPTANCE GATE: PASS
```

All 11 static checks and all 9 command gates passed.

### 19.3 Full release gates

| Gate | Result |
| --- | --- |
| Backend `npm test` | **PASS** — 30 passed / 10 skipped (40 files); 199 passed / 246 skipped (445) |
| Backend `npm run test:db` — **run 1** | **PASS** — 28 passed (28); 387 passed (387) |
| Backend `npm run test:db` — **run 2** | **PASS** — 28 passed (28); 387 passed (387) |
| Frontend `npm test` | **PASS** — 44 passed (44); 504 passed (504) |
| Backend typecheck / lint / build | **PASS / PASS / PASS** |
| Frontend typecheck / lint / build | **PASS / PASS / PASS** (527.38 kB chunk advisory only) |
| Browser QA | **unavailable** — no Playwright/Cypress/Puppeteer harness exists in the repository; none was added. `frontend/qa-shot/` holds static screenshots, not a harness. |

These counts are identical to the audited baseline in report 48 — no test was
weakened, deleted or skipped.

### 19.4 Safe fixes

Only additions to verification tooling and documentation. **No source behavior
was changed.**

| File | Change | Nature |
| --- | --- | --- |
| `scripts/acceptance.mjs` | **new** — the acceptance gate (dependency-free Node ESM) | tooling |
| `package.json` (root) | **new** — orchestration-only manifest: `acceptance`, `acceptance:static`; no dependencies, no workspaces | tooling |
| `docs/implementation/release-candidate-baseline.json` | **new** — machine-readable baseline (spec digest, audit pin, 214/12/3/3, §46 list, guards) | baseline |
| `docs/implementation/49-release-candidate-acceptance-gate.md` | **new** — this report | documentation |
| `README.md` | **edited** — repository structure note + the acceptance-gate command in "Test & release gates" | documentation |

The canonical specification, the audits, all backend/frontend source and every
test were left untouched.

## 20. Final specification hash

Recomputed at the end of this Prompt:

```
5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b  docs/WEREFA-COMPLETE-SPECIFICATION.md
```

Identical to the required value and to the digest observed before any work
began. The specification was read-only throughout; the requirement inventory is
still 232 headings (`REQ-001` … `REQ-232`).

## 21. Working-tree state

- Branch `master`; HEAD `80a69ff1aefcb06e5336547dd85bf23dbadf75d0` — **unchanged**
  (`git reflog` shows no new entry; the last entry is the pre-existing
  `docs: report email notification integration` commit).
- The index is clean — nothing is staged.
- The implementation remains uncommitted by design (it was already uncommitted
  before this Prompt; this Prompt did not alter that posture).
- `git status --porcelain`: **128** entries — 68 modified, 60 untracked. Of
  these, **4 untracked entries are new from this Prompt** (`package.json`,
  `scripts/`, `docs/implementation/release-candidate-baseline.json`,
  `docs/implementation/49-release-candidate-acceptance-gate.md`), plus an edit to
  `README.md`, which was already a modified entry before this Prompt began.
- The four temporary failure probes left **no** residue: the specification, the
  baseline JSON and `backend/.env.example` were restored byte-for-byte (hashes
  re-verified) and the probe module was deleted.

## 22. No-commit confirmation

**NO COMMIT CREATED.** No `git add`, `git commit`, `git push`, `tag`, `reset`,
`rebase`, `cherry-pick`, `stash`, `checkout`, `restore` or any other history or
index operation was performed. No branch, worktree or agent was created. All
work exists only as uncommitted working-tree changes.

---

## Appendix A — Failure output format

On failure the gate names the check, the expected condition, the observed
condition and — only where objectively known — the remediation direction:

```
FAIL  Requirement classification baseline
        expected: every guarded requirement stays in blocked / deferred / deployment-dependent (never implemented)
        observed: claimed implemented: REQ-094
        fix:      these requirements must not be reported as implemented; resolve the open decision first

ACCEPTANCE GATE: FAIL (1 of 11 checks failed)
```

For a failing command gate, the last 25 lines of that sub-gate's own output are
shown, because the existing suites already produce precise diagnostics.

## Appendix B — Invariants deliberately left to the deployment

Unchanged and out of scope for the gate: production PostgreSQL provisioning and
credentials, deployment packaging and TLS/reverse-proxy topology, `TRUST_PROXY`,
durable `PROOF_STORAGE_DIR` capacity, an approved external `EmailProvider` and its
credentials, Telegram bot credentials and public webhook URL, the production
origin in `CORS_ORIGINS` and its matching `VITE_API_BASE_URL`, and any browser QA
harness. These are operations decisions and are intentionally not hard-coded.
