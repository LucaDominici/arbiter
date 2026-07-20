---
title: 'ADR-109: constraint-map.json scaffolded + INV-115 fail-closed on a missing map'
doc_version: '1.0.0'
status: active
last_review: '2026-07-20'
owner: ''
canonical_id: '109'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-109: constraint-map.json scaffolded + INV-115 fail-closed on a missing map

**Project:** arbiter
**Date:** 2026-07-20
**Status:** Accepted
**Issue:** #2037

## Context

The INV-115 constraint-scan gate (`scripts/check-constraint-scan.mjs`) is wired
unconditionally at L1 in every generated project. It classifies free-text governance
prohibitions as COVERED (mapped to a verified enforcer), ENFORCED-BY-SCAN (derivable,
live-grepped), or UNENFORCEABLE (human triage) — reading `scripts/constraint-map.json`
to resolve the COVERED case. Neither the map file nor a template for it was ever
emitted by any generator: every consumer project runs the gate against `map = {}`,
so nothing can ever be reported COVERED. A gate is declared and wired, but its linking
data is silently absent — the exact "can't be faked" anti-pattern arbiter exists to
prevent (observed in production in two consumer projects, haben and coach-system).

## Decision

1. **Scaffold**: `scripts/constraint-map.json` is added as a new unconditional
   emission (`src/templates/scripts/constraint-map.json.ejs`), alongside its checker.
   It ships as a self-documenting, valid-JSON starter with no active mappings —
   `skipIfExists`, so a project's curated coverage is never clobbered by
   `arbiter update`.
2. **Fail-closed on MISSING, not on empty**: the gate now fails (exit 1) when the map
   file does not exist at all — the state that produced the bug (deletion, or a
   project scaffolded before this fix). A **present-but-empty** map (`{}`) still only
   warns: a fresh project starts with zero curated coverage by design and builds it up
   over time; failing that case would red every fresh L1 project on `init`. This is a
   narrower reading than the issue's initial "missing or empty" framing, chosen so the
   fix targets the actual observed failure mode without making a legitimate empty-map
   state (which many existing tests and every brand-new project rely on) a hard stop.
3. **Explicit opt-out**: `governance.constraintScan: "off"` in `arbiter.json` skips the
   gate entirely, with a visible `SKIP` line — never a silent bypass.

## Consequences

- Every consumer scaffolded or updated after this change gets a real (if initially
  empty) `constraint-map.json`; the missing-file case now only arises from deletion or
  an un-updated pre-existing consumer — both actionable, both now caught.
- The self-repo gate (`ENFORCE_DEFAULT=true`) and the emitted template
  (`ENFORCE_DEFAULT=false`) both gain the identical missing-map guard, mirrored
  token-for-token (enforced by `__tests__/templates/constraint-scan-render.test.ts`).
- haben and coach-system (the two consumers observed with this bug) are NOT
  retrofitted by this change — they pick it up via their own `arbiter update` under
  their linked adoption issues (haben#483, coach#495), tracked separately from arbiter
  self.
- A companion mechanism, `arbiter diff --governance` (#2040), audits whether a
  consumer's Iron Laws / permission deny-list sections are stale relative to the
  current template — same epic (#2034), same "declared but unverified" failure class,
  different target files.
