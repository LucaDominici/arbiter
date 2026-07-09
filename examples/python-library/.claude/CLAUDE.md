
# python-library — Claude Code Configuration

@AGENTS.md

> This file imports `AGENTS.md` (canonical governance, AAIF standard) via the `@` directive above.
> Below: Claude Code-specific configuration only — hooks, sub-agents, and slash commands.

---

## Quick Reference

| Fact | Value |
|------|-------|
| **Project** | python-library |
| **Gate** | `node scripts/check-all.mjs` |
| **Full governance** | `../AGENTS.md` (auto-imported above) |
| **Collaboration mode** | `peer-review` — merge: `pr-ff` / branch: `github-flow` |

---

## Claude Code-Specific

### Hooks

Configured in `.claude/settings.json`. Active hooks:

| Event | Hook | Purpose |
|-------|------|---------|
| `PreToolUse` → Bash | `stop-dangerous.mjs` | Block dangerous commands (rm -rf, force push) |
| `PreToolUse` → Edit\|Write | `enforce-read-only.mjs` | Guard read-only files |
| `PreToolUse` → Edit\|Write | `pre-edit-ssot-guard.mjs` | Prevent unauthorized SSOT edits |
| `PostToolUse` → Bash | `post-commit-check.mjs` | Verify commit format after git commits |
| `PostToolUse` → Edit\|Write | `check-no-orphan-todo.mjs` | Block orphan TODOs (INV-21) |

### Slash Commands

| Command | Purpose |
|---------|---------|
| `/ship #NNN` | **Orchestration entrypoint** — drive an issue to a merged PR (plan → review → gate → merge) |
| `/task` | Low-level engine/CLI: `arbiter task init/advance/record-red/recover/get` |
| `/wt-open` | Open an isolated task worktree |
| `/wt-close` | Close or harvest a task worktree |
| `/wt-list` | List active git worktrees with status |
| `/wt-prune` | Prune stale worktree metadata |

---

## Hard Stops (Inherited from AGENTS.md)

See `../AGENTS.md` §Invariants for the complete list.

**Never:**
- Skip the gate before committing

- Commit directly to `main` (use PR branches — see collaboration mode above)

- Add `any` type (TS) or `.unwrap()` (Rust)
- Leave orphan TODOs without task IDs

**If gate fails:** Fix the root cause. No `--no-verify`. No skipping.
