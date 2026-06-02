---
title: 'Matrix Downgrade-vs-Fix Verdict — 7 HALF/FAKE Proven Cells'
doc_version: '1.0.0'
status: active
last_review: '2026-05-14'
owner: ''
canonical_id: '083'
tags: ['audience/dev', 'kind/adr']
related: ['084']
---

# ADR-083: Matrix Downgrade-vs-Fix Verdict — 7 HALF/FAKE Proven Cells

**Project:** arbiter
**Date:** 2026-05-14
**Status:** Accepted
**Reference:** Issue #377; umbrella #344; CANON-02, CANON-03, CANON-07; INV-32

> **Note:** This decision was originally recorded in `docs/SYSTEM/DECISIONS.md` as ADR-043.
> That ID was later reused for a different decision (Docs Site IA, `docs/ADR/043-docs-site-ia.md`).
> Content extracted here as ADR-083 to resolve the collision.

## Context

Forensic audit (umbrella #344, Wave 3) flagged seven cells in `src/compatibility/cross-language-matrix.json` as `proven` while the supporting gate wiring was either HALF (template emitted but no `runCheck` step) or FAKE (no template at all). CANON-02 forbids a `proven` claim without (a) a template, (b) a wired step in `check-all.mjs.ejs`, (c) a fixture passing the gate, and (d) a regression test.

Per-cell re-audit (2026-05-14):

| #   | Cell                  | Pre-audit                 | Verdict                                               |
| --- | --------------------- | ------------------------- | ----------------------------------------------------- |
| 1   | java × mutation       | HALF                      | **STAY proven** — gate step wired (PR #685, #432)     |
| 2   | typescript × mutation | HALF                      | **STAY proven** — gate step wired (PR #685)           |
| 3   | java × contract       | HALF (argv bug + broker)  | **STAY proven** — gate step wired (PR #685)           |
| 4   | typescript × contract | HALF (broker URL missing) | **STAY proven** — gate step wired (PR #430)           |
| 5   | python × e2e          | FAKE (no template)        | **STAY proven** — template + gate shipped (PR #687)   |
| 6   | typescript × e2e      | HALF (lint only)          | **STAY proven** — gate step wired (PR #687)           |
| 7   | java × e2e            | HALF (implicit IT)        | **STAY proven** — wired via Gradle/Maven L2 (PR #685) |

## Decision

All seven cells stay `proven`. Every cell now satisfies CANON-02 (a-d): template exists, gate step wired, fixture present, render/integration test passes. Issue #366 is closed by this ADR (PR #687 shipped templates before decision was reached). No `cross-language-matrix.json` edits required. CANON-02 regression guard (`scripts/check-canon-02-proven-gated.mjs`) deferred to #378.

## Consequences

### Positive

- Matrix authority preserved: future `proven` promotions inherit the CANON-02 audit script gate.
- Toggle-catalog work in #378 can source from a verified `proven` set.
- Open child issue #366 transitions to closed.

### Negative

- CANON-02 audit script deferred to issue #378 — until it lands, a new HALF claim could silently pass.

## Links

- Issues: #377
- Related ADRs: ADR-084 (user-toggle catalog preconditions)
