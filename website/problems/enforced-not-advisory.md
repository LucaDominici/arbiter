---
title: 'We document standards but they are not enforced'
doc_version: '1.0.0'
status: active
last_review: '2026-06-01'
owner: ''
canonical_id: ''
tags: []
related: []
---

# We document standards but they are not enforced

> We have a CONTRIBUTING guide and a style doc, but they are advisory — people (and AI agents) ignore them and nothing stops a violating change from merging.

## The problem

Written conventions decay because nothing makes them binding. A linter that only warns, a coverage
number nobody gates on, a "please write tests" note in the wiki — all of these are skippable. Over
time the documented standard and the actual codebase drift apart.

## Who feels it

- Tech leads whose standards are ignored under deadline pressure.
- Teams onboarding AI agents that don't reliably follow prose guidelines.
- Maintainers who keep leaving the same review comments.

## How arbiter enforces it

arbiter's core principle is **once a rule is chosen, it is enforced as a hard gate** — there is no
advisory tier. `arbiter init` generates `scripts/check-all.mjs`, the single enforcement point, plus
git hooks and CI workflows that run it. A violation fails the command (non-zero exit), so it cannot
commit, push, or merge.

Rules activate by **governance level** (recorded in `arbiter.json`):

- **L1** (pre-commit): lint, format, unit tests (INV-24).
- **L2** (pre-push / CI): adds coverage threshold, cyclomatic complexity (INV-05), dead-code
  detection (INV-06), dependency audit (INV-13), secret scan (INV-11), PII scan (INV-12) — all HARD.

Source: [Enforcement Philosophy](/governance/) (the "once chosen, enforced" thesis and the per-level
HARD matrix).

## How to verify

In a project created by `arbiter init` at L2:

```bash
# Introduce a function above the complexity limit, then:
node scripts/check-all.mjs L2   # exits non-zero — the gate blocks
```

Inspect `arbiter.json` (`governanceLevel`) and the generated `AGENTS.md`, which lists exactly which
invariants are HARD at your level.

## What it does NOT do

- It is **not free of trade-offs** — hard gates add commit/PR latency and reduce agent autonomy.
  That is the deliberate cost of enforcement, not a bug.
- It is **not a CI replacement** — the gate is one step you wire into your existing pipeline.

## Related

- [Agents drift from our conventions](/problems/agents-drift)
- [Concepts: governance levels & gate tiers](/concepts/)
- [How arbiter compares](/comparisons/)
