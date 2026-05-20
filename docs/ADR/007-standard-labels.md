---
title: 'ADR-007: 15 standard labels as canonical set'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-007: 15 standard labels as canonical set

**Status:** Accepted
**Date:** 2026-04-01
**Deciders:** Luca Dominici

## Context

GitHub labels are used for issue triage, capacity planning, and workflow automation. Without a standard set, each project invents its own labels, making cross-repo consistency impossible and automation fragile.

## Decision

14 labels provisioned idempotently (`gh label create/edit`):

| Category      | Labels                                                             |
| ------------- | ------------------------------------------------------------------ |
| Type (8)      | `bug`, `feature`, `task`, `docs`, `refactor`, `test`, `ci`, `deps` |
| Task size (3) | `size:XS`, `size:S`, `size:Standard` (colon — see #237)            |
| Priority (3)  | `priority/P0`, `priority/P1`, `priority/P2`                        |

## Rationale

- Type labels mirror commit convention types, creating consistency between commits and issues.
- Size labels enable capacity planning.
- Priority labels enable triage.
- 15 is deliberately minimal -- enough for real use without labeling becoming overhead.

## Consequences

**Positive:**

- Consistent label vocabulary across all arbiter-managed repos.
- Automation (CI, bots, dashboards) can rely on a known label set.
- Type labels align with conventional commit types, reducing cognitive overhead.

**Negative:**

- Projects with existing label schemes need to reconcile with the standard set.
- 15 labels may be insufficient for very large projects (can be extended per-project).
