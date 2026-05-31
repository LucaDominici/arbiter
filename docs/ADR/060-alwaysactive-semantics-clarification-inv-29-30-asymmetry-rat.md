---
title: 'ADR-060: alwaysActive semantics clarification + INV-29/30 asymmetry rationale (#683)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-31'
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
