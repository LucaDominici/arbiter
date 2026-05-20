---
title: 'ADR-003: Docs Site Information Architecture'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-003: Docs Site Information Architecture

**Project:** arbiter
**Date:** 2026-05-15
**Status:** Accepted

## Context

Arbiter needs a public documentation site for the v1.0 OSS launch. The site must be navigable for three distinct audiences: new users who need a quickstart, practitioners who need reference material, and evaluators who need to understand how arbiter compares to alternatives. The IA must be extensible as content grows post-v1.

## Decision

The docs site uses the following top-level sections in this order:

| Section      | Purpose                                            |
| ------------ | -------------------------------------------------- |
| Quickstart   | Get running in under two minutes                   |
| Concepts     | Mental model: AGENTS.md, governance levels, gates  |
| Reference    | CLI, hooks, stack support, templates               |
| Recipes      | Practical how-to patterns                          |
| Comparisons  | How arbiter fits vs alternatives (spec-kit, BMAD…) |
| Integrations | CI systems, IDE setup, pre-commit framework        |
| Community    | GitHub issues, discussions, contributing, security |

Top nav: Docs (→ /quickstart/) / Comparisons / Recipes / Community / GitHub.

Rationale for order: new-user funnel first (Quickstart → Concepts → Reference), then differentiation content (Comparisons), then extension paths (Recipes → Integrations), then community last (stable destination, not discovery).

## Consequences

### Positive

- Clear separation between "learn" (Quickstart/Concepts) and "look up" (Reference) content
- Comparisons as a first-class section supports SEO and evaluation use cases
- Extensible: new sections can be added without restructuring existing nav

### Negative

- Recipes and Integrations will be empty stubs at v1.0 launch; users may perceive the site as incomplete
- Community section adds maintenance burden (keeping links accurate)

## Links

- Related ADRs: ADR-001, ADR-002
- Issues: #517
