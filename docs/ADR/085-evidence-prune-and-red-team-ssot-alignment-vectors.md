---
title: 'Evidence Prune Script and Red-Team SSOT Alignment Vectors'
doc_version: '1.0.0'
status: active
last_review: '2026-05-16'
owner: ''
canonical_id: '085'
tags: ['audience/dev', 'kind/adr']
related: ['079']
---

# ADR-085: Evidence Prune Script and Red-Team SSOT Alignment Vectors

**Project:** arbiter
**Date:** 2026-05-16
**Status:** Accepted
**Reference:** Issues #718, #723

> **Note:** This decision was originally recorded in `docs/SYSTEM/DECISIONS.md` as ADR-047.
> That ID was later reused for a different decision (Security Scanning Suite, `docs/ADR/047-security-scanning.md`).
> Content extracted here as ADR-085 to resolve the collision.

## Context

Two related gaps: (1) `evidence-rotate.mjs` is automated and count-only; manual maintenance needed a sibling `evidence-prune.mjs` supporting `--keep-last`, `--keep-days`, `--dry-run`, `--yes`. (2) `.claude/agents/red-team.md` had general attack vectors but no arbiter-specific SSOT alignment checks.

## Decision

- Emit `scripts/evidence-prune.mjs` (`skipIfExists: true` — user may customise thresholds) from new EJS template `src/templates/scripts/evidence-prune.mjs.ejs`.
- Emit `docs/METHOD/EVIDENCE_RETENTION.md` policy doc (`skipIfExists: true`) from `src/templates/governance/evidence-retention.md.ejs`.
- Add SSOT Alignment Vectors table to `.claude/agents/red-team.md` covering: template/materialized drift, invariant catalog vs gate, tier constant vs template, matrix cell vs gate reality, hook manifest vs generator, schema vs wizard defaults.

## Consequences

### Positive

- `generateEvidenceRetention` emits 4 files at L1 (was 2) and 6 at L2+ (was 4).
- Evidence prune script is user-customisable (`skipIfExists`) unlike rotate (always regenerated).
- Red-team agent now covers arbiter self-consistency checks in addition to general security vectors.

### Negative

- Slightly more SSOT alignment vectors to maintain as the codebase evolves.

## Links

- Issues: #718, #723
- Related ADRs: ADR-079 (red-team SSOT alignment checks)
