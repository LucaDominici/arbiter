---
title: 'ADR-032: Hook Hardness Manifest and Empirical Verification (INV-36)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: '032'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-032: Hook Hardness Manifest and Empirical Verification (INV-36)

**Status:** Accepted
**Date:** 2026-05-05
**Issues:** #402, #405, #410

## Context

Two arbiter-generated hooks were declared HARD in governance documents but exited 0 on violations — pure ceremony with no enforcement:

- `pre-edit-ssot-guard.mjs` warned on SSOT edits but never blocked.
- `pre-edit-plan-anchor.mjs.ejs` was an injector-only context printer; implementation-phase edits with no plan were silently allowed.

Without a structural verification mechanism, regressions could re-appear silently after any future hook edit.

## Decision

1. **Hard-block both hooks** (`#402`, `#405`): exit 2 on violation; respect session-scoped bypass env vars (`ARBITER_SSOT_BYPASS=1`, `ARBITER_PLAN_BYPASS=1`).

2. **Commit a hardness manifest** (`.arbiter/hooks-manifest.json`): every hook file in `src/templates/claude/hooks/` must have an explicit `HARD` or `ADVISORY` classification. HARD entries include a `fixture` and `expectedExitCode` for empirical spawn assertions.

3. **Wire a verifier** (`scripts/check-hardness-inventory.mjs`) into the L1 gate:
   - Drift detection: every hook file has a manifest entry; every entry points to an existing file.
   - Empirical assertion: every HARD+spawnable hook is spawned with its fixture and must exit the declared code.

4. **INV-36** added to `src/invariants/catalog.ts` (governance tier, alwaysActive).

## Consequences

- Hook hardness is a binary, mechanically-enforced invariant — ceremony cannot re-appear silently.
- Adding a new hook requires a manifest entry (gate blocks otherwise).
- Changing a HARD hook to exit 0 without updating the manifest fails L1 CI.
- EJS-template hooks (rendered at `arbiter init` time) are classified HARD in the manifest with `spawnable: false`; empirical coverage lives in their respective `__tests__/hooks/empirical/` test files.
