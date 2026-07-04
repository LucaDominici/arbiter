---
title: 'Red-Team SSOT Alignment Checks'
doc_version: '1.0.0'
status: active
last_review: '2026-05-16'
owner: ''
canonical_id: '079'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-079: Red-Team SSOT Alignment Checks

**Project:** arbiter
**Date:** 2026-05-16
**Status:** Accepted
**Reference:** Issue #723; prior-art baseline FINDINGS.md#mech-M-15

> **Note:** This decision was originally recorded in `docs/SYSTEM/DECISIONS.md` as ADR-051.
> That ID was later reused for a different decision (Collaboration-Mode Axis, `docs/ADR/051-collaboration-mode-workflow-axis.md`).
> Content extracted here as ADR-079 to resolve the collision.

## Context

The prior-art baseline's red-team agent includes a dedicated SSOT (Single Source of Truth) alignment section that systematically checks for invariant drift, CANON rule compliance, registry completeness, opt-in wiring, ADR currency, changeset presence, and ratchet baseline updates. Arbiter's red-team agent lacked this structured checklist, risking inconsistent governance on generator/template PRs.

## Decision

Add SSOT Alignment Checks section to both `src/templates/claude/agents/red-team.md.ejs` (generated version for target projects) and the materialized `.claude/agents/red-team.md` (arbiter self-governance). The section defines 9 checks, each with a specific query and severity mapping (HIGH for SSOT misalignment, MEDIUM for missing documentation).

## Consequences

### Positive

- Future red-team reviews on generator/template changes are guided to systematically verify all governance artifacts.
- Generated projects also inherit this checklist via the EJS template.

### Negative

- Red-team reviews become more comprehensive but also more time-consuming.

## Links

- Issues: #723
