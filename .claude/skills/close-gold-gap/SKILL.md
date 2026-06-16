---
name: close-gold-gap
description: Use when the gold-audit reports an N/P gap (or a manual check) and you want the deterministic remediation recipe — scaffold/test/config/process — that closes it for a REAL reason, never by faking it.
title: 'Close Gold Gap'
doc_version: '1.0.0'
status: active
last_review: '2026-06-16'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: ['gold-audit', 'tdd']
---

# Close Gold Gap

Turn one gold-audit gap into a concrete, deterministic remediation **recipe** — then carry it out.
This skill **never fakes a close**: a recipe is a plan of real work, not a shortcut to flip a verdict.

## When to use

After `arbiter gold-audit` reports a gap (an `N` or `P` check, or a `manual` check that a human must
attest). Pick the gap's `id` and ask for its recipe.

## Workflow

1. Run the audit to list the gaps:

```bash
npx arbiter gold-audit
```

2. Get the recipe for one gap:

```bash
npx arbiter close-gold-gap <gapId>
# machine-readable:
npx arbiter close-gold-gap <gapId> --json
```

3. Execute the recipe's steps yourself. Each step is typed by **category**:

| Category    | What the recipe does                                                            | Honest outcome |
| ----------- | ------------------------------------------------------------------------------ | -------------- |
| **doc-set** | Scaffold the missing doc (`check-doc-set --generate`) **then fill real content** | `P` → `Y` only after real content |
| **test**    | Write the missing test(s) TDD-first (loads the `tdd` skill)                      | `Y` when the real metric meets the bar |
| **config**  | Wire the real tool/config the check verifies                                     | `Y` when the tool genuinely runs |
| **process** | Human-only action for a `manual` check — **no code recipe**                      | `NV` (code cannot verify it) |

## Anti-fake-green (hard rules)

- A doc **stub** proves presence, not closure — a scaffold-only step is `P`, **never** `Y`. Fill it
  with real content before claiming the check.
- A `manual` check is `NV`: code cannot verify it. There is **no** code recipe — a human performs and
  records the real-world action. Never try to make code "pass" a manual check.
- **No suppression** — a recipe never contains `--no-verify`, `eslint-disable`, `skip`, or `ignore`.
- **No marker-stuffing** — never write the matched `pattern`/`equals` literal as the sole action; wire
  the behavior the check is verifying.

## Re-audit

After executing a recipe, re-run `npx arbiter gold-audit` and confirm the gap flipped for a real
reason — the genuine metric improved or real content/config now exists. If it only flipped because a
threshold moved or a literal was pasted in, that is fake-green: revert and do the real work.
