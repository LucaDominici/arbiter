---
title: 'ADR-114: extended-set activation + live-SSOT drift binding (#2044)'
doc_version: '1.0.0'
status: active
last_review: '2026-08-04'
owner: ''
canonical_id: '114'
tags: ['audience/dev', 'kind/adr']
related: ['112-project-invariants-proj-nn']
---

# ADR-114: extended-set activation + live-SSOT drift binding (#2044)

**Project:** arbiter
**Date:** 2026-08-04
**Status:** Accepted
**Issue:** #2044 (F-ENG-01 / F-SSOT-05 transposition, epic #2034)

## Context

The extended invariant set (INV-62..INV-71, incl. INV-63 SSOT-atomic, INV-64/69/70
abstraction discipline) was opt-in `governance.invariants_catalog: 'extended'` — the
activation MECHANISM existed end-to-end (schema → resolve-project-config →
generators) but was never activated in any consumer (grep=0 in haben/coach
arbiter.json), and the extended invariants' enforcement was declared manual. The
consumer-facing registers the discipline requires were missing (PATTERNS_CATALOG.md
existed at L2+; REUSE_REGISTRY.md's SPEC existed, its REGISTER did not), and no
mechanical check tied a code change to the update of a declared-live SSOT surface in
the same commit (INV-63).

## Decision

1. **Emission (AC-2044.1).** `REUSE_REGISTRY.md` (the register) is now emitted at L2+
   alongside `REUSE_REGISTRY_SPEC.md` and `PATTERNS_CATALOG.md` — `skipIfExists` so
   `arbiter update` never clobbers registered entries.
2. **Mechanical check (AC-2044.3).** `scripts/check-reuse-registry.mjs` (new, emitted
   ONLY when `invariants_catalog: extended` — emission and wiring share the same
   predicate, so a non-extended consumer never carries an unwired guard): fails when
   the register is absent or empty, passes with ≥1 registered entry. This is the
   documented search-before-build record the manual enforcement lacked.
3. **Live-SSOT binding (AC-2044.5/6).** `governance.liveSsot.surfaces[]` (schema-
   validated, `kind: matrix|ledger`, optional `keys`) declares the repo's LIVE SSOT
   surfaces. check-drift gains the binding: a commit that touches CODE (not
   docs/.md/.arbiter/.github, not a declared surface) must ALSO touch every declared
   surface in the SAME commit (INV-63 atomic); the obligation is LIMITED to the
   declared surfaces (never every commit). `.arbiter/live-ssot.json` (scaffold
   emitted from the config, `skipIfExists`) is the runtime declaration; absent
   manifest or parentless HEAD ⇒ SKIP.
4. **Consumer activation (AC-2044.2/4).** haben + coach-system arbiter.json gain
   `governance.invariants_catalog: 'extended'`; their GLOBAL_INVARIANTS.md regenerated
   (INV-63/64/69/70 present, verified); coach's drift-manifest hash re-pinned.
   Haben's L1 gate: ALL PASSED. Coach's L1: only its pre-existing ai-eval unit-test
   failure (data-eval, unrelated — verified identical without the change).

## Consequences

- The abstraction-discipline invariants are no longer dead config: activating the
  extended set gives a project the registers AND the mechanical gate that makes the
  practice checkable.
- The live-SSOT binding closes the INV-63 gap (code↔ledger in the same commit) with a
  fail-closed, scope-limited check — the softening honored: only declared-live
  surfaces bind, and only the LAST commit is inspected at gate time.
- Consumers keep day-1 green: the extended set adds doc content only; no gate reads
  the doc content, and the new check is wired only when explicitly activated.
