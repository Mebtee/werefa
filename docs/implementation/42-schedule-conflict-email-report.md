# 42 - Schedule Conflict Email (REQ-094) Report (Prompt 58)

## 1. Objective

Audit whether the canonical specification provides enough information to
implement the missing REQ-094 schedule-conflict affected-booking email producer
without inventing product behaviour, and — only if so — implement it through the
existing notification/outbox boundary. No new queue, scheduler, provider,
notification system, or email content was to be invented.

## 2. Starting specification SHA-256

`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`

## 3. Ending specification SHA-256

`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`

(Identical — the specification was not modified.)

## 4. Exact REQ-094 interpretation (read directly from the canonical spec)

Canonical text (Section 40.9) and the Section 19 catalog:

- **REQ-094** — an affected-booking email SHALL be generated for the impacted
  schedule change; AC1: sent when a conflictual schedule change is **applied**.
  (Catalog N12: recipient **Owner**, channel **Email**, trigger "on applied
  conflictual schedule change".)
- **REQ-096** — the notification lists **every** affected booking individually.
- **REQ-097** — each entry contains **customer name, phone, date/time and
  selected services**.
- **REQ-098** — the notification includes **direct access** to the affected
  bookings ("from the notification, the owner can open each affected booking").
- **REQ-099 / N14** — notifications/views offer **quick actions Reschedule,
  Cancel, Keep Booking**.
- **REQ-095 / N13** — close changes **MAY** be grouped into a five-minute window.
- Section 19.2/19.3 — an outbox row with status + bounded retries; delivery is
  idempotent per stable notification key; "schedule-change aggregation is MAY".

Recipient (owner) and the per-booking field set (REQ-097) are unambiguous. The
**link/action contract** (REQ-098/099) and the **grouping/trigger-identity**
semantics are not.

## 5. Outcome decision: **OUTCOME B — specification is insufficient**

REQ-094 cannot be fully and safely implemented without inventing product
behaviour that the canonical specification does not define. Therefore the
implementation portion was stopped, no speculative producer was created, and the
remaining ambiguity is documented below. This is a **specification gap requiring
a product decision, not an implementation failure**.

Decisive blocking facts:

1. **REQ-098 (MUST) and REQ-099 (MUST) require deep links / quick actions, whose
   target is undefined.** The canonical spec never defines the owner URL, route,
   or domain, and the repository provides **no canonical owner-link/URL
   construction mechanism**: the backend has no app/public/web base-URL config
   (`app-config.ts` has none; `backend/.env.example` has none), and the only
   non-Telegram web origin is the frontend build-time `VITE_API_BASE_URL`
   (an API base, not an owner web-app base). Building a deep link would require
   inventing a URL/domain/route contract. The Prompt 58 rules forbid inventing
   links ("do not invent email content, links, recipients, fields, timing, or
   behavior").
2. **Quick-action representation is undefined.** Whether the email carries
   Reschedule/Cancel/Keep as inline links, buttons, or simply points at the
   existing authenticated conflict view is not stated. The repository has no
   email-action mechanism, and the owner conflict UI/API is the authoritative
   mutation surface (Phase 9 forbids email-specific mutation endpoints).
3. **Delivery-time reconciliation is unspecified.** `listOpenConflicts` is a
   *pure on-demand derivation* from the ACTIVE version; conflicts can vanish
   before delivery (Keep Booking, reschedule, cancel, a later schedule edit).
   The spec does not say whether the email must snapshot the affected bookings at
   change time or re-derive at delivery, nor what to send if the set becomes
   empty. Choosing either is a product/architecture decision.
4. **Multi-booking payload has no persistence.** The existing outbox stores a
   ≤200-char `payload_ref` and re-resolves a single booking/proof at delivery.
   An affected-booking email needs an authoritative snapshot of **N** bookings
   (name/phone/date/services). No conflict/affected-booking persistence exists
   (the Prisma schema has no conflict table/column), so snapshot-vs-rederive
   must be decided first.
5. **REQ-095 grouping (MAY) has no mechanism or flag.** No grouping code, flag,
   window, or grouping identity exists in the active tree; enabling it would
   invent configuration and grouping storage. (It can be omitted because it is
   MAY, but it cannot be "preserved" because nothing exists to preserve.)
6. **Notification identity/subject are undefined.** The outbox requires a stable
   idempotency key and a template id; the canonical spec does not define the
   conflict email's logical identity or subject wording (architecture doc 13
   only says subjects are brand-fixed, "Werefa").

Because (1) alone is a MUST requirement whose contract is undefined and has no
existing canonical mechanism to reuse, implementing REQ-094 now would require
inventing a link/domain — explicitly disallowed.

## 6. Existing schedule-conflict implementation audited

- `ScheduleService.saveTemplate` (`backend/src/domain/services/schedule.service.ts`)
  creates a new immutable version, promotes it to ACTIVE (unless paused), and
  returns `{ versionId, activated }`. It **does not** evaluate conflicts and
  **does not** publish any event — so there is no producer hook today.
- `ScheduleService.listOpenConflicts(businessId)` (REQ-092/093) derives open
  conflicts from the ACTIVE version + live bookings (`PAYMENT_PENDING`/
  `CONFIRMED`), excluding recorded Keep-Booking exceptions. It returns exactly
  the fields needed by the UI: bookingId, status, startAt/endAt, createdAt,
  customerName, customerPhone, note, reason, reasonDetail, services.
- `ScheduleService.recordScheduleException` (REQ-159/160/161) — Keep Booking.
- API: `OwnerScheduleController` exposes `GET .../schedule/conflicts` and
  `POST .../schedule/exceptions`; the `PUT .../schedule` save path emits nothing.
- Notification boundary (reused, unchanged): `NotificationOutboxEventBus` +
  `NotificationDeliveryService` + `EMAIL_PROVIDER` (`DisabledEmailProvider`).
- No duplicate conflict detector, second outbox, queue, scheduler or email
  provider was introduced (and none was added by this pass).

## 7. Existing grouping behaviour

None. There is no five-minute grouping implementation, config flag, or grouping
row in the active tree (`grep` for grouping/window/debounce in `backend/src`
finds only unrelated day-grouping comments). Architecture doc 10/13 describe the
five-minute window as an optional (`MAY`) config flag; it is not implemented.
Historical report `docs/implementation/06-scheduling-management-report.md`
describes a previous (pre-reset) implementation with `grouped:true` rows and a
`managementUrl`; that code is **not** present in the active tree.

## 8. Notification producer changes

**None.** No event type, outbox writer branch, template, idempotency key, or
delivery path was added for REQ-094. No speculative producer was created.

## 9. Email payload / content

**None implemented.** The canonical per-booking fields (REQ-097: customer name,
phone, date/time, selected services) and the MUST link/action requirements
(REQ-098/099) are recorded above as the required content, but no payload was
invented. No subject/template id was invented.

## 10. Recipient resolution

Not implemented. When implemented, the recipient must be the authoritative
business owner (server-side) for the changed business, tenant-scoped, matching
the existing subscription-owner resolution pattern — never a client-supplied
address. No such producer exists yet.

## 11. Idempotency

Not implemented. The existing conventions (unique `notification_delivery.
idempotency_key`, P2002 dedupe) are preserved and available for a future
producer. The logical notification identity for a conflict email is part of the
gap (Section 5, item 6).

## 12. Delivery / failure semantics

Unchanged. Existing semantics (commit-first, best-effort delivery, bounded
retry/backoff, dead-letter, stale-`SENDING` reclaim, `SUPPRESSED` when no
provider) are preserved. No schedule-conflict-specific retry system exists.

## 13. Email provider status

Unchanged: `EMAIL_PROVIDER` → `DisabledEmailProvider` when no external provider
is configured. No SendGrid/SES/Mailgun/Resend/SMTP/provider was invented or
configured, and no delivery success can be falsely reported.

## 14. Keep Booking interaction

Preserved and unchanged. `recordScheduleException` still requires a real
conflict, is idempotent, writes the exception + a booking-history audit row
(`fromStatus` NULL), and clears the conflict. No re-notification loop and no
customer notification were introduced (REQ-160 AC6).

## 15. Reschedule / Cancel interaction

Unchanged. Owner reschedule/cancel continue to flow through the existing
`BookingService` (authorization, payment attachment, Telegram/customer
notifications unchanged). No workflow was duplicated into the notification
module and no email-specific mutation endpoint was added.

## 16. Security / tenant isolation

Strengthened by test (see Section 17). The conflict projection is business-scoped
and exposes only the approved fields; a schedule change for business A cannot
list business B's bookings, and no sensitive fields (payment/password/token/
email) are present in the projection. No authentication/authorization was
weakened.

