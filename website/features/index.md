---
title: 'Features'
doc_version: '1.0.0'
status: active
last_review: '2026-06-01'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Features

What arbiter enforces — organised as invariant families, with a full machine-generated coverage
matrix underneath. Every invariant is a **hard gate**, not a warning (see
[Architecture](/concepts/)).

## Invariant families

arbiter's invariants are grouped into five tiers. Each ships as generated hooks, gate steps, and CI
workflows scaled to your chosen governance level.

| Tier | Family                  | What it enforces                                                             |
| ---- | ----------------------- | ---------------------------------------------------------------------------- |
| 1    | Architectural Integrity | Module boundaries, dependency rules, no circular deps, complexity limits     |
| 2    | Data Integrity          | Migration safety, schema/constraint discipline, audit-log rules              |
| 3    | Security & Compliance   | Secret scanning, PII scanning, dependency audit (CVSS ≥ 7.0), supply chain   |
| 4    | Operational Excellence  | Test coverage, mutation testing, TDD evidence, real-DB integration, CI tiers |
| 5    | Governance              | No direct-to-main, human approval, SSOT integrity, commit/branch conventions |

The canonical, always-current list (every invariant ID, its enforcement script, and activation
level) is [`AGENTS.md`](https://github.com/LucaDominici/arbiter/blob/main/AGENTS.md) §Invariants.

<!-- BEGIN GENERATED:kit-count -->

## Coverage matrix (78 dimensions)

Beyond the named invariants, arbiter tracks a machine-generated catalogue of **78 security and
quality dimensions** — each with its gate tier (L1/L2/L3), BLOCKING/ADVISORY status, and per-stack
coverage, rendered into `docs/REFERENCE/GLOBAL_KIT.md` from the same source arbiter uses for itself.
<!-- END GENERATED:kit-count -->

<!-- The region above is emitted by scripts/gen-derived-pages.mjs from
     src/kit/catalog.json and gate-checked at L1 (#1838) — the dimension
     count can never drift from the catalog again. -->

Browse the source of truth:
[`src/kit/catalog.json`](https://github.com/LucaDominici/arbiter/blob/main/src/kit/catalog.json)
(schema and taxonomy documented in
[ADR-045](https://github.com/LucaDominici/arbiter/blob/main/docs/internal/ADR/045-kit-taxonomy.md)).

## See the families in action

- [Problems Solved & How](/problems/) — each problem page names the specific invariant that addresses it.
- [Reference](/reference/) — look up the CLI, hooks, and stack support.
- [Use-Cases](/use-cases/) — which families are proven against which stacks.
