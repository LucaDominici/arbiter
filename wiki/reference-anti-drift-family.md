---
generated: true
source: 'docs/REFERENCE/anti-drift-family.md'
source_sha: '03edff67f03fb2e5e7d0a5072506a09ae4f492a8'
last_updated: '2026-06-08'
---

# Anti-Drift Validator Family Reference

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/anti-drift-family.md](../docs/REFERENCE/anti-drift-family.md)

# Anti-Drift Validator Family Reference (INV-89)

The anti-drift validator family is a set of 20 `check-*.mjs` scripts that detect configuration
drift, secret leakage, suppression quality issues, and workflow structural problems in arbiter-
generated projects.

These scripts are emitted by `src/generators/anti-drift-validators.ts` (Track B) and 11 of them
are also wired directly in arbiter's own `scripts/check-all.mjs` L1 gate (Track A).

---

## Family Overview

| Script                              | Wave  | Track  | Gate Level | Purpose                                          |
| ----------------------------------- | ----- | ------ | ---------- | ------------------------------------------------ |
| `check-suppression-rationale.mjs`   | W6    | A+B    | L1         | Every suppression has a rationale comment        |
| `check-suppression-expiry.mjs`      | W6    | A+B    | L1         | Every Trivy suppression has a future expiry date |
| `check-pii-scan.mjs`                | W6    | A+B    | L1         | Whole-repo PII scan against pii-patterns.txt     |
| `check-secret-scan.mjs`             | W6    | A+B    | L1         | Gitleaks secret scan                             |
| `check-drift.mjs`                   | W6    | A+B    | L1         | Catalog/template/workflow trio consistency       |
| `check-workflow-runners.mjs`        | W6    | A+B    | L1         | Runner labels match allowed set                  |
| `check-workflow-docs-sync.mjs`      | W6    | A+B    | L1         | Workflow file list matches docs reference        |
| `check-workflow-test-integrity.mjs` | W6    | A+B    | L1         | No test step has continue-on-error: true         |
| `check-pr-size-gate.mjs`            | W6    | A+B    | L1         | sensitive-paths.txt patterns are valid globs     |
| `check-validator-helptext.mjs`      | W6+F4 | A+B    | L1         | All anti-drift scripts support --help flag       |
| `check-tier-coverage.mjs`           | W6+F4 | A+B    | L1         | Gate script covers all required tier checks      |
| `check-workflow-sha-pinning.mjs`    | W6    | B only | —          | All action refs are SHA-pinned                   |
| `check-workflow-job-naming.mjs`     | W6    | B only | —          | Job naming convention (kebab-case)               |
| `check-inline-suppressions.mjs`     | F4    | B only | —          | Inline arbiter-suppress directive quality        |
| `check-suppressions.mjs`            | F4    | B only | —          | Suppression entry metadata and expiry            |
| `check-action-pins.mjs`             | F4    | B only | —          | GitHub Actions SHA-pin gate (INV-76)             |
| `check-workflow-perms.mjs`          | F4    | B only | —          | Workflows declare top-level permissions          |
| `check-exit-code-contract.mjs`      | F4    | B only | —          | Scripts use 0=PASS/1=FAIL/2=ERROR only           |
| `check-ssot-core.mjs`               | F4    | B only | —          | All SSOT_CORE_SET.md entries exist on disk       |
| `check-ci-tiers.mjs`                | F4    | B only | —          | All required CI tier workflows exist             |

---

## Track Definitions

| Track   | Meaning                                                                                     |
| ------- | ------------------------------------------------------------------------------------------- |
| **A**   | Wired in arbiter's own `scripts/check-all.mjs` gate; enforced during arbiter development    |
| **B**   | Emitted by `src/generators/anti-drift-validators.ts` for target projects via `arbiter init` |
| **A+B** | Both: wired in arbiter's gate AND emitted for target projects (dual-track)                  |

---

## Invariant

**INV-89** governs this family. All 20 scripts must:

1. Have a shebang (`#!/usr/bin/env node`)
2. Support `--help` / `-h` flag (exits 0)
3. Cite `INV-89` in their header comment
4. Exit 0 on pass, 1 on failure (contract enforced by `check-exit-code-contract.mjs`)
5. Skip gracefully when the checked artifact is absent (bootstrap mode)

---

## Generator

Source: `src/generators/anti-drift-validators.ts`
Templates: `src/templates/scripts/check-*.mjs.ejs`

`arbiter init` invokes the generator for all governance levels (L1/L2/L3). All 20 scripts are
emitted with `skipIfExists: true` — re-running `arbiter init` on an existing project does not
overwrite customized validators.

---

## Planning Provenance

This family ports the agnostic anti-drift validators from `internal-ref`:

- **W6 (13 validators)**: PLAN-031..040, PLAN-042, PLAN-062, PLAN-063, PLAN-068
- **F4 (9 validators)**: check-validator-helptext, check-tier-coverage (deferred from W6),
  plus check-inline-suppressions, check-suppressions, check-action-pins, check-workflow-perms,
  check-exit-code-contract, check-ssot-core, check-ci-tiers (arbiter-native anti-drift scripts
  made dual-track)

Java-specific validators (PITest override, Jasypt, SpotBugs, schema isolation, etc.) are covered
by the F2 stack adapter.

---

## References

- `src/invariants/catalog.ts` — INV-89 definition
- `scripts/check-all.mjs` — Track A wiring (anti-drift section)
- `src/generators/anti-drift-validators.ts` — Track B generator
- `docs/audits/planning-skeleton-audit.md` — PLAN-031..068 inventory
- `docs/audits/arbiter-skeleton-gap-analysis.md` — gap analysis §16 anti-drift-validator
