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
