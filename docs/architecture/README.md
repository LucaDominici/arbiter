---
title: 'arbiter Architecture'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: 'ARCHITECTURE'
tags: ['audience/dev', 'kind/spine']
related: []
---

# arbiter Architecture

Spine for `docs/architecture/`. Read these in order to understand how arbiter
generates governance scaffolding.

## Reading order

1. [`OVERVIEW.md`](./OVERVIEW.md) — system map: CLI → generators → templates → target project
2. [`CANONICAL-SOURCE-MODEL.md`](./CANONICAL-SOURCE-MODEL.md) — SSOT layering and authority chain
3. [`TEMPLATE-SYSTEM.md`](./TEMPLATE-SYSTEM.md) — EJS template pipeline; how `src/templates/*.ejs` becomes target-project artifacts
4. [`CONFLICT-RESOLUTION.md`](./CONFLICT-RESOLUTION.md) — merge strategy when re-running `arbiter init` over an existing project
5. [`dual-track-contract.md`](./dual-track-contract.md) — CANON-16 dual-track rule: changes to self-config must ship with matching template change
6. [`evidence-bundle.md`](./evidence-bundle.md) — schema for `.arbiter/evidence/*` artifacts
7. [`skeleton-governance.md`](./skeleton-governance.md) — what the planning skeleton enforces

## Cross-cutting concepts

| Concept               | Source                                                     |
| --------------------- | ---------------------------------------------------------- |
| Invariants (INV-NN)   | `../../GLOBAL_INVARIANTS.md` + `../../AGENTS.md`           |
| Process rules (CANON) | `../SYSTEM/CANON.md`                                       |
| Decision log (ADR)    | `../ADR/`                                                  |
| Patterns catalog      | `../METHOD/PATTERNS_CATALOG.md` (planned; not yet present) |
| Test taxonomy         | `../TEST_TAXONOMY.md`                                      |
| CI tier model         | `../SYSTEM/CI-TIER-MODEL.md`                               |

## When to file an ADR

A change qualifies as architectural (and needs an ADR under `../ADR/`) when it:

- Adds, removes, or changes a public API surface
- Changes the dual-track contract (CANON-16)
- Changes a governance level threshold (L1/L2/L3)
- Touches the SSOT layering (CANONICAL_PATHS, SSOT_CORE_SET)
- Introduces a new external dependency or runtime requirement
- Reverses or supersedes a previous ADR
