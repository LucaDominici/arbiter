---
title: 'Four-Pillar SSOT Infrastructure (AC#1 Deviation)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-13'
owner: ''
canonical_id: '086'
tags: ['audience/dev', 'kind/adr']
related: ['018']
---

# ADR-086: Four-Pillar SSOT Infrastructure (AC#1 Deviation)

**Project:** arbiter
**Date:** 2026-05-13
**Status:** Accepted
**Reference:** Issue #255; INV-47..INV-50

> **Note:** This decision was originally recorded in `docs/SYSTEM/DECISIONS.md` as a sub-entry `### ADR-042`.
> That ID was already in use for a different decision (Three-Tier Gate System, `docs/ADR/042-gate-tiers.md`).
> Content extracted here as ADR-086 to resolve the collision.

## Context

Issue #255 (AC#1) named `src/generators/ssot-four-pillar.ts` as the implementation target for the four-pillar production baseline SSOT model (Authority / Routing / Aliasing / Gates). However, `src/generators/ssot.ts` already emits three of the four pillars via a clean dispatch over `ProjectConfig.governanceLevel`. Adding a fourth pillar (CANONICAL_PATHS) is a one-line extension to the existing `files.push(...)` loop.

## Decision

Extend `src/generators/ssot.ts` rather than create a new `ssot-four-pillar.ts` file. CANON-16 forbids new files when a refactor of an existing module is viable. The deviation from AC#1's naming is documented here per CANON-01.

Design choices:

- **CANONICAL_PATHS uses `skipIfExists`**: Like KNOWLEDGE_MAP, alias entries accumulate manual edits over time. Re-running `arbiter init` must not clobber user-defined redirects.
- **Four gates as L1 checks**: INV-47 (ssot-core), INV-48 (doc-links), INV-49 (knowledge-map), INV-50 (canonical-paths) are all wired into the L1 block of `check-all.mjs`. Bootstrap mode (missing SSOT files) exits 0, so fresh projects are not blocked before SSOT files are populated.
- **CANON-01 dual-sided**: Each gate ships as both an arbiter-self script (`scripts/check-X.mjs`) and an emitted template (`src/templates/scripts/check-X.mjs.ejs`) for target projects.
- **`arbiter harness --fast`**: CLI command wrapping the four gates for target project use.

## Consequences

### Positive

- The production baseline four-pillar model (Authority / Routing / Aliasing / Gates) is fully realised in both arbiter-self and generated target projects.
- Moved/renamed docs no longer silently break links (CANONICAL_PATHS + check-canonical-paths).
- Missing SSOT entries detected at L1; all four gates bootstrap safely on new projects.

### Negative

- Deviation from AC#1's specified file name; rationale documented here per CANON-01.

## Links

- Issues: #255
- Related ADRs: ADR-018 (SSOT framework generation)
