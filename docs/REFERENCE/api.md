---
title: 'Public API Reference'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Public API Reference

**Issue:** #598  
**Package:** `@arbiter/cli`

Arbiter exposes four stable public entry points. All other paths are internal and may change without notice.

---

## Entry Points

| Export path                  | Purpose                                       |
| ---------------------------- | --------------------------------------------- |
| `@arbiter/cli`               | CLI entry — not intended for programmatic use |
| `@arbiter/cli/plugin`        | Plugin type definitions                       |
| `@arbiter/cli/invariants`    | Invariant catalog + filtering                 |
| `@arbiter/cli/compatibility` | Environment probe + matrix types              |

---

## `@arbiter/cli/invariants`

```ts
import {
  INVARIANT_CATALOG,
  getFilteredInvariants,
  getInvariantsByTier,
  presetToTiers,
  defaultPresetForLevel,
} from '@arbiter/cli/invariants'

import type {
  Invariant,
  InvariantTier,
  InvariantPreset,
  Language,
  GovernanceLevel,
} from '@arbiter/cli/invariants'
```

### Exports

| Symbol                            | Kind          | Description                                                                |
| --------------------------------- | ------------- | -------------------------------------------------------------------------- |
| `INVARIANT_CATALOG`               | `Invariant[]` | Complete invariant catalog (all 90+ entries)                               |
| `getFilteredInvariants(config)`   | function      | Filter catalog by language, governance level, tiers                        |
| `getInvariantsByTier(invariants)` | function      | Group a filtered set by tier                                               |
| `presetToTiers(preset)`           | function      | Map preset name to tier array                                              |
| `defaultPresetForLevel(level)`    | function      | Get default preset for a governance level                                  |
| `Invariant`                       | type          | Single invariant entry shape                                               |
| `InvariantTier`                   | type          | `'architectural' \| 'data' \| 'security' \| 'operational' \| 'governance'` |
| `InvariantPreset`                 | type          | `'essential' \| 'standard' \| 'full'`                                      |
| `Language`                        | type          | `'typescript' \| 'java' \| 'rust' \| 'go' \| 'python'`                     |
| `GovernanceLevel`                 | type          | `'L1' \| 'L2' \| 'L3'`                                                     |

---

## `@arbiter/cli/compatibility`

```ts
import { runProbes, validateMatrix } from '@arbiter/cli/compatibility'

import type {
  MatrixEntry,
  LanguageMatrix,
  ProbeResult,
  ProbeStatus,
  VerifyReport,
} from '@arbiter/cli/compatibility'
```

### Exports

| Symbol                | Kind     | Description                                      |
| --------------------- | -------- | ------------------------------------------------ |
| `runProbes(dir)`      | function | Probe all required tools for a project directory |
| `validateMatrix(raw)` | function | Parse and validate a raw matrix JSON object      |
| `MatrixEntry`         | type     | One tool probe entry (`{ tool, range }`)         |
| `LanguageMatrix`      | type     | Per-language map of required tool entries        |
| `ProbeResult`         | type     | Result of probing a single tool                  |
| `ProbeStatus`         | type     | `'passed' \| 'skipped' \| 'failed' \| 'warning'` |
| `VerifyReport`        | type     | Aggregated report for all probed tools           |

---

## Environment Variables

All `ARBITER_*` variables are read at process start unless noted otherwise. Unknown variables and malformed values are silently ignored unless the variable controls a gate (gate violations produce a hard error).

### Runtime and trace

| Variable              | Format                            | Default       | Purpose                                                                                                                                                                    | Read in                      |
| --------------------- | --------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `ARBITER_RUN_ID`      | `arb-YYYYMMDD-HHMMSS-<8hexchars>` | auto-minted   | Trace ID for the current process. Minted once and exported so subprocesses inherit it automatically. Pre-set to correlate multiple arbiter invocations in the same CI job. | `src/utils/run-id.ts`        |
| `ARBITER_LOG_LEVEL`   | `error\|warn\|info\|debug\|trace` | `info`        | Minimum log level. CLI `--log-level` flag takes precedence. Invalid values fall back to `info` with a stderr warning.                                                      | `src/utils/logger-config.ts` |
| `ARBITER_LOG_FORMAT`  | `text\|json`                      | `text`        | Log output format. `json` emits newline-delimited JSON objects. CLI `--log-format` flag takes precedence.                                                                  | `src/utils/logger-config.ts` |
| `ARBITER_NO_EVIDENCE` | `1`                               | —             | Suppress evidence-file writing for the current run. Equivalent to the `--no-evidence` CLI flag.                                                                            | `src/cli.ts`                 |
| `ARBITER_LOCALE`      | BCP-47 locale string              | auto-detected | Override the locale used for UI messages. Falls back to `LC_ALL`, `LC_MESSAGES`, `LANG`, then `en`.                                                                        | `src/i18n/index.ts`          |

