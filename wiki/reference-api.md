---
generated: true
source: 'docs/REFERENCE/api.md'
source_sha: '9ee0a181bfdc490c8ff53ed42da6a4f6d2cc60ba'
last_updated: '2026-07-03'
---

# Public API Reference

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/api.md](../docs/REFERENCE/api.md)

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
| `ARBITER_SEED`        | string                            | —             | Reproducibility seed passed to stochastic subsystems. Equivalent to the `--seed` CLI flag; the flag writes this variable so downstream subprocesses inherit the same seed. | `src/cli.ts`                 |
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

| Variable                       | Format | Default | Purpose                                                                                                                                                                 | Read in                                  |
| ------------------------------ | ------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `ARBITER_SKIP_PLAN_REVIEW`     | `1`    | —       | Bypass the plan-review gate and write an audit bypass record. **Refused under CI** (`CI=true`). Use `--skip-plan-review` flag instead when possible.                    | `src/commands/task.ts`                   |
| `ARBITER_PLAN_REVIEW_OPTIONAL` | `1`    | —       | Treat a missing `claude` CLI binary as a PASS verdict instead of FAIL. Useful in environments where the review tool is not installed.                                   | `src/review/dispatch.ts`                 |
| `ARBITER_PLAN_BYPASS`          | `1`    | —       | Bypass the pre-edit plan-anchor hook (CANON-14). Allows edits in implementation phases without a valid `.task-plan` pointer. For emergency use only — bypass is logged. | `.claude/hooks/pre-edit-plan-anchor.mjs` |
| `ARBITER_COST_BUDGET_SKIP`     | `1`    | —       | Skip the first-phase token budget assertion. Use when context is known-clean post-`/clear`.                                                                             | `src/commands/task.ts`               

*[content truncated — see source for full text]*
