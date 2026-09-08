---
title: '#2605 L2 single test corpus contract'
doc_version: '1.0.0'
status: active
last_review: '2026-09-08'
owner: 'Luca Dominici'
canonical_id: 'task-2605-l2-single-corpus'
tags: ['audience/agent', 'kind/plan']
related: ['#2605']
---

context:
  issue: '#2605'
  type: perf
  pipeline: 'plan → red-team → red → green → focused verification'
  branch_convention: 'task/#2605-kebab-description'
  base_branch: main
  key_constraints:
    - 'L1 keeps the complete npm test command; L2/L3 execute the complete corpus once with coverage.'
    - 'Coverage is mandatory and failed, skipped, non-executed or empty coverage fails closed.'
    - 'The ratchet retains direct local WARN compatibility, but self L2 opts into its required-data policy.'
    - 'Preserve coverage selection, thresholds, ratchet, gate names/status truth, and CI unit/JUnit jobs.'
    - 'Only the listed source deltas; no cache, selector, threshold, workflow or release-scope redesign.'
  red_team_warnings:
    - 'Selective-gate skips must not turn required coverage into PASS.'
    - 'A self-skip marker must fail required coverage while optional checks retain SKIP semantics.'
    - 'A faster test step is not proof of faster complete-gate throughput; measure matched runs.'
  estimate: 'Standard; approximately 80s saving is a hypothesis from the issue baseline, not a result.'

# #2605 L2 single test corpus contract

## Context and provenance

Issue #2605 requests a measured throughput repair: `scripts/check-all.mjs` currently
invokes the same Vitest corpus once as `npm test` and again as `npm test -- --coverage`.
The observed 80,357 ms unit and 103,411 ms coverage timings make an approximately 80 s
saving a hypothesis only; this task must not claim savings without a matched run.
This is now one ancestry-preserving maintenance integration based on
`aa42406c3f66a99ac9f7cb1c7d68849c1283f1b7`, rather than six independently
qualified trains. Existing failure history, committed RED evidence and source reviews
remain attributable to their source commits; they are not re-labelled as a batch PASS.
No cache or invented execution proof is allowed.

## Scope

The exact 83-path write set is the `scope.paths` array in `.agents/plan/PLAN.json`.
It is deliberately an integration manifest, not a claim that all paths belong to #2605.
The functional groups and preserved source identities are:

| Existing source PR | Issue / intent | Exact source ancestry preserved in this batch |
| --- | --- | --- |
| #2492 | #2452: make `init --dry-run` a projection of the generator plan | `7accb3e5452bfe4d8f3d77f2b9ddfee43d4a4ef2` |
| #2495 | #2453: document two deprecated no-op update flags | `33b2dec712cd78341c6e6267f169f1f10838654b` |
| #2502 | #2466: external self-validation twin-diff | `3bcc353921e01a8808712ff98cfa8e89ab9d5e5b` |
| #2607 | #2604: exercise hook liveness with a real edit | `4afa1f29623bed32d12ea1788004c0b0ce677b92` |
| #2471 | zod `4.5.4` dependency update plus the required nested-TypeScript lock repair | `21f05e6c3e2162184d8cd0a14435e77c6ea07532`, then `19ab2ec792bdb91d7de8f83341da8e0bd695e8ef` |
| #2605 | one L2 corpus with coverage, strict required instrumentation, and its recovery documentation | `c313ff05e2e62a4bcae47dde6f273b84e9e647a6` (including its #2605 ancestors) |

Functional paths are limited to the five focused implementation areas, their executable
regressions and committed TDD/evidence, 27 generated bake snapshots plus their three
examples/manifests, the matching docs, and package metadata/lock integrity. In particular,
`docs/REFERENCE/ci-tier-workflows.md` is the sole fresh source document; native incremental
generation refreshes `wiki/reference-ci-tier-workflows.md`. The #2605 divergence remains the
existing self-only `scripts/lib/run-helpers.mjs` pin; only #2466 changes an emitted template.
The generated `THIRD_PARTY_LICENSES.md` records the admitted zod `4.5.4` package delta, and
the retained #2434 preview-caller suite is updated to await the already-async preview API while
keeping #540's migration-consent narrative separate from literal preview path buckets.

