# 55 — Real Payment-Proof Preview / Viewer for Owner & Admin Review

Prompt: **Real payment-receipt/proof preview experience for the existing owner and admin payment-proof review workflows**
Status: **COMPLETE** — reviewer can now inspect the actual uploaded proof before deciding; one existing backend gap closed; no product decision, schema change, new provider or mock data introduced; all gates green
Report date: 2026-10-01
Repository: Werefa (`master`, uncommitted working tree; **no commit made**)

> This is a UX/integration completion of the **existing** payment-proof flow, not
> a new payment feature. The customer upload, proof storage, metadata, tenant-
> scoped retrieval, owner and admin review routes already existed. The gap was
> that a reviewer was shown Approve/Reject **before** any visual access to the
> uploaded receipt. This report describes the audit, the single genuine backend
> gap (the admin had **no** way to read the proof bytes at all), and the shared
> frontend viewer added to the owner and admin review surfaces.
>
> The canonical specification was not modified. No §46 decision was resolved. No
> blocked/deferred requirement was touched. No mock/demo receipt data was added.
> No storage/payment/notification provider was added. No database schema change
> was made. No commit was created.

---

## 1. Audit performed

The full real chain was inspected from source and existing tests:

```
Customer upload (multipart `payload` + `proof`)
  ▼  BookingService / ResubmissionService / SubscriptionBillingService
Payment-proof persistence (PaymentProofStorage → LocalProofStorage)
  ▼  keys `<businessId>/<uuid>.<ext>`, bytes on disk, never in PostgreSQL
FileObject metadata (storage_key, mime_type, size_bytes, checksum)
  ▼
Tenant-scoped retrieval
  ▼  owner: BookingService.getOwnerProofDownload (TenantGuard → booking → proof → read)
Owner payment-proof review     (GET/POST owner bookings …/accept, …/reject)
Admin payment-proof review     (GET admin/subscription/proofs, …/approve, …/reject)
  ▼  Approve / Reject (business rules unchanged)
```

Key findings:

| Area | Finding |
| --- | --- |
| `PaymentProofStorage` / `LocalProofStorage` | Existing port + local adapter; path-traversal guarded; keys opaque and business-namespaced. **Reused unchanged.** |
| Owner proof download | `GET /api/v1/owner/businesses/:id/bookings/:bookingId/proofs/:proofId` already returns the real bytes with the real `Content-Type`, tenant + booking scoped, `Content-Disposition: attachment`. **Reused unchanged** (the frontend renders the fetched blob, so the download disposition is immaterial to preview). |
| Admin proof access | **Gap:** the admin review queue exposed only metadata; there was **no** admin route to read the proof bytes and the projection exposed no storage key/file id. A reviewer could approve/reject blind. **Closed** with a minimal authenticated read endpoint. |
| Content-type / magic bytes | `lib/proof-file.ts` sniffs magic bytes at upload; stored `mimeType` is authoritative. **Unchanged.** |
| Owner UI | `BookingDetailPage` rendered proof metadata + a download button in a card *below* the Approve/Reject card — the decision preceded the proof. |
| Admin UI | `SubscriptionReviewPage` rendered business/owner metadata + Approve/Reject with no receipt at all. |
| Proof lifecycle / lineage | The owner projection carries `replaced`; file-less proof rows were already dropped (Prompt 13/54/69 fix). **Preserved.** |

## 2. Current payment-proof architecture (unchanged)

- **Storage:** `PaymentProofStorage` port (`domain/repositories/proof-storage.port.ts`) with the `LocalProofStorage` filesystem adapter (`PROOF_STORAGE_DIR`). Owners/admin never see storage keys.
- **Metadata:** `FileObject` (category `SUBSCRIPTION_PROOF` / payment proof) linked from `PaymentProof` / `SubscriptionProof` by `fileObjectId`.
- **Authorization:** `TenantGuard.requireOwnedBusiness` for owner routes; `TenantGuard.requireAdminOrSuperAdmin` for admin routes; sessions are server-side cookies.
- **Uploads:** multipart `proof` file field; declared MIME is only a cheap screen, magic-byte sniffing is authoritative (`sniffProof`), 5 MB cap.
- **Delivery/notifications:** untouched (outbox; not relevant to preview).

## 3. Files / components changed

### Backend

| File | Change |
| --- | --- |
| `backend/src/domain/services/subscription-billing.service.ts` | New `getProofFileForAdmin(ctx, proofId)`: `requireAdminOrSuperAdmin` → `getProofById` → `fileRepo.findById` → `proofStorage.read`; returns bytes + real mime type + size + proof id; **never** the storage key. Missing proof/file/bytes → honest 404. |
| `backend/src/api/admin/subscription.controller.ts` | New `GET /api/v1/admin/subscription/proofs/:proofId/file` streaming route. Sets the real `Content-Type`, `Content-Disposition: inline; filename="payment-proof-<id8>.<ext>"`, `Content-Length`, `X-Content-Type-Options: nosniff`. Reuses the existing `proofFileName` helper. |
| `backend/src/api/http-subscription.db.spec.ts` | New DB-gated tests (see §7). |

