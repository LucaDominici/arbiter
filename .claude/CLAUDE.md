---
title: 'arbiter — Claude Code Configuration'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# arbiter — Claude Code Configuration

@AGENTS.md

> This file imports `AGENTS.md` (canonical governance, AAIF standard) via the `@` directive above.
> Below: Claude Code-specific configuration only — hooks, sub-agents, and slash commands.

---

## Mission

arbiter is a framework for serious AI-assisted software development.
Goals: speed, predictable outcomes, robustness, reliability, coherence.
A project using arbiter gets the maximum any agentic-development tool can offer.
Tradeoff: an expert-only tool.

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

| Event                        | Hook                          | Purpose                                                                     |
| ---------------------------- | ----------------------------- | --------------------------------------------------------------------------- |
| `PreToolUse` → Bash          | `stop-dangerous.mjs`          | Block dangerous commands (rm -rf, force push)                               |
| `PreToolUse` → Bash          | `enforce-gate-before-pr.mjs`  | Block `gh pr create` without valid gate-pass.json                           |
| `PreToolUse` → Edit\|Write   | `enforce-read-only.mjs`       | Guard read-only files                                                       |
| `PreToolUse` → Edit\|Write   | `pre-edit-load-memory.mjs`    | Inject memory-impl.md gotchas when glob matches                             |
| `PreToolUse` → Edit\|Write   | `pre-edit-ssot-guard.mjs`     | Prevent unauthorized SSOT edits                                             |
| `PreToolUse` → Edit\|Write   | `pre-edit-plan-anchor.mjs`    | Require plan anchor before editing (CANON-16)                               |
| `PostToolUse` → Bash         | `post-commit-check.mjs`       | Verify commit format after git commits                                      |
| `PostToolUse` → Bash         | `wiki-on-commit.mjs`          | Incremental wiki regeneration when docs/ files change (INV-116, #1241)      |
| `PostToolUse` → Edit\|Write  | `check-no-direct-spawn.mjs`   | Block direct child_process usage (INV-12)                                   |
| `PostToolUse` → Edit\|Write  | `check-no-orphan-todo.mjs`    | Block orphan TODOs (INV-21)                                                 |
| `PostToolUse` → Edit\|Write  | `check-no-placeholders.mjs`   | Block placeholder patterns left in edited files                             |
| `PostToolUse` → Edit\|Write  | `check-no-pii.mjs`            | Block PII patterns in edited files (INV-12)                                 |
| `PostToolUse` → Edit\|Write  | `check-no-unused-exports.mjs` | Block unused TypeScript value exports after edits (type exports: see #1189) |
| `PostToolUse` → Edit\|Write  | `check-no-any.mjs`            | Block `any` types (INV-04)                                                  |
| `PostToolUse` → Edit\|Write  | `check-circular-deps.mjs`     | Detect circular dependencies after TS/JS edits                              |
| `PostToolUse` → Edit\|Write  | `post-edit-dispatch.mjs`      | Run format + lint after file edits                                          |
| `PostToolUseFailure` → Bash  | `debug-state-on-failure.mjs`  | Persist debug state when gate/test commands fail                            |
| `UserPromptSubmit` → \*      | `post-brainstorm-stop.mjs`    | Block /task while brainstorm session active                                 |
| `UserPromptSubmit` → \*      | `skill-forced-eval.mjs`       | Enforce skill invocation before responses                                   |
| `UserPromptSubmit` → \*      | `guard-task-completion.mjs`   | Warn on premature task-completion claims                                    |
| `Stop` → \*                  | `stop-evidence-guard.mjs`     | Block completion claims without correlated evidence (INV-114, #1212)        |
| `PostToolUse` → ExitPlanMode | `exitplanmode-banner.mjs`     | Print next-step banner after plan mode ends (#1210)                         |
| `PreCompact` → \*            | `pre-compact.mjs`             | Persist context before auto-compaction                                      |

### Slash Commands

| Command      | Purpose                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------- |
| `/ship #NNN` | **Orchestration entrypoint** — drive an issue to a merged PR (plan → review → gate → merge) |
| `/task`      | Low-level engine/CLI: `arbiter task init/advance/record-red/recover/get`                    |
| `/wt-open`   | Open an isolated task worktree                                                              |
| `/wt-close`  | Close or harvest a task worktree                                                            |
| `/wt-list`   | List active git worktrees with status                                                       |
| `/wt-prune`  | Prune stale worktree metadata                                                               |

---

## Hard Stops (Inherited from AGENTS.md)

See `../AGENTS.md` §Invariants for the complete list.

**Never:**

- Skip the gate before committing
- Commit directly to `main`
- Add `any` type (TS) or `.unwrap()` (Rust)
- Leave orphan TODOs without task IDs

**If gate fails:** Fix the root cause. No `--no-verify`. No skipping.

## Iron Law — PRs are owned until merged

A PR is done only when it is **merged green**, not when it is opened. Follow every PR you
open through CI and fix each red by root cause (read the failing job's log, fix the
underlying cause, push, re-verify) — repeated until all checks pass and it merges. Handing
back or abandoning a red PR is a process violation.
