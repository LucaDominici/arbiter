---
name: configure
description: Use when the user wants to change arbiter.json settings (governance level, feature flags, thresholds) without re-running the full wizard.
title: 'Arbiter Configure'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# Arbiter Configure

Modify `arbiter.json` configuration fields without re-running `arbiter init`.

## Supported Paths

**Feature flags** (`true` / `false`):

- `features.debtGates`
- `features.securityScanning`
- `features.mutationTesting`
- `features.contractTesting`
- `features.suppressions`
- `features.evidenceHarness`

**AI tools** (comma-separated list: `claude`, `codex`):

- `tools`

**Thresholds** (numbers):

- `thresholds.lineCoverage` (1–100)
- `thresholds.branchCoverage` (1–100)
- `thresholds.mutationScore` (1–100)
- `thresholds.cyclomaticComplexity` (positive)
- `thresholds.methodLength` (positive)
- `thresholds.maxParams` (positive)

## Workflow

1. Ask the user which setting they want to change and the new value.
2. Run the configure command:

```bash
bun run arbiter configure --set <path>=<value>
```

3. If the change affects generated files, offer to run `arbiter update`:

```bash
bun run arbiter update
```

## Examples

```bash
# Disable mutation testing
bun run arbiter configure --set features.mutationTesting=false

# Raise line coverage target
bun run arbiter configure --set thresholds.lineCoverage=90

# Multiple changes at once
bun run arbiter configure --set features.debtGates=true --set thresholds.cyclomaticComplexity=10

# Change AI tools
bun run arbiter configure --set tools=claude,cursor
```

## Current Config

Read the current `arbiter.json` to show the user the current values before asking what to change.
