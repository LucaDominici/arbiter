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
    - 'No cache, test-selection, workflow, dependency, template, release, push, PR or merge changes.'
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
Base is frozen at `06890909e3023420433cb8996f5a12bc7d4b02f5` in the isolated
`task/2605-l2-single-corpus` worktree. Existing failure history and CI evidence remain
authoritative; no cache or invented execution proof is allowed.

## Scope

Modify only the self gate/helper and focused tests:

- `scripts/check-all.mjs`
- `scripts/lib/run-helpers.mjs` (only if needed to make required coverage skips fail closed)
- `scripts/check-coverage-ratchet.mjs` (only to expose its required-data policy to self L2)
- `.dogfood-divergences.json` (the existing self-only `run-helpers.mjs` pin only; no emitted template change)
- `wiki/reference-task-recovery.md` (incrementally regenerated from the changed private source document)
- `__tests__/scripts/check-all-l1.test.ts`
- `__tests__/scripts/run-helpers.test.ts` (only with the helper change)
- `__tests__/scripts/check-coverage-ratchet.test.ts`
- `.agents/plan/PLAN.json`, `.arbiter/evidence/ac-fit/2605.json`, and this plan metadata

## Acceptance Criteria

- [ ] AC-1: L1 still executes the complete unit test command; self L2/L3 execute the complete corpus once with coverage.
- [ ] AC-2: Coverage remains mandatory. Failed, skipped, non-executed or empty coverage cannot qualify L2; retain coverage selection, thresholds and ratchet, with self L2 invoking required-data mode.
- [ ] AC-3: Runnable regressions prove level dispatch and fail-closed handling; no selective-gate or result status may fabricate PASS, including empty ratchet data.
- [ ] AC-4: Record commands, source identity, environment and measured before/after timings with sample size and limitations; distinguish saved test work from observed complete gate throughput.

## Non-goals

- No cache or cache proof, test selection, threshold change, workflow/CI change, generated
  consumer-template change, registry/parity redesign, full L1/L2 run, push, PR, merge,
  remote/ref mutation, or unrelated gate repair.
- The worker does not run full L1/L2. The AC-4 acceptance benchmark is a bounded,
  root-owned exception after this patch is focused-qualified: run the unchanged baseline
  and candidate with `node scripts/check-all.mjs gate --level L2 --json` under the same
  checkout protocol, and record each source SHA, exact command, Node/npm versions, OS/CPU,
  cache state, sample count, individual and aggregate elapsed times, and limitations in
  `.arbiter/evidence/benchmark/#2605.json`. It must separately report removed unit work
  versus observed complete-gate throughput; it does not change selectors, thresholds,
  CI jobs, or gate policy.
- Direct `check-coverage-ratchet.mjs` local invocation remains backward-compatible with
  its documented sandbox WARN; only self L2 passes the required-data option so a required
  gate cannot qualify empty instrumentation.
- Required-data validation uses a positive finite `total.lines.total`, not branch or
  function totals: files without branches or functions remain legitimate instrumentation.

## Test and verification

Use TDD: add focused RED coverage for the L1/L2 call partition and the helper's required
coverage self-skip behavior, record genuine native RED, then implement the smallest change
and run only focused Vitest selectors plus syntax/type checks. The existing `npm test`
command remains the L1 authority; coverage remains the L2/L3 authority. AC-4 is not
complete until matched before/after runs record command lines, exact source identity,
environment, sample size, elapsed times, and limitations; any timing claim must distinguish
saved test work from observed complete-gate throughput. The worker defers that full-gate
benchmark to root after focused qualification, as specified in Non-Goals.
The amended ratchet regression must exercise a real temporary empty-summary subprocess in
both default local mode (existing WARN) and required-data mode (FAIL), invalid line totals
(missing, negative, or non-finite) and legitimate zero branch/function totals, plus the self
L2 source assertion that the strict option is wired. The approved self-only `failOnSkip`
delta is re-pinned through the native dogfood command; it does not change the emitted helper.
