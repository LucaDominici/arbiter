---
name: clean-code
description: Gate-map for code quality — which gate mechanically enforces each limit (jscpd/knip/madge/complexity/ratchet). Use when reviewing code quality or before adding code that might duplicate or over-complicate.
title: "Clean Code"
doc_version: "1.0.0"
status: active
last_review: "2026-05-20"
owner: ""
canonical_id: ""
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# Clean Code

This skill is a **gate-map, not a lecture.** Every limit below is mechanically enforced — the gate is the source of truth. When in doubt, run the gate; don't argue the principle.

## Limits → enforcing gate

| Concern | Limit | Enforced by |
| --- | --- | --- |
| **DRY / duplication** | clones below threshold; no copy-paste | `jscpd` (CANON-22) + debt ratchet — no net increase (Lehman entropy) |
| **Complexity (KISS)** | cyclomatic ≤ 10 per function | `eslint` complexity rule + debt ratchet |
| **No dead code (YAGNI)** | no unused files/exports | `knip` |
| **No cycles** | no circular imports | `madge --circular` |
| **No bloat** | file / LOC ceilings | bloat ratchet + debt ratchet |

## When a gate fires

Fix the **root cause** — extract the shared helper, simplify the function, delete the dead branch — or run `arbiter task record-tech-debt` with a rationale. A symptom patch over a flagged smell is a stop condition (see `90-exec-protocol.md` → Root-Cause Discipline). Juergens'09: an *inconsistent* clone (duplicated, then edited in one copy only) is a latent bug — dedup before it diverges.

## Naming & extraction (review heuristic — not gated)

- Names reveal intent: verb+noun functions (`getUserById`); `is`/`has`/`can` booleans; no cryptic abbreviations.
- Repeated block → **extract function**. Long `if/else` on a type → polymorphism. One-liner wrapper that adds no clarity → **inline**. Complex expression → **extract variable**.
- **TypeScript:** no `any` (use `unknown` and narrow — enforced by the `check-no-any` hook, INV-04); `const` over `let`; discriminated unions over nullable fields.
