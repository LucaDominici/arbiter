---
title: 'MCP Fallback Determinism Rule and Cross-Language Skip-Test Guard'
doc_version: '1.0.0'
status: active
last_review: '2026-05-16'
owner: ''
canonical_id: '082'
tags: ['audience/dev', 'kind/adr']
related: ['063']
---

# ADR-082: MCP Fallback Determinism Rule and Cross-Language Skip-Test Guard

**Project:** arbiter
**Date:** 2026-05-16
**Status:** Accepted
**Reference:** Issues #721, #730; prior-art baseline M-13, NI-11

> **Note:** This decision was originally recorded in `docs/SYSTEM/DECISIONS.md` as ADR-046.
> That ID was later reused for a different decision (Stack Adapter Model, `docs/ADR/046-stack-adapter.md`).
> Content extracted here as ADR-082 to resolve the collision.

## Context

Two extended-invariants issues batched: (a) MCP tools have no documented fallback when unavailable — silent downgrade creates non-deterministic session behavior; (b) skip annotations like `@Disabled`, `pytest.mark.skip`, and `t.Skip` can hide regressions and accumulate technical debt in test suites across Java, Python, and Go stacks.

## Decision

Ship two artifacts:

1. **`45-mcp-fallback.md`** (opt-in rule, `enableMcpFallback: true`): documents approved fallback equivalents for GitHub MCP → `gh` CLI, file-system MCP → built-in tools, browser MCP → curl/wget, search MCP → grep/find. Protocol: switch without asking + emit `[mcp-fallback]` deviation log.

2. **`check-no-skipped-tests.mjs`** (default-on HARD hook, disable with `enableNoSkippedTests: false`): PostToolUse Edit|Write hook blocking `@Disabled`, `@Ignore`, `pytest.mark.skip`, `pytest.mark.xfail`, `t.Skip(`, `skip.test(`. Complements `check-no-placeholders.mjs` which already guards JS/TS `.skip()` and `xit()`.

## Consequences

### Positive

- `check-no-placeholders.mjs` retains ownership of JS/TS test-skip patterns; `check-no-skipped-tests.mjs` adds Java/Python/Go without duplication.
- The MCP fallback rule is opt-in (default false) because not all projects use MCP tools.
- `enableNoSkippedTests` defaults to true because skipped tests are an unambiguous code smell with no legitimate permanent use.

### Negative

- `check-no-skipped-tests.mjs` (ADR-063) was later shipped as a separate ADR covering the same hook. ADR-082 documents the original design decision; ADR-063 is the implementation ADR.

## Links

- Issues: #721, #730
- Related ADRs: ADR-063 (check-no-skipped-tests hook)
