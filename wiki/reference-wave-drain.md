---
generated: true
source: 'docs/REFERENCE/wave-drain.md'
source_sha: 'c069394e175729e706811286085cd30e18dd0632'
last_updated: '2026-07-02'
---

# Reference: Wave Drain (/drain)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/wave-drain.md](../docs/REFERENCE/wave-drain.md)

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
   `epic`. Partition into groups of ≤5 issues by module/dependency; independent groups are
   parallelizable.
2. **One cumulative plan** → `.claude/plans/wave-N.md`, a manifest per group (files,
   invariants, TDD units, conflict risks). Each agent anchors its `arbiter task` to its
   group's section (CANON-16, `pre-edit-plan-anchor`).
3. **One plan review** — `arbiter review plan` on the cumulative plan + a tier-Standard
   red-team. CRITICAL → rework (max 2 cycles) → else GO for the whole wave.
4. **Parallel execution** — one agent per group in an isolated worktree (`/wt-open`), 4–6
   in parallel. Worktrees run **light checks only** (targeted `vitest` + lint); the full
   gate is forbidden in worktrees.
5. **Local integration** — `wave-N-integration` off `main`: sequential merge by
   conflict-risk → multiagent review + adversarial verify (evidence file, INV-114) → full
   gate (`npm run test && node scripts/check-all.mjs check`) → `gate-pass.json`.
6. **One PR per wave** — `Closes #N1, #N2, …`; merge only on GREEN CI.
7. `/wt-close` (harvest) + `/wt-prune` → next wave, until the backlog is empty.

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
