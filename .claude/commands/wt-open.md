---
title: '/wt-open <task-id> [slug]'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

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

1. Parse `$ARGUMENTS` for task ID and optional slug
   - Format: `#NNN` or `NNN` for task ID, followed by optional slug
   - Example: `/wt-open #99 smoke-test` → task ID `#99`, slug `smoke-test`
   - Multiple worktrees per task are allowed with different slugs: `/wt-open #99 feat-a` and `/wt-open #99 feat-b` can coexist

2. Run the arbiter worktree open command:

   ```bash
   arbiter wt open <TASK_ID> [SLUG]
   ```

   - Add `--base <branch>` if the user specified a base branch other than `main`

3. Parse the output:
   - The worktree path is on the line starting with `Worktree ready:`
   - The branch name is on the line starting with `Branch:`
   - The base ref is on the line starting with `Base:`
   - Link status is on the line starting with `Links:` (counts of linked/linked-dir/copied/missing items)

4. Switch the session to the worktree:

   ```bash
   cd <worktree-path>
   ```

   Use the path from the `Worktree ready:` line.

5. Print a summary:
   - Worktree path
   - Branch name
   - Base branch and ref
   - Link status (how many files symlinked/copied/missing)

## Error Handling

- **"Working tree has uncommitted changes"**: Ask the user to commit or stash changes before retrying.
- **"Worktree already exists"**: The task already has an open worktree with this slug. Run `arbiter wt list` to see existing worktrees, or suggest closing it first with `/wt-close`. To open a second worktree for the same task, use a different slug.
- **"Base branch does not exist"**: Ask the user to specify a valid base branch with `--base`.
- **"Must run from the main repository"**: The command must be run from the main repo, not from within an existing worktree. `cd` back to the main repo first.
- **Links show `N missing`**: One or more configured links could not be created (source not found). If `node_modules` is missing, run `npm ci` inside the worktree.

## Allowed Tools

- `Bash` for running `arbiter wt open` and `cd`
- `Read` for reading AGENTS.md in the worktree if needed

## Notes

- The worktree is created as a **sibling** of the main repo (in `<repo>.worktrees/`), not inside it
- Config files like `.claude/settings.local.json` are symlinked from the main repo using **absolute paths**
- `node_modules` is symlinked as a directory (no separate `npm ci` needed — unless it shows as `missing`)
- The open log at `.arbiter/worktree-open.log.json` is appended on every open; `wt-close` uses it to locate the worktree
- If the worktree already exists (same task + slug), the command will fail with an idempotency error
