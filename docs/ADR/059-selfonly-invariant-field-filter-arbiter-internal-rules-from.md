---
title: 'ADR-059: selfOnly invariant field — filter arbiter-internal rules from generated target AGENTS.md (#682)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-31'
owner: ''
canonical_id: '059'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-059: selfOnly invariant field — filter arbiter-internal rules from generated target AGENTS.md (#682)

**Date:** 2026-05-16
**Status:** Accepted
**Reference:** Issue #682 (from sweep #277 finding #12)

**Context:** Several invariants in `src/invariants/catalog.ts` describe arbiter's own development discipline — matrix fixtures, EJS template coverage, dogfood checks, hook fire-tests, etc. With `alwaysActive: true`, these invariants were written into every generated target-project `AGENTS.md` and `GLOBAL_INVARIANTS.md`. A Python backend project receiving "every 'proven' language must have a nightly real-project fixture" (INV-32) is confused by a rule that only makes sense inside the arbiter repo.

**Decision:** Add `selfOnly?: boolean` to the `Invariant` interface. Mark 11 arbiter-internal invariants: INV-32 (matrix fixtures), INV-36 (hook hardness manifest), INV-39 (hook fire-tests), INV-45 (self-dogfood), INV-46 (anti-bloat enforcement), INV-47 (matrix proven cell wiring), INV-48 (EJS template test coverage), INV-49 (generator tests), INV-50 (command tests), INV-51 (catalog/AGENTS parity), INV-52 (enforcement wiring). Add `includeArbiterInternal?: boolean` to `getFilteredInvariants` config — default `false` (target-project context excludes selfOnly). Arbiter's own test suite passes `includeArbiterInternal: true` to verify full catalog counts.

**CANON-08 survey:** grepped `src/invariants/types.ts` for existing sentinel fields — found `status`, `redirectTo`. `selfOnly` is distinct: not a lifecycle state, not a redirect, but a generation-context filter. Justified as new field.

**Consequences:** Generated AGENTS.md for target projects no longer contains arbiter-internal invariants. Catalog count tests updated (TS+L3+all: 57→46, Java+L2+all: 56→45, Java+L3+all: 59→48). New tests verify default exclusion and opt-in inclusion.
