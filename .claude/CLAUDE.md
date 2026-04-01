# arbiter — Claude Code Configuration

@AGENTS.md

> This file imports `AGENTS.md` (canonical governance, AAIF standard) via the `@` directive above.
> Below: Claude Code-specific configuration only — hooks, sub-agents, and slash commands.

---

## Quick Reference

| Fact                | Value                                |
| ------------------- | ------------------------------------ |
| **Project**         | arbiter                              |
| **Gate**            | `./scripts/check-all.sh`             |
| **Full governance** | `../AGENTS.md` (auto-imported above) |

---

## Claude Code-Specific

### Hooks

Configured in `.claude/settings.json`. Active hooks:

| Event                       | Hook                      | Purpose                                       |
| --------------------------- | ------------------------- | --------------------------------------------- |
| `PreToolUse` → Bash         | `stop-dangerous.sh`       | Block dangerous commands (rm -rf, force push) |
| `PreToolUse` → Edit\|Write  | `enforce-read-only.sh`    | Guard read-only files                         |
| `PreToolUse` → Edit\|Write  | `pre-edit-ssot-guard.sh`  | Prevent unauthorized SSOT edits               |
| `PostToolUse` → Bash        | `post-commit-check.sh`    | Verify commit format after git commits        |
| `PostToolUse` → Edit\|Write | `check-no-orphan-todo.sh` | Block orphan TODOs (INV-06)                   |
| `PostToolUse` → Edit\|Write | `check-no-any.sh`         | Block `any` types (INV-04)                    |

### Slash Commands

| Command            | Purpose                                              |
| ------------------ | ---------------------------------------------------- |
| `/start-task #NNN` | Initialize task: create branch, read AGENTS.md, plan |
| `/complete-task`   | Finalize: gate, commit, PR, merge                    |

---

## Hard Stops (Inherited from AGENTS.md)

See `../AGENTS.md` §Invariants for the complete list.

**Never:**

- Skip the gate before committing
- Commit directly to `main`
- Add `any` type (TS) or `.unwrap()` (Rust)
- Leave orphan TODOs without task IDs

**If gate fails:** Fix the root cause. No `--no-verify`. No skipping.
