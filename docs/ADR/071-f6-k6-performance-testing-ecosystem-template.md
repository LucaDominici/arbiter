---
title: 'ADR-071: F6 — k6 performance testing ecosystem template (#895)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-31'
owner: ''
canonical_id: '071'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-071: F6 — k6 performance testing ecosystem template (#895)

**Date:** 2026-05-20
**Status:** Accepted
**Reference:** Issue #895

**Context:** F2-java (#889) and W10 (#886) shipped tooling for extended CI tiers including soak and endurance testing categories. A dedicated k6 ecosystem template was needed to cover systematic performance testing across load profiles (load, stress, spike, soak, volume, breakpoint, smoke, ramp-up, ramp-down, steady-state, burst, endurance).

**Decision:**

- `src/generators/perf-k6.ts` (new): generator emitting the full k6 ecosystem, gated on `enablePerfTesting?: boolean` in `ProjectConfig`. All 19 output files use `skipIfExists` for brownfield safety.
- `src/templates/github/workflows/11-k6-on-demand.yml.ejs`: `workflow_dispatch`-triggered dispatcher that delegates to the reusable runner. Slot 11 chosen because slot 10 is occupied by `10-deploy-prod.yml.ejs` (F10, #899).
- `src/templates/github/workflows/_k6-runner.yml.ejs`: reusable workflow (`workflow_call`) that installs k6, validates scenarios, runs them, generates HTML report, and uploads artifacts.
- 12 named scenario templates under `src/templates/perf/k6/scenarios/`: each exports `options` + `export default function` (k6's required entry point) and imports from `k6`.
- 3 Python report generators under `src/templates/perf/k6/reports/`: HTML (with Jinja2-style template), JSON (aggregated summary), CSV (flat tabular).
- `src/templates/perf/k6/seed/test-data.sql.ejs`: PostgreSQL seed SQL using `generate_series` to create realistic test data volumes.
- `src/templates/scripts/validate-k6-scenarios.mjs.ejs`: scenario completeness validator checking for required entry point, k6 import, and `options` export.

**CANON-04:** 54 render tests added in `__tests__/templates/k6-render.test.ts`. **CANON-05:** Generator unit tests in `__tests__/generators/perf-k6.test.ts`. **CANON-11:** Brownfield tests in `__tests__/brownfield/perf-k6-brownfield.test.ts`. **CANON-16 survey:** Grepped `src/generators/` and `src/templates/` for `k6`/`perf` — nothing similar exists; new files justified.

**Consequences:** Projects opting in via `enablePerfTesting: true` get a complete k6 perf ecosystem on `arbiter init`. Existing projects (brownfield re-init) are unaffected due to `skipIfExists`.

## ADR-072: Loud-bypass contract library (Workstream C Port #10, #970)

**Date:** 2026-05-20
**Status:** Accepted
**Reference:** Issue #970, Workstream C Port #10

**Context:** Multiple upcoming gates (`ARBITER_PREPUSH_BYPASS` in Port #4, `ARBITER_GATE_BYPASS` for `scripts/check-all.mjs`) need a shared, deterministic, and deliberately loud env-var bypass contract. Without a shared library each gate would re-implement the contract slightly differently — a known source of silent-bypass bugs and inconsistent log shapes.

**Decision:**

- `scripts/lib/loud-bypass.mjs` (Level A only): exports `checkBypass(envName, opts)`. Returns `{ bypassed: true, reason, branch, ts }` ONLY when the env value is the **exact string** `'true'`. On any other non-empty value (`'1'`, `'yes'`, `'TRUE'`, `'on'`, ...) emits a loud stderr warning, returns `{ bypassed: false }`, and **never exits non-zero** (RED-TEAM B2 amendment: typo'd env vars must not brick the gate). On unset or `''`, the function is silent.
- `scripts/lib/log-bypass.mjs`: tiny CLI wrapper (`node scripts/lib/log-bypass.mjs <ENV> [reason]`) for use from shell hooks; always exits 0.
- Stderr format (RED-TEAM N6): `arbiter-bypass env=<NAME> branch=<BRANCH> at=<ISO_TS> reason="<REASON>"` — deliberately key=value with the `arbiter-bypass` token, **must not** match any other tooling's `[BYPASS]` bracketed convention.
- JSONL audit log: every non-silent invocation appends one line to `.arbiter/evidence/bypass-log.jsonl` with `{env, branch, ts, value, bypassed, reason}`.

**Legacy contracts NOT migrated:** Existing `ARBITER_SKIP_TDD=1`, `ARBITER_PLAN_BYPASS=1`, `ARBITER_SSOT_BYPASS=1`, and `ARBITER_SKIP_GATE_MARKER=1` consumers retain their numeric-truthy semantics. They are grandfathered to preserve documented user-facing contracts. The new library applies to NEW env vars only.

**Pre-audit grep recorded:**

```
scripts/check-tdd-evidence.mjs:  const envSkip = process.env.ARBITER_SKIP_TDD === '1'
scripts/visual-verify.mjs:const forcePWSkip = process.env.PLAYWRIGHT_SKIP === '1'
src/templates/claude/hooks/enforce-gate-before-pr.mjs:if (process.env.ARBITER_SKIP_GATE_MARKER === '1') {
src/templates/claude/hooks/pre-edit-ssot-guard.mjs:if (process.env.ARBITER_SSOT_BYPASS === '1') process.exit(0)
src/templates/claude/hooks/pre-edit-plan-anchor.mjs.ejs:if (process.env.ARBITER_PLAN_BYPASS === '1') process.exit(0);
```

Identical pre/post audit confirms no legacy migration.

**CANON-16 survey:** Closest existing utility is `scripts/lib/run-helpers.mjs` (gate runner trinity). Distinct responsibility — that one wraps `spawnSync` for gate steps, this one handles env-var bypass contracts for downstream consumers. Refactor not viable. New file justified.

**Tests:** `__tests__/scripts/lib/loud-bypass.test.ts` — 17 cases including table-driven coverage of `'true'`, `'1'`, `'yes'`, `'TRUE'`, `'on'`, `'false'`, `''`, undefined; structured bypass detail; ambiguous detail (exit 0 + warn); silent unset; defensive auto-mkdir; legacy-env non-consumption; CLI wrapper bypass/ambiguous/unset/usage cases. Negative assertion `expect(stderr).not.toMatch(/\[BYPASS\]/)` enforces format divergence.

**Consequences:** Future bypass-gate authors call `checkBypass('ARBITER_FOO_BYPASS')`; shell-side authors call `node scripts/lib/log-bypass.mjs`. Both share the same loud audit trail. First consumer lands in Workstream C Port #4 (pre-push evidence-freshness gate).
