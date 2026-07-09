# /wt-close <task-id>

Close a git worktree and optionally harvest files back to the main repo.

## Lifecycle

```
wt-open #NNN [slug]          → creates worktree, writes log entry
  work in worktree           → edit, commit, push
wt-close #NNN [--harvest]    → reads log to find worktree path, removes it
```

`wt-close` locates the worktree by reading `.arbiter/worktree-open.log.json` written by `wt-open`. When multiple worktrees exist for the same task with different slugs, it picks the first one whose path still exists on disk.

## Steps

1. Parse `$ARGUMENTS` for task ID and flags.
   - Task ID format: `#NNN` or `NNN`.
   - Flags: `--harvest`, `--harvest-all`, `--force`, `--keep-branch`, `--no-fetch`.

2. If `--harvest` or `--harvest-all` is specified, run:

   ```bash
   arbiter wt close <TASK_ID> --harvest-all
   ```

   Always use `--harvest-all` in non-interactive mode because it auto-confirms all files. `--harvest` is the interactive variant for human terminal use.

3. Otherwise, run:

   ```bash
   arbiter wt close <TASK_ID>
   ```

4. Parse output:
   - Closed path: line starting with `Worktree closed:`.
   - Branch deletion: line starting with `Branch <name> deleted.`.

5. Print a summary with harvested files, skipped files, closed path, and branch deletion status when present.

## Error Handling

- **"No open worktree found for task"**: Run `arbiter wt list` to see existing worktrees.
- **"Worktree has uncommitted changes"**: Commit or stash changes, use `--harvest-all`, or use `--force` only when losing changes is acceptable.
- **"Branch has not been merged"**: Merge the PR first, use `--harvest-all` to copy files back, or use `--force` only when safe.
- **"Close hook failed"**: Fix the hook or use `--force`; forced failures still emit a warning.
- **"Must run from the main repository"**: `cd` back to the main repo first.

## Allowed Tools

- `Bash` for running `arbiter wt close`.

## Notes

- `--harvest-all` skips the merge check and copies additions/modifications back to the main repo.
- Harvested files that conflict with uncommitted changes in the main repo are skipped, not overwritten.
- If multiple worktrees are open for the same task, `wt-close` picks the first live log entry.
- The worktree directory is removed after close; only the branch may be preserved with `--keep-branch`.
