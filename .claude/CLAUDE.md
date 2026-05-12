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

| Event                       | Hook                          | Purpose                                                 |
| --------------------------- | ----------------------------- | ------------------------------------------------------- |
| `PreToolUse` → Bash         | `stop-dangerous.mjs`          | Block dangerous commands (rm -rf, force push)           |
| `PreToolUse` → Edit\|Write  | `enforce-read-only.mjs`       | Guard read-only files                                   |
| `PreToolUse` → Edit\|Write  | `pre-edit-ssot-guard.mjs`     | Prevent unauthorized SSOT edits                         |
| `PostToolUse` → Bash        | `post-commit-check.mjs`       | Block non-conventional commit messages (INV-22, exit 1) |
| `PostToolUse` → Edit\|Write | `check-no-orphan-todo.mjs`    | Block orphan TODOs (INV-21)                             |
| `UserPromptSubmit` → \*     | `guard-task-completion.mjs`   | Warn on premature task-completion claims                |
| `PostToolUse` → Edit\|Write | `check-no-any.mjs`            | Block `any` types (INV-04)                              |
| `PostToolUse` → Edit\|Write | `check-no-placeholders.mjs`   | Block placeholder/WIP patterns (#151)                   |
| `PostToolUse` → Edit\|Write | `check-no-unused-exports.mjs` | Block unused TS exports via knip — src/ only (#156)     |
| `PostToolUse` → Edit\|Write | `check-circular-deps.mjs`     | Detect circular deps via madge (INV-01, TS)             |
| `PreToolUse` → Edit\|Write  | `pre-edit-plan-anchor.mjs`    | Block edits outside plan-anchored context (INV-38)      |
| `PostToolUse` → Edit\|Write | `check-no-direct-spawn.mjs`   | Block direct child_process calls outside run-cli        |
| `PostToolUse` → Edit\|Write | `check-no-pii.mjs`            | Block PII in source/tests (INV-12)                      |
| `PostToolUse` → Edit\|Write | `post-edit-dispatch.mjs`      | Advisory: format + lint feedback (exit 0, non-blocking) |
| `UserPromptSubmit` → \*     | `skill-forced-eval.mjs`       | Phase-aware skill activation nudge                      |
| `PostToolUseFailure` → Bash | `debug-state-on-failure.mjs`  | Persist debug state on bash failure                     |
| `PreCompact` → \*           | `pre-compact.mjs`             | Preserve session state across compaction                |

### Slash Commands

| Command         | Purpose                                           |
| --------------- | ------------------------------------------------- |
| `/task #NNN`    | Full lifecycle: branch, plan, implement, gate, PR |
| `/wt-open`      | Open an isolated task worktree                    |
| `/wt-close`     | Close or harvest a task worktree                  |
| `/wt-list`      | List active git worktrees with status             |
| `/wt-prune`     | Prune stale worktree metadata                     |
| `/status`       | Show active task phase, timestamp, and log        |
| `/replay phase` | Re-present instructions for a named task phase    |

---

## Hard Stops (Inherited from AGENTS.md)

See `../AGENTS.md` §Invariants for the complete list.

**Never:**

- Skip the gate before committing
- Commit directly to `main`
- Add `any` type (TS) or `.unwrap()` (Rust)
- Leave orphan TODOs without task IDs

**If gate fails:** Fix the root cause. No `--no-verify`. No skipping.
