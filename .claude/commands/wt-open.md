# /wt-open <task-id> [slug]

Open a git worktree for parallel task development.

## Steps

1. Parse `$ARGUMENTS` for task ID and optional slug
   - Format: `#NNN` or `NNN` for task ID, followed by optional slug
   - Example: `/wt-open #99 smoke-test` → task ID `#99`, slug `smoke-test`

2. Run the arbiter worktree open command:

   ```bash
   arbiter wt open <TASK_ID> [SLUG]
   ```

   - Add `--base <branch>` if the user specified a base branch other than `main`

3. Parse the output:
   - The worktree path is on the line starting with `Worktree ready:`
   - The branch name is on the line starting with `Branch:`
   - The base ref is on the line starting with `Base:`
   - Link status is on the line starting with `Links:`

4. Switch the session to the worktree:

   ```bash
   cd <worktree-path>
   ```

5. Print a summary:
   - Worktree path
   - Branch name
   - Base branch and ref
   - Link status (how many files symlinked/copied/missing)

## Error Handling

- **"Working tree has uncommitted changes"**: Ask the user to commit or stash changes before retrying.
- **"Worktree already exists"**: The task already has an open worktree. Run `arbiter wt list` to see existing worktrees, or suggest closing it first with `/wt-close`.
- **"Base branch does not exist"**: Ask the user to specify a valid base branch with `--base`.
- **"Must run from the main repository"**: The command must be run from the main repo, not from within an existing worktree. `cd` back to the main repo first.

## Allowed Tools

- `Bash` for running `arbiter wt open` and `cd`
- `Read` for reading AGENTS.md in the worktree if needed

## Notes

- The worktree is created as a **sibling** of the main repo (in `<repo>.worktrees/`), not inside it
- Config files like `.claude/settings.local.json` are symlinked from the main repo
- `node_modules` is symlinked as a directory (no separate `npm ci` needed)
- If the worktree already exists, the command will fail with an idempotency error
