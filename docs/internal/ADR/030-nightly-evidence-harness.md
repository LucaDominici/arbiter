---
title: 'ADR-030 — Nightly Pipeline & Evidence Harness'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: '030'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-030 — Nightly Pipeline & Evidence Harness

**Status:** Accepted
**Date:** 2026-04-17
**Issue:** #73 (M25)

## Context

L3 governance requires deep validation that cannot run on the PR critical path:

- Mutation testing (Stryker/PIT/cargo-mutants/mutmut) takes minutes to hours
- E2E full suites hit external services and cannot be parallelised cheaply
- Trivy deep scans (filesystem + config) are slower than the Trivy image scan in CI
- Load tests (k6) require a running service

Placing these on every PR would push merge latency above 30 minutes — unacceptable for developer flow. The solution is a nightly cron pipeline that produces machine-checkable evidence (`SUMMARY.json`) which the PR gate then reads.

## Decisions

### 1. Mutation moves from check-all.mjs to nightly.yml (unwinds ADR-029 §mutation-in-L2-gate)

ADR-029 placed mutation inside `check-all.mjs` at the L3 block. This was incorrect — mutation is too slow for a pre-commit or pre-push gate. M25 removes mutation from `check-all.mjs` entirely (all levels) and places it in `nightly.yml.ejs`. Tests in `__tests__/matrix/*.test.ts` were updated to assert absence from check-all rather than presence.

### 2. Real k6 wiring (not a stub)

The load-test job in `nightly.yml` runs `k6 run <%= k6ScriptPath %>` against a configurable script path (default `tests/load/default.js`). A stub that always exits 0 would provide false confidence. The tradeoff is that teams must provide a k6 script; projects that lack one will see a failing load-test job until they add one.

### 3. SUMMARY.json schema

```json
{
  "obs_gate": "PASS" | "FAIL",
  "timestamp": "<ISO8601>",
  "commit": "<sha>",
  "duration_seconds": 0,
  "tests": { "total": 0, "passed": 0, "failed": 0, "skipped": 0 },
  "coverage": { "line": 0.0, "branch": 0.0 },
  "mutation": { "score": 0.0, "threshold": 0.8 },
  "security": { "critical": 0, "high": 0 }
}
```

`obs_gate = PASS` requires: `tests.failed == 0`, `coverage.line >= threshold`, `mutation.score >= threshold`, `security.critical == 0`.

The schema is intentionally minimal. Future fields (archetype, retention, environment) can be added without breaking existing consumers because `check-all.mjs` only reads `obs_gate`.

### 4. Evidence gate is hard (INV-33) but warns when absent

`check-all.mjs` L3 block reads `.evidence/SUMMARY.json`:

- **Absent** → `WARN` (first run; nightly has not yet executed)
- **Present, `obs_gate != PASS`** → `FAIL` (hard gate)

This avoids blocking L3 bootstrapping (day-zero has no evidence) while still enforcing the gate once the nightly has run.

### 5. Change detection is advisory only

The `classify-changes` job writes `docs_only`, `backend_changed`, `frontend_changed`, `infra_changed`, `high_risk` flags to `$GITHUB_OUTPUT`. The `lint-and-test` job at L3 conditions on `docs_only != true`. However, classifier failure (script error) does **not** block merge — the `ci-required` job only checks `lint-and-test.result`, not `classify-changes.result`. A broken classifier degrades optimization but never blocks a valid merge.

### 6. Go has no mutation job in nightly

Go mutation tooling (`go-mutesting`) is experimental and produces unstable results. The nightly `evidence-collect` job excludes mutation score from the Go obs_gate calculation rather than hardcoding a failure. The `needs` list in the evidence-collect job skips the mutation job for Go.

### 7. INV-33 added to catalog; INV-91 dangling reference fixed

`INV-33` (tier: governance, alwaysActive: true, minGovernanceLevel: L3) enforces that L3 merges require valid evidence. A dangling `(INV-91)` reference in `evidence-rotate.mjs.ejs` was corrected to `(#91)` (GitHub issue reference, not an invariant ID).

## Consequences

- L3 projects generate 4 new files: `nightly.yml`, `evidence-collect.mjs`, `ci-classify-changes.mjs`, `.evidence/.gitkeep`
- L1/L2 projects generate none of these files
- All 5 language stacks × L3 verified by `__tests__/matrix/cross-product.test.ts`
- check-all.mjs no longer contains any mutation logic at any level
- ci.yml at L3 includes `classify-changes` job and conditionally skips `lint-and-test` for docs-only PRs
