---
name: impact
description: Use when you need the blast radius of a change — "who calls X", "what breaks if I touch Y", upstream/downstream dependents of a symbol or file. Opt-in graph-first: if the optional `graphify` knowledge graph is present and fresh, query it (deterministic, no-LLM, ~1000x fewer tokens than grep-and-read); otherwise fall back to ripgrep. Never required — degrades gracefully when graphify is absent.
argument-hint: '<symbol-or-file>'
title: 'Impact (blast radius)'
doc_version: '1.0.0'
status: active
last_review: '2026-06-15'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal', 'kind/analysis']
related: ['ssot-navigation', 'understand-code', 'ship']
---

# Impact (blast radius)

**Goal:** answer "what depends on X?" — the upstream/downstream blast radius of a symbol or
file — accurately and cheaply, before you change it.

**Opt-in, graph-first.** arbiter does not require any graph tool. But if the optional
[`graphify`](https://github.com/) knowledge graph is installed and a `graphify-out/graph.json`
exists in the repo, this skill queries the graph **first** — it is deterministic (no LLM),
pre-computes the dependency edges, and answers a blast-radius query in ~1000x fewer tokens than
loading every grep hit. When the graph is absent or the symbol is not in it, the skill falls
back to ripgrep. Either way you get an answer; the graph just makes it cheap and complete.

> This is the analysis sibling of `/ship`: run `/impact` to scope a change before planning, and
> in `/ship`'s plan/red-team phases to validate that the plan touched everything the change
> actually reaches.

---

## Step 0 — Detect availability (graceful)

```bash
command -v graphify >/dev/null 2>&1 && test -f graphify-out/graph.json
```

- **Available** → continue with the graph path (Steps 1–3).
- **Not available** → skip to **Fallback (ripgrep)**. Do NOT fail; graphify is optional. If the
  user wants the cheap path, tell them once: install the `graphify` CLI (a `uv tool`) and run
  `graphify update .` to build `graphify-out/`.

---

## Step 1 — Ensure the graph is fresh (deterministic, no-LLM)

The graph is a derived artifact; it is only trustworthy when it matches the working tree.

```bash
# Stale if the recorded build commit != HEAD, or tracked code changed in the working tree.
build_commit="$(sed -n 's/^build_commit: *//p' graphify-out/GRAPH_REPORT.md 2>/dev/null)"
head="$(git rev-parse HEAD)"
if [ "$build_commit" != "$head" ] || ! git diff --quiet; then
  graphify update .            # deterministic refresh; no model involved
fi
```

Refreshing is cheap and never asks a model anything — it re-extracts edges from source.

---

## Step 2 — Query the blast radius

```bash
graphify explain "<symbol>" --graph graphify-out/graph.json   # upstream + downstream dependents
graphify path "<A>" "<B>"   --graph graphify-out/graph.json   # shortest dependency chain A→B
```

- Treat `EXTRACTED` edges (found in real code) as reliable.
- Flag `INFERRED` edges (model-guessed at graph-build time) as "verify by hand" in any
  review/red-team note — do not trust them blindly.

---

## Step 3 — Report

Summarize: the changed symbol/file, its **direct** dependents, the **transitive** reach
(modules/files), and any `INFERRED` edges that need manual confirmation. Feed this into the plan
(which files the change must touch) and the red-team (what it might have missed).

---

## Fallback (ripgrep)

When graphify is unavailable or returns "not in graph" (a miss), use ripgrep — correct, just
more tokens:

```bash
rg -n --no-heading -w "<symbol>" -g '!**/dist/**' -g '!**/node_modules/**'
```

Then read the hits to separate definitions from call sites. This is the historical default and
is always available; the graph is purely an optimization on top of it.

---

## Hard rules

- **Optional, never fatal.** No gate, plan, or `/ship` phase may _require_ graphify. Absence ⇒
  fall back, never error.
- **Deterministic graph only.** Graph build/refresh (`graphify update`) is no-LLM; never "guess"
  a blast radius and present it as graph output.
- **Freshness before trust.** A stale graph is worse than none — always run Step 1 first.
