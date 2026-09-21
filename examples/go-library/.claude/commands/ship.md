---
description: One adaptive path from issue to merged, green capability
argument-hint: '#NNN [--tier XS|S|Standard]'
title: '/ship #NNN'
doc_version: '3.0.1'
status: active
last_review: '2026-09-20'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# /ship #NNN

`/ship` is the single delivery entrypoint. The unit of work is a capability that a user can run,
possibly backed by several related issues. Work is done only after merge, green CI, and live proof
when the capability has a live surface.

`arbiter ship` owns the next action and lifecycle state. Follow its output. Use `arbiter lifecycle`
subcommands only for recovery or direct lifecycle control; they enforce the same gates.

## Start and resume

```bash
arbiter ship #NNN --tier <XS|S|Standard>
arbiter ship #NNN --advance
```

Call the first form to read the current treatment and next action. Do that work, then call the
second form. Repeat until `Phase: complete (done)`. After context loss, call the first form again;
`.claude/.task/status.json` reconstructs the same treatment, phase, round, and next action.

## Adaptive treatment

The runtime persists one `ShipTreatment`. Plans, prompts, reviewers, evidence writers, and delivery
gates consume that record; none recomputes its own reviewer policy.

| Treatment | Plan    | Pre-code challenge |               Final code review | Acceptance fit | Model capability |
| --------- | ------- | -----------------: | ------------------------------: | -------------: | ---------------- |
| XS        | minimal |                  0 |            1 pertinent vertical |       included | economy          |
| S         | brief   |                  0 |            1 pertinent vertical |       included | economy          |
| Standard  | full    |                  0 |            1 pertinent vertical |       included | capable          |
| Sensitive | full    |                  0 | relevant specialists, maximum 3 |       included | frontier         |

XS and S require affirmative, fresh qualification: readable issue metadata, a plan `files:`
manifest covering every actual changed file, and a fresh directional dependency graph covering all
non-document files. Missing, stale, malformed, or incomplete input resolves to Standard. Core paths,
directional callers, wave or epic scope, and sensitive paths can only widen. A treatment never
narrows after it has widened.

Put the manifest in the plan's YAML frontmatter so hooks and runtime read the same list:

```yaml
---
files:
  - src/example.ts
  - __tests__/example.test.ts
---
```

Timeout, OOM, rate limit, unavailable tools, and queued CI are infrastructure states; they do not
justify source edits by themselves.

## Context economy

The cost of a delivery is turns multiplied by context, so keep both small.

- Read files by range and search before you read. Send long command output to a file and inspect
  its end; never pipe a gate or a test run through `tail` or `head`, because the pipe reports the
  pager's exit status and hides a failure.
- After the last commit run `node scripts/check-all.mjs preflight` and fix everything it reports
  before freezing; only a candidate that passes preflight is frozen and sent to review.
- Run the full gate once on the frozen candidate. A green gate is not repeated while HEAD is
  unchanged.

## Capability train

A train is one capability, one plan, one branch, one candidate, one final gate, and one PR. Every
companion issue, including an initial positional or `--chain` seed, needs complete qualification
and one affinity decision:

```bash
arbiter ship #A #B #C --tier XS --affinity '{
  "sameOutcome":true,
  "ownerPathOverlap":true,
  "dependencyRelated":true,
  "sharedProof":true,
  "orderingCompatible":true,
  "sharedAcceptanceBoundary":true,
  "sharedRollbackBoundary":true,
  "hardConflicts":[]
}'
```

When that proof is not available at the initial call, start with `#A` and use the same affinity
object with `--chain-add #B --chain-add #C` after the plan and dependency evidence exist.

The command emits every component and `JOIN` or `SEAL(reason)`. Missing evidence, any false
component, any hard conflict, Standard treatment, age limit, or size limit seals the train. Low
recall is deliberate: uncertain issues land separately. Each joined issue still needs its own
namespaced acceptance criteria, RED evidence, commit reference, and closing reference.

## Result-first lifecycle

1. **Preflight** — read the issue and current repository; seed state; verify that the state writer
   and delivery guard agree before implementation.
2. **Plan** — freeze `AC-N` criteria and non-goals; list the complete file set. Mechanical admission
   checks replace pre-code review.
3. **RED** — write the smallest tests that fail for the intended reason and record RED evidence.
4. **GREEN** — implement the capability. Run targeted checks while editing. Defer documentation and
   issue hygiene until behavior is green unless a decision is needed to implement correctly.
