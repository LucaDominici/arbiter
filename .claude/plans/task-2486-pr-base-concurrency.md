---
title: '#2486 PR concurrency base isolation'
doc_version: '1.0.0'
status: active
last_review: '2026-09-09'
owner: 'Astra coordinator'
canonical_id: 'task-2486-pr-base-concurrency'
tags: ['audience/agent', 'kind/plan']
related: ['#2486', '#2476']
---

context:
  issue: '#2486'
  type: fix
  pipeline: 'plan → red-team → red → green → refactor → verification → PR'
  branch_convention: 'task/#2486-pr-base-concurrency'
  base_branch: main
  key_constraints:
    - 'Change only the fast/extended PR concurrency identity on the two materialized workflows and their EJS twins.'
    - 'Different pull-request bases must isolate same-head runs; same PR updates must still supersede; fast push identity must remain exactly pr-fast-<ref_name>.'
    - 'Preserve all triggers, jobs, permissions, cancel-in-progress expressions/policy, and workflow behavior outside the group expression.'
    - 'CANON-18 coverage renders both EJS twins over all five stacks × L1/L2/L3/L4; self and emitted surfaces are exercised.'
    - 'No new dependency, workflow lane, gate, schema, or broad concurrency-family redesign.'
  red_team_warnings:
    - 'A base suffix that is unconditional changes the fast push key; tests must evaluate the extracted workflow expression with base_ref empty.'
    - 'String-presence assertions can pass while the two PR contexts still collide; tests must evaluate same-head/different-base and same-PR contexts.'
    - 'The materialized workflow and EJS twin can diverge; committed self and rendered emitted outputs must both be checked.'
  estimate: 'S (2h)'

# Plan: Issue #2486 — PR concurrency base isolation

## Context and provenance

The historical pre-implementation baseline is `8bda0342e9e71760fe5a36ba1f97ed80f4837aa6`.
The documentation-repair candidate is `7913c54384fdfd2de1f0983a6a83f2e738acf891` in the
same isolated worktree. After #2476 removed pull-request base filters, two open PRs with one shared
head and different bases can now run concurrently but share `pr-fast-<head>` and
`pr-extended-<head>`, causing one run to cancel the other. The baseline reproduction is
retained at `/home/luca/work/forma-rooms/portfolio/evidence/arbiter-2486/cycle-1788915508/baseline-collision.md`.

Readiness evidence is the corrected live body at
`/home/luca/work/forma-rooms/portfolio/evidence/arbiter-2486/cycle-1788915508/issue-ready.md`.
It is the source for the frozen criteria below. The readiness JSON proves parser
readiness only; it is not an independent schema or implementation approval.

## Scope and file manifest

One serial slice updates the four concurrency declarations and the focused tests/snapshot
that consume them. No new source file is needed.

| Path | Operation | Role |
| --- | --- | --- |
| `.github/workflows/01-pr-fast.yml` | modify | self/materialized T1 workflow |
| `.github/workflows/02-pr-extended.yml` | modify | self/materialized T2 workflow |
| `src/templates/github/workflows/01-pr-fast.yml.ejs` | modify | emitted T1 twin |
| `src/templates/github/workflows/02-pr-extended.yml.ejs` | modify | emitted T2 twin |
| `__tests__/templates/ci-render.test.ts` | modify | existing T1 render assertions and fast group semantics |
| `__tests__/templates/02-pr-extended-render.test.ts` | modify | existing T2 render assertions and group semantics |
| `__tests__/templates/pr-tier-base-branch-filter.test.ts` | modify | committed-vs-emitted self/parity and executable context cases |
| `__tests__/templates/__snapshots__/high-fanout/01-pr-fast.yml` | modify | derived approval snapshot of emitted T1 output |
| `docs/REFERENCE/ci-tier-workflows.md` | modify | document PR head/base identity and unchanged fast push identity |

The native task manifest must include this exact write set plus native plan/evidence
artifacts. The four workflow files are the only product/template surfaces. Existing
parity, syntax, actionlint, and workflow-integrity suites are read-only consumers and
must be run, not broadened.

Qualification repair (2026-09-09): L2 at `7913c54384fdfd2de1f0983a6a83f2e738acf891`
failed only the native docs-change gate. Add one paragraph to the existing CI tier
reference explaining the implemented head/base PR groups, unchanged cancellation
policy, and exact fast push fallback. No behavior or AC changes; preserve the original
RED and failed L2 receipt. Check docs, formatting, links and the unchanged AC anchor
before renewed L1/L2 and source-bound delta review. No generated documentation changes.

