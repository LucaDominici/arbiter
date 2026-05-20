---
title: 'Batch Execution Contract'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
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
