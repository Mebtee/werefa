# 16 — File Storage

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06
> Binding: REQ-117/118, REQ-136, REQ-207/208/209, REQ-170/172, REQ-177/178/182, plus "never make payment proof publicly accessible".

## 1. Object categories

| Category             | Content                                              | Who writes               | Restrictive access                                                   |
| -------------------- | ---------------------------------------------------- | ------------------------ | -------------------------------------------------------------------- |
| `CUSTOMER_PROOF`     | customer booking payment proof (image/PDF, R117/118) | Customer via public flow | **Private** — owner/Admin-review only; never public (hard rule)      |
| `SUBSCRIPTION_PROOF` | owner's subscription payment proof (R136)            | Owner                    | Private — Admins/SuperAdmin review                                   |
| `LOGO`               | business logo (R209)                                 | Owner                    | Public-read (for public page)                                        |
| `COVER`              | one main cover photo (R208)                          | Owner                    | Public-read                                                          |
| `REPORT_PDF`         | generated booking/schedule-history PDFs (R170/178)   | System (worker)          | Private — requester scope (owner/SuperAdmin) + temporary signed link |

## 2. Object naming

```
{env}/{category}/{businessId?}/{yyyy}/{mm}/{objectId}{ext}
e.g. prod/CUSTOMER_PROOF/3f9…/2026/09/a1b…png
```

- `objectId` = UUID (unguessable). **No user-supplied filename in the key.** Tenant isolation is enforced by key prefix **and** by access control; never rely on the key alone (doc 04 §9).
- `file_object` row stores `storage_key`, category, mime, size, `checksum_sha256`, uploader, tenant.

## 3. Access control

| Path                       | Mechanism                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload (proofs)            | **Presigned PUT** to S3 into a **staged** logical area; Mongo... no — staged objects are flagged `STAGED` until referenced by a committed booking/subscription row.                                     |
| Download proofs            | Presigned **GET** issued only to the owner/Admin of that business (for customer proofs) or the reviewers (subscription proofs); expiry ≤ 5 minutes; per-request authorization re-checked.               |
| Public assets (logo/cover) | served via CDN with cache headers; content-type allow-list.                                                                                                                                             |
| Generated PDFs             | returned via presigned GET scoped to the requester; audit entry on issuance (doc 21).                                                                                                                   |
| Upload size                | `MAX_UPLOAD_BYTES` (config; default 10 MB) rejected with `413`; proof types image (png/jpg/webp) or PDF only; MIME **allow-list + magic-byte sniff**; file is not executed or displayed inline as HTML. |

## 4. Virus/malware handling

- **Blocked formats** at upload (allow-list) reduces risk (no executables, no HTML, no archives).
- **Magic-byte validation** plus size caps are the phase-1 control.
- **Optional scanning step** (config flag): proof objects may be routed to a scanner (e.g., `clamscan` hook) with status `QUARANTINED → INVALID`; if enabled, scanned files only become "proof attached" after PASS; a FAILED scan rejects the proof visibly. Default: configurable-but-off to keep the flow simple; deployment doc records the flag.

## 5. Retention / deletion / cleanup

| Item                  | Policy                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Payment proofs        | retained while the booking/history exists; associated with the immutable history (reports may reference).                          |
| Subscription proofs   | retained with subscription history.                                                                                                |
| Generated report PDFs | TTL by retention (config; default 30 days) then purged by cleanup job.                                                             |
| Staged orphans        | `STAGED` objects older than `ORPHAN_GRACE_MINUTES` (default 60) removed by cleanup job (doc 17).                                   |
| Deactivated business  | business is closed but **not deleted** (R216), so files are retained per retention policy; no destructive cleanup below retention. |
| Audit                 | every issuance/delete of a private object is audited (identity, tenant, action).                                                   |

## 6. Privacy hard rules

- **Payment proof is never publicly accessible** — no public URL path exists; CDN bucket policy denies `CUSTOMER_PROOF`/`SUBSCRIPTION_PROOF`; only presigned, scoped GETs.
- Generated PDFs never contain reasons/notes where excluded (R183; R172) and never leak across tenants (doc 21).

## 7. Operations

S3 versioning on the private prefix; lifecycle rules push deleted/cold objects per retention. Object sizes are minified via CDN for public images. `FileStorageService` is the only module touching S3; tests use MinIO (doc 28).
