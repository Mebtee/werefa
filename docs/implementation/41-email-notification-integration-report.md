# 41 - Email Notification Integration Report (Prompt 57)

> Note: `40-email-notification-integration-report.md` already documented an earlier
> pass over this same prompt, and the code for that pass is present in the tree
> (commits `18206a2`, `ab7a6bd`, `e8d7611`, `dd3863a`, `80a69ff`). This report is
> the next sequential number and records the Prompt 57 **audit and gap-hardening**
> pass: it verifies that existing implementation and adds the missing EMAIL
> delivery-path test coverage. Nothing from report 40 was removed or rewritten.

## 1. Objective

Audit the canonical email-notification requirements, confirm that every
email-producing application event routes through one authoritative delivery
boundary (the existing notification outbox + worker), and close the concrete
verification gap: no test previously exercised the EMAIL half of the delivery
path. No external email provider, sender identity, reminder timing, or other
unresolved product behaviour was invented.

## 2. Starting specification SHA-256

`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`

## 3. Ending specification SHA-256

`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`

(Identical — the specification was not modified.)

## 4. Existing email implementation audited

Audited notification/outbox infrastructure, domain event bus, email/auth ports,
notification services, auth/security services, subscription services, schedule
service, lifecycle worker, recovery service, forced-logout implementation,
login-lockout implementation, existing email DTO/types, configuration, env vars,
tests and fixtures.

Findings:

- Outbox: `Notification` + `NotificationDelivery` (states `PENDING`, `SENDING`,
  `SENT`, `FAILED`, `DEAD_LETTERED`, `SUPPRESSED`) with a unique
  `idempotency_key` — the single exactly-once guard.
- Bus: `NotificationOutboxEventBus` is the only `DOMAIN_EVENT_BUS`
  implementation in production wiring.
- Worker: `NotificationBackgroundWorker` drives `NotificationDeliveryService`;
  no second scheduler/queue exists (no Redis/BullMQ introduced).
- Provider boundary: `EMAIL_PROVIDER` port (`EmailMessage`/`EmailProvider`),
  bound to `DisabledEmailProvider`; Telegram has an analogous real HTTP provider.
- Producers: `AuthService` (lockout), `RecoveryService` (recovery code),
  `AdminManagementService` (forced logout), `SubscriptionBillingService`
  (proof submitted/rejected).
- No duplicate email framework and no second outbox were found.
- `NotificationDeliveryService.deliverEmail(...)` (the real EMAIL send path) had
  **no integration coverage**; only `DisabledEmailProvider` had a unit test.

## 5. Email events mapped

| Requirement | Application event | Recipient | Template id | Provider/outbox state |
| --- | --- | --- | --- | --- |
| REQ-195/196 lockout | `LOCKOUT_EMAIL` | authoritative affected user (persisted id) | `security.lockout` | `PENDING` when a provider is configured, else `SUPPRESSED` |
| REQ-198/199 emergency recovery | `RECOVERY_CODE_EMAIL` | Super Admin (code handoff not provider-safe) | deferred | always `SUPPRESSED` |
| REQ-220/221 forced logout | `FORCED_LOGOUT_EMAIL` | authoritative affected user | `security.forced-logout` | `PENDING`/`SUPPRESSED` |
| REQ-140 proof submitted | `SUBSCRIPTION_PROOF_SUBMITTED` | exactly the active Admin accounts | `subscription.proof-submitted` | `PENDING`/`SUPPRESSED` |
| REQ-138 proof rejected | `SUBSCRIPTION_PROOF_REJECTED` | business owner | `subscription.proof-rejected` | `PENDING`/`SUPPRESSED` |
| REQ-139 subscription reminders | no event exists | owner | unresolved | not scheduled |
| REQ-094 affected-booking email | no event producer exists | owner | unresolved gap | not generated |
| N01–N08 customer notifications | booking events | customer | — | Telegram only (never EMAIL) |

## 6. Provider boundary

No real external provider is present or approved, so **none was selected**. The
application-level `EmailProvider` port carries only `to`, `subject`, `template`
(stable id), `data` (string map), `idempotencyKey`, optional `correlationId`, and
an `EmailSendResult { ok, accepted, error }`. `DisabledEmailProvider` reports
`isConfigured() === false` and never reports acceptance. The port knows nothing
about Prisma, HTTP controllers, booking services or subscription repositories.
External provider selection/configuration remains deployment/infrastructure work.
No SMTP password, API key, recovery secret or authorization token is logged.

## 7. Outbox / delivery behaviour

Verified (unchanged): the owning domain transaction commits before publication;
`createDelivery` writes `Notification` + `NotificationDelivery` atomically with a
unique idempotency key (duplicate → P2002 → skipped); failures are recorded, not
thrown, and never roll back booking/subscription/security state; bounded retry
with backoff; `DEAD_LETTERED` at `TELEGRAM_DELIVERY_MAX_ATTEMPTS`; stale `SENDING`
reclaim; delivery state observable via `attempts`/`lastError`/`sentAt`.

Email rows are written `PENDING` only when the injected provider reports
configured, otherwise `SUPPRESSED` — production can never falsely report email
success.

## 8. Recovery email

`RECOVERY_CODE_EMAIL` is always written `SUPPRESSED`, even when a provider is
configured, because the current event does not carry an encrypted/provider-safe
code handoff. The one-time code is hashed at rest, never logged, and its
generation/expiry/attempt-limit/single-use lifecycle is unchanged. Provider
failure cannot mark recovery as delivered. The limitation (recovery unusable
until an external provider is configured and the handoff is designed) is
preserved and documented, not faked.