5. **Freeze** — finish all fixes, commit, and freeze HEAD plus the plan acceptance hash.
6. **Certify** — push the frozen branch and open or reuse its draft PR, then run `arbiter ship --review-round` in the foreground. PR CI starts on that same SHA while the reviewer receives the frozen task, base/head SHAs, ordered acceptance criteria, non-goals, and acceptance hash. Do not dispatch reviewers or write envelopes by hand.
7. **Rework** — a changed source SHA invalidates review, acceptance-fit, and gate evidence. Round two
   reviews only the delta. The
   normal cap is two rounds; only LOW findings may be parked. Applicable MED/HIGH/CRITICAL findings
   block. If another ordinary round would be needed, report BLOCKED or deliberately force it. A
   round whose only findings are LOW is complete and parks those findings; the foreground
   `--review-round` command reports the result before returning.
8. **Verify** — join review completion and all-PASS acceptance fit with green CI for the exact frozen SHA. Record the CI verdict with `node scripts/ci-receipt.mjs` before `advance --to close`; only then mark the draft PR ready.
9. **Land** — reuse the unchanged qualification through PR and CI. Merge, verify green post-merge CI,
   perform live proof when applicable, close every carried issue, then clean up.

For a product with a live surface, use `/tabletop` as an optional pre-release step or run the
configured live journey before declaring the landing complete. The lifecycle must still observe the
merged PR and green CI; tabletop blockers are hard stops, and an open or red PR remains owned by the
current lane.

| Phase          | What `/ship` does                                                                                                                           | Review agents |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------: |
| `preflight`    | Read the issue and seed validated task state.                                                                                               |             0 |
| `plan`         | Freeze acceptance, non-goals, and files.                                                                                                    |             0 |
| `red`          | Use the `tdd` skill to write failing tests and `arbiter lifecycle record-red`.                                                              |             0 |
| `green`        | Implement the capability and run targeted checks.                                                                                           |             0 |
| `refactor`     | Freeze HEAD; push it, open/reuse a draft PR for overlapping CI, then dispatch the final reviewer.                                               |     treatment |
| `verification` | Require exact-head review, acceptance, and green CI evidence; record the CI verdict before advancing to close. |             0 |
| `close`        | Reuse the unchanged receipt through push, PR, and CI.                                                                                       |             0 |
| `complete`     | Verify merge and green CI, close carried issues, and clean up.                                                                              |             0 |

Add specialist reviewers only for auth, data integrity, concurrency, money, migrations, or deployment.
The final reviewer covers code, tests, and acceptance fit.

## Evidence commands

`arbiter ship --review-round` owns the final reviewer dispatch and evidence write in the foreground.
It builds the reviewer brief from the plan stored at the frozen SHA, writes the authoritative
`.arbiter/agents-dispatched.json` sidecar, and binds the returned envelope to the task, branch,
frozen SHA, provenance, and active treatment;
do not dispatch reviewers or write reviewer envelopes by hand. Use
`node scripts/check-review-completion.mjs --task '#NNN'` only for diagnostics.

The completion check rejects missing or malformed envelopes, a different task/branch/SHA, a sidecar
that differs from the persisted treatment, source changes after review, and any applicable
MED/HIGH/CRITICAL finding.

The runtime review envelope and acceptance-fit evidence stay bound to the same frozen subject.
`arbiter lifecycle advance --to verification` runs the canonical review-completion and
acceptance-fit checkers before changing phase. The final full gate writes the exact-subject receipt. A source change
invalidates it; evidence-only commits may preserve it when the binding checker proves source content
unchanged.

The adversarial verifier and wave-worker path still enter through `--mode ac-fit`; that entry records
the acceptance-fit view under the same frozen-subject and citation rules.

## Gate economy

Run `node scripts/check-all.mjs preflight` as a local diagnostic, then push the frozen candidate;
CI runs the full gate on that SHA and is the verification authority. Record the CI verdict with
`node scripts/ci-receipt.mjs` before `advance --to close`. PR and pre-push paths consume the same
receipt.

A killed process has no verdict. Preserve these outcomes distinctly: `PRODUCT FAIL`, `TEST FAIL`,
`ENVIRONMENT ERROR`, `TOOL UNAVAILABLE`, `TIMEOUT`, `KILLED/OOM`, and `NO DATA`.

## Hard stops

Stop the current lane when a lifecycle gate fails, affinity seals, no implementation approach makes
progress, required evidence is unavailable, or a material product decision is unresolved. Continue
independent work when possible. Do not bypass the state machine, invent a second worktree manager,
write a second evidence store, or claim completion before the merge and green CI are observed.
