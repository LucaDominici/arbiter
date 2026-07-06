---
title: 'Hook Contracts — `.claude/hooks/*.mjs`'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/method']
related: []
---

# Hook Contracts — `.claude/hooks/*.mjs`

> **Anti-rot gate:** `scripts/check-hook-contracts.mjs` (L1) diffs this file against the hooks
> directory. Add a row here whenever you add a hook file; remove the row when you delete the file.
> Mismatch → gate failure.

Generated from audit #615. Last updated: 2026-05-17.

---

## Concurrency Classes

| Class         | Meaning                                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SAFE**      | Pure reads, stdout-inject, or append-only writes. Safe to run concurrently with any other hook.                                                       |
| **SERIALIZE** | Read-modify-write to shared state. Must be the sole writer to its path during execution. Avoid new SERIALIZE hooks — redesign to append-only instead. |
| **EXCLUSIVE** | Holds a lock or modifies git index. Cannot run concurrently with other hooks touching the same resource.                                              |

---

## Registered Hooks

Hooks wired in `.claude/settings.json`.

| Hook                          | Event              | Trigger      | I/O                    | Shared Paths                            | Concurrency Class |
| ----------------------------- | ------------------ | ------------ | ---------------------- | --------------------------------------- | ----------------- |
| `stop-dangerous.mjs`          | PreToolUse         | Bash         | read                   | —                                       | SAFE              |
| `enforce-read-only.mjs`       | PreToolUse         | Edit\|Write  | read                   | —                                       | SAFE              |
| `pre-edit-load-memory.mjs`    | PreToolUse         | Edit\|Write  | read, stdout-inject    | `.claude/memory-impl.md`                | SAFE              |
| `pre-edit-ssot-guard.mjs`     | PreToolUse         | Edit\|Write  | read, stdout-inject    | —                                       | SAFE              |
| `pre-edit-plan-anchor.mjs`    | PreToolUse         | Edit\|Write  | read, stdout-inject    | `.claude/.task-*`, `.claude/plans/`     | SAFE              |
| `post-commit-check.mjs`       | PostToolUse        | Bash         | read (git log)         | —                                       | SAFE              |
| `wiki-on-commit.mjs`          | PostToolUse        | Bash         | run (gen-wiki.mjs)     | Incremental wiki regen for changed docs | SAFE              |
| `check-no-direct-spawn.mjs`   | PostToolUse        | Edit\|Write  | read                   | —                                       | SAFE              |
| `check-no-orphan-todo.mjs`    | PostToolUse        | Edit\|Write  | read                   | —                                       | SAFE              |
| `check-no-placeholders.mjs`   | PostToolUse        | Edit\|Write  | read                   | —                                       | SAFE              |
| `check-no-pii.mjs`            | PostToolUse        | Edit\|Write  | read                   | —                                       | SAFE              |
| `check-no-unused-exports.mjs` | PostToolUse        | Edit\|Write  | read (knip)            | —                                       | SAFE              |
| `check-no-any.mjs`            | PostToolUse        | Edit\|Write  | read                   | —                                       | SAFE              |
| `check-circular-deps.mjs`     | PostToolUse        | Edit\|Write  | read (madge)           | —                                       | SAFE              |
| `post-edit-dispatch.mjs`      | PostToolUse        | Edit\|Write  | read, append-write     | `.claude/hooks/logs/hook-events.log`    | SAFE              |
| `post-brainstorm-stop.mjs`    | UserPromptSubmit   | \*           | read, delete           | `.arbiter/brainstorm-active`            | SAFE              |
| `skill-forced-eval.mjs`       | UserPromptSubmit   | \*           | read, stdout-inject    | `.claude/.task-*`                       | SAFE              |
| `guard-task-completion.mjs`   | UserPromptSubmit   | \*           | read                   | `.claude/.task-*`                       | SAFE              |
| `stop-evidence-guard.mjs`     | Stop               | \*           | read (transcript, git) | `.arbiter/evidence/*`, `.claude/.task/` | SAFE              |
| `closer-mode-guard.mjs`       | PreToolUse         | Bash         | read (task state, git) | `.claude/.task/`                        | SAFE              |
| `debug-state-on-failure.mjs`  | PostToolUseFailure | Bash         | create-or-append-write | `.evidence/<task>/DEBUG_STATE.md`       | SAFE              |
| `exitplanmode-banner.mjs`     | PostToolUse        | ExitPlanMode | read, stdout-inject    | `.claude/.task/status.json`             | SAFE              |
| `pre-compact.mjs`             | PreCompact         | \*           | read, stdout-inject    | `.claude/.task-*`                       | SAFE              |

