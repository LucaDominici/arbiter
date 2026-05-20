---
title: 'ADR-040: Provenance Graph as a first-class primitive'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# ADR-040: Provenance Graph as a first-class primitive

**Status:** Accepted
**Date:** 2026-05-13
**Deciders:** Luca Dominici

## Context

arbiter accumulates governance artefacts in many places: invariants in `src/invariants/catalog.ts`, ADRs in `docs/ADR/`, canon rules in `docs/SYSTEM/CANON.md`, generated gates in `scripts/`, evidence in `.evidence/`. Today these are linked only by convention — the "chain of evidence" from an invariant to the gate that enforces it to the file that implements it to the test that proves it is reconstructed by humans grepping. As the catalog grows past 50 invariants this stops scaling.

## Decision

Introduce a typed, in-memory **Provenance Graph** under `src/graph/` and persist a snapshot to `.arbiter/graph.json`.

- Nine node kinds: `INV | ADR | REQ | CANON | FILE | SYMBOL | TEST | EVIDENCE | GATE`.
- Eight edge kinds: `enforces | decides | demands | implements | proves | produces | supersedes | promotes`.
- Builders are pure functions from upstream sources (catalog, parser, AST) to graph nodes/edges. Wave-1 ships only the `INV` builder.
- Two new commands: `arbiter graph build` (write snapshot) and `arbiter verify graph` (check failure classes). One new top-level command: `arbiter trace --from <id> [--depth N] [--format json|dot|mermaid]`.
- `.arbiter/graph.json` is gitignored — it is a derived artefact.

The graph is deliberately small in surface area (close-set node and edge kinds), large in reach (anything from a doc to a test can be wired in).

## Rationale

- **One representation, many consumers.** `trace`, `verify graph`, future dashboards, future audit reports all read the same store.
- **Forward-compatible.** Wave-1 only ships the `INV` builder, but `verify graph` already checks `implements` edges so it does not need to change when AST/test builders land.
- **Determinism for reviewability.** Stable sort + pretty-print means `graph.json` snapshots are byte-stable and CI-diffable.

## Consequences

**Positive:**

- A single source of provenance truth.
- New failure classes (orphan, untested, stale, dangling) become one-liners on the graph.
- `trace` answers "why is this rule here?" in one command, in three formats.

**Negative:**

- Adds a new derived artefact that must be regenerated to stay fresh — mitigated by ignoring `.arbiter/graph.json` and rebuilding in the gate.
- Wave-1 only catches the orphan-invariant failure class; AST/test builders are deferred to a follow-up.
