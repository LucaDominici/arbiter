---
title: 'ISO 27001 / NIS2 / GDPR Compliance Gate Mapping'
doc_version: '1.0.0'
status: active
last_review: '2026-05-16'
owner: ''
canonical_id: '078'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-078: ISO 27001 / NIS2 / GDPR Compliance Gate Mapping

**Project:** arbiter
**Date:** 2026-05-16
**Status:** Accepted
**Reference:** Issue #710; prior-art baseline COMPLIANCE_MAPPING.md §2; ISO 27001:2022 Annex A; NIS2 Art.21.2; GDPR Art.5/25/32

> **Note:** This decision was originally recorded in `docs/SYSTEM/DECISIONS.md` as ADR-052.
> That ID was later reused for a different decision (Fast-Forward Merge Policy, `docs/ADR/052-fast-forward-merge-cosign-preservation.md`).
> Content extracted here as ADR-078 to resolve the collision.

## Context

The prior-art baseline ships a gate-to-control mapping table (COMPLIANCE_MAPPING.md §25-68) that maps every quality gate to the ISO 27001 Annex A / NIS2 Art.21.2 / GDPR article it satisfies, accelerating audit preparation. Arbiter had no equivalent — only the full Annex A matrix (L3-only, from #217).

## Decision

Add three opt-in flags to `ProjectConfig`: `enableIso27001Mapping`, `enableNis2Mapping`, `enableGdprMapping`. When any flag is true, `generateCompliance` emits `docs/COMPLIANCE_MAPPING.md` from `src/templates/compliance/compliance-mapping.md.ejs`. The template has three conditional sections (ISO 27001, NIS2, GDPR), each with a gate-to-control table and an audit preparation checklist. Template uses `typeof` guards for optional fields. File is `skipIfExists: true`.

## Consequences

### Positive

- Teams can opt into compliance reporting per framework (ISO 27001, NIS2, GDPR) without adopting all three.
- The generated document gives auditors a structured gate-to-control mapping.
- The `industrial-grade` preset (issue #729) enables all three flags by default for regulated projects.

### Negative

- Three new boolean flags in `ProjectConfig` increase config surface.

## Links

- Issues: #710
- Related ADRs: ADR-066 (industrial-grade preset)
