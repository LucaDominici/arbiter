---
title: 'Arbiter — Architecture Documentation (GOLD)'
doc_version: '1.0.0'
status: active
last_review: '2026-07-11'
owner: ''
canonical_id: 'ARCH-README'
tags: ['audience/dev', 'kind/spine', 'kind/architecture']
related:
  [
    'docs/architecture/arc42.md',
    'docs/architecture/c4-model.md',
    'docs/architecture/adr-index.md',
  ]
---

# Arbiter — Architecture Documentation

A GOLD, enterprise-grade architecture description of **arbiter** (the AI-governance installer +
optional orchestration layer). It exists so that understanding arbiter no longer requires
reverse-engineering the source: the dynamic agent-orchestration rules — the crown jewels — are
written down here with file:line provenance.

Populated from the **reality of the code**, not aspirations. Where arbiter is inconsistent, drifting,
or carries pruned scaffolding, the docs say so ([arc42 §11](arc42.md#11-risks--technical-debt)).

## The map

| Document | What it gives you | Read it when |
|----------|-------------------|--------------|
| **[arc42.md](arc42.md)** | The full architecture in the 12 arc42 sections. **§6 Runtime View is the centre of gravity** — the dynamic rules for when/how arbiter challenges, reviews, verifies, and clusters. | You want the complete picture, or the honest tech-debt truth (§11). |
| **[c4-model.md](c4-model.md)** | The three C4 diagrams (Mermaid): **Context** (arbiter vs developer / AI agent / repo / GitHub / CI), **Container** (the internal subsystems), **Component** (inside the orchestration engine — the dynamic dispatch/verify rules). | You want the visual system map, or to see the orchestration internals. |
| **[adr-index.md](adr-index.md)** | All 106 ADRs catalogued one line each, grouped by theme, **plus a gap register** of load-bearing decisions that have no ADR (e.g. the missing ADR-103, the "no new TS engine" B-prune). | You want to find or audit a decision. |

## Where the jewels are (start here)

The value that a simplified re-telling of arbiter does **not** capture — the sophisticated *dynamic
rules* for launching challenge/verify agents and orchestrating work:

- **The `/ship` next-action loop** — a deterministic engine that computes the next step and advances
  only on a green gate, driving a model-side loop that does the reasoning
  (`src/commands/task-ship.ts`). → [arc42 §6.1](arc42.md#61-the-ship-loop--a-deterministic-next-action-computer-driving-a-model-loop)
- **Tier-driven, size-computed dispatch** — four count-axes (red-team 1/2/3, review 3/3/4, reviewers
  3/3/5, verticals 3/4/7), auto-computed from issue *size*, never from model identity
  (`task-ship.ts:77-100`). → [arc42 §6.2](arc42.md#62-the-dynamic-dispatch-rules-the-crown-jewels)
- **Weighted auditor routing** — 7 weighted auditors, an `always_on` floor, a glob `tag_map`, and a
  verdict `score = Σw(pass)/Σw(all)` where unresolved red-team findings mathematically cap the score
  (`.claude/auditor-routing.json`, `.claude/agent-dispatch-matrix.json`).
- **Fail-closed completion** — the INV-114 Stop gate requires three correlated evidence artifacts;
  claim-verified plan-digest and TDD-evidence sub-gates (`stop-evidence-guard.mjs`, `task.ts`). →
  [arc42 §6.3](arc42.md#63-completion-is-fail-closed-on-correlated-evidence-inv-114)
- **Wave drain** — multi-issue batch orchestration with worktree isolation, a `flock`-based gate
  mutex, and disjoint file-set manifests (`wave-drain` skill, `gate-exec.ts`). →
  [arc42 §6.5](arc42.md#65-wave-drain--multi-issue-batch-orchestration-drain)

## Relationship to existing docs

This set **complements** — it does not replace — the pre-existing internal references:

- [`docs/internal/architecture/ARCHITECTURE.md`](../internal/architecture/ARCHITECTURE.md) — the
  consolidated canonical-source / template-pipeline / dual-track / evidence-schema reference.
- [`docs/internal/SYSTEM/CANON.md`](../internal/SYSTEM/CANON.md) — the CANON-NN process rules.
- [`docs/internal/SYSTEM/CI-TIER-MODEL.md`](../internal/SYSTEM/CI-TIER-MODEL.md) — the cadence × governance CI model.
- [`docs/internal/SYSTEM/HOOK-CONTRACTS.md`](../internal/SYSTEM/HOOK-CONTRACTS.md) — the hook concurrency contracts.
- [`docs/internal/ADR/`](../internal/ADR/) — the canonical per-ADR files.

## Maintenance

These are **hand-authored** GOLD docs (no generator emits them). Keep them honest: when a subsystem
changes materially, update the matching arc42 section and, if the change is a structural decision,
add an ADR and update [adr-index.md](adr-index.md). The Mermaid diagrams are plain text — edit them
in place. If §11 (Risks & Technical Debt) items get fixed, move them out; don't let the honest
section rot into a stale one.