---

## Utility Modules

Shared helpers imported by hooks. Not registered as hooks themselves.

| File      | Purpose                                                                                                           | Shared Paths                                       | Concurrency Class |
| --------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------- |
| `lib.mjs` | Shared utilities: `readTaskState`, `getRepoRoot`, `logInfo/Warn/Error`, `findInlineSuppression`, `sanitizeTaskId` | `.claude/hooks/logs/hook-events.log` (append-only) | SAFE              |

---

## Unregistered Hook Files

Present in `.claude/hooks/` but not wired in `settings.json`. Document reason for non-registration.

| Hook                         | Reason Not Registered                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check-no-mockmvc.mjs`       | PostToolUse Java guard (INV-29): blocks MockMvc imports; only applies to Java files. Not registered in arbiter self-config (no Java sources here).       |
| `check-no-raw-types.mjs`     | PostToolUse Java guard: blocks unparameterized generic types in Java files. Not registered in arbiter self-config (no Java sources here).                |
| `check-no-skipped-tests.mjs` | Available for opt-in by generated projects; not self-applied to arbiter (arbiter uses `.skip` in `vitest.config.ts` exclusions, not inline skip markers) |
| `enforce-gate-before-pr.mjs` | PreToolUse gate-marker guard (R1.S5): blocks `gh pr create` unless gate marker is fresh. Pending registration after full gate-marker infra lands.        |
| `hooks.mjs`                  | Arbiter-generated hook dispatcher for target projects. Present here as dogfood; not registered as Claude Code hook in arbiter's own settings.json.       |
| `pre-task-track-detect.mjs`  | Experimental — wired as UserPromptSubmit in development branches; not yet stable for main settings                                                       |

---

## Invariants

1. **No SERIALIZE hooks.** If you find yourself writing a hook that reads then rewrites a file, use `openSync('wx')` for the first write and `appendFileSync` for subsequent writes instead.
2. **Shared log writes are append-only.** `lib.mjs` `logInfo/logWarn/logError` use `appendFileSync` → POSIX atomic for entries < 4KB (PIPE_BUF).
3. **debug-state-on-failure is SAFE.** Uses `openSync('wx')` (O_CREAT|O_EXCL) for header creation — concurrent first-creates fail silently on EEXIST and fall through to `appendFileSync`. Each attempt entry is a single `appendFileSync` call (< 4KB).
4. **Hooks must not acquire file locks.** If a hook needs exclusive access, redesign using atomic primitives above. `src/utils/file-lock.ts` is for CLI commands, not hooks.

---

## Shipped-hook dogfood corpus (#1090)

Eight hooks are emitted **verbatim** to target projects by `src/generators/claude.ts`
(`readTemplate` → `writeFile`, no EJS render): `stop-dangerous`, `enforce-read-only`,
`pre-edit-ssot-guard`, `check-no-orphan-todo`, `check-no-placeholders`, `enforce-gate-before-pr`,
`check-no-unused-exports`, `check-no-skipped-tests`. `scripts/check-self-dogfood.mjs`
(`checkRawHooks`, exported as `REQUIRED_RAW_HOOKS`) diffs each shipped template against arbiter's
materialized `.claude/hooks/` copy and **fails closed** on undocumented drift — closing the INV-45
gap where the corpus walk collected only `.ejs`, so a shipped hook could silently weaken.

Arbiter intentionally self-hardens four of these beyond the shipped template (repo-root scoping,
`lib.mjs` inline-suppression, and dropping `AGENTS.md` from `enforce-read-only`'s read-only set
because arbiter _authors_ its own `AGENTS.md` whereas a target's is generated and must stay locked).
Each divergence carries a dated rationale in `.dogfood-divergences.json` and is deliberately **not**
back-ported: back-porting the repo-root bypass was empirically shown to break the INV-36 HARD-hook
contract.
