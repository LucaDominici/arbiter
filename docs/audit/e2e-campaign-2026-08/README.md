---
title: 'E2E campaign & RTM — August 2026'
doc_version: '1.0.0'
status: active
last_review: '2026-08-03'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/audit']
related: []
---

# E2E campaign & RTM — August 2026

Durable evidence for the end-to-end verification campaign run against arbiter 0.5.0
on 2026-08-03, and for the `/ship` v2 experimental study that preceded it.

## What is here

| File                                     | What it holds                                                                                                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVENTORY.md`                           | The requirements inventory: 96 requirements in 8 functional areas, each with a use case, a coverage pointer, and an E2E verification recipe. The RTM skeleton.              |
| `area1-results.md` … `area78-results.md` | Per-area execution results: 215 use cases run against the compiled binary in throwaway projects, with verbatim commands, output tails, and PASS/FAIL/BLOCKED/SKIP verdicts. |
| `DRAIN-STRATEGY.md`                      | How the resulting backlog is clustered and drained (file-set-disjoint clusters, one plan per cluster).                                                                      |
| `STUDY-DESIGN.md`, `ANALYSIS-PLAN.md`    | The `/ship` v2 study: design v2 after adversarial review, and the analysis plan frozen before any paid run.                                                                 |
| `study-c-detector-results.md`            | Study C: text-only complexity triage measured on 45 real closed issues — the result that disqualified LLM-only tier routing.                                                |

## Why it is committed

The campaign found 59 negative outcomes across 215 executed cases; 14 defects were fixed,
verified against the binary, and merged. Every finding has a GitHub issue, but the issues
carry conclusions, not the execution record. This directory is the record: what was run,
what was observed, and what was left unverified.

Two things it deliberately preserves:

- **The unverified surface.** Interactive TTY flows, operations needing a real GitHub
  remote, and higher governance levels are marked SKIP with the reason. A campaign that
  hides its gaps is worth less than one that names them.
- **Attribution caveats.** Three rows note that the harness proves the gate ran, not the
  requirement's stated observable. Those notes stay.

## How to use it

Re-running an area is a matter of following the recipes in `INVENTORY.md` against a fresh
build. When a requirement's coverage changes, update its row rather than appending a new
report — the inventory is meant to age with the product, not to be a snapshot.
