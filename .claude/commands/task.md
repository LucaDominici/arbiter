---
description: Low-level task engine/CLI reference — use /ship for full orchestration
argument-hint: '<subcommand> [options]'
title: '/task'
doc_version: '2.0.0'
status: active
last_review: '2026-06-05'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# /task

> **Orchestration → use [`/ship`](ship.md)**. `/task` is the low-level engine/CLI behind `/ship`.
> Use the subcommands below for recovery, manual phase control, or one-off engine calls only.

Read `AGENTS.md` before using — invariants govern every phase transition.

---

## Subcommand reference

| Subcommand                                                | Purpose                                               |
| --------------------------------------------------------- | ----------------------------------------------------- |
| `arbiter task init --id <id> --plan <path> --tier <tier>` | Seed task state (id, plan path, tier)                 |
| `arbiter task advance --to <phase>`                       | Advance (or recover) to the target phase              |
| `arbiter task resume`                                     | Restore context from the last cursor (`arbiter mark`) |
| `arbiter task recover`                                    | Repair corrupted or stale task state                  |
| `arbiter task record-red --test-path <path>`              | Record TDD red evidence (failing test file)           |
| `arbiter task record-tech-debt --description <d>`         | File a tech-debt issue and record it                  |
| `arbiter task get`                                        | Print current task state as JSON                      |

---

## State machine

Phase order: `preflight → plan → red-team-review → red → green → refactor → verification → complete`

Lateral re-entry: `red-team-rework → red-team-review` (for CRITICAL red-team findings).

---

## Manual recovery

If mid-phase or stuck, advance directly:

```bash
arbiter task advance --to <phase>
# Examples:
# arbiter task advance --to red          # resume from plan approval
# arbiter task advance --to refactor     # resume after implementation
# arbiter task advance --to verification # resume after code review
```

Do NOT use the ordered sequence to re-run all phases — that is what `/ship --advance` does.

---

## Tech-debt filing

When you discover a pre-existing violation in code you are **not** changing (ADR violation in untouched
code, missing enforcement, fragile abstraction requiring out-of-scope rework), file a tech-debt issue:

```bash
arbiter task record-tech-debt \
  --description "brief finding description" \
  --triggered-by "#NNN"   # defaults to active task from .claude/.task/status.json
```

Creates a GitHub issue labeled `tech-debt` and appends the issue number to
`.arbiter/evidence/<task-id>/tech-debt.json`. Failure is soft (exit 0); reason is emitted to stderr.

---

## Gate commands

```bash
node scripts/check-all.mjs L1   # fast: lint + format + unit tests
node scripts/check-all.mjs L2   # full: L1 + coverage + integration
```
