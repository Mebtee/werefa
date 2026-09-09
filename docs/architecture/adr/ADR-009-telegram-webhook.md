# ADR-009 — Telegram Integration via Webhook

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** ACCEPTED — PROMPT 06

## Context

REQ-056 (optional customer Telegram), R065–R068 (owner notified + can Accept/Reject from Telegram), R227–R229 (customer notifications). Telegram is an integration, not the booking system (REQ-059).

## Decision

**Webhook mode** in prod/staging (`/api/v1/telegram/webhook`), long-poll in dev. Delivery: structured callback payloads over the same guarded booking transitions (ADR-004); authentication via X-Telegram-Bot-Api-Secret-Token; **update_id dedup** at-most-once (doc 12 §4/§5). Outbound sends are queued through `notification_delivery` + BullMQ (doc 13). Availability/correctness never depend on Telegram reachability (doc 13 §7).

## Alternatives considered

- Long-poll everywhere: fine for dev, insufficient for prod delivery guarantees.
- Treating the bot as a booking channel: explicitly rejected (REQ-059).

## Consequences

- Owner actions from chats are authenticated, idempotent, and bound to a real connection; spoofing and replay are prevented (doc 12 §4).
- Webhook secret + bot token managed as secrets; rotation runbook in deploy docs.
- Customer visibility is limited to their own bookings (privacy maintained).

## Linked docs

12-Telegram; 13-Notification; 18-API.
