---
title: 'ADR-113: decision registry (D-NN) — blocked project decisions with per-decision enforcement (#2036)'
doc_version: '1.0.0'
status: active
last_review: '2026-08-04'
owner: ''
canonical_id: '113'
tags: ['audience/dev', 'kind/adr']
related: ['112-project-invariants-proj-nn']
---

# ADR-113: decision registry (D-NN) — blocked project decisions with per-decision enforcement (#2036)

**Project:** arbiter
**Date:** 2026-08-04
**Status:** Accepted
**Issue:** #2036 (workstream 2 of epic #2034, roadmap #737)

## Context

The "blocked project decisions" layer did not exist in the framework. One governed consumer built a
hand-maintained `COSTITUZIONE.md` (D-01..D-22 + 7 Leggi + versioned changelog) but no
gate reads it — "solo net/http" or "no WebSocket/GraphQL" would never be intercepted
automatically; another governed consumer had no registry at all, so product choices had no
traceability. The 3-layer model (Leggi → D-NN → ADR) is the pattern to adopt.

## Decision

1. **Registry format.** A scaffolded `DECISION_REGISTRY.md` with the mandated table
   `| D-NN | decisione | razionale | decisore | data |`, an optional **Leggi** section,
   a versioned **Changelog**, and a documented **promotion path**: a D-NN that matures
   into a permanent rule promotes to a PROJ-NN project invariant
   (`governance.projectInvariants`, ADR-112) — one rule lives in ONE registry (no
   automatic promotion code).
2. **Per-decision enforcement.** Each D-NN row declares its enforcement on the line
   directly below the row: `Enforcement: <gate|test>` or `Enforcement: documentale`
   (explicit exemption). The grammar is documented in the scaffold.
3. **Gate.** `scripts/check-decision-registry.mjs` (emitted unconditionally, hard-wired
   at L2): an orphan D-NN (no enforcement, no `documentale` exemption) FAILS naming the
   decision; `documentale` passes with a note; an absent registry or a registry carrying
   the `arbiter:preserve` marker SKIPs (exit 0 with the recognized `[SKIP]` marker).
4. **Gold-doc-set tracking.** `DECISION_REGISTRY.md` is a mandatory manifest row
   (`tiers: solo:r/small:R/enterprise:R` — solo advisory per the anti-cathedral
   guardrail), `template: decision-registry`, with `accept_any: [DECISION_REGISTRY.md,
   COSTITUZIONE.md]` for consumer-style adoption. `GLOBAL_INVARIANTS.md` is now also
   registered (`conditional` + `applies: always` ⇒ a missing file is a RECOMMENDED gap,
   never a hard fail — the generator deliberately non-emits at the L1 essential preset,
   src/generators/global-invariants.ts `not-applicable`), closing AC-2036.6.
5. **Adoption semantics.** `arbiter:preserve` marks a user-owned record
   (COSTITUZIONE.md-style). The skeleton machinery never overwrites an existing file
   (scaffold only when missing); the gate treats a preserve-marked registry as
   user-owned format and skips enforcement review. Adoption requires NO import step —
   the file simply satisfies the manifest row.
6. **AGENTS.md pointer.** The authority hierarchy gains Level 2.5
   (`DECISION_REGISTRY.md — blocked project decisions`), plus the one-registry rule.

## Consequences

- A project's blocked decisions become machine-checked: an orphan D-NN (a decision with
  no enforcement story) is a gate failure, the last mile that consumer never had.
- Day-1 green: fresh consumers scaffold the registry with an empty table (vacuous pass)
  and the gate SKIPs until the registry exists.
- The D-NN→PROJ-NN promotion is documented, not automated — a rule lives in exactly one
  registry at any time.
- Enforcement-reviewable user-owned formats (arbiter:preserve) are explicitly outside
  the gate's grammar — manual review, zero false fails.
