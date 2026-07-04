---
title: 'ADR-015: Debt Ratchet — Baseline-Anchored Regression Prevention'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: '015'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-015: Debt Ratchet — Baseline-Anchored Regression Prevention

**Status:** Superseded by ADR-022
**Date:** 2026-04-08
**Deciders:** Luca Dominici

## Context

M15 added fixed-threshold tech debt gates (coverage ≥ 80%, complexity limits, dead code detection) across all 5 stacks. These thresholds prevent below-minimum quality but have a critical blind spot: a project at 92% coverage can decay to 80% without triggering any gate, because the fixed floor is 80%.

The novel requirement for M16 (issue #43, Layer C) was to design a proactive tech debt detection system that doesn't exist in the prior-art baseline or comparable tools. The key insight: thresholds enforce a floor, but users need a **ratchet** — a mechanism that locks in improvements and prevents backsliding relative to the project's own historical baseline.

## Decision

Implement a **debt ratchet** as two generated scripts in `scripts/`:

### `capture-debt-baseline.mjs`

Captures current debt metrics into `debt-baseline.json` (committed to version control, like a lockfile):

```json
{
  "version": 1,
  "capturedAt": "ISO timestamp",
  "commit": "git SHA",
  "metrics": {
    "coverage": {
      "value": 87.3,
      "unit": "percent",
      "direction": "higher-is-better"
    },
    "complexityViolations": {
      "value": 2,
      "unit": "count",
      "direction": "lower-is-better"
    },
    "deadCode": { "value": 5, "unit": "count", "direction": "lower-is-better" },
    "todoCount": {
      "value": 12,
      "unit": "count",
      "direction": "lower-is-better"
    }
  }
}
```

Supports `--update` flag: one-way tightening only (never loosens the baseline, safe to run after genuine improvements).

### `debt-report.mjs`

Compares current metrics against `debt-baseline.json`. Outputs a markdown table showing baseline vs current vs delta. Gate modes:

- `--gate`: exits non-zero if any metric regressed (used at L2)
- `--require-improvement`: exits non-zero if no metric improved (used at L3)
- No flags: report-only, always exits 0

If `debt-baseline.json` is absent, the script exits 0 with an informational message (no false failures on fresh repos).

### Integration

- **L2 gate** (`check-all.mjs L2`): calls `node scripts/debt-report.mjs --gate`
- **L3 gate** (`check-all.mjs L2`): calls `node scripts/debt-report.mjs --require-improvement`
- **CI**: `debt-ratchet` job in `ci.yml` runs after `lint-and-test`, included in `ci-required` aggregation
- **AGENTS.md**: Debt Ratchet section documents commands and the one-way ratchet rule

## Alternatives Considered

**1. Scheduled audit agent** — runs periodically to detect drift. Rejected: adds complexity, introduces CI timing issues, hard to integrate as a blocking gate.

**2. Percentage-based decay limits** — "coverage cannot drop more than 5%." Rejected: allows bounded regression, normalizes decay.

**3. External debt tracking service** — Sonarsource-style. Rejected: external dependency, not generated, requires account setup.

**4. Single combined script** — capture + report in one file. Rejected: separation of concerns. Capture writes state; report reads state. Running the gate should not modify the baseline.

## Key Design Decisions

| Decision                       | Rationale                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| JSON baseline (not text)       | Machine-parseable for ratchet comparison; `direction` field makes logic generic    |
| `--update` one-way ratchet     | Prevents accidental loosening; safe to run anytime after improvements              |
| Two scripts (capture + report) | No shared runtime state; separation of concerns                                    |
| Reuse `enableDebtGates` flag   | Ratchet is a natural extension of debt gates; no new config field                  |
| Stack-agnostic interface       | Same EJS conditionals pattern as existing templates; generated once, runs anywhere |
| L3 requires improvement        | Mirrors the escalation pattern: L2 prevents regression, L3 mandates progress       |

## Consequences

**Positive:**

- Projects at 92% coverage can't regress to 80% without a failing gate — the ratchet locks in the actual project baseline, not an arbitrary floor
- The `--update` workflow makes tightening the baseline explicit and intentional
- Stack-agnostic design works identically across all 5 stacks
- Baseline JSON is versioned with the code — ratchet history is tracked in git

**Negative:**

- First `git init` + arbiter init requires a conscious baseline capture step
- Baseline can become stale if metrics tools are not installed (fails gracefully but silently ignores that stack's metric)
- Metric duplication between capture and report scripts (EJS templates cannot share code across rendered files)
