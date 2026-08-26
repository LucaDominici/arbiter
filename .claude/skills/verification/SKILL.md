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

Run this sequence before any completion claim — a claim made from memory of green output is
the single most common agent failure mode, so every claim below is re-verified against the
tree now, not recalled. Work through the steps in order; each depends on the previous one,
and an unchecked box is an unfinished task, not an optional extra.

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

## Stop conditions

Commit and push only when every box above is checked. A failing gate, a failing test, or a
TODO without a task ID (`TODO(#NNN): ...`) stops the completion claim here: fix the root
cause first — a claim made over a red check is false the moment it is written, and the Stop
hook (INV-114) will reject it anyway. Report what is red and what you are doing about it
instead of claiming done.
