---
title: 'Reference: Wave Drain (/drain)'
doc_version: '3.0.0'
status: active
last_review: '2026-09-19'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: ['088-ship-as-orchestration-entrypoint', '103-worktree-parallel-carveout']
---

# Reference: Wave Drain (/drain)

> **Skill:** `.claude/skills/wave-drain/SKILL.md`
> **Command:** `.claude/commands/drain.md`
> **Templates:** `src/templates/claude/skills/wave-drain/SKILL.md.ejs`, `src/templates/claude/commands/drain.md.ejs`

## Purpose

`/drain` selects ready, compatible backlog work and invokes the same result-first Ship contract as
a single issue. It is a selection layer, not a second delivery orchestrator. One capability train
has one plan, one frozen candidate, one independent final review, one acceptance decision per AC,
one exact-subject full gate, one PR, and one verified landing.

## Flow

1. List open issues; exclude `blocked`, `needs-human`, `needs-clarification`, and `epic`.
2. Require explicit acceptance criteria, non-goals, and affected files/contracts. Unknown readiness
   excludes the issue from this wave.
3. Compose a train only when every issue satisfies Ship affinity: same outcome, related ownership
   or dependencies, compatible ordering, shared proof/acceptance/rollback boundaries, and no hard
   conflict. Uncertainty seals the train.
4. Invoke `arbiter ship #A #B --tier <tier> --affinity '<json>'`, then follow
   `arbiter ship --advance`. The persisted treatment remains the only reviewer policy.
5. Optionally implement disjoint groups in isolated worktrees. One author owns each worktree;
   dependency edits, overlapping paths, main-tree edits, and tags remain serial.
6. Integrate serially. Ship freezes the candidate, runs the pertinent independent final review,
   records per-AC fit, qualifies the exact subject once, then owns PR, CI, merge, post-merge proof,
   issue closure, and cleanup.

Each joined issue keeps its own acceptance criteria, RED evidence, commit reference, and closing
reference. TDD and targeted checks apply in every implementation lane. A source change after review
invalidates review, acceptance, and gate evidence.

## Stop conditions

Exclude or stop the affected issue when an invariant fails, required evidence is missing, a material
product decision is unresolved, affinity seals, or no implementation approach makes progress.
Continue independent work. Preserve product failures, test failures, environment errors, tool
unavailability, timeouts, killed processes, and no-data outcomes as distinct results.

Completion means the PR is merged, post-merge CI is green, live proof has passed when applicable,
all carried issues are closed, and temporary worktrees are cleaned up.
