---
generated: true
source: 'docs/REFERENCE/anti-drift-family.md'
source_sha: '016cc3885715da5cb7871317894cc05e6fd58103'
last_updated: '2026-06-27'
---

# Anti-Drift Validator Family Reference

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/anti-drift-family.md](../docs/REFERENCE/anti-drift-family.md)

# Anti-Drift Validator Family Reference (INV-89)

The anti-drift validator family is a set of up to 20 `check-*.mjs` scripts that detect
configuration drift, secret leakage, suppression quality issues, and workflow structural problems
in arbiter-generated projects.

These scripts are emitted by `src/generators/anti-drift-validators.ts` (Track B); the dual-track
ones are also wired directly in arbiter's own `scripts/check-all.mjs` L1 gate (Track A — see the
Track column). The exact per-target count depends on configuration: **16** for a github-enabled
L2/L3 target, **19** at L1 or github-off (the github-trio fallback is added), and **20** at
L1/github-off + self-validation-off (the exit-code-contract fallback is added too). The generator
emit arrays are the SSOT; this table is diffed against them by the `#1674` prose-parity self-gate.

---

## Family Overview

The `Condition` column states when each script is emitted: _always_ (every target), or a fallback
emitted only when the dedicated owner generator is disabled.

| Script                              | Wave | Track       | Gate Level | Condition                           | Purpose                                                     |
| ----------------------------------- | ---- | ----------- | ---------- | ----------------------------------- | ----------------------------------------------------------- |
| `check-suppression-rationale.mjs`   | W6   | A+B         | L1         | always                              | Every suppression has a rationale comment                   |
| `check-suppression-expiry.mjs`      | W6   | A+B         | L1         | always                              | Every Trivy suppression has a future expiry date            |
| `check-secret-scan.mjs`             | W6   | A+B         | L1         | always                              | Gitleaks secret scan                                        |
| `check-drift.mjs`                   | W6   | A+B         | L1         | always                              | Catalog/template/workflow trio consistency                  |
| `check-workflow-runners.mjs`        | W6   | A+B         | L1         | always                              | Runner labels match allowed set                             |
| `check-workflow-docs-sync.mjs`      | W6   | A+B         | L1         | always                              | Workflow file list matches docs reference                   |
| `check-workflow-test-integrity.mjs` | W6   | A+B         | L1         | always                              | No test step has continue-on-error: true                    |
| `check-secret-presence.mjs`         | W6   | A+B         | L1         | always                              | Empty-secret skip needs an explicit opt-out (#1497)         |
| `check-continue-on-error.mjs`       | W6   | A+B         | L1         | always                              | Gating step must not swallow failure via const-true (#1497) |
| `check-test-scope-tier.mjs`         | W6   | A+B         | L1         | always                              | Each required test tier is run by a gate step (#1497)       |
| `check-pr-size-gate.mjs`            | W6   | A+B         | L1         | always                              | sensitive-paths.txt patterns are valid globs                |
| `check-claude-md-lint.mjs`          | W6   | A+B         | L1         | always                              | CLAUDE.md/AGENTS.md context-file linter (#1266)             |
| `check-workflow-sha-pinning.mjs`    | W6   | B only      | —          | always                              | All action refs are SHA-pinned                              |
| `check-workflow-job-naming.mjs`     | W6   | B only      | —          | always                              | Job naming convention (kebab-case)                          |
| `check-min-test-execution.mjs`      | W6   | B only      | —          | always                              | Test runner collects >0 tests (#1497)                       |
| `check-validator-helptext.mjs`      | F4   | A+B         | L1         | always                              | All anti-drift scripts support --help flag                  |
| `check-action-pins.mjs`             | F4   | B only (fb) | —          | github-setup off (L1 or github-off) | GitHub Actions SHA-pin gate (INV-76)                        |
| `check-workflow-perms.mjs`          | F4   | B only (fb) | —          | github-setup off (L1 or github-off) | Workflows declare top-level permissions                     |
| `check-ci-tiers.mjs`                | F4   | B only (fb) | —          | github-setup off (L1 or github-off) | All required CI tier workflows exist                        |
| `check-exit-code-contract.mjs`      | F4   | B only (fb) | —          | self-validation off                 | Scripts use 0=PASS/1=FAIL/2=ERROR only                      |

`(fb)` = conditional **fallback**: anti-drift emits the script only when its dedicated owner
generator is disabled, so the script is never double-written.

### Intentionally NOT emitted by anti-drift

- `check-pii-scan.mjs` — duplicates the target-native `pii-scan.mjs` (already wired in check-all)
  and expects an arbiter-internal PII-patterns config absent in a target (#1152).
- `check-tier-coverage.mjs` — an arbiter-self meta-gate asserting arbiter's own check-all tier
  names; it fails in a target whose gate has a different tier set (#1152).
- `check-ssot-core.mjs`, `check-suppressions.mjs`, `check-inline-suppressions.mjs` — owned by the
  ssot / suppressions generators, which always run; anti-drift no longer double-emits them (#1318.2).

---

## Track Definitions

| Track   | Meaning                                                                                     |
| ------- | ------------------------------------------------------------------------------------------- |
| **A**   | Wired in arbiter's own `scripts/check-all.mjs` gate; enforced during arbiter development    |
| **B**   | Emitted by `src/generators/anti-drift-validators.ts` for target projects via `arbiter init` |
| **A+B** | Both: wired in arbiter's gate AND emitted for target projects (dual-track)                  |

---

## Invariant

**INV-89** governs this family. Every emitted script must:

1. Have a shebang (`#!/usr/bin/env node`)
2. Support `--help` / `-h` flag (exits 0)
3. Cite `INV-89` in their header comment
4. Exit 0 on pass, 1 on failure (contract enforced by `check-exit-code-contract.mjs`)
5. Skip gracefully when the checked artifact is absent (bootstrap mode)

---

## Generator

Source: `src/generators/anti-drift-validators.ts`
Templates: `src/templates/scripts/check-*.mjs.ejs`

`arbiter init` invokes the generator for all governance levels (L1/L2/L3). Every script in the
Family Overview table is emitted with `skipIfExists: true` — re-running `arbiter init` on an
existing project does not overwrite customized validators. The number actually emitted depends on
configuration (16/19/20 — see the count breakdown above).

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

## Family member spotlight: context-file linter (`check-claude-md-lint.mjs`, #1266)

`check-claude-md-lint.mjs` is a dual-track member of the family above (it appears in the table and
cites INV-89). It targets only `CLAUDE.md` / `AGENTS.md` (incl. nested `.claude/CLAUDE.md`). Beyond
the hard portability and
`@import` rules, it carries a **warn-only volatile-facts rule** (ported from t

*[content truncated — see source for full text]*
