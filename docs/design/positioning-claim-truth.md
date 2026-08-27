---
title: 'Positioning Claim Truth — realigning the comparison tables with what is enforced'
doc_version: '0.1.0'
status: draft
last_review: '2026-08-26'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/agent', 'kind/design']
related: ['scripts/check-tool-claims.mjs', 'docs/internal/SYSTEM/GAP.md']
---

# Positioning Claim Truth — realigning the comparison tables with what is enforced

Stale comparison tables and an ambiguous multi-tool claim — realign positioning with verifiable truth.

## Problem statement

arbiter polices the truth of its own claims **mechanically**: `scripts/check-tool-claims.mjs` exists precisely as a "positioning-truth gate", `scripts/check-anti-telemetry.mjs` turns "zero telemetry" from a promise into a gate, `docs/internal/SYSTEM/GAP.md` is an inventory of 78 claims labelled VERO/FALSO/PARZIALE/VACUO, and the roadmap even plans an "anti-overclaim positioning layer" (#673).

Yet the public comparison tables contain two verifiable defects, in opposite directions:

**1. A false underclaim.** `website/comparisons/index.md` gives arbiter `Requirements traceability —` and `Spec-driven development —`; `website/comparisons/spec-kit.md` repeats the same for requirements traceability. But requirements traceability **exists and is gated**: FEATURE_MATRIX (RTM `REQ-NNN` with `code_ref`/`test_ref`/`doc_ref`/`issue_ref`, fail-closed ladder, `verification_tier` IQ/OQ/PQ), INV-112, CANON-23, `scripts/check-feature-matrix.mjs`, plus the ISO 9001 template `REQUIREMENTS_TRACEABILITY.md.ejs`. The row was true when written (`last_review: 2026-05-20`, before INV-112 landed); today it is false and undersells the project's most defensible capability.

**2. An ambiguous claim tending to overclaim.** The row `Multi-tool support (Claude + Codex)` does not distinguish the two possible meanings. What arbiter does is **emit configuration files** for two tools (with gated parity, ADR-106 — serious work). What a reader understands is that arbiter _orchestrates_ two models. At runtime arbiter is single-model: every reviewer, every M13 skeptic, is a Claude subagent. The footnote clarifies the experimental status of the other five tools, but not this distinction.

`check-tool-claims.mjs` cannot catch either: its scope is strictly the false coupling between `--accept-beta-tools` and non-core tools. The comparison tables are outside its reach.

For a project whose thesis is "claims are enforced, not declared", a comparison table that marks itself absent on a capability it has, and present on an ambiguous one, is a credibility debt.

## Chosen approach

Three interventions, in order of value:

1. **Fix the false rows.** `Requirements traceability` becomes present, with the verifiable anchor (INV-112 / CANON-23 / `check-feature-matrix.mjs`). `Spec-driven development` stays honestly absent until the durable spec artifact exists.
2. **Disambiguate multi-tool.** Split the row into two distinct axes: _multi-tool configuration emission_ (arbiter: present) and _multi-model review/orchestration_ (arbiter: absent today, present once the cross-model feature lands).
3. **Make the recurring error mechanical.** The tables were last reviewed in May/June 2026 and went stale in silence. Evaluate whether to extend `check-tool-claims.mjs` (or a freshness check) so that a capability marked absent for arbiter while an active invariant enforces it becomes a gate failure.

## Key decisions and rejected alternatives

**D1 — Fix in both directions, not just the underclaim.**
The temptation is to fix the row that penalises us and leave the one that flatters us. That would be exactly the behaviour `check-tool-claims` and `D-NO-OVERCLAIM` (a conformance-scorecard dimension) exist to prevent. The multi-tool ambiguity must be resolved in the same PR as the underclaim, or the correction is partisan.

**D2 — `Spec-driven development` stays absent.**
This is the moment to inflate ("we have AGENTS.md, that's a constitution"), and it would be wrong: until a durable spec artifact exists (#2359), the honest answer is no. A credible comparison table must contain real absences.

**D3 — Prefer a mechanical check to a manual review, if it is cheap.**
The defect here is not that someone wrote a wrong row: it is that the row **became** wrong when INV-112 landed, and nothing noticed for three months. If a simple rule ("capability marked absent for arbiter while an active invariant enforces it ⇒ FAIL") is implementable without ceremony, it closes the class rather than the instance. If it is not, it is better to say so and settle for the correction plus a freshness reminder: a baroque gate over a marketing table would be worse than the problem.

**D4 — Do not add new capability rows in this PR.**
Adding axes where arbiter wins is tempting and shifts the comparison. Out of scope: this fixes false or ambiguous statements, it does not redesign positioning.

**D5 — Coordinate with the cross-model feature.**
If cross-model review lands (#2357), the "multi-model review" axis legitimately flips. The PR must leave the row in a state that updates with a value flip, not a rewrite.

## Decision outcome

**D3 resolved — do not extend `check-tool-claims.mjs`.** Its narrow, verifiable contract is
copy-pasteable tool selection: a non-core value passed to `--tools`, or a false coupling to
`--accept-beta-tools`. Detecting an underclaim in a comparison cell would require a second,
hand-maintained semantic capability-to-invariant registry, which would be less trustworthy than
the table it polices.

Instead, the self-only entry in `standards/gold-doc-set.yml` enrols all six comparison pages in
`scripts/check-doc-freshness.mjs`, coupled to the supported-tool configuration, both configuration
emitters, the Claude-agent generator, and `scripts/check-feature-matrix.mjs`. A relevant source
change now makes every comparison page stale until its `last_review` is renewed. The focused
`__tests__/docs/comparison-claim-truth.test.ts` prevents these exact truth corrections from
regressing.

## Open questions

- Is D3's mechanical rule actually implementable? It may need an explicit capability-to-invariant mapping in the tables (e.g. an HTML comment per row) for a gate to verify it without heuristics.
- Should the fix extend to the other four comparison pages (`bmad`, `gsd2`, `claude-flow`, `superclaude`), or is the error confined to `index.md` and `spec-kit.md`? A verification pass over all six is needed.
- `docs/internal/SYSTEM/GAP.md` is already an inventory of verified claims: should the comparison-table rows enter that register instead of living outside any check?

---

## Acceptance Criteria

- [x] AC-1: `Requirements traceability` reads as present for arbiter in `website/comparisons/index.md` and `website/comparisons/spec-kit.md`, citing the verifiable anchor (INV-112 / CANON-23 / `scripts/check-feature-matrix.mjs`).
- [x] AC-2: the `Multi-tool support` row is disambiguated into two distinct axes — multi-tool configuration emission vs multi-model review/orchestration — with the honest value for arbiter on each.
- [x] AC-3: `Spec-driven development` stays absent for arbiter, with the rationale explicit in the prose (no durable spec artifact yet).
- [x] AC-4: all six pages under `website/comparisons/` are verified row by row; every value assigned to arbiter is traceable to an invariant, a script, or a demonstrated absence of both.
- [x] AC-5: an explicit decision on D3 is recorded — either the mechanical check is implemented, or it is argued in writing why not, naming the alternative freshness mechanism.
- [x] AC-6: `last_review` is updated on every touched page and `node scripts/check-doc-freshness.mjs` stays green.
- [ ] AC-7: `node scripts/check-all.mjs L2` green, `check-tool-claims` included.

## Non-Goals

- No new capability rows added to widen arbiter's advantage (D4).
- No rewrite of positioning, the README, or the product thesis.
- No re-evaluation of competitor capabilities beyond what is needed to correct arbiter's own rows.
- No implementation of cross-model review here: only leaving the row updatable by a value flip.

## Files / contracts touched

- `website/comparisons/index.md` — traceability and multi-tool rows, `last_review`
- `website/comparisons/spec-kit.md` — requirements-traceability row, `last_review`
- `website/comparisons/bmad.md`, `gsd2.md`, `claude-flow.md`, `superclaude.md` — row-by-row verification (AC-4)
- `scripts/check-tool-claims.mjs` — possible scope extension (AC-5), or a written argument against
- `docs/internal/SYSTEM/GAP.md` — possible entry of comparison rows into the verified-claim register
- Contract: no API, no config, no runtime behaviour changes

## Wave placement

Lane **F (docs and positioning)**. No file-set overlap with any other issue in the wave — fully parallel-safe.
