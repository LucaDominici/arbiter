---
title: '25-Dimension Test Taxonomy Extension'
doc_version: '1.0.0'
status: active
last_review: '2026-05-16'
owner: ''
canonical_id: '081'
tags: ['audience/dev', 'kind/adr']
related: ['066']
---

# ADR-081: 25-Dimension Test Taxonomy Extension

**Project:** arbiter
**Date:** 2026-05-16
**Status:** Accepted
**Reference:** Issue #719; prior-art baseline M-11

> **Note:** This decision was originally recorded in `docs/SYSTEM/DECISIONS.md` as ADR-048.
> That ID was later reused for a different decision (Plugin API v1.1 Scaffolder, `docs/ADR/048-plugin-api-v1.1-scaffolder.md`).
> Content extracted here as ADR-081 to resolve the collision.

## Context

The base `TEST_TAXONOMY.md` template covers 17 universal dimensions suitable for most projects. Industrial-grade projects (compliance, regulated industries, high-traffic APIs) require additional coverage for audit trails, PII masking, rate limiting, session lifecycle, event delivery, graceful degradation, SLA assertions, and OWASP security surface.

## Decision

Add opt-in `enableTaxonomy25d: true` flag. When set, `generateTestTaxonomy` uses a new template at `src/templates/testing/test-taxonomy.md.ejs` that extends the base 17 dimensions with 8 compliance/industrial dimensions (18–25). The decision matrix is also extended with compliance-specific change types. The base template is unchanged — existing projects see no impact.

## Consequences

### Positive

- Projects using the `industrial-grade` preset (issue #729) or compliance flags (`iso27001`, `nis2`, `gdpr`) will set this flag automatically.
- Template is `skipIfExists: true` so teams can customise after init.
- All 25 dimensions map to existing INV references and external standards (GDPR, ISO 27001, OWASP ASVS, NIS2).

### Negative

- Additional template complexity (25d vs 17d base).

## Links

- Issues: #719
- Related ADRs: ADR-066 (industrial-grade preset)
