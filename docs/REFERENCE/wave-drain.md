---
title: 'Reference: Wave Drain (/drain)'
doc_version: '2.0.0'
status: active
last_review: '2026-07-10'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: ['088-ship-as-orchestration-entrypoint', '103-worktree-parallel-carveout']
---

# Reference: Wave Drain (/drain)

> **Target:** consumer repos (and arbiter-self, dogfooded)
> **Skill:** `.claude/skills/wave-drain/SKILL.md`
> **Command:** `.claude/commands/drain.md`
> **Templates:** `src/templates/claude/skills/wave-drain/SKILL.md.ejs`, `src/templates/claude/commands/drain.md.ejs`
> **Wiring:** `src/generators/skills.ts` (`SKILL_NAMES`), `src/generators/claude.ts` (commands), `src/compatibility/skills-validator.ts`

## Purpose

`/ship` drives **one issue → one PR**. **Wave Drain** is its multi-issue sibling: it
drains the open backlog at maximum throughput by composing **waves** of up to ~10 issues
and driving each wave to a **single PR merged GREEN**. It reuses the same per-issue phase
contract `/ship` runs — the heavy ceremony (one plan, one plan review, one code review, one
full gate, one PR) runs **once per wave**, not per issue. Tokens are saved by batching the
ceremony, never by skipping it.

The orchestrator **directs parallel agents** in isolated worktrees; it does not implement.
Issues that cannot proceed become `needs-human` with a blocker report and never block the
rest of the wave.

## The loop (per wave)

1. **Triage + compose** — `gh issue list --state open`; exclude `blocked` / `needs-human` /
   `epic` / `needs-clarification`. **Readiness gate (INV-138):** each issue selected into
   the wave passes `node scripts/issue-readiness.mjs` — explicit `AC-N:` acceptance
   criteria, non-goals, files/contracts touched — or it is labeled `needs-clarification`
   (with a generated checklist comment) and excluded. Partition into groups of ≤5 issues
   by module/dependency; independent groups are parallelizable.
2. **One cumulative plan** → `.claude/plans/wave-N.md`, a manifest per group (files,
   invariants, the issues' `AC-N` criteria frozen verbatim + non-goals — the INV-138
   anchor tests and review cite, TDD units, conflict risks). Each agent anchors its
   `arbiter task` to its group's section (CANON-16, `pre-edit-plan-anchor`).
3. **One plan review** — plan review on the cumulative plan + a tier-Standard
   red-team. CRITICAL → rework (max 2 cycles) → else GO for the whole wave.
4. **Parallel execution** — one agent per group in an isolated worktree (`/wt-open`),
   capped at `min(--max-parallel, nproc - 2, wave size)`. Worktrees run **light checks
   only** (targeted `vitest` + lint); the full gate is forbidden in worktrees. Expensive
   gates that can race another agent on the same repo go through
   `arbiter gate-exec -- <cmd>` (flock(1) mutex — kernel wait, released when the gate-exec
   supervisor is SIGKILL/OOM-killed; killing the Arbiter Node PID alone leaves that
   supervisor holding; fail-closed serial where flock is missing). Caches are per-worktree
   (`symlink-children`). Anti-stall: gate-waits are ONE foreground wait; turn-stalls are
   only bounded by the watchdog sweep over real `gh`/worktree state.
5. **Local integration** — `wave-N-integration` off `main`: sequential merge in
   minimum-overlap order from the REAL `git diff --name-only` of the branches →
   multiagent review + adversarial verify (evidence file, INV-114) → full gate under the
   mutex (`arbiter gate-exec -- sh -c 'npm run test && node scripts/check-all.mjs check'`)
   → `gate-pass.json`.
6. **One PR per wave** — `Closes #N1, #N2, …`; merge only on GREEN CI.
7. `/wt-close` (harvest) + `arbiter worktree prune --stale 24` (dry-run, then
   `--execute`) → next wave, until the backlog is empty.

## v2 additions (#1873, ADR-103)

- **Legality:** the ADR-103 rule-50 carve-out is what makes parallel write-agents legal —
  dedicated worktree, distinct branch, plan-manifest-disjoint file-sets; dependency
  changes, main-tree edits and tags stay serial.
- **Convergence (owner-ratified 2026-07-10):** governed repos converge on **one wave PR**;
  repos without arbiter use the skill's cross-repo appendix (N-PR + auto-merge armed +
  merge-train ≥3 as the integration net, with explicit caveats).
- **Declared conflicts:** `conflicts-with:#N` issues share a serial lane with #N.
- **Optional 3-hop plan gate:** issues labelled `needs-plan` carry a 3-comment plan trail
  (draft → red-team with `file:line` evidence → final) verified deterministically via
  `gh` before their agent writes code; cost (3 agent-runs/issue) is explicit.
- **Primitives:** see [wave-primitives](wave-primitives.md) for `arbiter gate-exec`, the
  `symlink-children` strategy, `arbiter worktree prune --stale`, and the liveness-first
  `isLockStale` fix.

## Iron law

No group enters integration without TDD + targeted tests green. Nothing reaches `main`
without red-team on the plan, multiagent review + adversarial verify, and a full gate GREEN
on the wave PR. The ceremony is **per-wave, not per-issue**.

## Stop conditions (fail-closed)

Invariant violation (cite INV-ID), unauthorized SSOT/read-only edit, orphan TODO,
`any`/placeholder, or two failed plan-review cycles → blocker report + `needs-human` +
proceed. A stop removes one group/issue; it never halts the wave.

## Relationship to /ship

Wave Drain is **scope-limited to wave execution** (open issues → wave → merge). Upstream
work — epic decomposition, design — stays in the `epic-decompose` and `brainstorming`
skills. For a single issue, use `/ship`; for draining a backlog, use `/drain`.
