---
name: verification
description: Use before claiming work is complete, before committing, or before creating PRs. Verify tests pass, gate passes, and no invariants are violated.
title: 'Verification Before Completion'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# Verification Before Completion

Use this before declaring any work done.

## Checklist

### 1. Tests

```bash
npm run test
```

- [ ] All tests pass
- [ ] No skipped or disabled tests added
- [ ] New behavior has test coverage

### 2. Quality Gate

```bash
node scripts/check-all.mjs L1
```

- [ ] Typecheck passes
- [ ] Lint passes
- [ ] Format passes
- [ ] No orphan TODOs

### 3. Invariant Check

- [ ] No `any` types introduced
- [ ] No disabled/placeholder tests

### 4. Before Push

```bash
node scripts/check-all.mjs L2
```

- [ ] Coverage threshold met
- [ ] No dead code
- [ ] No circular dependencies

## Hard Stops

Do NOT commit or push if:

- Gate fails
- Tests are failing
- You added a TODO without a task ID (`TODO(#NNN): ...`)
