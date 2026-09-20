---
title: 'Batch Execution Contract'
doc_version: '1.0.0'
status: active
last_review: '2026-09-20'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# Batch Execution Contract

Parallelize discovery only when agents are read-only, have no shared output, and
have no dependency on one another.

## Prohibited in Parallel Agents

Never parallelize agents that edit or write files, Commit to git, install or
modify dependencies (`package.json` / lockfiles), Create branches or tags, or
delete files or directories.

## Carve-out: Worktree-Isolated Parallel Execution (ADR-103)

The prohibitions above apply to agents sharing one working tree. A parallel agent
may edit only with ALL of the following: a dedicated `git worktree add` worktree,
a distinct branch, and disjoint file-sets declared in the plan manifest.
Dependencies, the main working tree, and tags remain serial-only.

Lock order under the carve-out is `gate-lock ≺ worktree-lock ≺ wave-claim`.

If agents collide, stop them, inspect `git status`, and continue serially from
the last consistent tree.
