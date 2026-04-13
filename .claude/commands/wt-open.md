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

3. Parse the output for the worktree path (line starting with `Worktree ready:`)

4. Switch the session to the worktree:

   ```bash
   cd <worktree-path>
   ```

5. Print a summary:
   - Worktree path
   - Branch name
   - Base branch and ref
   - Link status (how many files symlinked/copied/missing)

## Allowed Tools

- `Bash` for running `arbiter wt open` and `cd`
- `Read` for reading AGENTS.md in the worktree if needed

## Notes

- The worktree is created as a **sibling** of the main repo (not inside it)
- Config files like `.env` and `.claude/settings.local.json` are symlinked from the main repo
- `node_modules` is symlinked as a directory (no separate `npm ci` needed)
- If the worktree already exists, the command will fail with an idempotency error
