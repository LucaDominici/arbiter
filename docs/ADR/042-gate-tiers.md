---
title: 'ADR-002: Three-Tier Gate System (L1/L2/L3)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# ADR-002: Three-Tier Gate System (L1/L2/L3)

**Project:** arbiter
**Date:** 2025-01-01
**Status:** Accepted

## Context

Not all checks need to run on every commit. Fast checks (typecheck, lint, unit tests) should block PRs; expensive checks (coverage, dead code, audit, secrets full scan) should run less frequently but still gate merges.

## Decision

Implement three gate tiers in `scripts/check-all.mjs`:

- **L1**: Fast checks — typecheck, format, lint, tests, circular deps, placeholders, orphan TODOs, commitlint, test naming (~2 min)
- **L2**: L1 + coverage, dead code (knip), npm audit, gitleaks secrets scan (~8 min)
- **L3**: L2 + full repo secrets scan (nightly/manual)

Pre-commit hook runs L1. CI runs L2. Nightly runs L3.

## Consequences

### Positive

- Developer feedback loop stays fast (L1 < 2 min locally)
- Full quality gate (L2) enforced on every PR
- Nightly L3 catches secrets in git history

### Negative

- Two separate gate invocations must be maintained in sync
- L2 failures in CI that pass L1 locally require a second fix cycle

## Links

- Issues: #151, #153
