---
title: 'ADR-076: CANON-22 — evidence-based quality gating + gate un-blinding'
doc_version: '1.0.0'
status: active
last_review: '2026-06-01'
owner: ''
canonical_id: '076'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-076: CANON-22 — evidence-based quality gating + gate un-blinding

**Status:** Accepted
**Reference:** PR #1136; CANON-22 (docs/SYSTEM/CANON.md); INV-109; CANON-09 (claimed enforcement = wired gate); audit lineage #151–#186

## Context

Two failures motivated this decision:

1. **Blind gates.** `knip.json` carried a blanket `ignoreIssues` block that muted the dead-code/anti-bloat gate, and the CI `madge --circular src` invocation scanned **0 files** (missing `--extensions`). Both are CANON-09 violations — a gate that claims enforcement while hiding (or never looking at) its own findings is a lie.
2. **Unenforced DRY / anti-bloat.** Duplication and over-complexity — the project's primary quality concern — were advice, not gates.

A standing risk in "add more quality gates" is **gate-fatigue**: failing the build on contested heuristics (e.g. mechanical SOLID conformance) erodes trust in the gates that are actually validated, and breeds bypasses.

## Decision

1. **Tier the metrics (CANON-22).** A quality rule may become a **hard gate** only if it is **Tier-1** — backed by replicated empirical evidence linking the metric to a defect/maintainability outcome (McCabe 1976 cyclomatic complexity; Chidamber–Kemerer 1994 + Basili 1996 coupling; Khomh 2009 / Palomba 2018 smells; Juergens 2009 inconsistent clones; Lehman entropy; SEI/SQALE debt; Boehm 1981 shift-left). **Tier-2** heuristics (SOLID, DRY-as-dogma, cognitive complexity) may inform review/advisory output but MUST NOT fail the build alone.
2. **Un-blind, don't fake.** Remove the `ignoreIssues` mute and resolve the surfaced rot; fix the vacuous `madge`. Where a finding cannot be resolved in-scope (the ~37 tested-but-uncalled exports), record it in an enumerated burn-down audit (`docs/audits/unwired-exports-2026-06-01.md`) where a future hard gate lands green — never as a muted/baselined gate in the same change.
3. **Make DRY real.** A jscpd duplication gate + a debt-ratchet `duplicationPercentage` metric (no patch may raise duplication), dual-sided (dogfooded + generated). Graduated to **INV-109**.

## Consequences

- The gate set stays defensible: each hard gate cites validated evidence; contested heuristics live in the `clean-code` gate-map skill and the red-team Anti-Bloat vectors as advisory/blocking-eligible review.
- Adding a future hard gate requires declaring its tier; promoting a tested-but-unwired class requires burning down the audit list first (no laundering `ignoreIssues` into another suppression).
- INV-109 is TypeScript-only; `multi` projects list it via the filter's `multi→typescript` mapping but receive no duplication gate, consistent with the `knip`/`coverage` sibling pattern (tracked separately).
