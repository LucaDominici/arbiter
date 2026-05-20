---
title: 'Recipe: Sibling Worktree Pattern (`--sibling`)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Recipe: Sibling Worktree Pattern (`--sibling`)

Use the `--sibling` flag to open a worktree directly next to the main repo
instead of under the configured `worktreeBase`.

## When to use

- You want the worktree visible alongside the repo in your file manager
  (e.g., `~/projects/myapp` + `~/projects/myapp.worktrees/my-feature`)
- CI or editor configs are hard-coded to a sibling directory layout
- You are not using a central `worktreesDir` config

## Command

```bash
arbiter wt open --task-id '#698' --sibling my-feature
```

This places the worktree at:

```
<repo-parent>/<repo-name>.worktrees/my-feature
```

If `--sibling` is given without a slug (e.g. `--sibling ""`), the slug
defaults to the task directory name (`#<taskId>`).

## Auto-linked files (restricted set)

On open, arbiter creates symlinks in the worktree for:

| Path                          | Notes                                            |
| ----------------------------- | ------------------------------------------------ |
| `.env`                        | Literal only — not `.env.production` or `.envrc` |
| `.env.local`                  | Literal only                                     |
| `.claude/settings.local.json` | Editor/Claude settings                           |
| `.idea/`                      | JetBrains IDE config                             |
| `.vscode/`                    | VS Code config                                   |
| `node_modules`                | Avoids duplicate installs                        |

Use `--with-build-links` to also link `target/`, `dist/`, `.next/`, etc.

## Footguns

### `.claude/` directory is NOT linked

A `.claude/` directory symlink would cause hooks and analyzers to follow
the `realpath` back into the main repo, triggering them in the wrong
context. The individual file `.claude/settings.local.json` is safe and
included.

### Build artifacts are opt-in

`target/`, `dist/`, and `.next/` are excluded by default to prevent
accidental shared state. Pass `--with-build-links` to include them.

### `.env.production` and `.envrc` are never linked

Only `.env` and `.env.local` are linked. Run `git check-ignore .env` to
confirm your secrets file is ignored before opening the worktree.

### Existing non-symlink at destination → error

If a real file or directory (not a symlink) already exists at a link
destination, `materializeLink` throws with an actionable error:

```
Cannot materialize '.env': a non-symlink already exists at /path/to/worktree/.env.
Remove it manually then retry.
```

Remove the file, then re-run `arbiter wt open`.

## Closing

```bash
arbiter wt close '#698'
```

Close works identically to the standard pattern.
