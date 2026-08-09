---
title: 'ADR-112: project-declared invariants (PROJ-NN) — the project is the author of its own catalog additions (#2035)'
doc_version: '1.0.0'
status: active
last_review: '2026-08-04'
owner: ''
canonical_id: '112'
tags: ['audience/dev', 'kind/adr']
related: ['111-tier-origination-human-only']
---

# ADR-112: project-declared invariants (PROJ-NN) — the project is the author of its own catalog additions (#2035)

**Project:** arbiter
**Date:** 2026-08-04
**Status:** Accepted
**Issue:** #2035 (workstream 1 of epic #2034, roadmap #737)

## Context

The invariant catalog (`src/invariants/catalog.ts`, 137 entries) is a hardcoded SSOT:
a consumer project can only _filter_ it (tier presets, `invariants_catalog: core|extended`),
never _add_ to it. A governed consumer's product-specific invariants (tenancy `owner_id` /
`TripAccessContext`, GDPR-as-product-contract) have no home except hand-maintained
markdown that drifts — three different counts in three files were verified in the survey.
The catalog's INV-NN namespace is reserved for arbiter-shipped rules; a separate,
project-owned namespace was required.

## Decision

1. **Namespace.** Projects declare their own invariants as `PROJ-NN` (mandatory
   `/^PROJ-\d+$/`), never `INV-NN` (reserved; validated with a clear message naming the
   offending id). Duplicate ids and retired-status entries are rejected at config
   validation.
2. **Config surface.** `governance.projectInvariants[]` in `arbiter.json`, validated by
   `validateConfig` (shape, id pattern, duplicates, retired status, required fields,
   `languageDetail` coverage of `languages` — mirror of the #680 catalog rule).
3. **Single merge point.** `getFilteredInvariants` is the only place project invariants
   enter: they propagate to AGENTS.md, GLOBAL_INVARIANTS.md, `verify graph`, `explain`,
   and the parity gate by construction. Project invariants pass the same per-entry gates
   as catalog entries (retired/selfOnly/extended/language/minGovernanceLevel) **except
   the tier filter** — declared = wanted, a tier mismatch never silently drops a
   project-declared rule. Merge order is deterministic: catalog entries first, then
   project invariants in declaration order.
4. **Plugins.** `ArbiterPlugin.invariants?: Invariant[]` lets stack presets contribute
   invariants. `validatePluginShape` applies the same PROJ-NN/duplicate rules at load
   time; the proxy forwards them; the host merges them before generation with
   deterministic precedence **catalog < plugin < config** (config wins on id conflict,
   so a project can override a stack preset). The merged set is persisted into the saved
   `arbiter.json` (self-describing governance snapshot; `explain PROJ-NN` resolves from
   the config), so plugin invariants are visible and overridable.
5. **Graph.** `verify graph` treats an enforcement-less PROJ as an orphan, exactly like
   a built-in INV — the enforcement-declared-or-orphan contract is namespace-blind.
6. **Parity.** `check-global-invariants-parity.mjs --config=arbiter.json` extends the
   doc↔catalog parity contract to the merged set: every always-active declared PROJ must
   be documented, and every PROJ section in the doc must be declared (no phantom project
   invariants). Without `--config` (arbiter's own invocation) PROJ sections are
   tolerated.

## Consequences

- A project can now be the author of its own governance rules without touching the
  catalog; the catalog count stays frozen (no PROJ entry ever enters `INVARIANT_CATALOG`).
- Update round-trips: the merged set is persisted on init; `arbiter update` passes the
  stored config through untouched, so hand-written project invariants survive.
- The D-NN → PROJ-NN promotion path (a decision that matures into a permanent rule) is
  documented in the decision-registry template (#2036) — one rule lives in ONE registry.
- A plugin that changes its invariants requires a config edit to re-merge (config wins
  after persistence) — acceptable for stable stack presets; documented tradeoff.
