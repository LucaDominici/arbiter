---
title: '/wt-list'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# /wt-list

List active git worktrees with branch names, paths, and status.

## What This Does

Show all active worktrees managed by arbiter's worktree system. Delegates to `git worktree list` and cross-references against `.arbiter/worktree-open.log.json` for task ID mapping.

**Example output:**

```
/home/user/work/repos/arbiter                                 a1b2c3d [main]
/home/user/work/repos/arbiter.worktrees/#123-feat       e4f5g6h [task/#123-feat]
/home/user/work/repos/arbiter.worktrees/#456-fix        i7j8k9l [task/#456-fix]
```

## Steps

1. Run `git worktree list` to show all worktrees.

2. Match each worktree path against `.arbiter/worktree-open.log.json` to extract task IDs and open dates.

3. For each worktree, check:
   - Current branch name
   - Whether branch has a remote tracking branch (`git branch -vv`)
   - Whether remote branch is `[gone]` (PR merged, remote deleted)
   - Whether worktree has uncommitted changes (`git status --porcelain` in that worktree)

4. Print a table: Path, Branch, Task ID, Status.

5. Flag any anomalies:
   - `[gone]` remote branch → suggest `/wt-close` to clean up
   - Uncommitted changes → warn about lost work risk
   - Detached HEAD → note if intentional
   - No upstream → never pushed; note if task is old
   - Path in log but NOT in `git worktree list` → orphan; suggest `/wt-prune`

## Allowed Tools

- `Bash` for `git worktree list`, `git branch -vv`, `git status`
- `Read` for `.arbiter/worktree-open.log.json`

## Related Commands

- **Prune stale metadata:** `/wt-prune` (remove metadata for deleted worktrees)
- **Close finished worktree:** `/wt-close #NNN` (safe cleanup)
- **Open new worktree:** `/wt-open #NNN [slug]` (create isolated worktree)

## Troubleshooting

- **Stale worktree (dir deleted from disk):** use `/wt-prune` to clean metadata
- **Locked worktree:** `git worktree remove --force <path>`
- **`[gone]` branches in `git branch -vv`:** remote deleted post-merge; run `/wt-close #NNN`
- **No worktrees listed but expected one:** check `.arbiter/worktree-open.log.json` for log entries
