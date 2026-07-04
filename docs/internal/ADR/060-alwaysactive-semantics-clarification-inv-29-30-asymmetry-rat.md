---
title: 'ADR-060: alwaysActive semantics clarification + INV-29/30 asymmetry rationale (#683)'
doc_version: '1.0.0'
status: active
last_review: '2026-06-30'
owner: ''
canonical_id: '060'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-060: alwaysActive semantics clarification + INV-29/30 asymmetry rationale (#683)

**Date:** 2026-05-16
**Status:** Accepted
**Reference:** Issue #683 (from sweep #277 finding #13)

**Context:** Three related ambiguities were discovered during sweep #277:

1. The `alwaysActive` JSDoc said "True for Tier 1 and Tier 5" but the field is also used on Tier 3 security invariants (INV-11/12/13) and an architectural Java-only rule (INV-29).
2. `filter.ts` applies `meetsGovernanceLevel` before the `alwaysActive` bypass, making INV-11 (`alwaysActive: true, minGovernanceLevel: L2`) invisible at L1 — contradicting the "always" mental model.
3. INV-29 (NoMockMvc, `alwaysActive: true`) vs INV-30 (mutation/PITest, `alwaysActive: false, minGovernanceLevel: L2`) are both Java-only test-infra rules with no documented asymmetry rationale.

**Decision:**

**1. JSDoc fix — not rename.** The `alwaysActive` field is renamed to `tierBypassOnly` in the issue suggestion. After evaluating the ripple (61 catalog entries, graph fixtures, test assertions), we keep the name `alwaysActive` and fix only the JSDoc to accurately state: "Bypasses the invariantTiers filter only; `minGovernanceLevel` is still enforced." A comment is added to the filter to reinforce the ordering invariant.

**2. INV-11/12/13 at L2+ with `alwaysActive: true` is correct.** These security invariants (secrets scan, PII scan, dep audit) require `minGovernanceLevel: L2` because the tooling setup (gitleaks, pip-audit, OWASP) is non-trivial and inappropriate for L1 projects. `alwaysActive: true` means only that they are not excluded by the `invariantTiers` preset — a project on L2 with 'essential' preset still gets them. They remain invisible at L1, which is the intended behavior.

**3. INV-29/30 asymmetry is intentional.** INV-29 (Java — never use MockMvc in unit tests) is an architectural constraint with zero setup cost. It should apply even at L1 governance where quality bars are low — bad test practices are equally bad at any level. INV-30 (Java — mutation testing with PITest) requires a dedicated CI job, slow test runs, and a passing threshold. It is appropriate only at L2+ where the project has invested in deep quality gates. The asymmetry in `alwaysActive` + `minGovernanceLevel` correctly captures this intent.

**Consequences:** No behavior change. JSDoc and filter comment updated for accuracy. Future contributors can reason clearly about `alwaysActive` without misreading it as "visible at all governance levels."

## Extension (2026-06-30, #1635)

Decision 2's convention (`alwaysActive: true` + `minGovernanceLevel: L2`) is extended beyond
INV-11/12/13 to the rest of the baseline security tier: **INV-14/15/44/74/76/77/78/79/91/92** are
now `alwaysActive: true` with a `minGovernanceLevel: L2` floor (added to the 7 that previously
lacked it; INV-78/79/92 already declared the floor). Previously these were `alwaysActive: false`,
so the `standard` (L2) and `essential` (L1) presets — which exclude the `security` tier — silently
dropped them from generated `GLOBAL_INVARIANTS.md`/`AGENTS.md`, and `minGovernanceLevel: L2` on
INV-78/79/92 was a silent no-op. Surfacing them at L2 makes the default L2 security posture match
the documentation; the L2 floor keeps the L1 `essential` contract intact (the governance filter at
`filter.ts:50` drops them at L1 before the tier bypass). The change is documentation-only in
target projects — `getFilteredInvariants` feeds only the `agents-md` and `global-invariants`
generators, never a hard gate. `GLOBAL_INVARIANTS.md` (hand-maintained) gained 10 `### INV-NN:`
sections; `AGENTS.md` already listed all 10.
