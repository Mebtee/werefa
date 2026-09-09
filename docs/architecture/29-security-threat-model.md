# 29 — Security Threat Model

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06
> Companion to doc 14. Inputs to doc 28 §9 test plan and doc 27 hardening.

## 1. Method

Threats enumerated by asset class with STRIDE; mitigations tied to architectural controls; residual risks explicitly declared. Assets: **tenant data** (bookings/payments/proofs/history), **platform accounts** (Owner/Admin/SuperAdmin), **monetary evidence** (payment proofs/subscription proofs), **availability integrity** (slot correctness REQ-121).

## 2. Threat inventory

| ID   | Asset                | Threat                                                 | Who                             | STRIDE                             | Mitigation (arch)                                                                                             | Residual risk                                        |
| ---- | -------------------- | ------------------------------------------------------ | ------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| T-01 | tenant data          | Cross-tenant read/write via IDOR                       | malicious user                  | Information Disclosure / Tampering | business_id predicates + RLS everywhere; no id-only reads (doc 04 §5/§6); role guards                         | low (defense-in-depth)                               |
| T-02 | accounts             | Credential stuffing/brute force                        | botnet                          | Authentication                     | Argon2id; rate limits; lock after 5 (R193) (doc 14)                                                           | low                                                  |
| T-03 | accounts             | Session fixation/capture                               | MITM/XSS                        | Authentication                     | HttpOnly Secure SameSite cookie; opaque token; revocation (doc 14)                                            | low (XSS further reduced by CSP)                     |
| T-04 | accounts             | Unauthorized password reset                            | actor with email                | Authentication                     | one-time token; expiry (R28/31/33); single-active; lock reset (R194)                                          | low (email sec)                                      |
| T-05 | tenant data          | Upload of malicious proof (XSS/HTML)                   | customer/owner                  | Spoofing → code execution          | type allow-list + magic bytes + size caps (doc 16); served as binary only                                     | low                                                  |
| T-06 | monetary evidence    | Forgery/duplicate proof reuse                          | customer                        | Tampering                          | submission_key dedup; proof lineage; guarded payment transitions; checksum (doc 16/11)                        | low-moderate (manual review is the control)          |
| T-07 | availability         | Double booking / lost update                           | concurrency edge                | Tampering                          | advisory xact lock + unique partial index + guarded updates (doc 08)                                          | low (REQ-121)                                        |
| T-08 | accounts             | Abuse of Admin 2-count / Super Admin actions           | compromised Admin               | Privilege Escalation               | exactly 2 Admins (R037/38); SuperAdmin-only elevation (R217–221); audited (doc 22)                            | moderate (credential compromise of 2 accounts)       |
| T-09 | tenant data          | Telegram spoofing/impersonation                        | attacker w/ bot secret or token | Spoofing                           | webhook secret; update_id dedup; structured callbacks + connection binding; no text-based identity (doc 12)   | low                                                  |
| T-10 | tenant data          | Proof download by non-owner                            | user w/ URL                     | Information Disclosure             | presigned short-TTL GET + per-request authorization; proofs private (doc 16)                                  | low                                                  |
| T-11 | revenue/subscription | Renewal proof abuse (approve without genuine transfer) | colluding Admin                 | Privilege Escalation               | 2-minimum review (do-not-merge w/o human), audit trail (R206), monitor patterns                               | risk borne by manual review (accepted product model) |
| T-12 | tenant data          | Log/PII leakage                                        | bug/insider                     | Information Disclosure             | structured log redaction; PII minimized in notifications (doc 24/13)                                          | low-moderate                                         |
| T-13 | platform             | DoS on public booking endpoint                         | attacker                        | Denial of Service                  | Redis rate limiting; bounded payloads; cache for reads (doc 25 §3)                                            | moderate (mitigated by edge/LB)                      |
| T-14 | accounts             | Recovery-code brute force                              | attacker w/ email               | Authentication                     | one-time recovery code; rate limiting; audit (R198–200)                                                       | low                                                  |
| T-15 | history              | Repudiation of owner actions                           | owner/admin                     | Repudiation                        | immutable history + audit_event (doc 22); reports exclude actor/reason but history retains (R173/174 vs R183) | low                                                  |
| T-16 | tenant data          | Deletion of security records w/o trace                 | SuperAdmin                      | Tampering                          | deletion audited (R206), retention 1 yr, platform purge audited (doc 22 §5)                                   | low                                                  |

## 3. Assumptions & non-goals

- Non-goal (documented): no direct PSP integration; proofs verified manually (T-06/T-11 controls rely on human review). No SMS/OTP 2FA (TOTP-ready only, R34). No refund status (REQ-122).
- Assumption: operator controls DevOps infra (DB, Redis, S3), keys rotated; email provider (SES) protected by provider account security.
- PII handling per regulations: minimal collection (R097-style scoping), retention-managed security events (R204), history is intentional/legal (R175).

## 4. Residual-risk disposition

The two moderate residuals (T-08, T-13) receive documented mitigations (LBs, rate limits, monitoring, 2-account rule) and are revisited if platform reaches scale. T-11 is accepted by product design (manual review with audit) — no automated fix planned.
