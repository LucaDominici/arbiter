---
description: Blast-radius analysis for a symbol or file — opt-in graph-first (graphify) with ripgrep fallback (skill:impact)
argument-hint: '<symbol-or-file>'
title: '/impact'
doc_version: '1.0.0'
status: active
last_review: '2026-06-15'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal', 'kind/analysis']
related: ['ship', 'ssot-navigation']
---

# /impact

`/impact <symbol-or-file>` reports the **blast radius** of a change — who depends on it,
upstream and downstream — before you touch it.

It loads the **`impact`** skill. The skill is **opt-in graph-first**: if the optional
`graphify` knowledge graph is installed and `graphify-out/graph.json` is present and fresh, it
queries the graph (deterministic, no-LLM, far cheaper than grep-and-read); otherwise it falls
back to ripgrep. graphify is **never required** — the command degrades gracefully when it is
absent.

## Use it

- **Before planning a change** — scope which files the change must touch.
- **Inside `/ship`** — in the plan and red-team phases, to confirm the plan reaches everything
  the change actually affects.

## Defaults

| Behavior        | Detail                                                                      |
| --------------- | --------------------------------------------------------------------------- |
| Graph detection | `command -v graphify` AND `graphify-out/graph.json` present                 |
| Freshness       | build-commit == HEAD AND clean working tree, else `graphify update .` first |
| Fallback        | ripgrep over the repo (excluding `dist/`, `node_modules/`)                  |

> See the **`impact`** skill for the full algorithm and hard rules.
