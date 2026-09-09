# Werefa

**Werefa** is a **multi-tenant SaaS scheduling / queue platform**. It manages **bookings**, **schedules**, **conflict handling**, **schedule exceptions**, **notifications**, **history/audit**, and **reports**, with **Telegram** used for customer and owner messaging (optional for customers). Approved decision content is captured in the [canonical decision register](docs/250-approved-decisions.md); the derived requirements (REQ-001 … REQ-232) live in the [master specification](docs/01-master-specification.md).

---

## Repository Status

- **Stage:** Documentation — requirements derived from approved decision content (Prompt 03 complete); **Prompt 04 consistency audit** and **Prompt 05-FIX decision application complete**; **Prompt 06 architecture & technical design complete** (docs/architecture, 30 docs + 12 ADRs); DEC source-word import pending
- **Implementation:** **Not yet begun** (will begin only after the documentation stage is complete)
- **Decision process:** 250 approved requirements decisions exist. All are registered (`DEC-001`…`DEC-250`); exact source wording is pending import. Captured approved content is recorded as **242 `KF-*` facts**; the **14 Prompt 05-FIX final approved decisions** are applied (Appendix C of the decision register). These produced **232 requirements** (REQ-001 … REQ-232). The single known conflict (CONF-001) is **resolved**; see the [consistency audit](docs/consistency-audit.md).

---

## Documentation

**The documentation is the source of truth for implementation.**

The documentation lives in [`docs/`](docs). Start with the index, then the master specification, then the decision register.

| Document                                                                 | Purpose                                                                                                   |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| [docs/00-project-overview.md](docs/00-project-overview.md)               | Non-technical product overview and domain map                                                             |
| [docs/01-master-specification.md](docs/01-master-specification.md)       | **Authoritative** requirements: 232 decision-traced requirements (REQ-001 … REQ-232) + §26 state machines |
| [docs/250-approved-decisions.md](docs/250-approved-decisions.md)         | **Canonical decision register**: 250 decision slots + 242 captured approved facts + known conflicts       |
| [docs/consistency-audit.md](docs/consistency-audit.md)                   | Full consistency audit; CONF-001 resolution and cross-domain findings                                     |
| [docs/02-user-roles-permissions.md](docs/02-user-roles-permissions.md)   | The five roles and their per-role permissions                                                             |
| [docs/decision-traceability.md](docs/decision-traceability.md)           | Decision-to-requirement mapping (reverse index)                                                           |
| [docs/requirements-traceability.md](docs/requirements-traceability.md)   | REQ → KF traceability matrix (one row per requirement)                                                    |
| [docs/requirements-quality-check.md](docs/requirements-quality-check.md) | Per-requirement quality checklist results                                                                 |
| [docs/decision-import-checklist.md](docs/decision-import-checklist.md)   | Per-decision import progress and validation checklist                                                     |
| [docs/architecture/README.md](docs/architecture/README.md)               | **Prompt 06** architecture & technical design set (30 docs + 12 ADRs)                                     |
| [docs/02-open-questions.md](docs/02-open-questions.md)                   | Log of missing / ambiguous / contradictory items                                                          |
| [docs/03-documentation-index.md](docs/03-documentation-index.md)         | Navigation map and documentation governance                                                               |
| [README.md](README.md)                                                   | This file — repository entry point                                                                        |

---

## For Coding Agents

If you are a coding agent about to work on this repository, please:

1. Read [docs/03-documentation-index.md](docs/03-documentation-index.md) first to understand the documentation structure and governance rules.
2. Read [docs/01-master-specification.md](docs/01-master-specification.md) as the authoritative source of requirements.
3. Do **not** begin application implementation until the documentation stage is complete.
4. Do **not** invent business requirements; record ambiguity in [docs/02-open-questions.md](docs/02-open-questions.md) instead.

---

## Getting Started / Building

> Not yet applicable — there is no application code. The technology stack **is decided** by the architecture set (Prompt 06); see [docs/architecture/README.md](docs/architecture/README.md) and [docs/architecture/adr/ADR-001-technology-stack.md](docs/architecture/adr/ADR-001-technology-stack.md). This section will be populated once implementation begins.