**Example — structured log output with a stable trace ID:**

```bash
export ARBITER_RUN_ID=arb-20240101-120000-abcd
ARBITER_LOG_FORMAT=json ARBITER_LOG_LEVEL=debug arbiter task advance --to green
```

### Task lifecycle

| Variable                   | Format | Default | Purpose                                                                                                                                                                 | Read in                                                                    |
| -------------------------- | ------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `ARBITER_SKIP_PLAN_REVIEW` | `1`    | —       | Bypass the plan-review gate and write an audit bypass record. **Refused under CI** (`CI=true`). Use `--skip-plan-review` flag instead when possible.                    | `src/commands/task.ts`                                                     |
| `ARBITER_PLAN_BYPASS`      | `1`    | —       | Bypass the pre-edit plan-anchor hook (CANON-14). Allows edits in implementation phases without a valid `.task-plan` pointer. For emergency use only — bypass is logged. | `.claude/hooks/pre-edit-plan-anchor.mjs`                                   |
| `ARBITER_POST_CLEAR`       | `1`    | —       | Signal that this invocation is a post-`/clear` re-entry. Equivalent to the `--post-clear` CLI flag; controls the task handoff strategy.                                 | `src/commands/task.ts`                                                     |
| `ARBITER_SKIP_GATE_MARKER` | `1`    | —       | Bypass the current `gate-pass.json` requirement for task phase transitions and the pre-PR hook. **Refused under CI** (`CI=true`).                                       | `src/commands/task.ts`, `packages/kernel/hooks/enforce-gate-before-pr.mjs` |

**Example — bypass plan-review in a local one-off run:**

```bash
ARBITER_SKIP_PLAN_REVIEW=1 arbiter task advance --to red
```

### Worktrees

| Variable                | Format        | Default                                | Purpose                                                                                                                             | Read in                    |
| ----------------------- | ------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `ARBITER_WORKTREES_DIR` | absolute path | `<repo-parent>/<repo-name>.worktrees/` | Override the base directory where `arbiter worktree open` creates worktrees. Takes precedence over `arbiter.json` `worktrees.base`. | `src/commands/worktree.ts` |

**Example:**

```bash
ARBITER_WORKTREES_DIR=/scratch/wt arbiter worktree open 42
```

### Compatibility probing

| Variable                          | Format                | Default | Purpose                                                                                                                                                                 | Read in                          |
| --------------------------------- | --------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `ARBITER_PROBE_TIMEOUT_MS`        | positive integer (ms) | `10000` | Per-tool probe timeout. Increase in slow environments (e.g. network-mounted tool paths).                                                                                | `src/compatibility/probe.ts`     |
| `ARBITER_BUILD_PROBE_TIMEOUT_MS`  | positive integer (ms) | `60000` | Build-step probe timeout. Build probes invoke the project build tool, which may take longer than a version check.                                                       | `src/compatibility/probe.ts`     |
| `ARBITER_ALLOW_CHANNEL_DOWNGRADE` | `1`                   | —       | Allow channel downgrade without an interactive TTY prompt. In non-TTY environments (CI, pipes) the downgrade exits 1 by default; set this to proceed non-interactively. | `src/utils/confirm-downgrade.ts` |

### Pre-push gate

The `.githooks/pre-push` hook (and its scaffolded twin in `src/templates/githooks/pre-push.ejs`) runs an evidence-freshness check before the L2 gate. If `.arbiter/evidence/` has no file newer than `ARBITER_PREPUSH_MAX_AGE_MIN` minutes (default 240, i.e. 4 hours), the push is blocked. The classifier in `scripts/ci-classify-changes.mjs` is consulted with `BASE_SHA=@{u}` (or `origin/main`) and `HEAD_SHA=HEAD`: if it reports `docs_only=true` or both `backend_changed=false` and `high_risk=false`, the gate downgrades to a warning so docs / chore branches aren't penalised. Missing or empty evidence directories are silently skipped — first-time pushers are never blocked.