No schema change. No new provider. No source under `frontend/public/`. No static/Nest static serving added.

### Frontend

| File | Change |
| --- | --- |
| `frontend/src/components/proof/PaymentProofPreview.tsx` (new) | Shared, role-agnostic viewer: takes an authenticated `load()` callback; renders image (contained, enlarge dialog), PDF (native viewer + open), download, and explicit loading/error/no-preview states. Never fabricates metadata. |
| `frontend/src/lib/download.ts` | Added jsdom-safe `createObjectUrl` / `revokeObjectUrl` helpers (feature-detected). |
| `frontend/src/features/owner-portal/state/usePaymentReview.ts` | New `loadProof(proof)` returning the authenticated blob via the **same** owner route; no new endpoint. |
| `frontend/src/features/owner-portal/lib/paymentReview.ts` | `OwnerProofReview` now carries the real `submittedAt` from the backend projection. |
| `frontend/src/features/owner-portal/pages/BookingDetailPage.tsx` | Review-decision card now renders the receipt preview (current non-replaced proof) before the Approve/Reject controls; honest no-proof/loading/error text. |
| `frontend/src/api/admin.ts` | New `loadSubscriptionProofFile(proofId)` using `apiDownload` on the new admin route. |
| `frontend/src/features/admin/SubscriptionReviewPage.tsx` | Each queue row now renders the real proof preview above Approve/Reject. |
| `frontend/src/styles/components.css` | Bounded, responsive viewer styles (no new media query; intrinsically bounded). |
| `frontend/src/test/businessApi.ts` | Test double mirrors the real contract: a proof-less booking yields an **empty** `proofs` list (previously it threw), so the honest no-proof state is testable. |
| `frontend/src/features/owner-portal/PaymentProofReview.test.tsx` | Owner preview tests added. |
| `frontend/src/features/admin/subscriptionProofPreview.test.tsx` (new) | Admin preview tests added. |

## 4. API / backend changes

- **Reused unchanged:** `GET /api/v1/owner/businesses/:businessId/bookings/:bookingId/proofs/:proofId` — already returned the bytes, real `Content-Type` and full authorization. The frontend uses it for preview **and** download; no duplicate owner API was created.
- **Added (required):** `GET /api/v1/admin/subscription/proofs/:proofId/file` — the admin previously had no file route at all. It reuses the existing admin authorization boundary, `FileRepository.findById` and `PaymentProofStorage.read`. It returns only bytes + real content type + size; no storage key, no filesystem path, no public URL.

No query-parameter disposition mechanism was added because the frontend renders fetched blobs (so the download disposition is irrelevant to preview), keeping the change minimal.

## 5. Security / authorization

- **Tenant isolation preserved:** the owner preview calls the same tenant/booking-scoped owner route; the existing test proving Owner A cannot read another business's proof still passes.
- **Admin boundary:** the new route calls `requireAdminOrSuperAdmin` (owners receive 403; unauthenticated receives 401), identical to the queue/approve/reject routes. The admin UI never calls an owner route and vice-versa.
- **No public proof URL:** proofs are only reachable through session-gated API routes. Nothing is copied into `frontend/public/`, no Nest static serving, no signed/public URL, no `/uploads/...`.
- **No leakage:** only bytes + real mime type + size are returned; the storage key and `PROOF_STORAGE_DIR` never reach the client (asserted in tests).
- **Content validation unchanged:** magic-byte sniffing at upload stays authoritative; the real stored content type is served. Browser filenames/MIME are never trusted.

## 6. Behavior

- **Owner:** when a booking is under review (`PAYMENT_PENDING`) and a current (non-replaced) proof exists, the receipt section appears directly above Approve/Reject with the real preview, `Uploaded` (real instant), `Type` (real content type), size, Open/Enlarge, Download receipt, then Accept/Reject. Rejection still requires a reason. Older/replaced receipts remain in the lineage list and are never shown as the current receipt.
- **Admin:** each pending subscription proof shows the real receipt preview (`Payment Receipt / Proof`) with Open/Enlarge and Download receipt above Approve/Reject.
- **Images:** rendered from the authenticated object URL, contained (`object-fit: contain`, `max-width: 100%`, bounded height) — never distorted; click or Open/Enlarge opens an accessible dialog (Escape closes, focus moves into the dialog); the enlarged view reuses the **same** object URL (no second fetch/copy).
- **PDFs:** rendered in the browser's native viewer via an authenticated object URL with an Open receipt action and download. No server-side conversion, no fabricated thumbnail.
- **No proof:** an honest "No payment proof uploaded." (owner) / error-with-retry (admin, when the file is absent) — never a placeholder or fabricated receipt. Consistent with the earlier file-less-proof removal.
- **States:** loading, loaded, error (with Retry), unsupported-type fallback, and no-preview fallback (environment without object URLs). A canceled-flag effect keeps the viewer out of a permanent spinner (including StrictMode double-invoke).

