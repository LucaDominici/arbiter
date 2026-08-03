---
title: 'ADR-111: tier origination is human-only (#2184, follow-up to #2180/#2178)'
doc_version: '1.0.0'
status: active
last_review: '2026-08-03'
owner: ''
canonical_id: '111'
tags: ['audience/dev', 'kind/adr']
related: ['088-ship-as-orchestration-entrypoint']
---

# ADR-111: tier origination is human-only (#2184, follow-up to #2180/#2178)

**Project:** arbiter
**Date:** 2026-08-03
**Status:** Accepted
**Issue:** #2184 (follow-up to #2180/#2178)

## Context

After #2178 reduced review-agent counts for narrow tiers (`REVIEW_AGENTS`: XS=1,
S=1, Standard=2), the harm of mis-narrowing is asymmetric: it under-reviews a change
that needed review. #2180 already established a widen-only floor for automated,
deterministic signals. The remaining decision is which inputs may originate a narrow
tier in the first place.

## Decision

The only inputs that may originate a non-widest ship tier are:

1. an explicit `--tier XS|S` flag; and
2. a tier a human persisted with `arbiter task init --id <id> --tier <tier>`.

Nothing infers a narrow tier. When neither input is present, `normTier` falls back to
the widest tier, `Standard`. Automated deterministic signals may only widen the
selected tier (the #2180 widen-only floor); they never originate or narrow one.

## Rejected Alternatives

### Plan-manifest size

`src/sizing/`, which carried diff files + LOC and plan unit estimates, was deleted
wholesale in #1817. The plan front-matter `files:` list is parsed only to compute blast
radius and records no size or LOC. Adopting this approach would be a data-collection
project, not an implementation.

### Historical nearest-neighbour

No corpus of past task tier + outcome is recorded anywhere in the repository. This has
the same data-collection objection.

### LLM text-only classification

Study C (#2176) banned this approach after 20% fail-dangerous L→S errors.

## Consequences

- Tier origination remains an accountable human choice; automation cannot under-review a
  change by assigning it a narrow tier.
- #2207 was the blocker for persisted-tier origination: until `ship` stopped clobbering
  the persisted tier at the CLI boundary, the second allowed origination path did not
  work.
