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
| `INVARIANT_CATALOG`               | `Invariant[]` | Complete invariant catalog (all 61+ entries)                               |
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

## Stability

All symbols in these entry points follow semantic versioning. Breaking changes require a major version bump. Internal modules (`src/invariants/*.ts`, `src/compatibility/*.ts` individually) are not part of the public API and may change in any release.
