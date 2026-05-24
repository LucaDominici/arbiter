---
title: 'Migration: config versioning (`v0` / `v0.1` → `v0.2`)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/migration']
related: []
---

# Migration: config versioning (`v0` / `v0.1` → `v0.2`)

Issue: #231

## Version map

| Version string | Era | Description                                                                     |
| -------------- | --- | ------------------------------------------------------------------------------- |
| _(none)_       | v0  | Pre-versioning: no `version` field in `arbiter.json`                            |
| `"0.1"`        | v1  | Flat-flag era: `enableDebtGates`, `enableSecurityScanning`, `evidenceRetention` |
| `"0.2"`        | v2  | Current canonical format: `features` object, `thresholds` object                |

## What changed

`arbiter.json` was restructured in v0.2:

- Flat boolean flags (`enableDebtGates`, `enableSecurityScanning`, `enableSuppressions`)
  are replaced by a single `features` object.
- Threshold values are grouped in a `thresholds` object.
- `evidenceRetention.enabled` is replaced by `features.evidenceHarness`.
- `contractType` presence drives `features.contractTesting` automatically.
- `decomposition.backend` is derived from `useGitHub` when absent.

## Automatic migration

`arbiter` silently migrates any `arbiter.json` to v0.2 on load. No manual steps are
required for most projects.

Migration chain:

```
v0 (no version)  →  stamp version: "0.1"  →  v1
v1 ("0.1")       →  derive features + thresholds  →  v2 ("0.2")
v2 ("0.2")       →  validate + apply decomposition alias  →  unchanged
```

The migration is idempotent: running it multiple times on the same input produces
an identical result.

## Manual migration (v1 → v2)

If you prefer to upgrade `arbiter.json` by hand:

**Before (v1):**

```json
{
  "version": "0.1",
  "tools": ["claude"],
  "governanceLevel": "L2",
  "useGitHub": false,
  "enableDebtGates": true,
  "enableSecurityScanning": true,
  "contractType": "none",
  "evidenceRetention": { "enabled": false, "retentionDays": 30 }
}
```

**After (v2):**

```json
{
  "version": "0.2",
  "tools": ["claude"],
  "governanceLevel": "L2",
  "useGitHub": false,
  "decomposition": { "backend": "markdown" },
  "features": {
    "contractTesting": false,
    "mutationTesting": true,
    "securityScanning": true,
    "evidenceHarness": false,
    "debtGates": true,
    "suppressions": true
  },
  "thresholds": {
    "lineCoverage": 80,
    "branchCoverage": 70,
    "mutationScore": 80,
    "cyclomaticComplexity": 15,
    "methodLength": 65,
    "maxParams": 7
  }
}
```

## Feature flag derivation rules (v1 → v2)

| Feature flag       | Source (in priority order)                                                    |
| ------------------ | ----------------------------------------------------------------------------- |
| `debtGates`        | `enableDebtGates` if present; else `true` for L2/L3, `false` for L1           |
| `securityScanning` | `enableSecurityScanning` if present; else `true` for L2/L3, `false` for L1    |
| `suppressions`     | `enableSuppressions` if present; else always `true`                           |
| `mutationTesting`  | `true` for L2/L3, `false` for L1                                              |
| `contractTesting`  | `true` when `contractType` is not `"none"` and not absent                     |
| `evidenceHarness`  | `evidenceRetention.enabled` if present; else `true` for L3, `false` otherwise |

## Threshold defaults

Default thresholds are set from `DEFAULT_THRESHOLDS[governanceLevel]`:

| Threshold              | L1  | L2  | L3  |
| ---------------------- | --- | --- | --- |
| `lineCoverage`         | 60  | 80  | 85  |
| `branchCoverage`       | 50  | 70  | 80  |
| `mutationScore`        | 70  | 80  | 85  |
| `cyclomaticComplexity` | 20  | 15  | 10  |
| `methodLength`         | 100 | 65  | 40  |
| `maxParams`            | 8   | 7   | 5   |

## Legacy flags stripped on migration

The following fields are removed from the output object during v1 → v2 migration
(their values are consumed to derive the `features` object):

- `enableDebtGates`
- `enableSecurityScanning`
- `enableSuppressions`

All other v1 fields (e.g. `archetype`, `architectureStyle`, `isMultiTenant`,
`hasDatabase`, `hasPublicApi`, `graceEndsAt`, `invariantTiers`, `lanes`) are
carried through verbatim.

## Casing normalization for `governanceLevel`

`arbiter.json` files with a lowercase `governanceLevel` (e.g. `"l3"`) are
automatically normalized to uppercase (`"L3"`) during validation. The on-disk
file is not rewritten; normalization happens in-memory at load time.

## Scaffold dependency injection

When `arbiter init` generates TypeScript scaffold files that import third-party
packages, it injects the required dependencies into the project's `package.json`
automatically:

| Scaffold                                         | Injected dep                              | Kind         |
| ------------------------------------------------ | ----------------------------------------- | ------------ |
| Express middleware (public-api archetypes)       | `express ^5.1.0`, `@types/express ^5.0.3` | dep + devDep |
| Pact consumer test (rest-owned contract testing) | `@pact-foundation/pact ^16.4.0`           | devDep       |

Existing pinned versions are never overwritten.

## Thresholds auto-fill

When a v0.2 `arbiter.json` is loaded without a `thresholds` object, `validateConfig` automatically
populates it from `DEFAULT_THRESHOLDS[governanceLevel]` before validation runs. No manual steps are
required and no error is emitted; the field is treated as optional for convenience.

This only applies when `thresholds` is entirely absent. Partial threshold objects (missing individual
keys) still fail validation normally — they must be complete or absent.

## Language confirmation in `arbiter init`

The `arbiter init` wizard now shows a language confirmation prompt as its first question. The
auto-detected language is pre-selected; you can scroll to override it before continuing. The chosen
language is reflected in all generated scaffold files.
