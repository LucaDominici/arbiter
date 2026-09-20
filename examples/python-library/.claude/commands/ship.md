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

Keep the cursor precise during implementation:

```bash
arbiter lifecycle checkpoint --tdd GREEN --last '<completed result>' --next '<one executable next action>' --digest '<one line>'
```

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

Use the lowest model capability printed by `arbiter ship`. Escalate only when the treatment widens,
a new material risk appears, or one implementation approach makes no progress. Timeout, OOM, rate
limit, unavailable tools, and queued CI are infrastructure states; they do not justify source edits
or model escalation by themselves.

## Thin orchestrator

The cost of a delivery is turns multiplied by context. This session orchestrates; for Standard and
wider treatments it does not carry the implementation. XS and S implement inline.

- After the plan is frozen, dispatch ONE implementer subagent for RED → GREEN → freeze. Its brief is
  the plan path, the frozen `AC-N` list, the file manifest, and the commands printed by
  `arbiter ship`. It commits; it leaves push, review, and phase advances to this session. It returns
  the frozen SHA, the RED evidence path, the tests it ran with counts, and at most ten lines of notes.
- Leave the implementer's diff to the final reviewer and the gates, which read it against the same
  SHA. Read it here only to resolve a finding.
- After the last commit run `node scripts/check-all.mjs preflight` and fix everything it reports
  before the single full gate. Pipe long output through `tail`.
- If the implementer stalls or returns a failing candidate twice, take the write lane back and say
  so in the PR.

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
2. **Plan** — freeze `AC-N` criteria and non-goals; list the complete file set, proof, rollback,
   and smallest executable implementation. Mechanical admission checks replace pre-code review.
3. **RED** — write the smallest tests that fail for the intended reason and record RED evidence.
4. **GREEN** — implement the capability. Run targeted checks while editing. Defer documentation and
   issue hygiene until behavior is green unless a decision is needed to implement correctly.
5. **Freeze** — finish all fixes, commit, and freeze HEAD plus the plan acceptance hash.
6. **Certify** — run one targeted certification for that HEAD. Dispatch the treatment's final
   reviewer against the same SHA and shared evidence. That reviewer also returns acceptance fit.
7. **Rework** — reconcile every finding from the round into one fix batch. A changed source SHA
   invalidates review, acceptance-fit, and gate evidence. Round two reviews only the delta. The
   normal cap is two rounds; only LOW findings may be parked. Applicable MED/HIGH/CRITICAL findings
   block. If another ordinary round would be needed, report BLOCKED or deliberately force it.
8. **Verify** — after review completion and all-PASS acceptance fit, run one clean-HEAD full gate.
9. **Land** — reuse the unchanged qualification through PR and CI. Merge, verify green post-merge CI,
   perform live proof when applicable, close every carried issue, then clean up.

For a product with a live surface, use `/tabletop` as an optional pre-release step or run the
configured live journey before declaring the landing complete. The lifecycle must still observe the
merged PR and green CI; tabletop blockers are hard stops, and an open or red PR remains owned by the
current lane.

| Phase             | What `/ship` does                                                                                                                          | Review agents |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------: |
| `preflight`       | Read the issue and seed validated task state.                                                                                              |             0 |
| `plan`            | Freeze acceptance, non-goals, files, proof, and rollback.                                                                                  |             0 |
| `red`             | Use the `tdd` skill to write failing tests and `arbiter lifecycle record-red`.                                                                  |             0 |
| `green`           | Implement the smallest executable capability and run targeted checks.                                                                      |             0 |
| `refactor`        | Freeze HEAD; dispatch one final reviewer, adding specialist seats only for sensitive domains.                                           |     treatment |
| `verification`    | Require review and acceptance evidence, then run one full clean-HEAD gate.                                                                 |             0 |
| `close`           | Reuse the unchanged receipt through push, PR, and CI.                                                                                      |             0 |
| `complete`        | Verify merge and green CI, close carried issues, and clean up.                                                                             |             0 |

One implementer owns the write lane. Use at most one independent blocker lane. Add specialist
reviewers only for auth, data integrity, concurrency, money, migrations, or deployment. Reviewers
receive the frozen plan, candidate diff, and shared evidence; they do not receive the implementer's
transcript. For ordinary work, the same final reviewer covers code, tests, and acceptance fit
independently of the implementer.

## Evidence commands

Record the complete final reviewer panel once. The recorder reads reviewer count, verticals, and
treatment hash from active task state. Each reviewer envelope's `agent` must be the exact assigned
vertical name, so a declared specialist seat cannot be filled by an unrelated review. The recorder
writes the one authoritative `.arbiter/agents-dispatched.json` sidecar.

```bash
node scripts/record-agent-return.mjs --mode reviewer-panel --task '#NNN' <<'JSON'
{"envelopes":[/* exact arbiter-agent-return-v1 reviewer envelopes */]}
JSON
node scripts/check-review-completion.mjs --task '#NNN'
```

After `--review-round` plans a round, `arbiter ship` prints this command block with task, branch,
frozen SHA, and reviewer verticals already filled; replace every `<...>` placeholder before running
it, and repeat the acceptance-fit criterion object for every frozen AC.

The completion check rejects missing or malformed envelopes, a different task/branch/SHA, a sidecar
that differs from the persisted treatment, source changes after review, and any applicable
MED/HIGH/CRITICAL finding.

The reviewer-panel envelope includes that reviewer's acceptance fit against every frozen criterion;
the recorder writes both correlated artifacts from the same submission. `arbiter lifecycle advance
--to verification` runs the canonical review-completion and acceptance-fit checkers before changing
phase. The final full gate writes the exact-subject receipt. A source change
invalidates it; evidence-only commits may preserve it when the binding checker proves source content
unchanged.

The adversarial verifier and wave-worker path still enter through `--mode ac-fit`; that entry records
the acceptance-fit view under the same frozen-subject and citation rules.

## Gate economy

Run touched tests, changed-file format/lint, and `git diff --check` before freezing, then one full
clean-HEAD gate after review and acceptance fit. Do not repeat a green full gate while HEAD and
its relevant environment are unchanged. PR and pre-push paths consume the same receipt.

A killed process has no verdict. Preserve these outcomes distinctly: `PRODUCT FAIL`, `TEST FAIL`,
`ENVIRONMENT ERROR`, `TOOL UNAVAILABLE`, `TIMEOUT`, `KILLED/OOM`, and `NO DATA`.

## Hard stops

Stop the current lane when a lifecycle gate fails, affinity seals, no implementation approach makes
progress, required evidence is unavailable, or a material product decision is unresolved. Continue
independent work when possible. Do not bypass the state machine, invent a second worktree manager,
write a second evidence store, or claim completion before the merge and green CI are observed.