Read-set and bounded impact: inspect `src/utils/render.ts`, the CI render context helper,
the existing `pr-tier-base-branch-filter.test.ts`, `ci-tier-render-parity.test.ts`,
`high-fanout-file-snapshot.test.ts`, and workflow-integrity/actionlint coverage. No fresh
`graphify-out/graph.json` exists for this candidate, so use the bounded native fallback:
`rg -n 'pr-fast-|pr-extended-|head_ref|base_ref|concurrency:' .github src __tests__`,
then manually inspect the listed callers and generated-output consumers. This fallback
is an impact diagnostic, not a graph regeneration or broad audit.

## Approach & decomposition

Keep the existing group prefixes and cancellation policy. Use the exact conditional
suffix shape `group: pr-fast-${{ github.head_ref || github.ref_name }}${{ github.base_ref && format('-{0}', github.base_ref) || '' }}` (and the corresponding
`pr-extended-` prefix). This adds `github.base_ref` only for pull-request contexts, so
an empty `base_ref` falls back to the current fast push value `pr-fast-${{ github.ref_name }}`. The PR key must
contain both base and head, so same-head/different-base PRs are distinct while repeated
events for the same PR retain one key and the current `cancel-in-progress` behavior.
Apply the same shape to the T2 group (which is pull-request-only today). Do not change
trigger filters, job guards, permissions, job content, prefixes, or cancellation values.

Replace the stale #2476 comments in the self fast workflow, fast EJS twin, and fast
high-fanout snapshot: they must describe the now base-aware group and preserved push key,
not say the collision is intentionally accepted.

Update the existing literal render expectations, add executable context cases that extract
the rendered/committed `group` expression and evaluate it for representative GitHub
contexts, and retain the existing all-stack/all-level loops. For both `github-flow` and
`github-flow-with-develop`, exercise both T1 and T2 across five stacks × four levels
(`L1`, `L2`, `L3`, `L4`), including same-head/different-base isolation, same-PR stable
identity, and exact fast push identity. Refresh only the affected high-fanout snapshot
from the normal snapshot test after the template is correct.

## Threat model & abuse cases

This is a CI isolation boundary: a contributor can open stacked or cross-base PRs sharing
one head branch and otherwise cause a valid run to cancel another. A malformed or
unconditional suffix can instead fragment push runs or defeat intended same-PR
supersession. Tests must cover both abuse contexts and preserve the existing cancellation
policy. No secrets, permissions, external input parsing, or runtime application surface
is introduced.

## Input validation

The trust boundary is GitHub's workflow context (`head_ref`, `base_ref`, `ref_name`, and
`ref`). Do not parse or normalize branch names in JavaScript or introduce shell input.
GitHub's expression engine owns empty-string and fallback semantics. Tests validate the
actual extracted group expression from each committed/rendered workflow, including a
push context with empty `base_ref`, rather than asserting a hand-coded key alone.

## Idiomatic patterns & pitfalls

Use the existing `${{ ... }}` expression style and the exact `format('-{0}', github.base_ref)`
short-circuit fallback above; keep the key a single YAML scalar. Avoid nested expression interpolation, a
second helper, branch-name sanitization, or a new gate. Preserve the exact fast push
identity and existing `cancel-in-progress` lines byte-for-byte. `02-pr-extended.yml`
has no push trigger, but its PR expression must still match its EJS twin and remain
stable for same-PR updates.

## Acceptance Criteria

- [ ] AC-1: the concurrency group distinguishes pull requests that share a head but differ in base —
  appending `github.base_ref` is the obvious shape; confirm it does not break the `push:` lane,
  where `base_ref` is empty.
- [ ] AC-2: the `02-pr-extended.yml` group (`pr-extended-...`) is checked for the same defect in the
  same pass, along with the corresponding `.ejs` twins (CANON-18).

## Non-Goals

- Do not change workflow triggers, required checks, job contents, permissions, or cancel-in-progress policy. Do not extend this fix to other workflow concurrency groups or change the existing push group identity.

## Test strategy

TDD units, in order:

