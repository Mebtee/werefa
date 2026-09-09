# 11 — Payment Architecture

> **Architecture Version:** 1.0.1 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06 (+ Prompt 06-CORRECTION: resubmission requires verification control, §A.3)
> Binding: REQ-100, REQ-110–124, REQ-230; SM-12; OQ-PAY-001. Two independent flows: **A** customer booking payment, **B** business subscription payment.

## A. Customer booking payment

### A.1 Method set (OQ-PAY-001)

Exactly **Bank Transfer** and **Telebirr / mobile money**. No custom methods this phase (REQ-115 superseded). `payment.method ∈ {BANK_TRANSFER, TELEBIRR_MOBILE_MONEY}` constrained by CHECK (doc 07). Methods are a **platform configuration**, not a per-business backend integration — the platform instructs the method and the customer transfers manually; **no direct PSP/payout integration** exists in the approved baseline.

### A.2 Prepayment configuration

Per-business prepayment config (REQ-110): owner chooses **percentage** or **fixed** amount (REQ-111). Stored in `business_settings.prepaid_percent`/`prepaid_fixed`; derived `prepaid_minor` computed at booking time and snapshotted onto `payment`.

### A.3 Proof lifecycle

| Step                          | Action                                                                                                                          | States                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Upload (R117/R118)            | Image or PDF proof, staged in S3 (doc 16), attached in booking tx                                                               | payment PENDING                                                       |
| Owner review dashboard (R119) | Accept / Reject                                                                                                                 | PENDING→ACCEPTED / PENDING→REJECTED (reason required R68/R124)        |
| Owner review Telegram (R120)  | Same actions via bot callback (doc 12)                                                                                          | same                                                                  |
| Resubmission (R230/SM-09)     | New valid proof → REJECTED→PENDING; **requires the resubmission verification control** (doc 08 §9 — phone-scoped one-time code) | new proof replaces old (lineage `payment_proof.replaced_by_proof_id`) |
| Slot binding                  | slot locked at PENDING; blocked on REJECTED until release/resubmit (R123)                                                       | see doc 08/09                                                         |

### A.4 Enforced rules

- Payment status is **exactly** PENDING/ACCEPTED/REJECTED (REQ-100/SM-12); DB CHECK + API claims both enforce.
- **No refund state.** Manual refunds are an external owner business operation (REQ-122); never a status, never automated, never exported as a status (doc 21 exclusions).
- Accepted payment _attaches_ to the booking and remains after reschedule (REQ-107). A higher new price after reschedule is handled manually by the owner (REQ-108).
- Rejection must carry a reason delivered to the customer (R124) — stored on the history/notification event, not a new payment status.

### A.5 Data

`payment` (business, booking, status, method, prepaid_minor) + `payment_status_history` + `payment_proof` (file refs, submission_key, lineage). All tenant-scoped.

## B. Business subscription payment

### B.1 Basics (REQ-125/126/135/136)

One standard monthly price; no tiers. Paid by **manual bank transfer**; the owner uploads proof (image or PDF) via dashboard.

### B.2 Review

- Proof enters a **review queue** visible to exactly the two Admin accounts (REQ-140).
- Approve (Admin or Super Admin) **activates/extends the subscription by 30 days** (REQ-130/137).
- Reject requires a **reason**, sent to the owner (REQ-138).
- No automated money movement; all is manual review of a transferred amount.

### B.3 Subscription state effects

Detailed in doc 15. Summary: approval → `ACTIVE` (or extend `period_ends_at`), trial→paid transition, grace windows, expiry processing; reminders by email + business Telegram (R139); warning until renewal (R141).

### B.4 Distinction from customer payment

- Different entity families (`subscription_payment` vs `payment`), different reviewer roles (Admin/Super Admin vs Owner), different gating (subscription entitlement vs booking slot).
- Shared infrastructure only: FileObject (proof uploads), notifications, audit history, and the "proof is verified manually, reason on reject" pattern.