## 17. Backend tests

- Existing coverage confirmed for REQ-090/092/093 (open conflicts with reason and
  booking detail), REQ-159/160/161 (Keep Booking, idempotency, non-conflict
  rejection, oversized reason) and distinct CLOSED/BLOCKED/OUTSIDE_HOURS reasons.
- Added one focused test to `backend/src/domain/domain-services.db.spec.ts`
  (DB-gated): *"lists every affected booking of the changed business with only
  the approved fields (REQ-096/097, tenant-scoped)"* — two affected bookings of
  business A are all listed with the exact approved field set
  (name/phone/date/services/reason), business B is untouched and lists zero
  conflicts, and business B's booking never appears in A's list. This strengthens
  only already-defined behaviour; **no expected email payload was invented**.
- Unit: **179 passed / 234 skipped** (36 files).
- `npm run typecheck` / `npm run lint` / `npm run build`: **PASS**.

## 18. DB tests

- Run 1: **357 passed / 24 files**.
- Run 2: **357 passed / 24 files**.
- Consecutive clean DB runs: **2**.

(356 before this pass + 1 new test.)

## 19. Frontend changes

**None.** No frontend code was changed. No filtered route or new link target was
introduced (there is no email link yet). The existing owner conflict UI and its
tests are untouched.

## 20. Browser-QA status