## 9. Lockout email

Five consecutive failures → 15-minute lock is preserved. The lockout email is
generated through the common boundary; the recipient is resolved from the
persisted user id (not client input); the IP/device/browser are read from the
persisted `ACCOUNT_LOCKED` security event at delivery time. Repeated failures
cannot create uncontrolled duplicate email events (idempotency key
`system:LOCKOUT_EMAIL:<userId>`). The payload contains only `ip`/`device`/
`browser` — no passwords, tokens or internal ids.

**Audit note (not silently resolved):** the per-user lockout idempotency key also
suppresses a *second, later* lockout email for the same user. This favours
duplicate-suppression over one-email-per-lockout-instance; it was left as-is
rather than guessing a lockout-instance identity.

## 10. Forced logout email

Session revocation and the `FORCED_LOGOUT` audit/security records occur before
notification publication; session invalidation does not depend on email
delivery. Email failure does not undo the logout and is observable via the
delivery record.

## 11. Schedule-conflict email

The schedule service derives open conflicts (`listOpenConflicts`, REQ-092/093)
and the canonical five-minute grouping allowance is preserved, but **no
affected-booking email event producer or grouped delivery record exists** in the
repository. This was left as an explicit implementation gap: implementing it
would require choosing email content, direct-access links and grouping identity
that the canonical text leaves to implementation detail, and the prompt forbids
inventing unresolved behaviour. It was audited and documented, not fabricated.

## 12. Subscription email

Proof-submission (REQ-140) and proof-rejection (REQ-138) now use the common
email provider/outbox boundary, with recipients resolved server-side (exactly
the active Admins; the correct business owner) and idempotency keys scoped per
business and per Admin. The subscription reminder event/lead-time remains
deferred (Section 22).

## 13. Recipient resolution

Recipients come from authoritative server-side data only: `recipientRef` is a
persisted user id (auth/subscription emails) or a bound Telegram connection id;
the email address is resolved from the user row at delivery time. No
client-supplied address is trusted. Multi-business isolation is enforced by
business-scoped lookups, and covered by a cross-business test.

## 14. Security controls

Verified/tested: no credential-shaped keys enter email payloads; recovery codes
are never in payloads or logs; recipients are server-side ids, not emails;
customer channels never produce EMAIL rows; provider errors are stored as a
bounded `lastError` string with no secrets.

## 15. Failure / retry / idempotency behaviour

Covered by new tests: provider failure → `PENDING` with incrementing `attempts`
and a bounded backoff `nextAttemptAt`; terminal `DEAD_LETTERED` after the max
attempts; domain state untouched; exactly-once on repeated publishes;
`SUPPRESSED` when no provider is configured. `SENT` is only recorded on provider
acceptance, never merely because a request was made.

## 16. Worker interaction

`NotificationBackgroundWorker` remains the sole notification worker (reused, not
duplicated). Existing shutdown behaviour and test-disabling are preserved. No
second scheduler/queue was added.

## 17. Tests

Added `backend/src/domain/notifications/email.db.spec.ts` (DB-gated, 9 tests)
with a deterministic capturing `FakeEmailProvider` (never sends real email),
asserting recipient, event/template, subject, safe payload, delivery invocation,
idempotency, suppression and failure handling across lockout, forced logout,
recovery, subscription N15/N17 and customer-channel exclusion.

## 18. DB results

- Run 1: **356 passed / 24 files**.
- Run 2: **356 passed / 24 files**.
- Consecutive clean DB runs: **2**.

(347 before this pass + 9 new email tests.)

## 19. Frontend results

- `npx vitest run`: **500 passed / 43 files**.
- Typecheck: **PASS**. Lint: **PASS**. Build: **PASS** (existing 520.70 kB chunk
  warning remains).

No frontend source was changed (email delivery adds no user-facing surface).

## 20. Browser-QA status

No automated browser-QA harness exists (no Playwright/Cypress/Puppeteer scripts;
`frontend/qa-shot/` only holds ad-hoc screenshots). No harness was added for this
prompt, and email delivery introduces no frontend surface, so browser QA is not
applicable.

## 21. Provider configuration status

No external provider is configured and none was invented. `EMAIL_PROVIDER` is
bound to `DisabledEmailProvider`; no email env vars or sender addresses were
added. Configuring a real provider remains deployment/infrastructure work.

## 22. Explicitly deferred subscription-reminder lead time

The subscription-reminder lead-time default remains unresolved in §46. No lead
time was chosen, hard-coded, or silently configured, and the reminder schedule is
**not** claimed complete. The email event/provider boundary exists without a
schedule.

## 23. Other unresolved product decisions left untouched

Subscription price, owner booking-report PDF behaviour, timezone-abbreviation
behaviour, and all other §46 decisions were not resolved. Prompt 38 Item 6 was
not reconstructed.

## 24. Confirmation the specification was not modified

SHA-256 unchanged: `5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`.

## 25. Confirmation no commit was made

**NO COMMIT WAS MADE.** The only change introduced by this pass is the new
untracked file `backend/src/domain/notifications/email.db.spec.ts`. The
pre-existing worktree changes (Prompt 56 and earlier) and the pre-existing
Prompt 57 commits were left exactly as found; no history was rewritten.

## Backend verification summary

- `npm test`: **179 passed / 233 skipped** (36 files: 27 passed, 9 skipped).
- `npm run test:db`: **356 passed** ×2 consecutive.
- `npm run typecheck`: **PASS**. `npm run lint`: **PASS**. `npm run build`: **PASS**.
