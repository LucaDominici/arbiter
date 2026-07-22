# /wt-list

List active git worktrees with branch names, paths, and status.

## What This Does

Show all active worktrees managed by the worktree system. Delegates to `git worktree list`.

**Example output:**
```
/home/user/repos/ts-library-fixture                                 a1b2c3d [main]
/home/user/repos/ts-library-fixture.worktrees/#123-feat       e4f5g6h [task/#123-feat]
/home/user/repos/ts-library-fixture.worktrees/#456-fix        i7j8k9l [task/#456-fix]
```

## Steps

1. Run `git worktree list` to show all worktrees.

2. For each worktree, check:
   - Current branch name
   - Whether branch has a remote tracking branch (`git branch -vv`)
   - Whether remote branch is `[gone]` (PR merged, remote deleted)
   - Whether worktree has uncommitted changes (`git status --porcelain` in that worktree)

3. Print a table: Path, Branch, Task ID, Status.

4. Flag any anomalies:
   - `[gone]` remote branch → suggest `/wt-close` to clean up
   - Uncommitted changes → warn about lost work risk
   - Detached HEAD → note if intentional
   - No upstream → never pushed; note if task is old

## Allowed Tools

- `Bash` for `git worktree list`, `git branch -vv`, `git status`

## Related Commands

- **Prune stale metadata:** `/wt-prune` (remove metadata for deleted worktrees)
- **Close finished worktree:** `/wt-close #NNN` (safe cleanup)
- **Open new worktree:** `/wt-open #NNN [slug]` (create isolated worktree)

## Troubleshooting

- **Stale worktree (dir deleted from disk):** use `/wt-prune` to clean metadata
- **Locked worktree:** `git worktree remove --force <path>`
- **`[gone]` branches in `git branch -vv`:** remote deleted post-merge; run `/wt-close #NNN`
