# /wt-close <task-id>

Close a git worktree and optionally harvest files back to the main repo.

## Lifecycle

```
wt-open #NNN [slug]          → creates worktree, writes log entry
  work in worktree           → edit, commit, push
wt-close #NNN [--harvest]    → reads log to find worktree path, removes it
```

`wt-close` locates the worktree by reading `.arbiter/worktree-open.log.json` (written by `wt-open`). When multiple worktrees exist for the same task (different slugs), it picks the first one whose path still exists on disk.

## Steps

1. Parse `$ARGUMENTS` for task ID and flags
   - Task ID format: `#NNN` or `NNN`
   - Flags: `--harvest` (copy modified files back), `--harvest-all` (same + skip merge check)

2. If `--harvest` or `--harvest-all` is specified:

   ```bash
   arbiter wt close <TASK_ID> --harvest-all
   ```

   Always use `--harvest-all` (not `--harvest`) in non-interactive mode — it auto-confirms all files without prompting. `--harvest` (without `--all`) is the interactive variant for human use at the terminal.

   Otherwise:

   ```bash
   arbiter wt close <TASK_ID>
   ```

   Additional flags the user may specify:
   - `--force` — close even if branch is unmerged or hook fails (uncommitted work in the worktree will be lost)
   - `--keep-branch` — do not delete the task branch after closing
   - `--no-fetch` — skip `git fetch origin` before merge check

3. The command runs from the main repo (already required — no `cd` needed after close). Parse output:
   - Closed path is on the line starting with `Worktree closed:`
   - Branch deletion is confirmed on the line `Branch <name> deleted.`

4. Print a summary:
   - If harvest was used: list of harvested files (copied) and skipped files (conflicts)
   - Worktree closed path
   - Branch deletion status

## Error Handling

- **"No open worktree found for task"**: The task has no open worktree. Run `arbiter wt list` to see existing worktrees.
- **"Worktree has uncommitted changes"**: Either commit/stash changes in the worktree, or use `--force` to close anyway (changes lost), or use `--harvest-all` to copy changes back first.
- **"Branch has not been merged"**: The branch hasn't been merged into the base branch. Use `--harvest-all` to copy files back, or `/task` to merge the branch first, or `--force` to close anyway (uncommitted work will be lost).
- **"Close hook failed"**: The `closeHook` configured in `arbiter.json` exited non-zero. Fix the hook or use `--force` to bypass.
- **"Must run from the main repository"**: `cd` back to the main repo first.

## Allowed Tools

- `Bash` for running `arbiter wt close`

## Notes

- `--harvest-all` implies skipping the merge check — useful when closing an unmerged branch whose changes you want to preserve in the main repo
- **Harvest copies only additions and modifications** — files deleted in the worktree are NOT deleted in the main repo. Deletions must be applied manually.
- Harvested files that conflict with uncommitted changes in the main repo are skipped (not overwritten)
- If multiple worktrees are open for the same task (different slugs), `wt-close` picks the first one whose path still exists. To close a specific slug, use `--force` after closing others, or manage them with `arbiter wt list`.
- If `closeHook` is configured in `arbiter.json`, it runs before the worktree is removed. Use `--force` to bypass a failing hook.
- The worktree is removed after closing; only the branch may be preserved with `--keep-branch`
