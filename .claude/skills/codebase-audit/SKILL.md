---
name: codebase-audit
description: Use when running a comprehensive codebase verification. Dispatches parallel agents across disjoint scopes to check invariant compliance, dead code, test coverage gaps, and naming consistency.
title: 'Codebase Audit'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# Codebase Audit

**Purpose:** Systematic whole-codebase verification using parallel read-only agents.

## When to Use

- Before a major release
- After a large refactor
- Periodic health checks
- Onboarding to an unfamiliar codebase

## Audit Scopes

Divide the codebase into disjoint scopes and delegate each to a `codebase-scanner` agent:

| Scope                  | What to Check                                               |
| ---------------------- | ----------------------------------------------------------- |
| **Dead code**          | Unused exports, unreachable functions, commented-out blocks |
| **Naming consistency** | Conventions followed (camelCase, snake_case per layer)      |
| **Test coverage gaps** | Source files without a corresponding test file              |
| **Error handling**     | Unchecked errors, swallowed exceptions, missing fallbacks   |
| **Type safety**        | `any` usage, missing return types on public functions       |

## Execution

For each scope, delegate to `codebase-scanner`:

```
Delegate to codebase-scanner:
  "Find all <scope> issues in src/"
```

Run scopes in parallel when possible.

## Output Format

```markdown
## Codebase Audit Report

**Date:** <date>
**Scope:** Full / Partial (<modules>)

### Dead Code

- <file:line — description>

### Naming Inconsistencies

- <file:line — convention violated>

### Test Coverage Gaps

- <source file without test>

### Error Handling Gaps

- <file:line — description>

### Type Safety Issues

- <file:line — description>

### Summary

- Total issues found: <N>
- Critical: <N>
- Recommended actions: <list>
```

## Constraints

- Read-only. No edits during audit.
- Do not fix issues inline — create task briefs for fixes.

## Product-complete mode

When the requested scope is `product-complete`, code-quality lanes are only inputs. Freeze the
subject SHA, inventory every in-scope public/emitted entrypoint, then add this metadata and marked
table to the report:

```markdown
<!-- PRODUCT_AUDIT
scope: product-complete
subject_sha: <40-char SHA>
entrypoint_denominator: <count derived from rows>
readiness_verdict: PASS|FAIL|NO_DATA|N/A
docs_verdict: PASS|FAIL|NO_DATA|N/A
behavior_verdict: PASS|FAIL|NO_DATA|N/A
-->
<!-- PRODUCT_COVERAGE_START -->

| capability_id | classification | entrypoints | owner | config | proof | external_overlap | coverage | verdict |
| ------------- | -------------- | ----------- | ----- | ------ | ----- | ---------------- | -------- | ------- |

<!-- PRODUCT_COVERAGE_END -->
```

Use FEATURE_MATRIX IDs for `SUPPORTED` rows; use capability `N/A` only for `INTERNAL` or `RETIRED`.
Coverage is `VERIFIED`, `SOURCE_TRACED`, `SAMPLED`, `NEEDS_REVALIDATION`, `UNCOVERED`, or `N/A`.
Validate the completed report with:

```bash
node scripts/check-feature-matrix.mjs --product-report <report.md>
```

Counts come from rows. Presence, markers, authored transcripts, and historical evidence cannot
produce a behavior `PASS`.