1. **RED — AC-1:** In the existing focused template tests, add cases that extract the
   actual fast group expression from the materialized workflow and from rendered EJS,
   then evaluate contexts `{head_ref: 'shared-head', base_ref: 'main'}` and
   `{head_ref: 'shared-head', base_ref: 'release'}`. Assert distinct keys; evaluate a
   repeated same-PR context and assert equal keys; evaluate push `{base_ref: '',
   head_ref: '', ref_name: 'main'}` and assert the pre-change `pr-fast-main` identity.
2. **RED — AC-2/CANON-18:** Run the same assertions against both T1/T2 EJS twins over
   five stack fixtures × `L1`/`L2`/`L3`/`L4`, under both `github-flow` and
   `github-flow-with-develop`. Assert the committed T1/T2 group lines and rendered
   T1/T2 group lines use the same base-aware contract, with same-head/different-base
   isolation, same-PR stability, and exact fast push fallback covered in every strategy.
   Concretely, extend the existing `LEVELS = ['L1', 'L2', 'L3']` loops in both
   `ci-render.test.ts` and `02-pr-extended-render.test.ts` to include `L4`; do not add
   a parallel partial matrix.
3. **GREEN:** Apply the smallest expression-only change to the four workflow declarations;
   update the existing exact-string assertions and refresh the one affected high-fanout
   snapshot. No new test framework, helper module, fixture family, or dependency.
4. **Verification:** Run focused Vitest selectors, the existing `ci-tier-render-parity`,
   high-fanout snapshot, generated-workflow syntax/actionlint, workflow-integrity, and
   all-stack × all-level CANON-18 coverage. Then run the native L1/L2 gates at the exact
   candidate before any push. Record fresh AC-fit evidence with file:line citations.

The red receipt must be a real failing test against the unchanged group expression and
must retain command, exit, candidate SHA, and output. Do not claim the baseline collision
or readiness probe as TDD, schema approval, or implementation PASS.

## Derived outputs and native review contract

The implementation's derived output is limited to the four workflow declarations and the
single T1 high-fanout snapshot listed above. Native lifecycle outputs are separate,
required, and must be produced against the exact plan/candidate: `.arbiter/evidence/tdd/#2486.json`,
`.arbiter/evidence/plan-review/_2486/latest.json`, `.arbiter/evidence/redteam/#2486.json`,
`.arbiter/evidence/ac-fit/2486.json`, the L1/L2 gate receipts, independent code-review and
adversarial-verifier returns, and the final PR/CI evidence. No generated docs, examples,
schemas, lockfiles, or other workflow groups are in scope.

Native Standard review verticals are `bugs`, `type-safety`, `domain`, `test-quality`,
`security`, `data-integrity`, and `silent-failures` (security confirms no permissions or
secrets surface changed). The review focus is concurrency, regression, edge cases, and
parity; these are not additional vertical names. Standard plan review and three Standard
red-team reviewers must check the exact read-set, bounded impact fallback, four-level ×
five-stack × two-strategy matrix, and comment/snapshot parity. No new reviewer vertical
or graph artifact is created.

Before implementation, the native preflight must retain the corrected readiness command
and exact issue body, confirm branch/base/source SHA and this plan digest, and update the
native manifest without claiming readiness is schema APPROVED. Standard-tier plan review
requires a fresh independent PASS at `.arbiter/evidence/plan-review/_2486/latest.json`
bound to this exact plan digest; three independent Standard red-team returns are required
before red. Any HIGH/CRITICAL finding must be resolved in the plan/diff and re-reviewed.

After RED/GREEN, the native sequence is: focused tests and TDD receipt; independent
code review plus adversarial verifier; AC-fit PASS for both criteria with file:line
evidence; exact-head L1 then L2 under the native gate mutex; current CI checks; and
only then PR/merge admission. No child jobs were dispatched for this bounded plan.

## Risks

The main risk is preserving push identity while making PR keys base-aware; direct
expression evaluation and committed/rendered parity tests catch it. A second risk is
updating only a template or only self; the four-surface manifest, parity suite, and
snapshot catch drift. GitHub expression support for the selected short-circuit/format
shape must be confirmed by the reviewer against the official expression semantics before
implementation. Residual risk is limited to GitHub's own group-name normalization; no
application-side workaround is warranted.

The plan/base remains **NOT-TESTED for implementation** until fresh TDD, review, AC-fit,
L1/L2, CI, and merge evidence exist. The preserved baseline collision is diagnostic only.
