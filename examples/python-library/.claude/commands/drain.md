---
description: Drain the open backlog at maximum throughput — batch issues into waves, one wave PR merged GREEN per cycle (skill: wave-drain)
argument-hint: '[--wave-size N] [--max-parallel N]'
title: '/drain'
doc_version: '1.0.0'
status: active
last_review: '2026-06-13'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal', 'kind/orchestration']
related: ['ship', 'wt-open']
---

# /drain

`/drain` is the **wave orchestration entrypoint**. It drains the open backlog by composing
**waves** of up to ~10 issues and driving each wave to a **single PR merged GREEN**, reusing
the per-issue contract that `/ship` runs for one issue.

It loads and executes the **`wave-drain`** skill. You are the orchestrator: you direct
parallel agents, you do not implement.

## Defaults

| Flag               | Default | Meaning                                                        |
| ------------------ | ------- | -------------------------------------------------------------- |
| `--wave-size N`    | 10      | Max issues per wave                                            |
| `--max-parallel N` | 6       | Max worktree agents running concurrently (groups of ≤5 issues) |

## The loop (per wave)

1. **Triage + compose** the wave (exclude `blocked` / `needs-human` / `epic`).
2. **One cumulative plan** → `.claude/plans/wave-N.md` (group manifests, anchors for CANON-16).
3. **One plan review** + tier-Standard red-team. CRITICAL → rework (max 2 cycles) → else GO.
4. **Parallel execution** — one agent per group in an isolated worktree (`/wt-open`), TDD per
   unit, light checks only; full gate forbidden in worktrees.
5. **Local integration** on `wave-N-integration` (off `main`): sequential merge by
   conflict-risk → multiagent review + adversarial verify (evidence, INV-114) → **full gate**
   (`npm run test && node scripts/check-all.mjs check`) → `gate-pass.json`.
6. **One PR per wave**, `Closes #…`, merge only on GREEN CI.
7. `/wt-close` + `/wt-prune` → `/clear` → next wave, until the backlog is empty.

## Hard stops (fail-closed)

Invariant violation (cite INV-ID), unauthorized SSOT/read-only edit, orphan TODO,
`any`/placeholder, or 2 failed plan-review cycles → blocker report + `needs-human` + proceed.
A stop removes one group/issue; it never halts the wave.

## Iron law

No group integrates without TDD + targeted tests green. Nothing reaches `main` without
red-team on the plan, multiagent review + adversarial verify, and a full gate GREEN on the
wave PR. The ceremony is per-wave, not per-issue.

> See the **`wave-drain`** skill for the full phase contract.
