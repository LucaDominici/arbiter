---
description: Drain the open backlog at maximum throughput — batch issues into waves, one wave PR merged GREEN per cycle (skill: wave-drain)
argument-hint: '[--wave-size N] [--max-parallel N]'
title: '/drain'
doc_version: '2.0.0'
status: active
last_review: '2026-07-10'
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

| Flag               | Default | Meaning                                                                        |
| ------------------ | ------- | ------------------------------------------------------------------------------ |
| `--wave-size N`    | 10      | Max issues per wave                                                            |
| `--max-parallel N` | 6       | Max worktree agents; effective cap `min(--max-parallel, nproc - 2, wave size)` |

Parallel write-agents are legal ONLY under the ADR-103 rule-50 carve-out: dedicated
worktree, distinct branch, plan-manifest-disjoint file-sets; deps/main-tree/tags stay
serial. Convergence (owner-ratified 2026-07-10): governed repos → **one wave PR**; repos
without arbiter → N-PR + merge-train (skill appendix).

## The loop (per wave)

1. **Triage + compose** the wave (exclude `blocked` / `needs-human` / `epic`);
   `conflicts-with:#N` issues share a serial lane with #N.
2. **One cumulative plan** → `.claude/plans/wave-N.md` (group manifests with DISJOINT
   file-sets, anchors for CANON-16).
3. **One plan review** + tier-Standard red-team. CRITICAL → rework (max 2 cycles) → else GO.
   Every issue then passes the per-issue **3-hop plan gate** (skill §Phase 2.5, default-on;
   hop 2's skeptic count scales with the tier) before its agent writes code — the
   `needs-plan` label raises hop 2 to the Standard skeptic floor, it no longer switches the
   gate on.
4. **Parallel execution** — one agent per group in an isolated worktree (`/wt-open`), TDD per
   unit, light checks only; full gate forbidden in worktrees. Expensive gates that can race
   another agent on the same repo go through `arbiter gate-exec -- <cmd>` (flock(1) mutex,
   released even on SIGKILL/OOM; fail-closed serial where flock is missing). Caches are
   per-worktree (`symlink-children`). Anti-stall: gate-waits are ONE foreground wait;
   turn-stalls are bounded by the watchdog sweep over real `gh`/worktree state.
5. **Local integration** on `wave-N-integration` (off `main`): sequential merge,
   minimum-overlap order from the REAL `git diff --name-only` of the branches → multiagent
   review + adversarial verify (evidence, INV-114) → **full gate under the mutex**
   (`arbiter gate-exec -- sh -c 'npm run test && node scripts/check-all.mjs check'`) →
   `gate-pass.json`.
6. **One PR per wave**, `Closes #…`, merge only on GREEN CI.
7. `/wt-close` + `arbiter worktree prune --stale 24` (dry-run, then `--execute`) → `/clear`
   → next wave, until the backlog is empty.

## Hard stops (fail-closed)

Invariant violation (cite INV-ID), unauthorized SSOT/read-only edit, orphan TODO,
`any`/placeholder, or 2 failed plan-review cycles → blocker report + `needs-human` + proceed.
A stop removes one group/issue; it never halts the wave.

## Iron law

No group integrates without TDD + targeted tests green. Nothing reaches `main` without
red-team on the plan, multiagent review + adversarial verify, and a full gate GREEN on the
wave PR. The ceremony is per-wave, not per-issue.

> See the **`wave-drain`** skill for the full phase contract.
