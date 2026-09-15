---
title: '#2693 exact-tree gate evidence reuse across commit and close'
doc_version: '1.0.0'
status: review-ready
last_review: '2026-09-15'
owner: 'Luca Dominici'
canonical_id: 'task-2693-exact-tree-gate-reuse'
tags: ['audience/agent', 'kind/plan']
related: ['#2693', '#2681', '#2328', '#2427', '#2615', '#2698']
---

context:
  issue: '#2693'
  type: perf
  tier: Standard (no human-originated narrower tier; core paths `src/commands/`, shared gate verifier)
  branch: 'task/#2693-exact-tree-gate-reuse'
  base: 'main @ 2d6de912'
  host: 'arbiter 0.6.0 (/tmp/arbiter-current-2693/bin/arbiter), host-preflight OK'
  readiness: >-
    scripts/issue-readiness.mjs exit 1 — body lacks explicit `AC-N:` ids, a Non-goals section and a
    Files/contracts section. Not labeled needs-clarification: criteria are frozen below in issue order,
    and the compatibility preflight narrows the unsafe staged-receipt criterion (recorded on the issue,
    comment 5675448114) while preserving the measured objective and every existing verifier axis.
  status: 'review-ready — R1 recorded at #2693 comment 5675448114'

# #2693 exact-tree gate evidence reuse across commit and close

## Files manifest

files:
  - src/commands/ship-profile.ts                    # expose existing evidenceHarness feature to /ship
  - src/commands/task-ship.ts                       # verification/close action text: select one final level
  - .claude/commands/ship.md                        # Gate economy, Complete: prescribed gate order
  - src/templates/claude/commands/ship.md.ejs       # emitted twin of the same text (Track B)
  - __tests__/commands/task-ship.test.ts            # final-level selection per evidenceHarness
  - __tests__/templates/ship-driver-render.test.ts  # direct landing preserves frozen receipt
  - __tests__/commands/ship-profile.test.ts         # existing feature reaches the resolved profile
  - __tests__/evidence/gate-evidence-binding.test.ts     # staged-after-commit rejection
  - scripts/record-agent-return.mjs                     # align reviewer recorder with trunk-solo /ship
  - src/templates/scripts/record-agent-return.mjs.ejs   # emitted twin of recorder alignment
  - src/commands/task-state.ts                          # carry schema-validated collaboration mode
  - src/commands/task.ts                                # persist validated mode during task init
  - __tests__/commands/task.test.ts                     # task-state writer contract
  - __tests__/scripts/record-agent-return-modes.test.ts  # one-reviewer trunk-solo regression
  - __tests__/evidence/done-evidence-sequence.test.ts    # final L3 reuse without a second gate
  - __tests__/githooks/pre-push-reuse-evidence.test.ts  # stronger final receipt reused at push
  - docs/REFERENCE/task-recovery.md                    # durable lifecycle and review contract
  - examples/{ts-library,python-library,go-library}/.claude/commands/ship.md
  - examples/{ts-library,python-library,go-library}/scripts/record-agent-return.mjs
  - examples/{ts-library,python-library,go-library}/.arbiter-generated-manifest.json
  - .arbiter/evidence/tdd/#2693.json                # committed TDD evidence

Not edited (read as contract): `scripts/lib/gate-evidence.mjs` (+ `.ejs` twin), `src/evidence/gate-binding.ts`,
`scripts/check-all.mjs`, `scripts/done-evidence.mjs` (+ `.ejs`), `.githooks/pre-push`.
The existing consumer/start-end tests retain the other identity and invalidation boundaries.

Existing Code Survey (CANON-16): no new `src/` file. Reuse `verifyGateEvidence` rank semantics
(`GATE_EVIDENCE_LEVEL_RANK`), `features.evidenceHarness` (already switches `checkCompletionEvidence`
between an L2 marker and the L3 done receipt), `done-evidence.mjs` existing L3-marker reuse branch, and
pre-push `--min-level L2` reuse. No new schema, store, orchestrator, dependency or issue.

