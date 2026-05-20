---
title: 'SSOT Core Set — arbiter'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/ssot']
related: []
---

# SSOT Core Set — arbiter

**Status:** ENFORCED
**Archetype:** `library`

**Location:** `docs/METHOD/SSOT_CORE_SET.md`
**Purpose:** Authoritative inventory of all Single Source of Truth documents in this project. Every canonical document governing product, system, or process MUST be listed here.

---

## Governance (HOW Agents Must Behave)

- `AGENTS.md` — Canonical agent governance: invariants, coding standards, commit convention, gate commands

## Method (HOW We Execute)

- `docs/METHOD/KNOWLEDGE_MAP.md` — Navigation index for heavy documentation; read this before opening large docs
- `docs/METHOD/SSOT_CORE_SET.md` — This file (authoritative SSOT inventory)
- `docs/METHOD/CANONICAL_PATHS.md` — Aliasing registry for moved/renamed documents; check before reporting broken links

- `docs/METHOD/ENGINEERING_DEFAULTS.md` — SOLID principles, coding standards, complexity limits
- `docs/METHOD/TAG_TAXONOMY.md` — Closed vocabulary for the `tags:` frontmatter field on hand-authored docs
- `docs/METHOD/DOC_SEMVER.md` — Per-document content semver policy (`doc_version:` axis, distinct from product semver)
- `docs/METHOD/CONTEXT_PACK_SPEC.md` — Deterministic context-bundle artifact spec (Verification Bridge §Port #14a)
- `docs/METHOD/TRACK_MODEL.md` — Work-scope taxonomy (core/templates/kit/docs/ci/meta) with CODEOWNERS + CI gate subsets

## Entrypoints (HOW To Start)

- `docs/QUICKSTART.md` — 5-minute install + first command + first gate run
- `OBSIDIAN.md` — How to open this repository as an Obsidian vault

## Spines (HOW To Navigate Subtrees)

- `docs/GOVERNANCE/README.md` — Governance directory spine (RACI, CoC, contributor policy)
- `docs/architecture/README.md` — Architecture directory spine (OVERVIEW, CANONICAL-SOURCE-MODEL, TEMPLATE-SYSTEM, CONFLICT-RESOLUTION, dual-track-contract, evidence-bundle, skeleton-governance)
- `docs/api/README.md` — Public API surface spine (compatibility, invariants, plugin snapshots)

## System (HOW We Build It)

> Add architecture, ADR, and decision records here as the project grows.
>
> Examples:
>
> - `docs/SYSTEM/ARCHITECTURE.md` — Technical architecture overview
> - `docs/SYSTEM/DECISIONS.md` — Architectural Decision Records

---

## Maintenance Rules

1. Every canonical document added to the project MUST get an entry in this file.
2. Entries must include the path and a one-line purpose description.
3. Removed documents must be removed from this index.
4. Run a SSOT integrity check when the index and filesystem diverge.
