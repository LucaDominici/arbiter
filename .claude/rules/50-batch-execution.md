---
title: 'Batch Execution Contract'
doc_version: '1.1.0'
status: active
last_review: '2026-07-10'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# Batch Execution Contract

## Principle

Parallel agents are powerful but dangerous when they edit shared state concurrently. This rule defines when parallelism is safe.

## Allowed: Read-Only Parallel Agents

Spawn multiple agents concurrently only when ALL of the following are true:

- **Read-only**: agents only read files, grep, search, or list — no writes
- **File-discovery**: agents locate paths, gather facts, or summarize content
- **No shared output**: agents do not write to the same file or directory
- **No dependencies**: agents do not depend on each other's results to proceed

Examples of safe parallel work:

- Search for all usages of a symbol across the codebase
- Read multiple independent files to gather facts
- Run read-only analysis scripts on separate subsystems

## Prohibited in Parallel Agents

Never spawn parallel agents that:

- **Edit or write files** — concurrent edits cause conflicts and lost work
- **Commit to git** — commit ordering is non-deterministic; history corrupts
- **Install or modify dependencies** — package-lock divergence is unrecoverable
- **Create branches or tags** — race conditions in git ref creation
- **Delete files or directories** — no recovery from concurrent deletes

## Carve-out: Worktree-Isolated Parallel Execution (ADR-103)

The prohibitions above target parallel agents sharing ONE working tree. A parallel
agent is exempt from the edit/commit/branch prohibitions only when ALL of the following
conditions hold — each is necessary, and any miss voids the exemption:

1. **Dedicated worktree** — the agent operates in its own git worktree opened via
   `arbiter worktree open` (or `/wt-open`). Branch creation is serialized by the
   worktree open lock, so there is no race on git ref creation.
2. **Distinct branch per agent** — no two parallel agents ever share a branch.
3. **Disjoint file-sets** — the file-sets the agents will touch are declared disjoint
   in a plan manifest (wave-drain Phase 1) before dispatch.

Still prohibited even under the carve-out:

- **Installing or modifying dependencies** (`package.json` / lockfiles) — a solo,
  serial lane only; lockfile divergence across worktrees is unrecoverable.
- **Editing the main working tree** — workers write only inside their own worktree.
- **Creating tags** — tags are repo-global refs; no worktree isolation applies.

Lock discipline under the carve-out (anti-deadlock, ADR-103): a process never holds
two arbiter locks at once. `arbiter gate-exec` is a **leaf** operation — it acquires
only the gate flock and is never invoked while `.arbiter/.lock` is held. Total
acquisition order: gate-lock ≺ worktree-lock ≺ wave-claim.

## Anti-Rot Checklist

Before spawning parallel agents, verify:

- [ ] Each agent's task is read-only or produces output to a distinct, non-overlapping path
- [ ] No agent modifies shared state (git index, lockfiles, shared dirs)
- [ ] Results are aggregated by the orchestrator AFTER all agents complete
- [ ] If any agent needs to write, serialize it — run agents sequentially instead

## Recovery

If parallel agents collide (conflicting edits, broken lockfile, corrupted state):

1. Abort all in-flight agent operations
2. Run `git status` to assess damage
3. Restore from last clean commit (`git stash` or `git restore`)
4. Re-run the work sequentially
