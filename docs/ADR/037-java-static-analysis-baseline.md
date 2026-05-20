---
title: 'ADR-037 — Java Static Analysis: Baseline Audit and Wiring Fixes'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# ADR-037 — Java Static Analysis: Baseline Audit and Wiring Fixes

**Date:** 2026-05-10
**Issue:** #404
**Status:** Accepted
**Reference snapshot:** production baseline (2026-05-07)

---

## Context

Issue #404 requested a rule-by-rule audit of Arbiter's generated Java static analysis
configuration (Checkstyle / PMD / SpotBugs / JaCoCo / Pitest) against a production baseline,
and resolution of any gaps in rule depth and CI/gate wiring.

---

## Audit findings

### PMD

**Gap confirmed:** Arbiter generated 6/7 rule categories; industry baseline uses 7. Missing: `codestyle`.

**Resolution:** Added four `codestyle.xml` rules to `pmd-ruleset.xml.ejs`:

- `UnnecessaryFullyQualifiedName`
- `UnnecessaryReturn`
- `UselessParentheses`
- `UselessQualifiedThis`

Thresholds (DESIGN category) already matched baseline. Exclusions in ERROR-PRONE, BEST PRACTICES,
and PERFORMANCE categories already matched.

### Checkstyle

**Gap confirmed (partial):** Arbiter generated 16 modules; production baseline generates 8. However, the
baseline's minimalism reflects its Spotless + google-java-format philosophy (formatter enforces style, so
Checkstyle only enforces structural rules). Arbiter generates broader Checkstyle coverage for
projects not using google-java-format — this is intentional and correct.

**Real gap:** Arbiter was missing the `SuppressWarningsHolder` (TreeWalker child) +
`SuppressWarningsFilter` (Checker child) pair. Without this pair, `@SuppressWarnings` annotations
in generated project code are silently ignored by Checkstyle.

**Resolution:** Added both modules to `checkstyle.xml.ejs`.

### SpotBugs

**Gap confirmed:** Arbiter generated 3 `<Match>` blocks; production baseline has 13 structured sections.

**Resolution:** Expanded `spotbugs-exclude.xml.ejs` to 8 structured sections using generic
class-pattern targeting (production baseline uses some project-specific names; Arbiter uses package-pattern
regex). Security patterns (SQL injection, XSS, path traversal) remain never-suppressed per policy.

**CI wiring gap:** SpotBugs was not invoked in any CI job. Added `spotbugsMain` / `mvn spotbugs:check`
step to the Java debt-gates job in `ci.yml.ejs`.

**Gate-script wiring gap:** SpotBugs was hard-gated at L2 while PMD and JaCoCo used
`{ soft: graceActive }`. This violated ADR-028 (uniform soft during L1→L2 grace window).
Fixed: SpotBugs now uses `{ soft: graceActive }` at L2.

### JaCoCo

**Gap confirmed:** Arbiter invoked a threshold in the gate script but did not generate
`jacocoTestCoverageVerification` task in `build.gradle`/`jacoco.gradle`.

**Resolution:** `jacoco.gradle.ejs` already generated the task; fixture was missing it.
Fixture updated. Gate script wiring was already correct (`{ soft: graceActive }` at L2).

**Note on threshold values:** Production baseline hardcodes 90%. Arbiter uses `computeThresholds()` parametrised
by governance level (L1=70%, L2=80%, L3=90%). This is intentionally superior — L3 produces 90%
through existing logic. No change needed.

### Pitest (non-gap reaffirmed)

**Plan gap:** The initial plan labelled "Pitest not in `check-all.mjs`" as a gap and proposed
wiring it at L3. This was incorrect.

**M23 decision:** Pitest is deliberately nightly-only. The existing test at
`__tests__/matrix/java.test.ts:467` codifies this:

```
check-all.mjs does NOT invoke pitest (mutation moved to nightly)
```

Pitest additions to `check-all.mjs.ejs` were added and then reverted after L1 gate failure
confirmed the M23 constraint. The revert is correct and intentional.

**`pitest.gradle.ejs` already exists** and is included in generated output. Nightly CI invokes it.
No change needed.

### findsecbugs plugin

Considered. Not used in production baseline. Adding it would exceed parity without user request. Deferred.

---

## Decisions

1. PMD `codestyle` category added — achieves 7/7 category parity with industry baseline.
2. Checkstyle `SuppressWarningsHolder` + `SuppressWarningsFilter` pair added.
3. SpotBugs exclude template expanded to 8 structured sections with security-never-suppressed policy.
4. SpotBugs CI step wired in `ci.yml.ejs` Java debt-gates job (Gradle + Maven).
5. SpotBugs gate-script entry changed from hard to `{ soft: graceActive }` per ADR-028.
6. JaCoCo `jacocoTestCoverageVerification` fixture gap fixed; template was already correct.
7. Pitest remains nightly-only (M23 decision reaffirmed). `check-all.mjs.ejs` does not invoke it.
8. `computeThresholds()` parametrisation kept as-is (superior to hardcoded 90%).
9. Fixture `java-backend-web-db-gradle` updated with PMD + SpotBugs plugins and JaCoCo verification.
10. Fixture tests in `real-project-fixtures.test.ts` extended with static-presence assertions.

---

## Deferred

- **Failure-mode tests** (coverage-drop fails gate, PMD violation fails gate, etc.) — require
  Gradle-execution test infrastructure not currently present. Deferred to follow-up issue.
- **Maven-side fixture parity** — only Gradle fixture updated; Maven fixture work is a separate ticket.
- **JaCoCo Maven vs Gradle exclusion divergence** — known but out of scope here.
- ~~**Java `coverageEnabled` guard missing**~~ — Fixed in follow-up commit (task/#404b):
  `check-all.mjs.ejs` Java coverage blocks now wrapped in `<% if (coverageEnabled) { %>`,
  matching all other languages. Tests added for both `coverageEnabled=true` and `false`.

---

## Consequences

- Generated Java projects now have full static analysis CI wiring (Checkstyle + PMD + SpotBugs +
  JaCoCo), matching production-grade baseline setup.
- SpotBugs soft-gate during grace window aligns with ADR-028.
