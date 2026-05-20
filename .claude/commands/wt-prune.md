---
title: '/wt-prune'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# /wt-prune

Prune stale git worktree metadata for worktrees whose directories no longer exist on disk.

## What This Does

Clean up worktree metadata from `.git/worktrees/` and `.arbiter/worktree-open.log.json` when a worktree directory has been manually deleted. This keeps the worktree system consistent.

**Important scope distinction:**

- `/wt-prune` (this command) → only removes metadata for **missing directories** on disk
- Does NOT remove worktrees whose directory still exists, even if the branch is merged
- Worktrees done but still on disk → use `/wt-close #NNN`

**When to use:**

- After manually deleting a worktree directory
- When `git worktree list` shows worktrees with paths that no longer exist
- Regular cleanup to keep worktree metadata in sync

## Steps

1. Run `git worktree prune` to clean `.git/worktrees/` metadata for deleted directories.

2. Read `.arbiter/worktree-open.log.json` and remove entries whose worktree paths no longer exist on disk.

3. Print a summary of what was pruned (or confirm nothing to clean).

## Allowed Tools

- `Bash` for `git worktree prune`, `git fetch --prune`
- `Read`/`Write` for `.arbiter/worktree-open.log.json`

## Related Commands

- **List all worktrees with status:** `/wt-list` (show path, branch, remote status)
- **Close finished worktree safely:** `/wt-close #NNN` (remove directory + metadata)

## Troubleshooting

- **"No stale worktrees to prune"** → nothing to clean, good state
- **Worktree still shows after prune** → directory still on disk; use `/wt-close #NNN`
- **Cannot prune locked worktree** → unlock first with `git worktree unlock <path>`
- **See `[gone]` branches in `git branch -vv`** → remote deleted after merge; use `/wt-close #NNN`
