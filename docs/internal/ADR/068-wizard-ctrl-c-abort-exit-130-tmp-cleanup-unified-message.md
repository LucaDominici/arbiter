---
title: 'ADR-068: Wizard Ctrl+C abort — exit 130, tmp cleanup, unified message (#621)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-31'
owner: ''
canonical_id: '068'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-068: Wizard Ctrl+C abort — exit 130, tmp cleanup, unified message (#621)

**Date:** 2026-05-17
**Status:** Accepted
**Reference:** Issue #621

**Context:** Pressing Ctrl+C during `arbiter init` produced inconsistent behaviour: inquirer raised `ExitPromptError`, `runWizard` logged `Cancelled.` via the internal `log` helper (invisible in non-TTY), and the process exited 0 (success). Any in-flight `.arbiter-tmp-*` files written before the interrupt were left on disk.

**Decision:**

- `runWizard` catch block in `src/wizard/prompts.ts` now calls `cleanupInFlightTmpFiles()` before returning, then sets `process.exitCode = 130` and prints `\n  Aborted — no changes made.\n` to stdout. This is the single authoritative abort path for `ExitPromptError` and its variants (detected via the existing `isUserCancellation()` helper).
- `cleanupInFlightTmpFiles()` promoted from an internal helper to a public export in `src/utils/fs.ts`. The existing `doCleanup()` internal function is reused; `registerCleanupHandlers()` continues to call it directly for raw SIGTERM/SIGINT (non-TTY path, where inquirer never fires).
- The duplicate `log('\n  Cancelled.\n')` call that was in `src/commands/init.ts` is removed. The normal "No" path (user declines the confirm prompt) prints `\n  Cancelled.\n` via `console.log` directly in `prompts.ts` for consistency.
- Exit code 130 follows the POSIX convention for SIGINT termination (`128 + 2`). `process.exitCode` (not `process.exit(130)`) is used so the async unwind completes before Node exits.
- L4 file lock release (`TODO(#614)`) deferred: a placeholder comment marks the intended call site.

**CANON-16 survey:** `isUserCancellation()` (prompts.ts:172) and `doCleanup()` (fs.ts) existed and were reused. No new source files added.

**Consequences:** `arbiter init` Ctrl+C now exits 130, prints a clear message, and leaves no orphan tmp files regardless of when in the wizard flow the interrupt fires.

## ADR-069: Action pin parity — dependabot bypass fix (#911)

**Date:** 2026-05-19
**Status:** Accepted
**Reference:** Issue #911

**Context:** `dependabot[github-actions]` bumps action version pins in `.github/workflows/*.yml` only. EJS source templates at `src/templates/github/workflows/*.yml.ejs` are the downstream SSOT but are invisible to dependabot. `__tests__/parity/ci-tier-render-parity.test.ts` asserts that committed yml equals `renderTemplate(ejs, fixture)`, so any dependabot action-bump PR fails Unit Tests and Tech Debt Gates (both run vitest) plus CI Required in cascade. All 4 open github-actions PRs (#905–#908) were blocked by this.

**Decision:**

- `scripts/sync-action-pins.mjs` (new, selfOnly): for each `.github/workflows/<x>.yml` ↔ `src/templates/github/workflows/<x>.yml.ejs` pair, extracts `uses: <action>@<version>` pins from the yml and text-substitutes them into the EJS. Modes: write (EJS ← yml, default), `--check` (read-only, exit 1 on drift), `--reverse` (yml ← EJS, for human SSOT-first edits).
- `scripts/check-all.mjs` L1: adds `runCheck('action pin parity', 'node', ['scripts/sync-action-pins.mjs', '--check'])`. Belt-and-suspenders with the vitest parity test; provides faster local signal and catches human-side drift too.
- `.github/workflows/dependabot-actions-sync.yml` (new, arbiter-self-only): triggered on `pull_request` paths `.github/workflows/**` from `dependabot[bot]` with `github_actions/*` head. Runs sync script; commits changed EJS back to the PR branch so parity test passes on the re-triggered run.
- Runbook at `docs/RUNBOOKS/dependabot-handling.md`: protocol for triage, rebase, and the required manual `approved-by-human` label (INV-74 stays — dependabot auto-merge is out of scope).

**CANON-16 survey:** No existing yml↔EJS sync utility found (`scripts/sync-*.mjs` cover changelog and governance copy; unrelated). New file justified. No EJS templates created or edited — workflow file written directly as YAML (arbiter-self-only, not emitted for downstream projects, so CANON-01/CANON-04/CANON-18 do not apply).

**Sync direction rationale:** yml is the ground truth for what runs in CI (dependabot edits it directly). EJS is the derivable artifact for downstream. Sync direction yml → EJS means the EJS always tracks what CI actually runs.

**Consequences:** Dependabot github-actions PRs auto-fix their own EJS divergence on the first CI run after the new workflow merges. Human approval (INV-74) remains required for merge. The L1 gate catches any future human-side drift before commit.

## ADR-070: Toolchain audit generator — W11 evidence bundle (#887)

**Date:** 2026-05-20
**Status:** Accepted
**Reference:** Issue #887, umbrella #875

**Context:** W11 closes the planning-skeleton migration (W1–W11). The deliverable is a self-validating audit script that proves the toolchain is intact: CI workflow files exist, gate scripts exist, build toolchain is defined. This is Track A (arbiter-self) + Track B (target projects via EJS generator).

**Decision:**

- `scripts/audit-toolchain.mjs` (Track A): arbiter-self version, always passes on the arbiter repo.
- `src/templates/scripts/audit-toolchain.mjs.ejs` (Track B): EJS template emitted to target projects via `arbiter init`/`arbiter update`.
- `src/generators/audit-toolchain.ts`: generator function (CANON-05); always enabled; added to registry.
- `src/config/diff.ts`: `GeneratorKey` union extended with `'audit-toolchain'`.
- Dogfood: `src/templates/scripts/` is NOT in scope for `check-self-dogfood.mjs` (which only covers `src/templates/claude/`), so no dogfood divergence entry is needed.

**CANON-16 survey:** `self-validation.ts` is the closest neighbor (A/B/C drill harness). Distinct responsibility: inventory audit vs. drill harness. No refactor viable. New file justified.

**Consequences:** Target projects generated at any level (L1/L2/L3) receive `audit-toolchain.mjs`. Template tests baseline updated 147→145 (2 fewer untested EJS files).

## ADR-071: F6 — k6 performance testing ecosystem template (#895)

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
