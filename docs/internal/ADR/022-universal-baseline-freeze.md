---
title: 'ADR-022 — Universal Baseline-Freeze (MB)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: '022'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-022 — Universal Baseline-Freeze (MB)

**Status:** Accepted  
**Date:** 2026-04-15  
**Milestone:** MB (Phase 9.5 Foundation — resolves C6 from antagonist review)

---

## Context

M16 shipped a debt-ratchet system that captures only four metrics: `coverage`, `complexityViolations`, `deadCode`, `todoCount`. Running `arbiter init` at L2 on a 50k-LoC existing Java repo fails the gate immediately on thousands of pre-existing PMD / Checkstyle / SpotBugs / ArchUnit violations — there is no way to lock in a "day-zero" state. This blocks brownfield adoption entirely.

Two additional problems compound this:

1. **Per-stack metrics are primitive.** Java PMD was captured as exit-status 0 or 1, not a violation count, making ratchet deltas meaningless.
2. **Template duplication.** The two generated scripts (`capture-debt-baseline.mjs`, `debt-report.mjs`) duplicated ~80 lines of per-stack metric collection. MB's additions would double that to ~160 lines of identical code across the two files.

---

## Decision

### 1. Schema v2

`scripts/debt-baseline.json` gains:

- `version: 2` (was 1)
- `archetype` field (records the archetype at capture time)
- Per-metric `items?: string[]` for diagnostic lists (ArchUnit rule names, advisory IDs) — comparison still uses the numeric `value`

Version 1 baselines are **not auto-migrated**. `debt-report.mjs` detects `version !== 2`, prints a migration hint, and exits 0 (soft — same behavior as "no baseline"). `capture-debt-baseline.mjs` on a v1 file rewrites it as v2 from the current project state.

### 2. Per-stack violation counts

New metrics added on top of existing `coverage` / `complexityViolations` / `deadCode`:

| Stack      | New metrics                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| Java       | `pmdViolations`, `checkstyleViolations`, `spotbugsViolations`, `archunitFailingRules`, `coverageLine`, `coverageBranch` |
| TypeScript | `eslintErrors`, `tscStrictErrors`, `bundleSizeKb` (frontend-spa only)                                                   |
| Rust       | `clippyDenyCount`, `cargoAuditAdvisories`                                                                               |
| Go         | `golangciViolations`, `govulncheckAdvisories`                                                                           |
| Python     | `ruffErrors`, `mypyStrictErrors`, `pipAuditAdvisories`                                                                  |

### 3. Shared `debt-lib.mjs` helper

Generator emits a third file `scripts/debt-lib.mjs` exporting:

- `spawnOrSkip(name, tool, cmd, args, opts)` — returns null on ENOENT with a warning
- `collectMetrics(cwd)` — dispatches to the correct per-stack collector
- `countTodos(cwd)` and `getCommit(cwd)` — shared utilities

Both `capture-debt-baseline.mjs` and `debt-report.mjs` import from `./debt-lib.mjs`. This eliminates the ~160-line duplication and provides a stable extension point for future milestones (MC suppressions, MK grace period, ME matrix maturity).

### 4. `--brownfield` flag on `arbiter init`

`arbiter init --brownfield` auto-runs `node scripts/capture-debt-baseline.mjs` after generation. If the toolchain is incomplete (missing Gradle, missing pytest), the capture fails non-fatally — generated files remain on disk. The `arbiter verify` command (MD) is the correct place to fail-hard on toolchain issues.

### 5. `MetricsProfile` generator abstraction

A `MetricsProfile` interface is computed at generation time from `(language, archetype, architectureStyle)` and passed to EJS templates. This keeps templates free of inline archetype-string comparisons and ensures the generated `debt-lib.mjs` contains only the code paths relevant to the specific project.

---

## Consequences

- **Hard v1→v2 migration.** Projects with existing v1 baselines must re-run `capture-debt-baseline.mjs` to get the new violation counts. Auto-migration was rejected because v1 baselines lack violation counts entirely — a fresh capture is semantically correct and safer.
- **SpotBugs emitted for all Java projects.** `spotbugs.gradle` is generated alongside the existing PMD/Checkstyle configs. Projects tune the ruleset locally post-init.
- **govulncheck, cargo-audit, mypy, pip-audit** are now invoked by the generated scripts. Missing-tool handling (ENOENT → skip metric + warn) prevents failures on machines without the full toolchain.
- **`--update` preserves prior metrics for absent tools (#126).** When a tool is unavailable on the current machine, its metric key is absent from `collected` but survives in the baseline: the `--update` block seeds `baseline.metrics` from `existing.metrics` first, then ratchets by `collected`. A partial capture run (e.g. CI machine missing one tool) therefore cannot silently drop a metric the ratchet has already locked in. Ratchet ties (`current.value === prev.value`) keep `prev` so sub-fields like `archunitFailingRules.items` are not overwritten by an empty list. Direction changes between runs or unknown-direction metrics overwrite (no silent unit mix). Malformed baseline JSON now errors with the filename in the message.
- **Three generated scripts** instead of two. The `debt-lib.mjs` import is resolved by Node's `.mjs` extension handling without requiring changes to the target project's `package.json`.

---

## Alternatives rejected

| Alternative                                   | Reason rejected                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| Soft-warn mode (never fail gate on new tools) | Loses fail-closed posture; violations accumulate silently                            |
| Per-tool baseline files                       | Unbounded file proliferation; harder to diff                                         |
| Baseline in `arbiter.json`                    | Couples ephemeral metric state to config persistence                                 |
| Auto-migrate v1→v2                            | Hides the invariant violation (v1 had no violation counts); fresh capture is correct |
| Keep duplication (Option A)                   | ~160 lines of identical code doubling on every subsequent debt-ratchet milestone     |
