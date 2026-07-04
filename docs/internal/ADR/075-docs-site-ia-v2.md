---
title: 'ADR-075: Docs Site Information Architecture v2 — Outcome-First Navigation'
doc_version: '1.0.0'
status: active
last_review: '2026-06-01'
owner: ''
canonical_id: '075'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-075: Docs Site Information Architecture v2 — Outcome-First Navigation

**Project:** arbiter
**Date:** 2026-06-01
**Status:** Accepted

## Context

[ADR-043](043-docs-site-ia.md) defined the v1 public-docs IA for the OSS launch: a seven-section funnel (Quickstart, Concepts, Reference, Recipes, Comparisons, Integrations, Community) optimised for "learn → look up → differentiate → extend → community." That structure has two gaps now that the docs have grown (issue #1100, lens IA):

- It is **mechanism-first**, not **outcome-first**. A reader who arrives with a problem ("my agents drift from the agreed rules", "how do I prove governance to an auditor") has no landing surface; the closest material (ENFORCEMENT-PHILOSOPHY, WHAT-ARBITER-IS-NOT, case-studies, comparisons) is scattered and never framed as problem → mechanism → verify.
- It does not separate the **user-facing** public surface from **contributor/internal** material. The repository carries ~300 docs across both audiences with no nav-level split, so the public site and the contributor docs blur together.

ADR-043 also predates the consolidations that have since landed (`docs/INDEX.md` generated + gated #1102; redirect-stub canonical homes for CLI/HOOKS/TEMPLATES; the SSOT_CORE_SET generation of #1100 Wave 2). The IA decision needs to be restated against the current state, not amended piecemeal.

## Decision

Adopt an **outcome-first**, audience-split IA for the public docs site, superseding ADR-043. Top-level public navigation (VitePress) uses these sections in order:

| Section                   | Question it answers         | Purpose                                                                              |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| Get Started               | "How do I begin?"           | Install + first command + first gate run (today's Quickstart)                        |
| Architecture              | "How is it built?"          | Mental model: AGENTS.md, governance levels, gate tiers (Concepts) + Decision Records |
| Features                  | "What is enforced?"         | The invariant/dimension catalogue + Coverage Matrix (generated)                      |
| Use-Cases                 | "Who/what is it for?"       | USE-CASE-MATRIX promoted to a hub + the consolidated recipe set                      |
| ★ Problems Solved & How ★ | "Does it solve MY problem?" | One page per problem: problem → mechanism → how to verify (NEW)                      |
| Reference                 | "Look it up"                | CLI, hooks, stacks, templates, API                                                   |
| Governance & Legal        | "Can I trust it?"           | AGENTS, GLOBAL_INVARIANTS, CoC, SECURITY, PRIVACY, comparisons                       |

A non-nav **Contributing & Internals** surface (Method / System+CI / Runbooks / Audits+RFC / Dev guides) remains in `docs/` for contributors and is intentionally excluded from the public top nav.

Organising principle: **user-facing vs contributor-facing split**, with the public surface ordered by reader outcome (begin → understand → evaluate enforcement → match to a use-case → confirm it solves a specific problem → look up details → trust). "Problems Solved & How" is a first-class section, not a sub-page, because it is the highest-intent surface for evaluators.

This ADR records the **target IA**; the VitePress nav restructure and the authored "Problems Solved & How" pages are delivered in later #1100 waves (content first, nav flip last) so no section ships as an empty stub.

## Consequences

### Positive

- Evaluators with a concrete problem get a dedicated, first-class entry point (Problems Solved & How) instead of inferring fit from scattered philosophy/comparison docs.
- Clear public-vs-contributor split keeps the ~300-doc contributor corpus out of the user funnel.
- Outcome ordering matches the real evaluation journey (begin → trust) better than the v1 mechanism funnel.

### Negative

- Larger nav (7 sections + non-nav internals) is more to maintain than v1's funnel.
- "Problems Solved & How" requires net-new authoring and ongoing curation as problems evolve.
- The nav restructure is a breaking change to existing public URLs; redirects must be applied when the nav flips (later wave) to preserve inbound links.

## Links

- Supersedes: [ADR-043](043-docs-site-ia.md)
- Related ADRs: ADR-001, ADR-002
- Issues: #1100 (docs-IA reorg umbrella), #1087 (parent), #517 (original IA)
