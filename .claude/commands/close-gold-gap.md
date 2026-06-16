---
description: Emit the deterministic remediation recipe for one gold-audit gap — scaffold/test/config/process, never a fake close (skill:close-gold-gap)
argument-hint: '<gapId>'
title: '/close-gold-gap'
doc_version: '1.0.0'
status: active
last_review: '2026-06-16'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal', 'kind/remediation']
related: ['gold-audit', 'tdd']
---

# /close-gold-gap

`/close-gold-gap <gapId>` prints the **remediation recipe** for one gold-audit gap — the concrete,
deterministic steps that close it for a **real** reason. It loads the **`close-gold-gap`** skill.

It runs the existing gold-audit engine (one engine, never a second), finds the requested `N`/`P` gap
(or a `manual` check), and emits the typed recipe from the remediation catalog. It **never executes**
the recipe and **never fakes a close**.

## Use it

```bash
npx arbiter gold-audit          # list the gaps
npx arbiter close-gold-gap <gapId>        # human recipe
npx arbiter close-gold-gap <gapId> --json # machine-readable recipe
```

## Recipe categories

| Category    | Action                                                        | Honest outcome              |
| ----------- | ------------------------------------------------------------ | --------------------------- |
| doc-set     | scaffold the doc, **then fill real content**                  | `P` → `Y` after real content |
| test        | write the missing test(s) TDD-first (`tdd` skill)            | `Y` when the metric meets the bar |
| config      | wire the real tool/config the check verifies                  | `Y` when the tool runs      |
| process     | human-only action for a `manual` check — no code recipe       | `NV` (code cannot verify)   |

> A scaffold is `P`, not `Y` (presence ≠ closure). A `manual` check has no code recipe. Recipes carry
> **no suppression** and **no marker-stuffing**. See the **`close-gold-gap`** skill for the full rules.
