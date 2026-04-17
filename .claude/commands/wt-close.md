# /wt-close <task-id>

Close a git worktree and optionally harvest files back to the main repo.

## Steps

1. Parse `$ARGUMENTS` for task ID and flags
   - Task ID format: `#NNN` or `NNN`
   - Flags: `--harvest` (copy modified files back), `--harvest-all` (harvest all + skip merge check)

2. If `--harvest` or `--harvest-all` is specified:

   ```bash
   arbiter wt close <TASK_ID> --harvest-all
   ```

   Use `--harvest-all` (not just `--harvest`) since non-interactive mode should auto-confirm all files.

   Otherwise:

   ```bash
   arbiter wt close <TASK_ID>
   ```

   Additional flags the user may specify:
   - `--force` — close even if branch is unmerged or hook fails
   - `--keep-branch` — do not delete the task branch
   - `--no-fetch` — skip `git fetch origin` before merge check

3. After the command succeeds, switch back to the main repo:

   ```bash
   cd $(git rev-parse --show-toplevel)
   ```

   Or use the path from the worktree open log at `.arbiter/worktree-open.log.json`.

4. Print a summary:
   - If harvest was used: list of harvested files (copied) and skipped files (conflicts)
   - Worktree closed path
   - Branch deletion status

## Error Handling

- **"No open worktree found for task"**: The task has no open worktree. Run `arbiter wt list` to see existing worktrees.
- **"Worktree has uncommitted changes"**: Either commit/stash changes in the worktree, or use `--force` to close anyway, or use `--harvest-all` to copy changes back first.
- **"Branch has not been merged"**: The branch hasn't been merged into the base branch. Use `--harvest-all` to copy files back, or `/task` to merge the branch first, or `--force` to close anyway (uncommitted work will be lost).
- **"Must run from the main repository"**: `cd` back to the main repo first.

## Allowed Tools

- `Bash` for running `arbiter wt close` and `cd`

## Notes

- `--harvest-all` implies skipping the merge check, which is useful when closing an unmerged branch whose changes you want to preserve in the main repo
- Harvested files that conflict with uncommitted changes in the main repo are skipped (not overwritten)
- The worktree is removed after closing; only the branch may be preserved with `--keep-branch`
