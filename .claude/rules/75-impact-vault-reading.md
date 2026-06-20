---
title: 'Impact-First Editing Rule'
doc_version: '1.0.0'
status: active
last_review: '2026-06-20'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# Impact-First Editing Rule

Before you change a module, know what depends on it. arbiter already emits a
dependency graph and an `/impact` analysis skill — but nothing makes you _read_ it
before editing. A change made blind to its blast radius is how a "small fix" silently
breaks three callers you never opened.

## The Contract

Before editing a module that is **shared, core, or reached by more than one caller** —
and always before a change that touches **2+ files** — first establish its blast radius:

```
/impact <symbol-or-file>
```

`/impact` is **graph-first**: when the optional `graphify` knowledge graph
(`graphify-out/graph.json`) is present and fresh, it answers from the precomputed
dependency edges — deterministic, no-LLM, ~1000x cheaper than loading every grep hit.
When the graph is absent or the symbol is not in it, it **falls back to ripgrep**, so
you always get an answer. Reading the graph is never required for the gate to pass — but
it is the cheapest way to avoid an out-of-scope break.

Record the result in the plan: the upstream callers and downstream dependents the change
reaches, and which of them this edit must keep working. The plan's `files:` manifest
should cover them — if `/impact` surfaces a dependent outside the manifest, widen the
plan or capture it with `arbiter note`, do not edit it incidentally.

## What This Is NOT

- A hard gate — this is **advisory**. It blocks nothing; it directs attention. It
  composes with the `pre-edit-plan-anchor` hook (which enforces the plan) and the
  incidental-capture rule (which keeps out-of-scope dependents out of the diff).
- A requirement to install `graphify` — arbiter never requires a graph tool. The skill
  degrades to ripgrep with no loss of correctness, only of cheapness.
- Applicable to a one-line edit in a leaf file with no dependents — judgment, not
  ceremony.

## Why

The blast radius of a change is knowable _before_ you make it, and arbiter already paid
to compute it. Reading it first turns "I think this is isolated" into "I verified what
this reaches" — the difference between a reviewed change and a hopeful one.
