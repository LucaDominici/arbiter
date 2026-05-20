---
title: 'ADR-018: SSOT Framework Generation (M20)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# ADR-018: SSOT Framework Generation (M20)

**Status:** Accepted
**Date:** 2026-04-09
**Issue:** #38

---

## Context

The production baseline SSOT (Single Source of Truth) framework is the backbone of context-efficient agent navigation. It uses three interlocking documents — `KNOWLEDGE_MAP.md`, `SSOT_CORE_SET.md`, and `ENGINEERING_DEFAULTS.md` — plus a `TRACK_ROUTER.md` routing guide to help agents find the right document without reading everything.

Projects initialized with arbiter had no SSOT skeleton. Teams had to build this structure from scratch, leading to inconsistent documentation and agents that read entire files instead of navigating to specific sections.

---

## Decision

Arbiter generates a `docs/METHOD/` SSOT skeleton as part of `arbiter init` and `arbiter update`, with adoption tiers matching the governance level:

**L1 (essential):**

- `docs/METHOD/SSOT_CORE_SET.md` — Authoritative inventory of all canonical documents
- `docs/METHOD/KNOWLEDGE_MAP.md` — Navigation index with section breakdown per document

**L2 (standard) — adds:**

- `docs/METHOD/ENGINEERING_DEFAULTS.md` — SOLID-first policy + language-specific complexity limits (cognitive complexity, nesting, parameter count tables for TS/Java/Rust/Go/Python)

**L3 (full) — adds:**

- `docs/METHOD/TRACK_ROUTER.md` — Query-to-document routing table; maps agent intent to the right starting document and section

### Key design choices

**`KNOWLEDGE_MAP.md` is `skipIfExists`:** The knowledge map accumulates project-specific line ranges and section notes over time. Regenerating it would destroy those edits. All other files use `backup: true` (regenerated, prior version backed up).

**Language-aware `ENGINEERING_DEFAULTS.md`:** Complexity limit tables are emitted only for the detected project language. A Java project gets a Java table (SonarQube metrics); a TypeScript project gets an ESLint-compatible table. Unknown/multiple languages get the TypeScript/JS table as default.

**`SSOT_CORE_SET.md` is adoption-tier-aware:** The L1 version omits references to `ENGINEERING_DEFAULTS.md` and `TRACK_ROUTER.md` since those files are not generated at that tier.

---

## Consequences

- Teams get a working SSOT skeleton on first `arbiter init` with no manual bootstrapping.
- Agents can use `KNOWLEDGE_MAP.md` immediately to navigate without reading full documents.
- `ENGINEERING_DEFAULTS.md` gives consistent complexity limits that match the project's language toolchain.
- `TRACK_ROUTER.md` (L3) provides explicit routing rules that reduce context waste in large projects.
- `KNOWLEDGE_MAP.md` is intentionally not regenerated on `arbiter update` to protect manual edits.

---

## Amendment (post-review)

Post-merge code review identified three issues, fixed in the same PR cycle:

- **Template**: Sequential `if` blocks in `ENGINEERING_DEFAULTS.md.ejs` converted to `else if` chain to enforce mutual exclusivity of language sections at the template level.
- **Tests**: Added coverage for `unknown` language (fallback → TypeScript table), `rust`, `go`, `python`, and a cross-language mutual exclusivity test verifying exactly one section renders per language.
- **skipIfExists test**: Strengthened to write actual manual edits between runs and assert they survive, rather than only checking the returned action enum.