No automated browser harness exists (no Playwright/Cypress/Puppeteer scripts;
`frontend/qa-shot/` holds only ad-hoc screenshots). No harness was added for this
prompt. Email delivery introduced no user-facing surface and no owner
route/link, so browser QA is not applicable.

## 21. Known limitations

- **REQ-094/096/097/098/099 are not implemented**: the schedule-conflict
  affected-booking email is not generated on a conflictual schedule change.
  This is a **specification gap**, not a regression: the conflict detection,
  warning projection, Keep-Booking exception flow and tenant isolation all remain
  functional; the email channel is the only missing piece.
- No grouping window exists (REQ-095 is MAY and is intentionally not enabled).

## 22. Remaining specification ambiguity (explicit)

The following must be confirmed by the product owner before REQ-094 can be
implemented safely:

1. **Deep-link contract (REQ-098):** the owner web-app base URL/domain and the
   route to open a single affected booking; whether links are authenticated
   deep links and whether they must also open the conflict panel.
2. **Quick-action representation (REQ-099):** inline links/buttons vs. a single
   link into the existing authenticated conflict view (no email mutation
   endpoints).
3. **Trigger point:** whether conflicts are evaluated and captured at schedule
   save (snapshot) or re-derived at delivery time.
4. **Reconciliation:** what to send when the affected set changes or becomes
   empty before delivery.
5. **Grouping:** whether the optional five-minute window (REQ-095) is enabled,
   and if so its persistent identity/merge key.
6. **Notification identity + subject:** the stable idempotency identity and the
   (brand-fixed) subject wording for the conflict email.

This ambiguity is **not** one of the six §46 items; it is a newly surfaced gap in
the schedule-conflict notification contract.

## 23. Unresolved §46 decisions left untouched

All six remain unresolved and were not invented or resolved: (1) subscription
monthly price, (2) global timezone identity, (3) subscription-reminder lead time,
(4) owner booking-report PDF export, (5) owner "modify" scope, (6) timezone
abbreviation display. Prompt 38 Item 6 was not reconstructed.

## 24. Confirmation the specification was not modified

SHA-256 unchanged: `5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`.

## 25. Confirmation no commit was made

**NO COMMIT WAS MADE.** The only change introduced by this pass is one added test
in `backend/src/domain/domain-services.db.spec.ts` (a file that was already
modified in the worktree before this prompt). No history was rewritten; no
reverts, resets, squashes, or staged commits occurred.
