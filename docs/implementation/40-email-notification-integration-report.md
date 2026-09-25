# 40 - Email Notification Integration Report (Prompt 57)

## 1. Objective

Audit the canonical email notification requirements and connect email delivery to
the existing notification outbox and worker without selecting an unapproved
external provider or inventing unresolved product behavior.

## 2. Specification SHA-256

Starting and ending SHA-256:

`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`

The canonical specification was not modified.

## 3. Existing implementation audited

The repository already had one `Notification` / `NotificationDelivery` outbox,
`NotificationOutboxEventBus`, `NotificationDeliveryService`, and
`NotificationBackgroundWorker`. Telegram had the only real provider boundary.
Auth lockout, recovery, forced logout, and subscription events were already
generated, but email rows were always written as `SUPPRESSED` and the worker
claimed Telegram rows only. No approved email provider or duplicate email
framework was found.

## 4. Event matrix

| Requirement | Application event | Recipient | Template | State without provider |
| --- | --- | --- | --- | --- |
| REQ-195/196 lockout | `LOCKOUT_EMAIL` | authoritative affected user | `security.lockout` | `SUPPRESSED` |
| REQ-198/199 recovery | `RECOVERY_CODE_EMAIL` | configured Super Admin recovery email | recovery template deferred | `SUPPRESSED` |
| REQ-220/221 forced logout | `FORCED_LOGOUT_EMAIL` | authoritative affected user | `security.forced-logout` | `SUPPRESSED` |
| REQ-138 subscription rejection | `SUBSCRIPTION_PROOF_REJECTED` | business owner | `subscription.proof-rejected` | `SUPPRESSED` |
| REQ-140 proof submission | `SUBSCRIPTION_PROOF_SUBMITTED` | exactly the active Admin accounts | `subscription.proof-submitted` | `SUPPRESSED` |
| REQ-139 reminder | no event exists | owner | unresolved | not scheduled |
| REQ-094 affected booking | no event producer exists | owner | unresolved implementation gap | not generated |

Customer booking reminders remain Telegram-only per the canonical specification.

## 5. Provider boundary

Added `EmailProvider` and `EmailMessage` contracts containing only recipient,
subject, stable template ID, safe string data, idempotency key, and optional
correlation ID. Added `DisabledEmailProvider`, which reports unavailable
delivery and never reports acceptance. No vendor, credentials, sender identity,
SMTP configuration, or production domain was invented.

## 6. Outbox and delivery behavior

The existing outbox remains authoritative. Email rows are `PENDING` only when
the injected provider reports configured; otherwise they are `SUPPRESSED`. The
existing worker claims both channels, uses the existing stable idempotency key,
records provider acceptance as `SENT`, and applies the existing bounded retry,
dead-letter, stale-claim, and observable error behavior. Domain state is not
rolled back when delivery fails.

## 7. Security and recipient resolution

Recipients are resolved from server-side user records using the persisted user
ID; client-provided addresses are not used. Lockout IP/device/browser values are
read from the persisted `ACCOUNT_LOCKED` security event at delivery time. Email
payload parsing accepts only string values. Passwords, recovery codes, tokens,
provider credentials, and raw exceptions are not placed in email payloads or
logs.

## 8. Recovery, lockout, and forced logout

Lockout and forced logout event production was preserved. Session revocation and
lockout state occur before notification publication and do not depend on email.
Recovery code generation, hashing, expiry, attempt limits, and single-use
consumption were preserved. Recovery delivery remains suppressed even if a
provider is later configured because the current event does not carry an
encrypted or provider-safe code handoff; the code is never logged or stored in
plaintext.

## 9. Schedule-conflict email

The existing schedule service derives open conflicts and preserves the canonical
five-minute grouping allowance, but no email event producer or grouped delivery
record exists in the current repository. No new grouping duration, recipient
behavior, or booking payload was invented. This remains an explicit follow-up
implementation gap.

## 10. Subscription email

Existing proof-submission and proof-rejection events now use the common email
provider/outbox boundary. The subscription reminder event and lead-time remain
deferred because the numeric lead time is unresolved in specification §46. No
default was hard-coded and no reminder scheduler was added.

## 11. Worker interaction

`NotificationBackgroundWorker` remains the sole notification worker. No second
scheduler, Redis queue, or alternate outbox was introduced. Shutdown and test
disabling behavior remain unchanged.

## 12. Tests

Added a deterministic `DisabledEmailProvider` test covering unavailable delivery
and the absence of provider acceptance. Existing Telegram notification tests
continue to typecheck and run. Full backend tests passed with the new test
included.

## 13. Verification results

- Backend unit/integration suite: **179 passed / 224 skipped**, 35 files.
- DB suite run 1: **347 passed / 23 files**.
- DB suite run 2: **347 passed / 23 files**.
- Consecutive clean DB runs: **2**.
- Backend typecheck: **PASS**.
- Backend lint: **PASS**.
- Backend build: **PASS**.
- Frontend tests: **500 passed / 43 files**.
- Frontend typecheck: **PASS**.
- Frontend lint: **PASS**.
- Frontend build: **PASS**; existing 520.70 kB chunk warning remains.

## 14. Browser QA

Not run. No Playwright, Cypress, Puppeteer, or equivalent browser-QA harness
exists in the repository, and email delivery introduced no frontend surface.

## 15. Provider configuration and deferred decisions

External provider configuration remains deployment/infrastructure work. The
subscription-reminder lead time remains explicitly unresolved. Subscription
price, owner booking-report PDF behavior, timezone-abbreviation behavior, and
all other §46 decisions were left untouched. The missing schedule-conflict email
producer is also documented rather than silently resolved.

## 16. Change and history confirmation

The canonical specification was not modified. No secrets or provider
credentials were added. Focused email changes were committed separately as:

- `18206a2` - `feat: add email provider boundary`
- `ab7a6bd` - `feat: route email events through notification outbox`
- `e8d7611` - `feat: expose email provider availability`
- `dd3863a` - `test: cover disabled email delivery`

These commits were made because the latest user instruction requested one-by-one
commits. Pre-existing Prompt 56 worktree changes were not staged, reverted, or
committed.