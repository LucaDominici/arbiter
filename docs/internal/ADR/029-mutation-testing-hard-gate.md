---
title: 'ADR-029: Mutation Testing as Hard L3 Gate — Multi-Stack, 85% Threshold'
doc_version: '1.0.0'
status: superseded
last_review: '2026-07-12'
owner: ''
canonical_id: '029'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-029: Mutation Testing as Hard L3 Gate — Multi-Stack, 85% Threshold

**Status:** Superseded by ADR-030 (mutation moved to nightly pipeline, unwinding L2 gate placement)
**Date:** 2026-04-17
**Deciders:** Luca Dominici
**Issue:** #71
**Supersedes (in part):** ADR-016 — mutation portion of INV-30

## Context

ADR-016 established mutation testing (INV-30) as an L2+ advisory gate for Java only, using pitest with 80% mutation / 85% coverage thresholds and a `pitest-setup.md` guide. This was a starting point — L2 advisory guides document what to do but cannot enforce it.

Issue #71 and the production baseline alignment analysis mandate mutation testing as a **hard gate** at L3 with:

- 85% mutation threshold across all supported stacks
- PIT 1.15.0 for Java, Stryker for TypeScript, cargo-mutants for Rust, mutmut for Python
- Go excluded (go-mutesting ecosystem is unmaintained/unsafe)

The enforcement philosophy (`docs/PRODUCT/ENFORCEMENT-PHILOSOPHY.md:8-12`) requires: "once chosen, enforced." L3 governance cannot rely on advisory guides.

## Decision

### INV-30 broadened: L3 hard gate, multi-language, 85%

INV-30 moves from L2 to L3, expands from Java-only to java/typescript/rust/python (Go excluded), and raises the mutation threshold from 80% to 85%.

The L2 advisory guide (`src/templates/mutation/pitest-l2-setup.md.ejs`) is **kept at L2 unchanged** — projects at L2 still receive setup guidance. L3 projects receive enforced configuration fragments.

### Per-stack tool selection

| Language   | Tool          | Maturity | Notes                                            |
| ---------- | ------------- | -------- | ------------------------------------------------ |
| Java       | PIT/pitest    | proven   | 1.15+, production-baseline 3-pattern targets     |
| TypeScript | Stryker       | proven   | vitest runner, thresholds.break = 85             |
| Rust       | cargo-mutants | beta     | requires `--accept-beta-tools`                   |
| Python     | mutmut        | beta     | requires `--accept-beta-tools`                   |
| Go         | —             | unsafe   | excluded — ADR-029 records exclusion permanently |

### Java target-class pattern (production-baseline 3-pattern)

```
*.domain.*
*.application.service.*
*.application.usecase.*
```

Adapters, controllers, and infrastructure layers are excluded — mutations there often survive legitimately (integration tests only, not unit tests).

### L3 generation-time gate

`check-all.mjs.ejs` emits L3-specific mutation steps inside the generated script when `governanceLevel === 'L3'`. The runtime script still runs at `L2` (not `L3`). This is intentional: mutation runs as part of the L2 check in L3-governed projects (i.e., L3 config tightens what L2 runs, it does not create a third runtime level).

This is a known limitation: a future milestone (M25) will add a dedicated nightly workflow for mutation runs that are too slow for the main L2 gate.

### Beta opt-in

Rust and Python mutation are beta. The existing `--accept-beta-tools` flag (already enforced in `src/utils/maturity-check.ts`) gates emission. No new flag needed. Error message on missing flag must be explicit: "mutation testing for Rust/Python is beta — re-run with --accept-beta-tools or lower governance to L2".

### mutmut runtime caution

mutmut can take 6h+ on mid-size Python codebases. Scoping to `src/<modulePath>/` and `timeout_per_mutant: 120s` caps this. Teams must monitor first-run times and narrow scope further if needed.

## Consequences

- INV-30 at L2 is removed. Java projects at L2 still get `pitest-setup.md` (advisory). L2 CI does not run pitest.
- L3 Java/TS projects: arbiter emits mutation config + AGENTS.md instructions automatically.
- L3 Rust/Python: emitted only with `--accept-beta-tools`.
- Go L3: `checkL3MaturityGates` aborts init with unsafe tool error (pre-existing behaviour).
- `__tests__/invariants/catalog.test.ts` count adjustments: Java+L2 = 29 (was 30), TS+L3 = 31 (was 30).
- ADR-016 mutation portion is superseded. RestAssured/INV-29 portion of ADR-016 remains active.
