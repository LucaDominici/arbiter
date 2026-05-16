# arbiter — Claude Code Configuration

@AGENTS.md

> This file imports `AGENTS.md` (canonical governance, AAIF standard) via the `@` directive above.
> Below: Claude Code-specific configuration only — hooks, sub-agents, and slash commands.

---

## Quick Reference

| Fact                | Value                                |
| ------------------- | ------------------------------------ |
| **Project**         | arbiter                              |
| **Gate**            | `node scripts/check-all.mjs`         |
| **Full governance** | `../AGENTS.md` (auto-imported above) |

---

## Claude Code-Specific

### Hooks

Configured in `.claude/settings.json`. Active hooks:

| Event                       | Hook                          | Purpose                                          |
| --------------------------- | ----------------------------- | ------------------------------------------------ |
| `PreToolUse` → Bash         | `stop-dangerous.mjs`          | Block dangerous commands (rm -rf, force push)    |
| `PreToolUse` → Edit\|Write  | `enforce-read-only.mjs`       | Guard read-only files                            |
| `PreToolUse` → Edit\|Write  | `pre-edit-ssot-guard.mjs`     | Prevent unauthorized SSOT edits                  |
| `PreToolUse` → Edit\|Write  | `pre-edit-plan-anchor.mjs`    | Require plan anchor before editing (CANON-14)    |
| `PostToolUse` → Bash        | `post-commit-check.mjs`       | Verify commit format after git commits           |
| `PostToolUse` → Edit\|Write | `check-no-direct-spawn.mjs`   | Block direct child_process usage (INV-12)        |
| `PostToolUse` → Edit\|Write | `check-no-orphan-todo.mjs`    | Block orphan TODOs (INV-21)                      |
| `PostToolUse` → Edit\|Write | `check-no-any.mjs`            | Block `any` types (INV-04)                       |
| `PostToolUse` → Edit\|Write | `check-no-placeholders.mjs`   | Block placeholder patterns left in edited files  |
| `PostToolUse` → Edit\|Write | `check-no-pii.mjs`            | Block PII patterns in edited files (INV-12)      |
| `PostToolUse` → Edit\|Write | `check-no-unused-exports.mjs` | Block unused TypeScript exports after edits      |
| `PostToolUse` → Edit\|Write | `check-circular-deps.mjs`     | Detect circular dependencies after TS/JS edits   |
| `PostToolUse` → Edit\|Write | `post-edit-dispatch.mjs`      | Run format + lint after file edits               |
| `PostToolUseFailure` → Bash | `debug-state-on-failure.mjs`  | Persist debug state when gate/test commands fail |
| `UserPromptSubmit` → \*     | `skill-forced-eval.mjs`       | Enforce skill invocation before responses        |
| `UserPromptSubmit` → \*     | `guard-task-completion.mjs`   | Warn on premature task-completion claims         |
| `PreCompact` → \*           | `pre-compact.mjs`             | Persist context before auto-compaction           |

### Slash Commands

| Command      | Purpose                                           |
| ------------ | ------------------------------------------------- |
| `/task #NNN` | Full lifecycle: branch, plan, implement, gate, PR |
| `/wt-open`   | Open an isolated task worktree                    |
| `/wt-close`  | Close or harvest a task worktree                  |
| `/wt-list`   | List active git worktrees with status             |
| `/wt-prune`  | Prune stale worktree metadata                     |

---

## Hard Stops (Inherited from AGENTS.md)

See `../AGENTS.md` §Invariants for the complete list.

**Never:**

- Skip the gate before committing
- Commit directly to `main`
- Add `any` type (TS) or `.unwrap()` (Rust)
- Leave orphan TODOs without task IDs

**If gate fails:** Fix the root cause. No `--no-verify`. No skipping.
