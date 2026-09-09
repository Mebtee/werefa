# 19 — Frontend Architecture

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06

## 1. Applications

One Vite workspace with **two apps** sharing a UI kit (`@wl/ui`):

| App             | Audience                    | Route root  | Auth                              |
| --------------- | --------------------------- | ----------- | --------------------------------- |
| `public-app`    | Customers (anonymous)       | `/b/{slug}` | none (public)                     |
| `dashboard-app` | Owner / Admin / Super Admin | `/app/*`    | session cookie redirects to login |

Rationale: public booking must stay unauthenticated and lightweight; the dashboard carries heavy tooling. Same domain, distinct SPAs (ADR-001/ADR-010 note).

## 2. Routing

- **public-app:** `/b/{slug}` page (R207–215), slot picker (R50), booking form (R54/55), optional Telegram connect (R56), availability via `/public` API.
- **dashboard-app:** guarded routes per role:
  - `/login`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password` (R24–33)
  - Owner: `/owner/businesses` (R16–18), business switcher (R19), dashboard, bookings, schedule builder, services, payments, subscription, pause, history, reports
  - Admin: `/admin/reviews`, `/admin/bookings` (current status only R176; no schedule history R168)
  - Super Admin: `/super-admin/admins` (R217–219), force logout (R220), full history (R177), exports (R178), security records (R205), emergency recovery (R198/199)
- Route guards resolve `role` from session; unknown/unauthorized → redirect + `403`.

## 3. Role-based access & business context

- Server enforces everything (guards); frontend hides affordances for UX only.
- Owner state: session `activeBusinessId` (R21 remembered last business R21/22; auto-open last selected on login R22). Business switcher (R19) calls the switch endpoint; deactivated/expired businesses still openable (R23).
- Business identity always visible in the dashboard header (R20).

## 4. State management

| Concern         | Tool                         | Notes                                                 |
| --------------- | ---------------------------- | ----------------------------------------------------- |
| Server cache    | TanStack Query               | Keys by business+entity; invalidation after mutations |
| Client/UI state | Zustand                      | forms, business switcher, toasts, modal               |
| Session         | Query on `/auth/me` + cookie | never store token in JS                               |
| Forms           | react-hook-form + zod        | client validation mirrors DTOs                        |

No stale-while-revalidate for **booking** claims (availability display may cache briefly; claims go through server tx).

## 5. API communication

- Typed API client generated from OpenAPI (doc 18).
- All writes carry idempotency headers/key where the endpoint requires (`submission_key`).
- Error mapping to the envelope (doc 23) → user messages; `409 SLOT_UNAVAILABLE` shows "slot taken" retry copy; `422` subscription/paused shows reason; no server internals shown.

## 6. Error & loading states

- Loading skeletons for data; optimistic UI only for safe non-transactional toggles.
- Full-screen error boundaries per route; retry buttons for failed loads.
- Disabled states reflect server truth (paused/expired page stays visible with message R146/R148/R149, but booking controls disabled R147/R133).

## 7. Accessibility & responsiveness

- WCAG 2.1 AA target: semantic landmarks, full keyboard nav, focus management, `aria-live` for toasts, contrast for Tailwind palette; builders expose alt text for logo/cover.
- Mobile-first: booking flow is touch-first; dashboards responsive down to 360px; no dedicated native app in scope.

## 8. Public vs authenticated boundary

- public-app never renders authenticated UI, booking history (R57), or any tenant row except the page itself.
- dashboard-app never mounts public booking internals; both talk to `/api/v1` under the respective auth mode.

## 9. Observability

Error tracking (Sentry) wired in both apps; core web vitals telemetry; no PII or tokens in client logs (doc 24).
