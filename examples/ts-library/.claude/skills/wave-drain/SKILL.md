---
name: wave-drain
description: Select ready compatible backlog work and deliver each capability train through the same result-first Ship contract.
argument-hint: '[--wave-size N] [--max-parallel N]'
title: 'Wave Drain'
doc_version: '3.0.0'
status: active
last_review: '2026-09-19'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal', 'kind/orchestration']
related: ['epic-decompose', 'understand-code', 'tdd', 'verification', 'ssot-navigation']
---

# Wave Drain

Drain chooses work; Ship delivers it. Do not create a second lifecycle, reviewer policy,
evidence store, worktree manager, or landing path here.

## 1. Select ready work

List open issues and exclude `blocked`, `needs-human`, `needs-clarification`, and `epic`.
Before selection, require explicit `AC-N` acceptance criteria, non-goals, and affected
files/contracts. Run `scripts/issue-readiness.mjs` when present. Missing evidence or an unavailable
issue source is unknown, so exclude the issue from this wave and record why.

## 2. Compose a capability train

Select at most the configured `ship.train.maxChain` or `--wave-size`, whichever is smaller.
Every joined issue must satisfy the Ship affinity proof:

- same user-visible outcome;
- related owner paths or dependencies;
- compatible ordering;
- shared proof, acceptance boundary, and rollback boundary;
- no hard conflict.

Uncertain affinity seals the train. Conflicting work lands separately. Each joined issue keeps
namespaced acceptance criteria, RED evidence, a commit reference, and a closing reference.

Record one cumulative plan with the complete file manifest, dependency proof, acceptance criteria,
non-goals, rollback, and issue-to-proof mapping. Mechanical admission checks validate the plan and
finish before implementation.

## 3. Invoke the shared Ship contract

Start the train through the same runtime entrypoint as a single issue:

```bash
arbiter ship #A #B --tier <XS|S|Standard> --affinity '<json>'
```

Follow the emitted next action and advance only through:

```bash
arbiter ship --advance
```

Ship owns persisted treatment, TDD transitions, review policy, exact-subject evidence, recovery,
PR, CI, merge, post-merge proof, issue closure, and cleanup. Never recompute its tier or reviewer
panel from this skill.

## 4. Optional parallel implementation

Parallel writers are allowed only when every lane has a dedicated worktree and branch and the plan
proves disjoint file sets. Dependency files, main-tree changes, tags, and overlapping paths remain
serial. One author owns each worktree. Each lane runs TDD and targeted checks; the integrated frozen
candidate receives the single final qualification owned by Ship.

**M16 handoff-contract: subagents never own waits** — a worker returns its commit, tests, residual
risks, and structured evidence. The orchestrator owns integration and external waits.

Integrate lanes serially in dependency order. A conflict, missing commit, failed targeted test, or
scope breach is a failure, not permission to skip proof.

## 5. Qualify and land

On the frozen integrated SHA, Ship runs one independent final review with the persisted treatment's
pertinent verticals. That same panel supplies an acceptance decision for every AC. Applicable
MED/HIGH/CRITICAL findings block; reconcile one fix batch and invalidate stale review, acceptance,
and gate evidence when source changes.

After review and all-PASS acceptance fit, run the full gate once for the exact candidate. Reuse the
unchanged receipt through PR and CI. Completion requires the PR merged, green post-merge CI, live
proof when applicable, every carried issue closed, and worktree cleanup.

## Hard stops

Stop or exclude only the affected work when an invariant fails, required evidence is missing, a
material product decision is unresolved, affinity seals, or an implementation approach makes no
progress. Continue independent work. Preserve product failures, test failures, environment errors,
tool unavailability, timeouts, killed processes, and no-data outcomes as distinct results.

Do not add parallel qualification pipelines, forced context clearing, or mandatory handoff steps.
Do not claim completion while any PR is open or CI is red.
