---
title: 'Incident: INV-32 (matrix fixture parity) blocking a `beta → proven` promotion'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Incident: INV-32 (matrix fixture parity) blocking a `beta → proven` promotion

**Invariant:** INV-32 — every language with ≥1 `proven` cell must have a fixture  
**Gate:** `node scripts/check-matrix-fixtures.mjs` (L1)  
**Policy:** `.claude/rules/95-matrix-fixture-policy.md`

---

## What happened

During milestone M18, a developer promoted the Go/library archetype from
`beta` to `proven` in `src/compatibility/cross-language-matrix.json` after
confirming that the generated hooks and gate scripts worked correctly in
manual testing.

The PR passed linting and type-checking. But the L1 gate failed:

```
matrix fixtures ... FAIL
  language "go" has proven cells but no fixture under __tests__/fixtures/real-projects/
  Fix: add a fixture with manifest.json (language, archetype, levels fields required)
```

## Why the rule exists

A `proven` cell means the framework guarantees its generated config works for
that language/archetype combination. "It worked in my manual test" is not a
guarantee — it is an anecdote. The fixture represents a minimal but real
project structure that the test suite can run `arbiter init` against and
verify the output.

Without the fixture:

- Future changes to the Go generator cannot be regression-tested
- The `proven` claim in the matrix cannot be verified by CI
- Users who adopt Go/library governance have no test evidence that it works

## The fix

The developer added:

```
__tests__/fixtures/real-projects/go-library/
  manifest.json      (language: "go", archetype: "library", levels: ["L1","L2"])
  go.mod
  main.go
  .arbiter-generated.json  (expected output for snapshot comparison)
```

The L1 gate passed. The promotion was merged.

## Impact

The blocked PR spent 40 minutes in review before the developer noticed the
gate failure. After the fixture was added (15 minutes of work), the merge
proceeded. The gate saved a `proven` promotion that had no CI evidence behind
it.

## Takeaway

Promotion gates have to be hard blocks, not warnings. A `proven` claim with
no fixture is marketing, not engineering. INV-32 enforces that every
promotion is backed by runnable evidence.
