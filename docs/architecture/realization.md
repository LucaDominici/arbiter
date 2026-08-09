---
title: 'Arbiter — Realization (Divergence Log)'
doc_version: '1.0.0'
status: active
last_review: '2026-08-09'
owner: ''
canonical_id: 'REALIZATION'
tags: ['audience/dev', 'kind/spine', 'kind/architecture']
related:
  ['docs/architecture/arc42.md', 'docs/internal/PRODUCT/FEATURE_MATRIX.md', 'docs/PRODUCT/PRD.md']
---

# Arbiter — Realization

Holds only what [arc42 §5](arc42.md#5-building-block-view) (structural decomposition) and
[FEATURE_MATRIX.md](../internal/PRODUCT/FEATURE_MATRIX.md) (the RTM, requirement→code→test at
fine grain) don't: a thin pointer index, then a log of places implementation departed from the
obvious reading of a requirement, and why, when the departure isn't big enough for its own ADR.
Never restates either source — if an entry stops applying, it is deleted, not marked resolved.

## Pointer Index

Requirement cluster ([PRD.md §Features by Phase](../PRODUCT/PRD.md#features-by-phase)) →
realizing arc42 §5.1 building block(s), one line each:

| PRD Phase                                 | arc42 §5.1 building block(s)                               |
| ----------------------------------------- | ---------------------------------------------------------- |
| 1 — Core Generation                       | Wizard / Init, Generators, Template Engine, Write Pipeline |
| 2 — GitHub Integration                    | Generators                                                 |
| 3 — Update and Diff                       | Profile Resolver, Generators                               |
| 4 — Extended Tool Support                 | Generators                                                 |
| 5 — Comprehensive Tests and Documentation | Gate Runner, Self-Dogfood Check                            |
| 6 — Smart Init Wizard Redesign            | Wizard / Init                                              |
| 7 — Foundation Repair + Stack Parity      | Compatibility Matrix                                       |
| 8 — Tech Debt Prevention                  | Conformance / Check Engine, Gate Runner                    |
| 9 — Advanced Generation                   | Invariant Catalog, KIT Catalog, Generators                 |
| 10 — Production Baseline Enforcement      | Conformance / Check Engine, Gate Runner                    |
| 11 — Ecosystem                            | Plugin API, CLI Front Controller, Generators               |

## Divergence Log

None currently. See [arc42 §11.6](arc42.md#116-deliberate-absence-no-model-tier-gating-info--by-design-not-debt)
for the "requirement satisfied by deliberate absence" precedent an entry follows when one is
warranted. An empty log is a valid, healthy state — it is not padded to look more substantial.
