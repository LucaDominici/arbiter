---
title: 'Incident: INV-06 (orphan TODO) caught during milestone closeout'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Incident: INV-06 (orphan TODO) caught during milestone closeout

**Invariant:** INV-06 — every TODO comment must reference a task ID (`TODO(#NNN): …`)  
**Hook:** `check-no-orphan-todo.mjs` (PostToolUse → Edit|Write)  
**Gate:** `node scripts/check-no-orphan-todo.mjs` (L1)

---

## What happened

During a milestone closeout, a developer was cleaning up a generator file and
left a bare TODO as a reminder to add validation later:

```typescript
// src/generators/contract-testing.ts
export function generateContractTests(config: ContractConfig): string[] {
  // TODO: add validation for missing baseUrl
  return buildTestSuite(config)
}
```

The TODO had no task ID and no linked issue. It described a real gap
(missing validation) but was not tracked anywhere.

## How arbiter caught it

The gate failed at L1:

```
orphan TODOs ... FAIL
  src/generators/contract-testing.ts:12
  Bare TODO found: "TODO: add validation for missing baseUrl"
  Fix: use TODO(#NNN): description — open an issue first
```

The milestone could not close because the L1 gate was a hard block on the
pre-commit hook.

## The fix

The developer opened issue #487 ("Add baseUrl validation to contract generator")
and updated the comment:

```typescript
// TODO(#487): add validation for missing baseUrl
```

The gate passed. The issue appeared in the milestone backlog, where it was
triaged and scheduled for the next sprint.

## Impact

The orphan TODO represented a real validation gap — one that would have been
invisible without INV-06. After triage, #487 was marked `P2` and fixed two
sprints later, before the gap caused a user-facing error.

## Takeaway

Bare TODOs are a form of untracked debt. INV-06 converts every TODO into a
tracked issue, making the backlog the authoritative source of what work is
pending. A TODO without an issue is a promise to no one.