## Compatibility preflight result (AC-1)

Traced end to end on `2d6de912`. All consumers share one marker file `.arbiter/gate-pass.json`
(schema `arbiter-gate-pass-v3`) and one verifier contract (script `scripts/lib/gate-evidence.mjs`,
engine twin `src/evidence/gate-binding.ts`, pinned by parity tests).

| # | Party | Location | Level required | Identity bound |
| - | ----- | -------- | -------------- | -------------- |
| W | Receipt writer | `scripts/check-all.mjs:801-821` → `buildGateEvidence` | stamps `effectiveGateLevel` (L1 for `check`, else the positional level) | `head_sha`=HEAD, `tree_hash`=working tree incl. untracked, excl. `.arbiter/`; start==end identity; `tree_was_clean_at_run_time`=no tracked/staged change |
| V | `/ship` verification | `task.ts:1179` (TDD gates only); step text `task-ship.ts:390` runs `profile.defaultGateLevel` | none enforced on entry | — |
| C | `/ship` close entry | `task.ts:1183` `checkGatePassMarkerGate(dir,'L1')` | ≥ L1 | exact HEAD, branch, checkout, toolchain, tree, clean=true, TTL |
| C' | close step text | `task-ship.ts:234` | instructs "run L2 once before push" | — |
| D | `done-evidence` | `scripts/done-evidence.mjs:272-310,404` | ≥ L3; reuses a valid L3 marker, otherwise runs `check-all.mjs L3` | same verifier + receipt pins marker bytes sha256 |
| P | pre-push | `.githooks/pre-push:193` | ≥ L2 (reuse), else runs L2 | same verifier |
| K | `/ship` complete | `task.ts:951-968` | evidenceHarness: done receipt (L3 marker bytes, head/tree equal); else L2 marker | exact HEAD + marker digest |

Findings:

1. **Level disagreement (root cause of the duplicate L2/L3).** C' prescribes L2, D requires L3, P
   accepts ≥ L2. On arbiter-self `L2` and `L3` both resolve to subcommand `gate` — identical check set;
   the level is only the label (`parse-check-args.mjs:23`, pinned by `done-evidence-gate-level.test.ts`).
   An L2 run can never satisfy D, so D reruns the same checks. An L3 run satisfies C, P and D by rank.
   In generated projects L3 is a strictly larger lane (`check-all.mjs.ejs:1314`), and D still requires
   L3 there, so "run the level D requires" is correct for both.