| Variable                        | Format          | Default             | Purpose                                                                                                                                                                                                                                                                           | Read in                                                     |
| ------------------------------- | --------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `ARBITER_PREPUSH_MAX_AGE_MIN`   | integer minutes | `240`               | Maximum age of the newest file under `.arbiter/evidence/`. Pushes whose freshest evidence is older than this are blocked unless the classifier downgrades to warn-only or the bypass env is set.                                                                                  | `.githooks/pre-push`, `src/templates/githooks/pre-push.ejs` |
| `ARBITER_PREPUSH_BYPASS`        | exact `true`    | —                   | Bypass the freshness gate. **Exact string match only** — `1`, `yes`, `TRUE`, etc. emit an "ambiguous value" warning and the gate still runs. On bypass the hook emits a loud `arbiter-bypass …` line on stderr and appends a JSONL entry to `.arbiter/evidence/bypass-log.jsonl`. | `.githooks/pre-push`, `src/templates/githooks/pre-push.ejs` |
| `ARBITER_PREPUSH_BYPASS_REASON` | free-form text  | —                   | Free-form justification recorded in the loud-bypass JSONL line. Defaults to `unspecified` when absent.                                                                                                                                                                            | `.githooks/pre-push`, `src/templates/githooks/pre-push.ejs` |
| `ARBITER_PREPUSH_SKIP`          | exact `true`    | —                   | Skip the freshness gate entirely (no warning, no log). Reserved for nested hook recursion and the freshness-gate test harness — do not set in normal workflow.                                                                                                                    | `.githooks/pre-push`, `src/templates/githooks/pre-push.ejs` |
| `ARBITER_PREPUSH_EVIDENCE_DIR`  | path            | `.arbiter/evidence` | Override the evidence directory the gate inspects. Useful when the host project relocates `.arbiter/`.                                                                                                                                                                            | `.githooks/pre-push`, `src/templates/githooks/pre-push.ejs` |

**Example — refresh evidence locally to clear a blocked push:**

```bash
node scripts/check-all.mjs L2 --json .arbiter/gate/local-result.json
git push                       # gate now sees fresh evidence
```

**Example — emergency force-push with audited bypass:**

```bash
ARBITER_PREPUSH_BYPASS=true \
ARBITER_PREPUSH_BYPASS_REASON="rev-lock break, see #971" \
  git push
# stderr: arbiter-bypass env=ARBITER_PREPUSH_BYPASS branch=… at=… reason="rev-lock break, see #971"
# .arbiter/evidence/bypass-log.jsonl appended with the same fields
```

### Config overrides

These variables overlay values from `arbiter.json` at startup. The env layer never turns a valid config into an invalid one — unknown keys and malformed values are silently ignored.

| Variable                     | Format     | Purpose                                                                                                                                                                                                                                                                                              | Read in                       |
| ---------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `ARBITER_THRESHOLD__<FIELD>` | numeric    | Override a threshold field. `<FIELD>` is the SCREAMING_SNAKE_CASE form of the camelCase key in `arbiter.json` `thresholds` (e.g. `ARBITER_THRESHOLD__LINE_COVERAGE=80`). Valid fields: `LINE_COVERAGE`, `BRANCH_COVERAGE`, `MUTATION_SCORE`, `CYCLOMATIC_COMPLEXITY`, `METHOD_LENGTH`, `MAX_PARAMS`. | `src/config/env-overrides.ts` |
| `ARBITER_FEATURE__<FLAG>`    | `1` or `0` | Override a feature flag. `<FLAG>` is the SCREAMING_SNAKE_CASE form of the camelCase key in `arbiter.json` `features` (e.g. `ARBITER_FEATURE__MUTATION_TESTING=1`). Valid flags: `CONTRACT_TESTING`, `MUTATION_TESTING`, `SECURITY_SCANNING`, `EVIDENCE_HARNESS`, `DEBT_GATES`, `SUPPRESSIONS`.       | `src/config/env-overrides.ts` |

**Example — CI matrix with different thresholds per job:**

```bash
# Job A: strict
ARBITER_THRESHOLD__LINE_COVERAGE=90 ARBITER_THRESHOLD__BRANCH_COVERAGE=85 arbiter check

# Job B: relax mutation score during incremental work
ARBITER_THRESHOLD__MUTATION_SCORE=60 arbiter check
```

---

## Stability

All symbols in these entry points follow semantic versioning. Breaking changes require a major version bump. Internal modules (`src/invariants/*.ts`, `src/compatibility/*.ts` individually) are not part of the public API and may change in any release.
