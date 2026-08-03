---
title: Anti-Drift Validator Family Reference
type: reference
invariant: INV-89
status: active
date: 2026-05-20
waves: W6, F4
doc_version: '1.0.0'
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Anti-Drift Validator Family Reference (INV-89)

The anti-drift validator family is a set of up to 22 `check-*.mjs` scripts that detect
configuration drift, secret leakage, suppression quality issues, and workflow structural problems
in arbiter-generated projects.

These scripts are emitted by `src/generators/anti-drift-validators.ts` (Track B); the dual-track
ones are also wired directly in arbiter's own `scripts/check-all.mjs` L1 gate (Track A — see the
Track column). The exact per-target count depends on configuration: **17** for a github-enabled
L2/L3 target, **20** at L1 or github-off (the github-trio fallback is added), and **22** at
L1/github-off + self-validation-off (the exit-code-contract + pipe-tee-hazard fallbacks are added
too — #1835, closing a crash-class ghost where check-pipe-tee-hazard.mjs was referenced unguarded
in check-all.mjs.ejs with no fallback emitter). The generator emit arrays are the SSOT; this table
is diffed against them by the `#1674` prose-parity self-gate.

---

## Family Overview

The `Condition` column states when each script is emitted: _always_ (every target), or a fallback
emitted only when the dedicated owner generator is disabled.

| Script                              | Wave | Track       | Gate Level | Condition                           | Purpose                                                                                                                                                                                                                        |
| ----------------------------------- | ---- | ----------- | ---------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `check-suppression-rationale.mjs`   | W6   | A+B         | L1         | always                              | Every suppression has a rationale comment                                                                                                                                                                                      |
| `check-suppression-expiry.mjs`      | W6   | A+B         | L1         | always                              | Every Trivy suppression has a future expiry date                                                                                                                                                                               |
| `check-secret-scan.mjs`             | W6   | A+B         | L1         | always                              | Gitleaks secret scan                                                                                                                                                                                                           |
| `check-drift.mjs`                   | W6   | A+B         | L1         | always                              | Catalog/template/workflow trio consistency                                                                                                                                                                                     |
| `check-workflow-runners.mjs`        | W6   | A+B         | L1         | always                              | Runner labels match allowed set                                                                                                                                                                                                |
| `check-workflow-docs-sync.mjs`      | W6   | A+B         | L1         | always                              | Workflow file list matches docs reference                                                                                                                                                                                      |
| `check-workflow-test-integrity.mjs` | W6   | A+B         | L1         | always                              | No test step has continue-on-error: true                                                                                                                                                                                       |
| `check-secret-presence.mjs`         | W6   | A+B         | L1         | always                              | Empty-secret skip needs an explicit opt-out (#1497)                                                                                                                                                                            |
| `check-continue-on-error.mjs`       | W6   | A+B         | L1         | always                              | Gating step must not swallow failure via const-true (#1497)                                                                                                                                                                    |
| `check-test-scope-tier.mjs`         | W6   | A+B         | L1         | always                              | Each required test tier is run by a gate step (#1497)                                                                                                                                                                          |
| `check-pr-size-gate.mjs`            | W6   | A+B         | L1         | always                              | sensitive-paths.txt patterns are valid globs                                                                                                                                                                                   |
| `check-claude-md-lint.mjs`          | W6   | A+B         | L1         | always                              | CLAUDE.md/AGENTS.md context-file linter (#1266)                                                                                                                                                                                |
| `check-unwired-guards.mjs`          | W6   | A+B         | L1         | always                              | Every guard script is referenced from a gate entrypoint (#2159); candidate set also covers `.claude/hooks/*.mjs` (wired via settings.json full-path, hooks.mjs HANDLERS bare-name, or relative import by a wired hook) (#2228) |
| `check-workflow-sha-pinning.mjs`    | W6   | B only      | —          | always                              | All action refs are SHA-pinned                                                                                                                                                                                                 |
| `check-workflow-job-naming.mjs`     | W6   | B only      | —          | always                              | Job naming convention (kebab-case)                                                                                                                                                                                             |
| `check-min-test-execution.mjs`      | W6   | B only      | —          | always                              | Test runner collects >0 tests (#1497)                                                                                                                                                                                          |
| `check-validator-helptext.mjs`      | F4   | A+B         | L1         | always                              | All anti-drift scripts support --help flag                                                                                                                                                                                     |
| `check-action-pins.mjs`             | F4   | B only (fb) | —          | github-setup off (L1 or github-off) | GitHub Actions SHA-pin gate (INV-76)                                                                                                                                                                                           |
| `check-workflow-perms.mjs`          | F4   | B only (fb) | —          | github-setup off (L1 or github-off) | Workflows declare top-level permissions                                                                                                                                                                                        |
| `check-ci-tiers.mjs`                | F4   | B only (fb) | —          | github-setup off (L1 or github-off) | All required CI tier workflows exist                                                                                                                                                                                           |
| `check-exit-code-contract.mjs`      | F4   | B only (fb) | —          | self-validation off                 | Scripts use 0=PASS/1=FAIL/2=ERROR only                                                                                                                                                                                         |
| `check-pipe-tee-hazard.mjs`         | F4   | B only (fb) | —          | self-validation off                 | Pipe/tee hazard advisory scan (#1835)                                                                                                                                                                                          |

`(fb)` = conditional **fallback**: anti-drift emits the script only when its dedicated owner
generator is disabled, so the script is never double-written.

### Intentionally NOT emitted by anti-drift

- `check-pii-scan.mjs` — duplicates the target-native `pii-scan.mjs` (already wired in check-all)
  and expects an arbiter-internal PII-patterns config absent in a target (#1152).
- `check-tier-coverage.mjs` — an arbiter-self meta-gate asserting arbiter's own check-all tier
  names; it fails in a target whose gate has a different tier set (#1152).
- `check-ssot-core.mjs`, `check-suppressions.mjs`, `check-inline-suppressions.mjs` — owned by the
  ssot / suppressions generators, which always run; anti-drift no longer double-emits them (#1318.2).
- `check-governance-mirror-sync.mjs` — arbiter-self meta-gate (Track A only, L1): asserts
  `website/governance/AGENTS.md` is a byte-for-byte mirror of root `AGENTS.md`, i.e. that
  `scripts/sync-public-governance.mjs` was re-run after any AGENTS.md edit (#1805). Targets have
  no website mirror, so nothing is emitted.

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
`@import` rules, it carries a **warn-only volatile-facts rule** (ported from the `internal-ref`
context linter): a literal version (`X.Y.Z`) or a hardcoded count of governance items
(`N invariants/hooks/rules/...`) in body prose is flagged, because such facts drift and belong
in SSOT (config/code). Frontmatter (`doc_version`), fenced code, and lines that already point at
an SSOT file are exempt. It is advisory first (never fails the gate); it can be promoted to a
hard rule once the context files are clean.

---

## References

- `src/invariants/catalog.ts` — INV-89 definition
- `scripts/check-all.mjs` — Track A wiring (anti-drift section)
- `src/generators/anti-drift-validators.ts` — Track B generator
- `docs/audits/planning-skeleton-audit.md` — PLAN-031..068 inventory
- `docs/audits/arbiter-skeleton-gap-analysis.md` — gap analysis §16 anti-drift-validator