2. **Digest mismatch (#2616).** The receipt pins the marker bytes; any later gate run (the L2 at C')
   rewrites the marker. Running the final level once, before D, and nothing after, keeps K valid.
3. **Staged receipt (#2690).** The prescribed worktree flow ("run L1 before committing",
   ship.md §Gate economy) stamps `clean=false, head_sha=parent`; C rejects it after commit. See the
   compatibility decision below: tree equality alone does not make that receipt equivalent to a committed run.
4. **Evidence commits.** Committed `.arbiter` evidence after the final gate moves HEAD and invalidates
   P/D by design (AC-5 keeps head binding). Done receipts are gitignored, so D does not move HEAD.
   The prescribed order must therefore commit review/AC-fit evidence before the final gate.

## Compatibility decision — R1

AC-2 treats "commit tree == recorded projected tree" as sufficient to reuse a staged receipt. It is
not, for the existing L1 check set. These L1 checks measure HEAD or history, not the index or working tree,
so a staged run did not evaluate the commit that is about to be created:

- `scripts/check-drift.mjs:37-43` — diffs `HEAD^..HEAD`: the staged run checks the *previous* commit.
- `scripts/check-bloat-ratchet.mjs:96-104` — `merge-tree origin/main HEAD`: staged changes are absent.
- `scripts/check-plugin-api-stability.mjs:52` — `diff base...HEAD`: staged changes are absent.
- `scripts/check-acceptance.mjs:226` — binds AC-fit to `rev-parse HEAD`: the parent SHA.

(`check-docs.mjs` unions `--cached`, and its commit-message bypass only relaxes, so it is safe.) Reusing a
staged L1 after commit would certify drift/bloat/plugin-API/AC-fit results never computed for that commit.
That would be green-by-assertion (INV-33) and weaken the gate, which every issue comment forbids.

- **Selected R1.** Keep the verifier's existing fail-closed rejection of `clean=false` markers
  (no verifier change). Remove the staged run from the prescribed lifecycle instead. Commit the candidate
  and its review/AC-fit evidence, then run the one final level on the clean HEAD. C accepts it by rank,
  D reuses it, P reuses it, and K validates the unchanged receipt post-merge. A staged receipt remains
  invalid because its HEAD-bound checks did not measure the commit. Tests pin that boundary. Result:
  one final full gate per unchanged worktree candidate.
- **Rejected R2.** Make the four checks projection-aware (index tree instead of HEAD) and relax
  `shapeProblem`/engine twin for `clean=false` when `HEAD^ == head_sha` and HEAD tree minus `.arbiter`
  equals `tree_hash`. This widens scope to both verifier twins, their `.ejs`, four check scripts, and every
  future HEAD-reading check. That is an open-ended equivalence obligation with no mechanical guard.

R1 is recorded on the issue (comment 5675448114). The literal staged-survival requirement is superseded
by that narrowed issue evidence: preserve the exact committed subject and reuse one sufficient final gate.

## Approach & decomposition (R1)

1. `src/commands/ship-profile.ts` + `src/commands/task-ship.ts` — expose the existing
   `features.evidenceHarness` boolean on the resolved profile and make the verification action select ONE final
   level: `L3` when the harness is active (the level D and K require), otherwise `L2` (the level P and
   non-harness K require). Keep the existing profile-default gate as the single pre-commit
   diagnostic run in refactor; its dirty marker is deliberately not reused. At verification, commit candidate plus evidence,
   run `node scripts/check-all.mjs <final>` once, then do not run another gate while the subject is unchanged.
   With `evidenceHarness`, run
   `node scripts/done-evidence.mjs` to capture the existing receipt from that L3 marker; without it,
   skip done-evidence. Close consumes the qualified receipt, then push reuses it. The profile/context already reaches `shipStepFor`; thread the boolean
   from existing config loading. No new config key.
2. `.claude/commands/ship.md` + `ship.md.ejs` — update every cadence instruction, including the landing
   and push summary near lines 98–100. Replace "run L1 in the worktree before
   committing and retain its receipt" with "commit, then run the final level once on the clean HEAD; a
   staged receipt is not reusable (HEAD-bound checks)". §Complete: state the single order
   (evidence commits → final gate → conditional done-evidence capture → push reuse → post-merge validate
   in the original checkout/branch with the unchanged candidate HEAD, no recapture).
   The phase map consumes only the verification skill's claim checks, not its generic before-push L2,
   so that fallback cannot overwrite the final receipt. The final gate runs before the transition into
   `close`, whose entry guard already requires a valid marker.
   Trunk-solo direct landing performs no rebase or second gate after freeze: it rejects an advanced
   `origin/main`, otherwise pre-push reuses the qualified receipt.
3. `task init` + `record-agent-return.mjs` and its emitted twin — load `collaborationMode` through the
   canonical schema validator, persist it in unified task state, and derive the Standard panel minimum
   from that state: one reviewer for `trunk-solo`, two for collaborative modes, while the existing routed
   risk escalation remains three. Missing state keeps the stricter collaborative default. This closes the
   measured #2681 mismatch without letting unvalidated raw config weaken the guard.
4. No change to writer, verifier, done-evidence, pre-push or engine guards. They already reuse by rank
   and reject every invalidation boundary.

Harness data flow after the pre-commit diagnostic: clean-HEAD `check-all L3` → `gate-pass.json` → (C rank ≥ L1) → (D reuse,
receipt pins bytes) → (P rank ≥ L2) → merge exact SHA → (K receipt+marker unchanged). Non-harness:
`check-all L2` → C/P/K reuse, with no done-evidence invocation.

## Threat model & abuse cases

Local JSON is identity binding, not authenticity; CI reruns the gate (unchanged trust boundary). Abuses:
(a) passing a dirty or staged receipt off as committed proof — stays rejected (`clean=false`).
(b) A lower-level marker satisfying D — rank check. (c) Replaying another task's or checkout's marker —
`task_id`, `checkout_root`. (d) Mutating source after the final gate, then pushing on the old receipt —
`tree_hash`/`head_sha`. (e) Receipt reused post-merge after marker rewrite — digest pin. (f) A parseable
but schema-invalid raw config lowers the review panel — recorder trusts only validated task state. The change only
reorders prescribed commands; it removes no axis.

## Input validation

Trust boundary is the marker/receipt files read by the verifier twins; unchanged. `evidenceHarness` is
read through existing `loadConfig` (throws on malformed config); a missing config → non-harness → `L2`,
which matches K's non-harness requirement, so it cannot select a level below what completion needs.
The same validator supplies `collaborationMode` to task state; the recorder never reparses raw config.

## Idiomatic patterns & pitfalls

- Reuse `GATE_EVIDENCE_LEVEL_RANK` semantics; do not add an `L2≡L3` equivalence (#2615 test forbids
  widening the ladder).
- Pitfall: `.ejs` twin drift → covered by existing emission/bake parity; regenerate snapshots, never
  hand-resolve.
- Pitfall: the evidence commit after the final gate silently forces a rerun. The text must order
  evidence commits first.
- Pitfall: tests shelling `git commit` must disable hooks and gpg (existing `gate-evidence-consumers`
  fixture pattern).

## Acceptance Criteria

- [ ] AC-1: A preflight verifies compatibility between the gate receipt writer, `/ship` verification/close guards, `done-evidence`, and pre-push requirements before implementation begins.
- [ ] AC-2: A staged gate receipt remains invalid after commit even when the projected tree matches, because HEAD/history checks did not evaluate that commit; the worktree lifecycle no longer prescribes this unsafe run.
- [ ] AC-3: Any source/staged mutation, different tree hash, insufficient gate level, or ambiguous dirty state invalidates reuse.
- [ ] AC-4: `/ship` verification selects one sufficient final gate level before entering close; harness `done-evidence` reuses that receipt instead of launching a second full gate on the same tree.
- [ ] AC-5: Pre-push reuses the same qualified receipt when head and tree binding still match.
- [ ] AC-6: Tests cover reuse and every invalidation boundary without creating a parallel evidence format.
- [ ] AC-7: Gate duration and avoided duplicate runs remain observable metrics, not new blocking ceremony.
- [ ] AC-8: The compatibility preflight is durable. A test pins that the close-selected final level ranks ≥ every consumer requirement (C ≥ L1, P ≥ L2, D = L3 under evidenceHarness, K). It fails if any requirement or the prescribed level changes independently.
- [ ] AC-9: A staged (`tree_was_clean_at_run_time=false`) receipt is rejected after commit even when HEAD's tree minus `.arbiter/` equals its `tree_hash`. The rejection reason is actionable, and no verifier axis is removed or relaxed (INV-33).
- [ ] AC-10: The emitted `ship.md.ejs` twin and the self `ship.md` prescribe the same final-gate order; generated bake snapshots are regenerated, not hand-edited.
- [ ] AC-11: The reviewer recorder accepts the single independent reviewer prescribed by a trunk-solo Standard `/ship`, retains two for collaborative Standard work, and retains the routed three-reviewer escalation.

## Non-Goals

- No new evidence schema/field, store, orchestrator, config key, dependency or issue.
- No L2≡L3 ladder equivalence, TTL change, or relaxation of any verifier axis.
- No change to CI gates, the check set of any level, or done-evidence runtime/pinning.
- No projection-aware rewrite of HEAD/history checks (R2); revisit only if staged-gate survival becomes a measured product need.
- No broader reviewer-router redesign; #2681 retains the remaining review and wait economy work.

## Merge contract

1. ACs: AC-1..AC-11 above (hard-gated by `check-acceptance`).
2. Policy: INV-33 (no green-by-assertion), INV-38 (done evidence), INV-114 (Stop evidence), INV-138,
   CANON-06 (`src/commands`), CANON-25 (gate-behaviour change: name what turns it red — AC-8/AC-9 tests),
   Track A+B dual canon (ship.md + `.ejs`).
3. Required tests: see Test strategy.
4. CI: L1, L2 incl. bake/emission parity, tdd-evidence, acceptance, review-completion.
5. Review: use only the current mechanically required Standard panel on the frozen source SHA and one
   adversarial AC-fit verdict. No implementation agent, extra specialist, or repeated full-context round;
   reconcile all actionable findings in one batch. #2681 owns reducing this mandatory fan-out permanently.
6. Dependencies (impact): `task-ship.ts` ← `src/cli.ts:52` (ship step printer) and its tests;
   `ship.md.ejs` ← emission/bake snapshots and `__tests__/matrix/cross-product.test.ts`; verifier
   consumers listed in the preflight table (read-only here).

Landing route supported: yes (trunk-solo + pr-ff).

## Test strategy

| AC | Unit / level | Proof |
| -- | ------------ | ----- |
| AC-1, AC-8 | `ship-profile.test.ts`, `task-ship.test.ts` plus existing consumer requirement fixtures | the existing harness feature reaches `/ship`; selected final level satisfies close, done and pre-push contracts; verification + close contain one gate command before the close entry guard |
| AC-2, AC-3, AC-9 | `gate-evidence-binding.test.ts` plus existing start/end and consumer tests | add only the staged-then-commit equal-tree rejection; retain existing mutation, level, dirty and untracked cases |
| AC-4, AC-5 | `done-evidence-sequence.test.ts`, `pre-push-reuse-evidence.test.ts` | clean L3 is captured without launching another gate and reused at push; non-harness path contains no done-evidence command |
| AC-6 | review of diff | only existing `arbiter-gate-pass-v3` marker used; no new file format |
| AC-7 | lifecycle test | reuse messages (pre-push `PRE-PUSH: reusing green`, done-evidence reuse line) and `durationMs` in `local-result.json` remain present; none add an exit path |
| AC-10 | existing emission/bake parity + grep assertion | both ship texts contain the same final-level order |
| AC-11 | `task.test.ts`, `record-agent-return-modes.test.ts` | task init persists a validated mode; trunk-solo accepts one reviewer; raw invalid config cannot lower the collaborative minimum; routed escalation remains green |

Baseline (issue comments, before): L1 132,967 / 134,311 / 137,054 / 134,090–137,668 ms; L2 247,322–253,423 ms;
L3 245,955–273,288 ms. Totals per slice: 656,658 ms (#2691), 932,229 ms (#2686), 1,178,722 ms (#2698).
After: a faster step is not proof of throughput. Measure this task's own landing (one pre-commit diagnostic
gate plus one final full gate; count their `durationMs` from the gate output, plus reuse lines at
done-evidence and pre-push) and record it
in the PR. Do not pay extra gates for a matched benchmark.

## Risks

- TTL (240 min) can expire between the final gate and post-merge complete on a slow CI → K reruns.
  Accepted residual; no TTL change (Non-goal). Recorded, not mitigated.
- Late evidence commit after the final gate forces a rerun → mitigated by the prescribed order and a
  step-text test.
- Generated projects with a heavier L3 lane now run L3 at verification instead of L2 plus a separate L3 at
  done-evidence. That is still one full gate instead of two, and D already demanded L3.
- R1 intentionally does not deliver staged-receipt survival; the preflight proved that doing so would
  require projection-aware semantics for every HEAD/history check.

## Units

2 units: (1) task-ship final-level text + tests; (2) ship.md/.ejs order + lifecycle/invalidation tests + bake regen.
