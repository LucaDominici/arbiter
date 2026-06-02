---
title: 'User-Toggle Catalog Preconditions and UX Scaffold'
doc_version: '1.0.0'
status: proposed
last_review: '2026-05-14'
owner: ''
canonical_id: '084'
tags: ['audience/dev', 'kind/adr']
related: ['083']
---

# ADR-084: User-Toggle Catalog Preconditions and UX Scaffold

**Project:** arbiter
**Date:** 2026-05-14
**Status:** Proposed (preconditions track open)
**Reference:** Issue #378; umbrella #344; ADR-083; CANON-02/03/07/08

> **Note:** This decision was originally recorded in `docs/SYSTEM/DECISIONS.md` as ADR-044.
> That ID was later reused for a different decision (Docs Site Versioning, `docs/ADR/044-docs-versioning.md`).
> Content extracted here as ADR-084 to resolve the collision.

## Context

Future feature: expose `arbiter init` and `arbiter configure` toggles for opt-in test categories (mutation, e2e, contract, BDD, a11y). Naïve exposure risks false confidence: a toggle that enables-without-effect (cf. HALF cells in ADR-083) is worse than an opaque always-on default — users believe they have a gate they do not have.

## Decision

Toggle UI is gated behind six hard preconditions; the ADR specifies the catalog source, the precondition set, and a minimal CLI scaffold that does **not** ship the toggle exposure yet (resist gold-plating; the deliverable is the contract, not the UI).

**Preconditions (HARD — all must hold before any per-category toggle is exposed):**

1. All HIGH-severity F-series closed (tracking: #347, #361–#366, #371–#373, #376 — all CLOSED as of 2026-05-14).
2. Per-cell decision recorded (#377, ADR-083). Status: CLOSED.
3. CANON-02 audit script wired L1 (`scripts/check-canon-02-proven-gated.mjs`). Status: OPEN — tracked as follow-up under #378.
4. Per-toggle integration test: ON → generated gate fails on violation; OFF → gate skips silently.
5. Toggle catalog sourced from matrix `proven` cells only. `beta`/`unsafe`/`unavailable` cells are invisible.
6. Self-test matrix (subset): render each `2^N` toggle combination for ≥1 archetype per language.

**Toggle-catalog data contract:** The catalog is a derived view, never hand-edited. Input: `cross-language-matrix.json`. Output: `{language, archetype} → toggleable_categories[]`. A category is `toggleable` iff: (a) matrix cell is `proven`, (b) gate step is conditionally rendered, (c) toggle has documented default state.

**Always-on categories (NOT toggleable):** unit tests, coverage, static analysis, security audit.

**UX scaffold (post-precondition; this ADR ships only the contract):** `arbiter init` interactive prompt, `arbiter configure` extension (ALLOWED_PATHS already enumerate `features.*` toggles).

## Consequences

### Positive

- Precondition 3 (CANON-02 audit script) is the explicit unblocker before any toggle UI is exposed.
- Toggle catalog never exposes `beta`/`unsafe`/`unavailable` cells — load-bearing invariant.
- `arbiter configure`'s ALLOWED_PATHS already enumerates `features.contractTesting`, `features.mutationTesting`, etc. — CLI plumbing is in place.

### Negative

- ADR delivery closes the design question; implementation acceptance remains gated on precondition 3 closure.
- A toggle exposed without precondition compliance is a CANON-02 violation.

## Links

- Issues: #378
- Related ADRs: ADR-083 (matrix downgrade-vs-fix verdict)
