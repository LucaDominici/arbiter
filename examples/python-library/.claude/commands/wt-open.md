# /wt-open <task-id> [slug]

Open a git worktree for parallel task development.

## Lifecycle

```
wt-open #NNN [slug]          → creates worktree, writes log entry
  work in worktree           → edit, commit, push
wt-close #NNN [--harvest]    → reads log to find worktree path, removes it
```

`wt-open` writes an entry to `.arbiter/worktree-open.log.json`. `wt-close` reads that log to locate the worktree — no manual path tracking needed.

## Steps

1. Parse `$ARGUMENTS` for task ID and optional slug.
   - Format: `#NNN` or `NNN` for task ID, followed by optional slug.
   - Example: `/wt-open #99 smoke-test` → task ID `#99`, slug `smoke-test`.
   - Multiple worktrees per task are allowed with different slugs.

2. Run the arbiter worktree open command:

   ```bash
   arbiter wt open <TASK_ID> [SLUG]
   ```

   Add `--base <branch>` if the user specified a base branch other than `main`.

3. Parse the output:
   - Worktree path: line starting with `Worktree ready:`.
   - Branch name: line starting with `Branch:`.
   - Base ref: line starting with `Base:`.
   - Link status: line starting with `Links:`.

4. Switch the session to the worktree:

   ```bash
   cd <worktree-path>
   ```

5. Print a summary with worktree path, branch, base ref, and link status.

## Error Handling

- **"Working tree has uncommitted changes"**: Ask the user to commit or stash changes before retrying.
- **"Worktree already exists"**: Run `arbiter wt list`, close the existing worktree with `/wt-close`, or use a different slug.
- **"Base branch does not exist"**: Ask the user to specify a valid base branch with `--base`.
- **"Must run from the main repository"**: `cd` back to the main repo first.
- **Links show `N missing`**: If `node_modules` is missing, run the package install command inside the worktree.

## Allowed Tools

- `Bash` for running `arbiter wt open` and `cd`.
- `Read` for reading AGENTS.md in the worktree if needed.

## Notes

- The worktree is created as a sibling of the main repo, not inside it.
- Config files like `.claude/settings.local.json` are symlinked from the main repo using absolute paths.
- The open log at `.arbiter/worktree-open.log.json` is appended on every open; `wt-close` uses it to locate the worktree.
