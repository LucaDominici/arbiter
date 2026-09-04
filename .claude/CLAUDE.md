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

| Event                        | Hook                           | Purpose                                                                                                                            |
| ---------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `PreToolUse` → Bash          | `stop-dangerous.mjs`           | Block dangerous commands and obvious writes to protected Arbiter state                                                             |
| `PreToolUse` → Bash          | `enforce-gate-before-pr.mjs`   | Block `gh pr create` without valid gate-pass.json                                                                                  |
| `PreToolUse` → Bash          | `closer-mode-guard.mjs`        | CLOSER-mode Rule 1/2 enforcement, active only in the `close` phase (#A11, #2014)                                                   |
| `PreToolUse` → Edit\|Write   | `enforce-read-only.mjs`        | Guard read-only files                                                                                                              |
| `PreToolUse` → Edit\|Write   | `pre-edit-load-memory.mjs`     | Inject memory-impl.md gotchas when glob matches                                                                                    |
| `PreToolUse` → Edit\|Write   | `pre-edit-ssot-guard.mjs`      | Prevent unauthorized SSOT edits                                                                                                    |
| `PreToolUse` → Edit\|Write   | `pre-edit-plan-anchor.mjs`     | Require plan anchor before editing (CANON-16)                                                                                      |
| `PostToolUse` → Bash         | `post-commit-check.mjs`        | Verify commit format after git commits                                                                                             |
| `PostToolUse` → Bash         | `wiki-on-commit.mjs`           | Incremental wiki regeneration when docs/ files change (INV-116, #1241)                                                             |
| `PostToolUse` → Edit\|Write  | `check-no-direct-spawn.mjs`    | Block direct child_process usage (INV-12)                                                                                          |
| `PostToolUse` → Edit\|Write  | `check-no-orphan-todo.mjs`     | Block orphan TODOs (INV-21)                                                                                                        |
| `PostToolUse` → Edit\|Write  | `check-no-placeholders.mjs`    | Block placeholder patterns left in edited files                                                                                    |
| `PostToolUse` → Edit\|Write  | `check-no-skipped-tests.mjs`   | Block committed skipped or disabled tests                                                                                          |
| `PostToolUse` → Edit\|Write  | `check-no-pii.mjs`             | Block PII patterns in edited files (INV-12)                                                                                        |
| `PostToolUse` → Edit\|Write  | `check-no-unused-exports.mjs`  | Block unused TypeScript value exports after edits (type exports: see #1189)                                                        |
| `PostToolUse` → Edit\|Write  | `check-no-any.mjs`             | Block `any` types (INV-04)                                                                                                         |
| `PostToolUse` → Edit\|Write  | `check-circular-deps.mjs`      | Detect circular dependencies after TS/JS edits                                                                                     |
| `PostToolUse` → Edit\|Write  | `post-edit-dispatch.mjs`       | Run format + lint after file edits                                                                                                 |
| `PostToolUseFailure` → Bash  | `debug-state-on-failure.mjs`   | Persist debug state when gate/test commands fail                                                                                   |
| `UserPromptSubmit` → \*      | `post-brainstorm-stop.mjs`     | Block /task while brainstorm session active                                                                                        |
| `UserPromptSubmit` → \*      | `skill-forced-eval.mjs`        | Phase-bound TDD evidence verifier; blocks implementation edits without a successful `Skill(tdd)` result (exit 2)                   |
| `UserPromptSubmit` → \*      | `guard-task-completion.mjs`    | Hard-block premature task-completion claims (exit 2)                                                                               |
| `UserPromptSubmit` → \*      | `guard-done-evidence.mjs`      | Validate SHA-pinned done-evidence before completion claims (#1872; active — `features.evidenceHarness: true` in arbiter.json)      |
| `Stop` → \*                  | `stop-evidence-guard.mjs`      | Block completion claims without correlated evidence (INV-114, #1212)                                                               |
| `Stop` → \*                  | `stop-finding-loss.mjs`        | E6b #1948; hard by default — `ARBITER_FINDING_LOSS_HARD=1` set in settings `env` (OD-14; hardened 2026-08-26)                      |
| `PostToolUse` → ExitPlanMode | `exitplanmode-banner.mjs`      | Print next-step banner after plan mode ends (#1210)                                                                                |
| `PreCompact` → \*            | `pre-compact.mjs`              | Persist context before auto-compaction                                                                                             |
| `PreToolUse` → Task\|Agent   | `pre-spawn-worktree-guard.mjs` | E5 #1947; hard by default — `ARBITER_SPAWN_GUARD_HARD=1` set in settings `env` (OD-14; hardened 2026-08-26)                        |
| `SubagentStop` → \*          | `post-subagent-release.mjs`    | E5 #1947, #2403; cleanup companion to pre-spawn-worktree-guard.mjs — removes the finished dispatch's sidecar entry, always exits 0 |

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

## Iron Laws (Inherited from AGENTS.md)

See `../AGENTS.md` §Iron Laws for the canonical formulation of: worktree isolation for
parallel agents, complete-means-merged-to-main, root-cause-first after any failure, and
verification-before-victory.

## Iron Law — every problem gets fixed, including pre-existing ones

A failure is never dismissed because "it was already broken" or "it's not from my change."
Pre-existing red, flaky infra, a stale pin, a lapsed suppression, a nightly that's been
failing for days — all of it gets **fixed at the root cause**, or, when out of the current
scope, **filed as a tracked issue** that will itself be driven to a fix. "Pre-existing" is an
explanation of origin, not a reason to leave it broken. When you discover a problem you are
not fixing this instant, open an issue for it before moving on; the backlog is the queue, not
the graveyard.
