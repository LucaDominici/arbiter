---
title: 'ADR-118: The lifecycle ontology is wired, not written'
doc_version: '1.0.0'
status: active
last_review: '2026-09-02'
owner: ''
canonical_id: '118'
tags: ['audience/dev', 'kind/adr']
related:
  [
    'docs/internal/SYSTEM/ID-REGISTRY.md',
    'docs/internal/SYSTEM/OD-REGISTRY.md',
    'docs/internal/SYSTEM/CANON.md',
    'schemas/id-registry.schema.json',
  ]
---

# ADR-118: The lifecycle ontology is wired, not written

**Project:** arbiter
**Date:** 2026-09-02
**Status:** Accepted

## Context

arbiter governs a project's lifecycle, but only part of that lifecycle is codified. Invariants are
a typed catalog with a gate that refuses an unwired enforcement claim. Requirements are a matrix
with a fail-closed status ladder. Evidence has schemas. CANON is parsed too, and its parity gate
refuses an Enforcement field that is neither a wired gate nor a dated promotion. Then the
codification thins out: milestones are prose whose `MN` ids collide with the methodology measures
`M1`–`M16`, `E1`–`E7` names two unrelated subsystems, `OD-NN` was cited in five files with **no
file defining it**, arc42 has no section-level gate, feasibility has no doc-set row, and use cases,
runbooks, tabletop definitions and external sources have no shape at all.

An earlier draft of this ADR listed CANON among the ungoverned. That was wrong — a reminder that
the survey which precedes a rule like this one is itself worth gating, and the reason the registry
below records a mechanism per row rather than an impression.

The asymmetry is not an accident of effort — it is what happens without a rule about what
"codified" means. A well-written document reads like governance. It is indistinguishable, in a
review, from a mechanism. The failure mode is systemic: the framework accumulates persuasive prose
and cannot tell, of any given rule, whether anything would notice its violation.

The immediate forcing function is a companion project (forma) that renders this lifecycle. A
visualiser cannot derive a milestone, a critical path, a verification verdict or a source citation
from prose. Whatever is not codified here cannot be shown there, and — worse — what is _partly_
codified gets rendered as if it were whole.

## Decision

**An artifact type is admitted to the ontology only as a wired behaviour.** Each ships five legs,
and the absence of any one is a gate failure, not a follow-up:

1. **Schema** — a JSON Schema under `schemas/`, so the artifact has a shape.
2. **Gate** — a `scripts/check-*.mjs` registered on the side its track names: `scripts/check-all.mjs`
   for self, the declarative Track-B roster `src/templates/scripts/gate-registry.yml.ejs` for
   emitted gates (CANON-01).
3. **Hook** — a `.claude/hooks/*.mjs` registered in `.claude/settings.json`, so a violation reaches
   the agent at edit time rather than an hour later in CI.
4. **Tool** — an `arbiter <verb>` surface, so humans and agents can query the artifact.
5. **Catalog citation** — an `INV-NN` whose `enforcement` names the gate. This leg is already
   load-bearing: `scripts/check-inv-enforcement-wired.mjs` (INV-52) fails when a cited script is
   not wired, and verifies Track-B claims against `src/generators/`.

Three mechanisms make the rule self-policing rather than aspirational:

- `docs/internal/SYSTEM/ID-REGISTRY.md` declares every identifier scheme in one machine-parsed
  block — prefix, anchored pattern, SSOT, gate, track, tool, hook, status.
- `scripts/check-id-registry.mjs` (INV-140) proves the registry is well-formed: no two schemes can
  match one identifier, every SSOT resolves, every `OD-NN` citation resolves against the new owner
  decision registry.
- `scripts/check-ontology-wired.mjs` (INV-141) proves every **active** row is actually wired, and
  carries a monotone ratchet over the rows that are not.

**`staged` is how an honest gap is expressed.** A scheme may be declared before it is built, but
only with a `note` naming the wave that wires it and an `expires` date that fails the gate once it
passes. Nine of the twenty-one schemes are staged today. That number can fall and cannot silently
rise — the same dated-debt discipline as INV-31 and `scripts/canon01-self-only.json`, applied to
the ontology itself.

**Ownership follows competence, across repositories.** forma defined the stack-agnostic C4 model
shape and generates it; arbiter adopts that shape (vendored, hash-pinned) rather than inventing a
second C4 standard, and INV-143 gates the pin from both sides.

## Consequences

Good. A rule in this framework can now be audited mechanically: the meta-gate enumerates the
registry and names anything that exists only on paper. The `MN` collision is closed (`M` is
methodology-only; milestones become `MS`). `OD-14` has a definition, reconstructed from its
citations and marked as such. Every future artifact type inherits edit-time enforcement by adding
one line to the hook's table.

Bad. Five legs is real ceremony, and it is deliberately front-loaded: a type that cannot justify
all five does not belong in the ontology, which means some genuinely useful documents will stay
documents. The `staged` escape hatch is the pressure valve, and it is the part most likely to be
abused — which is why it is dated, counted, and ratcheted rather than merely allowed.

Accepted deliberately: the meta-gate's ratchet must be edited by hand to grow. There is no
`--allow-increase` flag, because a flag that logs loudly is still a flag; a raised number in the
diff next to its justification is the only form of growth a reviewer actually sees.

## Links

- `docs/internal/SYSTEM/ID-REGISTRY.md` — the registry of registries
- `docs/internal/SYSTEM/OD-REGISTRY.md` — owner decisions, previously undefined
- INV-140, INV-141, INV-142, INV-143 in `src/invariants/catalog.ts`
- CANON-01 (dual-sided declination), CANON-09 (enforcement claims), CANON-16 (refactor first)
