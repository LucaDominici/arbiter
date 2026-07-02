---
generated: true
source: 'docs/PRODUCT/PRD-DOCS-EVOLUTION.md'
source_sha: 'a8737c27280f84b049806db7c8a0b653ffee1f2c'
last_updated: '2026-07-02'
---

# PRD — Documentation Evolution: SSOT-core + Generated LLM-Wiki

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/PRODUCT/PRD-DOCS-EVOLUTION.md](../docs/PRODUCT/PRD-DOCS-EVOLUTION.md)

# PRD — Documentation Evolution: SSOT-core + Generated LLM-Wiki

**Status:** Active
**Owner:** Luca
**Related:** ADR-089, DISPOSITION-REGISTER, #1234 (LLM-wiki spike), #1239 (umbrella)

## 1. Problem

arbiter has **333 documentation files**. The owner — who hand-wrote ~none of them; they are
LLM-generated — gets lost navigating them. The hand-maintained surface is far larger than what is
actually authoritative. The bespoke Obsidian "knowledge-map" machinery (scripts + gh-action sync +
manual vault curation) adds maintenance cost without solving navigation. Meanwhile the load-bearing
truth (CANON, invariants, the PM bible, architecture) is diluted among hundreds of narrative, how-to,
marketing, and point-in-time files.

## 2. Goals

- **G1.** Reduce the hand-maintained doc surface from 333 to **≈10-12 authoritative SSOT core
  files** (the things a human reads/maintains), without losing information.
- **G2.** Replace hand-written _navigation/explanation_ with an **auto-generated, queryable wiki**
  (Karpathy LLM-Wiki pattern) grounded in source, so explanatory docs need no manual upkeep.
- **G3.** Make the wiki **drift-proof and audit-grade**: citations mandatory, "Lint" promoted to a
  **gate** (broken links / orphans / stale / contradictions = red), like STATUS/GAP/doc-index.
- **G4.** Keep **Obsidian as a pure viewer** over the generated markdown+wikilinks; **delete the
  bespoke knowledge-map scripts/gh-action**.
- **G5.** Ship the capability **dual-sided** (CANON-01/14): governed projects get the same SSOT-core
  discipline + generated wiki.

## 3. Non-goals

- Not touching **ADR/** (91 files) — append-only decision history.
- Not touching **generated registries/indexes** (INDEX, SSOT_CORE_SET, DECISIONS, KNOWLEDGE_MAP→to
  be retired, HOOK-CONTRACTS, REUSE_REGISTRY, CLI/HOOKS/TEMPLATES/STACK-SUPPORT, api).
- The wiki is **non-authoritative**: it navigates, it never overrides SSOT (CANON/invariants/ADR win
  on conflict, like claude-mem).
- Not making arbiter public (separate v1 track); deepwiki.com hosted reader is a v1 bonus.

## 4. Target structure (3 tiers)

1. **Hand SSOT core (~12)** — CANON.md; ARCHITECTURE.md; ENGINEERING_DEFAULTS.md; PROCESS.md;
   TESTING.md; GOVERNANCE.md; CONTRIBUTING.md; PRODUCT bible (PRD, MILESTONES, FEATURE_MATRIX,
   STATUS, GAP); small gated contracts (CANONICAL_PATHS, DEPRECATIONS, SECURE_CODING_CHECKLIST,
   PLUGIN-API, SEMVER). See DISPOSITION-REGISTER §KEEP-CORE.
2. **Generated tier** — indexes/registries (unchanged) + the **new generated wiki** (`wiki/`,
   Obsidian-compatible) compiled from source + the core.
3. **History tier** — `docs/ADR/` (untouched).

## 5. Success metrics

- Hand doc count: **333 → ≤ 20** (core + gated contracts + generated indexes; ADR excluded as
  history).
- WIKI/DELETE executed: ≥ 80% of narrative files removed from the SSOT tree with **zero broken
  gates** (`check-all --level L2` green throughout).
- Wiki freshness: a wiki-lint **gate** fails on any broken link / orphan / stale page → drift
  impossible.
- Navigation: owner can answer "where is X / how does Y work" via the wiki Query in < 30s without
  grepping 333 files.
- Maintenance: bespoke knowledge-map scripts + gh-action **deleted**; net LOC of doc-tooling down.

## 6. Phased delivery (sequenced — see issues)

- **P0 — Wiki capability first** (prerequisite): generator (`raw/`+source → `wiki/` with index/log,
  citations), incremental on-commit, **Lint-as-gate**, dual-sided. _WIKI content needs a home before
  any hand doc is deleted._
- **P1 — Consolidate core**: merge the KEEP-CORE sets into ARCHITECTURE/PROCESS/TESTING/GOVERNANCE/
  CONTRIBUTING; update every gate-referenced path + INDEX + doc-links in the same PRs; retag via
  INV-108 lever.
- **P2 — Delete disposable tier**: audits, coverage stubs, point-in-time reports, dups (no wiki
  dependency) + gate updates.
- **P3 — Migrate WIKI docs**: retag to non-backbone kind, confirm wiki covers them, delete hand
  docs.
- **P4 — Retire knowledge-map**: delete bespoke scripts + gh-action; Obsidian reads the generated
  `wiki/`.
- **P5 (v1 bonus)** — deepwiki.com hosted reader for the public repo.

## 7. Risks & mitigations

- _Content loss_ → wiki-before-delete sequencing; git history preserved; DISPOSITION-REGISTER
  reviewed.
- _Broken gates_ → every core move ships its `check-*.mjs` update in the same PR; `check-all
--level L2` is the gate (CI==pre-push after #1225).
- _LLM hallucination in wiki_ → mandatory citations + Lint-gate + non-authoritative status.
- _Over-deletion_ → DISPOSITION-REGISTER is explicit per file; P2 deletes only high-confidence
  disposables.

## 8. Dependencies

- **#1225** (pre-push == CI) — now done.
- **#1224** (clear current main red) — now done.