## 7. Tests added / strengthened

**Backend (`http-subscription.db.spec.ts`):**
1. Admin reads a real **PNG** proof file: `Content-Type: image/png`, `inline` disposition, `nosniff`, bytes equal the upload, and the storage dir/key is absent from the response.
2. Admin reads a real **PDF** proof file: `Content-Type: application/pdf`, exact bytes.
3. Owner cannot read the admin proof file (**403**); unauthenticated is **401**.
4. Unknown proof id is an honest **404**.
5. A proof row with `fileObjectId = null` is an honest **404** (no fabricated receipt).
6. Existing approve / reject / resubmit-lineage and owner-isolation tests remain green.

**Frontend:**
- `PaymentProofReview.test.tsx`: preview fetches the real tenant-scoped route and renders the image; Open/Enlarge dialog opens and closes with Escape; honest no-proof state; honest error state with Approve/Reject retained.
- `subscriptionProofPreview.test.tsx` (new): admin image preview over the authenticated admin route (asserting no public/uploads/storage-key URL), admin PDF rendering with Open receipt, honest 404 error state with Approve/Reject retained, and Retry re-requesting the file.
- `businessApi.ts` now models a proof-less booking so the honest empty state is exercised.

## 8. Test results

| Gate | Command | Result |
| --- | --- | --- |
| Backend unit | `cd backend && npm test` | **PASS** — 199 passed, 264 skipped (30 files) |
| Backend DB run 1 | `cd backend && npm run test:db` | **PASS** — 405 passed (29 files) |
| Backend DB run 2 | `cd backend && npm run test:db` | **PASS** — 405 passed (29 files) |
| Backend typecheck | `cd backend && npm run typecheck` | **PASS** |
| Backend lint | `cd backend && npm run lint` | **PASS** |
| Backend build | `cd backend && npm run build` | **PASS** |
| Frontend tests | `cd frontend && npm test` | **PASS** — 546 passed (50 files) |
| Frontend typecheck | `cd frontend && npm run typecheck` | **PASS** |
| Frontend lint | `cd frontend && npm run lint` | **PASS** |
| Frontend build | `cd frontend && npm run build` | **PASS** |
| Acceptance (static) | `npm run acceptance:static` | **PASS** |
| Acceptance (full) | `npm run acceptance` | **PASS** |

The DB suite was run twice consecutively against the same `werefa_test` database. No test timeouts were changed and no gate was weakened.

## 9. Browser QA

There is **no browser QA harness** in the repository (only static screenshots under
`frontend/qa-shot/`). Browser QA was therefore **unavailable**; no browser results
are claimed. Component-level render tests (jsdom) exercise the real API client
against the doubles for image and PDF proofs, open/enlarge, download, and the
loading/error/no-proof states.

## 10. Canonical specification SHA-256

```
5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b  docs/WEREFA-COMPLETE-SPECIFICATION.md
```

Verified before and after implementation — unchanged. The acceptance gate's pinned
digest check passes.

## 11. Product decisions / scope

- No unresolved §46 decision was resolved (subscription price, global timezone,
  reminder lead time, owner booking-report PDF, owner "modify" scope, timezone
  abbreviation all untouched).
- Blocked (REQ-094/095/139), deferred (REQ-025/034/115) and provider-dependent
  requirements were not touched.
- Described accurately as: **"Real payment-proof preview/view capability for the
  existing payment-proof review workflow."** No new payment requirement was added.

## 12. Mock / demo audit

No runtime mock/demo receipt data was introduced. Production code imports no
`@/mock/*` seam; no fake receipt image/URL/metadata, placeholder, `payment-proof-*.bin`,
0-byte placeholder or fallback receipt exists. Fixtures remain confined to
`src/test/**` and `src/mock/**`. The whole-app no-mock guards and the acceptance
gate continue to pass.

## 13. Working tree status

Modified:
```
M backend/src/api/admin/subscription.controller.ts
M backend/src/api/http-subscription.db.spec.ts
M backend/src/domain/services/subscription-billing.service.ts
M frontend/src/api/admin.ts
M frontend/src/features/admin/SubscriptionReviewPage.tsx
M frontend/src/features/owner-portal/PaymentProofReview.test.tsx
M frontend/src/features/owner-portal/lib/paymentReview.ts
M frontend/src/features/owner-portal/pages/BookingDetailPage.tsx
M frontend/src/features/owner-portal/state/usePaymentReview.ts
M frontend/src/lib/download.ts
M frontend/src/styles/components.css
M frontend/src/test/businessApi.ts
```
Untracked (new):
```
?? frontend/src/components/proof/                     (PaymentProofPreview.tsx)
?? frontend/src/features/admin/subscriptionProofPreview.test.tsx
?? docs/implementation/55-real-payment-proof-preview-inspection.md
```

**No commit was created.** No schema change, no new provider, no specification change.
