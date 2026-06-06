---
title: 'ADR-089: Collapse hand docs to SSOT-core + generated LLM-Wiki'
doc_version: '1.0.0'
status: active
last_review: '2026-06-06'
owner: ''
canonical_id: '089'
tags: ['audience/dev', 'kind/adr']
related: ['088-ship-as-orchestration-entrypoint']
---

# ADR-089: Collapse hand docs to SSOT-core + generated LLM-Wiki

**Status:** Active
**Date:** 2026-06
**Related:** PRD-docs-evolution, DISPOSITION-REGISTER, #1234 (LLM-wiki spike), #1225 (CI parity)
**Supersedes/affects:** the bespoke knowledge-map (KNOWLEDGE_MAP.md + `knowledge-map-update.mjs` + sync gh-action), Obsidian vault curation workflow.

## Context

333 doc files, almost all LLM-generated, none hand-crafted by the owner, who cannot navigate them.
The authoritative truth (CANON, invariants, PM bible, architecture) is diluted among hundreds of
narrative/how-to/marketing/point-in-time files. A bespoke Obsidian "knowledge-map" adds maintenance
without solving navigation. Two industry patterns are relevant: **DeepWiki** (auto wiki + Q&A reader)
and **Karpathy's LLM-Wiki** (LLM compiles & maintains a cited wiki from sources). The Karpathy
pattern's "Lint for broken-links/orphans/stale/contradictions" is _already_ arbiter's anti-drift
philosophy (cf. STATUS/GAP/doc-index gates).

## Decision

**Adopt a three-tier documentation model** collapsing 333 hand docs to ≈12 SSOT-core files + a
generated wiki + history tier.

1. **Hand SSOT core (~10-12 files)** — the only docs a human writes/maintains: CANON, ARCHITECTURE,
   ENGINEERING_DEFAULTS, PROCESS, TESTING, GOVERNANCE, CONTRIBUTING, PRODUCT bible
   (PRD/MILESTONES/FEATURE_MATRIX/STATUS/GAP), + small gated contracts.
2. **Generated tier** — existing indexes/registries **plus a new generated LLM-Wiki** (`wiki/`,
   Obsidian-compatible markdown+wikilinks) compiled from source + the core, with mandatory
   **citations**, incremental **on-commit** updates, and a **Lint gate** (broken
   links/orphans/stale/contradictions = build red).
3. **History tier** — `docs/ADR/` untouched.

Everything explanatory (narrative, how-to, recipes, marketing, specs, migration guides, incident
exemplars) moves to the **generated wiki**; everything point-in-time (audits, dated reports, coverage
stubs, dups) is **deleted**. The bespoke knowledge-map is **retired**; Obsidian becomes a pure viewer
of the generated `wiki/`.

The wiki is **explicitly non-authoritative**: on any conflict, SSOT (CANON/invariants/ADR) wins (same
contract as claude-mem). The wiki ships **dual-sided** (CANON-01/14) so governed projects inherit the
model.

## Consequences

**Positive:** hand surface 333 → ≤20; navigation via wiki Query; zero-maintenance explanatory docs;
drift-proof via Lint-gate; less doc-tooling LOC; on-brand (generated+gated+dual-sided+grounded).

**Negative / cost:** building the wiki generator (non-trivial); a churn window where gates must be
updated alongside doc moves; LLM hallucination risk (mitigated by citations + Lint-gate +
non-authoritative status); INV-108 retagging required so WIKI docs leave the core set.

**Neutral:** ADRs and the PM bible unchanged; deepwiki.com remains an optional hosted _reader_ once
public (v1).

## Alternatives considered

- **Hosted DeepWiki only** — rejected: arbiter is private; also a reader, not a maintenance fix.
- **deepwiki-open self-host only** — good interim reader, but lives outside the gated pipeline, can
  drift, ungrounded.
- **Keep hand docs, just consolidate** — rejected: owner's intent is aggressive de-bloat; doesn't
  kill the maintenance burden.
- **Do nothing** — rejected: owner cannot navigate; bespoke knowledge-map keeps costing.

## Invariants / gates touched

- New: wiki-lint gate (candidate INV).
- Updated in same PRs as doc moves: check-canon-references, check-ssot-core (INV-108),
  check-doc-links, doc-index (gen-doc-index), check-knowledge-map (retire),
  check-canonical-paths, check-deprecations, feature-matrix, STRIDE/RACI.
- CANON-08 catalog↔AGENTS parity + CANON-01/14 dual-sided render tests for the new generator.

## Rollout

Sequenced per PRD §6: P0 wiki capability → P1 consolidate core → P2 delete disposables → P3 migrate
WIKI docs → P4 retire knowledge-map → P5 (v1) hosted reader. Gated by `check-all --level L2`
(after #1225 makes CI==pre-push — now done).
