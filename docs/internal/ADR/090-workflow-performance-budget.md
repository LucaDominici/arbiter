---
title: 'ADR-090: Workflow Performance Budget'
doc_version: '1.0.0'
status: active
last_review: '2026-06-07'
owner: ''
canonical_id: '090'
tags: ['audience/dev', 'kind/adr']
related: ['089-collapse-hand-docs-to-ssot-core-plus-generated-wiki']
---

# ADR-090 — Workflow Performance Budget

**Status:** Accepted
**Date:** 2026-06-07
**Maps to:** §17.5 recommendation 6, Wave 0.6 M2

---

## Context

Arbiter's generated CI pipelines serve as the enforcement surface for governance contracts. Without
an explicit performance budget, timing thresholds in individual workflow templates are undocumented
magic numbers. Contributors have no principled basis for evaluating whether a proposed pipeline
change violates the intent or merely stays within acceptable bounds.

Evidence gathered during Wave 0.6 showed that sequential `needs:` chains — especially in PR-fast
workflows — consistently exceed 15 minutes when reactor/cache patterns are absent. A reference
engineering organisation running arbiter-governed projects observed:

- PR-fast critical path without parallelism: 28–42 min
- PR-fast critical path with reactor + cache: 10–14 min
- PR-extended without parallel stages: 45–65 min

The delta is structural, not flaky: removing sequential chains and adding cache handoff consistently
shaves 50–70% of wall-clock time.

## Decision

Arbiter's generated workflows MUST conform to the following performance budget:

| Workflow         | Critical path | Min parallel jobs | Max sequential `needs:` chain |
| ---------------- | ------------- | ----------------- | ----------------------------- |
| PR Fast (T1)     | ≤ 15 min      | ≥ 3               | ≤ 2                           |
| PR Extended (T2) | ≤ 30 min      | ≥ 2               | ≤ 3                           |
| Human Approval   | ≤ 40 min      | —                 | ≤ 3                           |
| Nightly (T4)     | ≤ 60 min      | ≥ 2               | ≤ 5                           |

These limits are enforced by L1 gates. Overrides are configurable via environment variables
(`ARBITER_MAX_NEEDS_CHAIN`, `ARBITER_MIN_PARALLEL_JOBS`) for non-standard project needs, but
require a corresponding ADR update to the project's `docs/ADR/` directory.

## Rationale

**15 min PR-fast** is the developer mental model boundary: "I can submit, grab coffee, return, and
rebase if needed within one focus window." Beyond 15 min, interrupt cost exceeds the benefit of the
CI signal. At ≥ 20 min, developers bypass CI by force-pushing or reviewing stale signals.

**30 min PR-extended** aligns with the "go grab coffee and come back" model. PR-extended runs the
full test matrix (coverage, integration, BDD). 30 min is achievable only with parallelism — serial
execution of the same matrix reaches 55–70 min.

**3 parallel jobs minimum (PR-fast)** targets the runner sweet spot: three independent jobs (lint,
unit test, security scan) can run simultaneously, cutting the first-pass time to the slowest single
job rather than their sum. Requiring fewer gives no meaningful parallelism.

**Max 3 sequential needs chain** caps the critical path depth. Each `needs:` edge adds latency even
on fast jobs (queue time, setup overhead, artifact handoff). A chain of 4+ indicates a sequential
pipeline masquerading as parallel — the canonical anti-pattern this budget addresses.

## Consequences

- `scripts/check-workflow-parallelism.mjs` (L1) enforces max `needs:` chain and min parallel jobs.
- `scripts/check-workflow-cache-strategy.mjs` (L1) enforces cache/reactor patterns per archetype.
- `__tests__/integration/workflow-perf.test.ts` validates generated workflows against these budgets.
- Future workflow templates MUST conform at generation time. Non-conformance fails the L1 gate.
- The budget is stricter than industry default (many CI systems tolerate 30+ min PR-fast). This is
  intentional: arbiter targets organisations where developer velocity is a first-class metric.
- Archetype-specific overrides (e.g., embedded targets with slow build toolchains) may apply via
  per-workflow config in `arbiter.json` (`ci.performanceBudget`), but require documented rationale.

## Compliance

- Gate: `check-workflow-parallelism.mjs` (enforces chain ≤ 3, parallel ≥ 3)
- Gate: `check-workflow-cache-strategy.mjs` (enforces cache/reactor per archetype)
- Test: `__tests__/integration/workflow-perf.test.ts`
- Reference: `docs/REFERENCE/workflow-pr-fast.md` (canonical annotated pattern)

## References

- §17.5 (Wave 0.6 CI-perf audit, arbiter internal)
- ADR-053: local-CI parity (INV-59)
- ADR-088: ship-as-orchestration-entrypoint
- `docs/REFERENCE/workflow-pr-fast.md`
