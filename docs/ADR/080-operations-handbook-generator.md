---
title: 'Operations Handbook Generator'
doc_version: '1.0.0'
status: active
last_review: '2026-05-16'
owner: ''
canonical_id: '080'
tags: ['audience/dev', 'kind/adr']
related: ['066']
---

# ADR-080: Operations Handbook Generator

**Project:** arbiter
**Date:** 2026-05-16
**Status:** Accepted
**Reference:** Issue #717; prior-art baseline M-09

> **Note:** This decision was originally recorded in `docs/SYSTEM/DECISIONS.md` as ADR-049.
> That ID was later reused for a different decision (Java Static Analysis Baseline, `docs/ADR/049-java-static-analysis-baseline.md`).
> Content extracted here as ADR-080 to resolve the collision.

## Context

The prior-art baseline ships a 3301-line operations handbook covering 4-signal observability (latency, traffic, errors, saturation), RC gate checklist, on-call protocol, and runbook templates. Projects using arbiter lack a structured baseline for operational readiness.

## Decision

Add opt-in `enableOperationsHandbook: true` flag. When set, `generateOperations` emits `docs/OPERATIONS_HANDBOOK.md` from `src/templates/operations/handbook.md.ejs`. The template is archetype-aware: `backend-web-db` and `data-pipeline` add database signals and load-test gates; `frontend-spa` adds Core Web Vitals. The template is `skipIfExists: true` so teams can customise after init.

## Consequences

### Positive

- Template provides an immediately actionable operational baseline.
- Teams are not required to use it (opt-in).
- The `industrial-grade` preset (issue #729) enables this flag by default.

### Negative

- One more opt-in flag in `ProjectConfig`.

## Links

- Issues: #717
- Related ADRs: ADR-066 (industrial-grade preset)