The user authorized a procedural review-count waiver solely to maintain these already-open
source PRs in one batch. It is not a review, evidence artifact, or PASS claim. Root remains
the independent batch reviewer.

## Acceptance Criteria

- [ ] AC-1: L1 still executes the complete unit test command; self L2/L3 execute the complete corpus once with coverage.
- [ ] AC-2: Coverage remains mandatory. Failed, skipped, non-executed or empty coverage cannot qualify L2; retain coverage selection, thresholds and ratchet, with self L2 invoking required-data mode.
- [ ] AC-3: Runnable regressions prove level dispatch and fail-closed handling; no selective-gate or result status may fabricate PASS, including empty ratchet data.
- [ ] AC-4: Record commands, source identity, environment and measured before/after timings with sample size and limitations; distinguish saved test work from observed complete gate throughput.

## Non-goals

- No cache, selector, threshold or workflow changes, unrelated gate repair, or dependency/
  template updates beyond the source deltas listed above. Root authorizes one combined
  native L1/L2 qualification and one PR through the unchanged exact-SHA landing contract;
  the earlier source-worker prohibition on full gates is superseded for this integration.
- AC-4's native A/B measurement is already retained in
  `.arbiter/evidence/benchmark/#2605.json`, including source identities, commands,
  environment, cache/ref limitations and n=1. Preserve it without re-crediting it as
  qualification or a speed measurement of this larger batch. No extra benchmark run
  is required: the remaining run is the batch's ordinary exact-HEAD qualification.
- Direct `check-coverage-ratchet.mjs` local invocation remains backward-compatible with
  its documented sandbox WARN; only self L2 passes the required-data option so a required
  gate cannot qualify empty instrumentation.
- Required-data validation uses a positive finite `total.lines.total`, not branch or
  function totals: files without branches or functions remain legitimate instrumentation.
- No new `init --adopt-governance` CLI flag or programmatic-adoption refactor. The public
  `init` command exposes no such flag; #2452's public acceptance is preview/run parity.

## Test and verification

Preserve the committed authentic RED evidence from the source work and run the native
verifier; do not re-create an entire TDD cycle for unchanged imported implementations.
The existing `npm test` command remains the L1 authority; coverage remains the L2/L3
authority. Historical AC-4 measures saved test work separately from complete-gate time;
the combined batch must still pass its own native qualification.
The amended ratchet regression must exercise a real temporary empty-summary subprocess in
both default local mode (existing WARN) and required-data mode (FAIL), invalid line totals
(missing, negative, or non-finite) and legitimate zero branch/function totals, plus the self
L2 source assertion that the strict option is wired. The approved self-only `failOnSkip`
delta is re-pinned through the native dogfood command; it does not change the emitted helper.

## Batch verification status

The imported source state is green only at its recorded focused selectors. Before any
push, PR, merge, or acceptance claim, root must independently review this amended plan and
write the updated reviewer-owned plan/ac-fit evidence for the frozen candidate. Then this
batch runs one native L1 and one exact-HEAD L2/CI qualification. Until those complete,
AC-1 through AC-4 retain their #2605 source evidence but the combined-batch L2, CI, and
merge status are **NOT-TESTED**. The #2605 n=1 benchmark remains a bounded historical
measurement, not a performance claim for this integrated HEAD.

Preserved committed RED evidence is `.arbiter/evidence/tdd/#2452.json`, `#2453.json`,
`#2454.json`, `#2466.json`, `#2604.json`, and `#2605.json`. The dependency source uses
the real #2471 source/repair ancestry above; it does not fabricate a TDD receipt for a
package-lock integrity repair.
