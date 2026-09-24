---
files:
  - .arbiter/evidence/tdd/#2865.json
  - .claude/plans/task-2865-exact-main-ac.md
  - .claude/commands/ship.md
  - src/templates/claude/commands/ship.md.ejs
  - scripts/lib/acceptance-criteria.mjs
  - src/templates/scripts/lib/acceptance-criteria.mjs.ejs
  - scripts/check-acceptance.mjs
  - src/templates/scripts/check-acceptance.mjs.ejs
  - scripts/record-agent-return.mjs
  - src/templates/scripts/record-agent-return.mjs.ejs
  - src/commands/task-ship.ts
  - src/commands/task.ts
  - __tests__/scripts/acceptance-criteria-lib.test.ts
  - __tests__/scripts/check-acceptance.test.ts
  - __tests__/commands/ship-review.test.ts
  - __tests__/commands/task-advance-gates.test.ts
  - examples/**
  - __tests__/integration/e2e/bake/__snapshots__/*.json
---

# Task #2865 — exact-main acceptance criteria

## Acceptance Criteria

- [ ] AC-1: A reviewer envelope with a PASS/non-blocking verdict and at least one `NOT-TESTED` criterion is recorded as a review return, never as `E_REVIEW_NO_DATA`. `ship --review-round` prints a deterministic message naming each non-PASS criterion.
- [ ] AC-2: A plan can mark a criterion as proven on exact main (one explicit marker in the plan AC line; its hash stays part of the plan anchor). For such criteria only, the pre-merge ac-fit accepts `NOT-TESTED`. Every other criterion still requires PASS.
- [ ] AC-3: For a task with at least one exact-main criterion, the lifecycle reaches `complete` only after the exact-main CI run on the merge SHA is terminal green, verified natively with the same CI-receipt authority, bound to the merge SHA. Red or missing is refused.
- [ ] AC-4: `pr-merge-watch` landing is unchanged. It still requires the exact-head CI receipt and a completed review for the frozen SHA.
- [ ] AC-5: An unmarked `NOT-TESTED` still blocks acceptance, as today. A marker on every criterion is refused at plan admission: at least one criterion must be provable pre-merge.

## Non-Goals

- No change to review cap, reviewer seats, thresholds or the landing method.
- No free-form waiver of acceptance.

## Design (minimal, existing authorities only)

- **Marker**: the literal `[exact-main]` as the first token of the criterion text, right after
  `AC-N:`. It stays inside `text`, so `computeAcHash` covers it without change. The parser sets
  `exactMain: true` on explicit criteria only. `validateIssueAcceptanceCoverage` strips the marker
  from the plan text before the verbatim comparison (the issue does not carry it).
- **ac-fit (AC-2/AC-5)**: `validateAcFit(..., { requireAllPass, exactMainIds })`. Under
  `requireAllPass`, `NOT-TESTED` is accepted only when the id is in `exactMainIds`. `FAIL` is never
  accepted. `checkPlanAnchor` returns `exactMainIds` and refuses a plan where every criterion is
  marked. Callers (`check-acceptance` plan/gate/explicit-fit, recorder ac-fit and panel) pass the
  ids derived from the same parsed anchor.
- **Recorder (AC-1)**: in `--mode ac-fit`, when the fit is valid except for non-PASS verdicts on
  unmarked criteria, the envelope is recorded as an ordinary review return (same path as `--mode
  return`, prints `OK — wrote <path>`). No ac-fit artifact is written, so acceptance stays blocked
  (AC-5). `persistEnvelope` already reads the direct `OK — wrote` line first. No TS routing change.
- **Round message (AC-1)**: `executeCodexReviewRound` appends
  `· non-PASS: AC-x NOT-TESTED, AC-y FAIL` (plan order of the envelope) when any criterion is not
  PASS.
- **complete (AC-3)**: `task.ts` asks the emitted checker for the marked ids
  (`check-acceptance.mjs --plan <plan> --exact-main-ids`, via the existing `runRequiredTaskChecker`,
  fail-closed). When non-empty: the `permitGitHub`-unset skip refuses; on the PR path the merge SHA
  is the `mergeCommit.oid` of the verdict PR, read with the existing `readCommitCi` and judged by the
  existing push/main rule (`isSuccessfulPostMainCheck`), filtered to push/main runs so an
  `exact-pr` fast-forward (merge SHA = PR head, which also carries `pull_request` runs) is judged
  on its main runs; zero main runs = missing = refused. `--no-pr` already verifies post-main CI on
  HEAD = origin/main, unchanged.
- **AC-4**: `pr-merge-watch.mjs` is not touched; it runs `check-acceptance` gate mode, whose
  semantics for unmarked criteria are unchanged. Regression test pins that a fit with an unmarked
  `NOT-TESTED` is still refused by gate mode.

## Existing Code Survey (CANON-16)

No new source file. Grepped `exact-main|exactMain` (nothing). Reused: `parseCriterionLine`,
`computeAcHash`, `validateAcFit`, `checkPlanAnchor`, `recordReturn`, `runRequiredTaskChecker`,
`readCommitCi`, `isSuccessfulPostMainCheck`, `successfulPostMainCi`. Rejected: a third inline
`node --eval` plan reader in task.ts (duplication ratchet) — use the emitted checker CLI instead.

## /impact (blast radius)

- `acceptance-criteria.mjs`: imported by check-acceptance, record-agent-return, issue-readiness,
  cross-model-review/task-ship eval scripts, check-review-completion. Additive field + option;
  default behavior unchanged.
- `check-acceptance.mjs`: called by task.ts gates, pr-merge-watch, wave integrate. New flag only.
- `record-agent-return.mjs`: called by external-review persistEnvelope and agents. ac-fit mode
  gains one fallback branch.
- `task.ts` `complete` gate and `task-ship.ts` round message: small local hunks. Both files are
  also touched by open PR #2864 — expect a trivial rebase; hunks kept away from its areas.

## PREMORTEM

- **Files**: see `files:` above. Mirrors kept byte-identical: `scripts/lib/acceptance-criteria.mjs`
  ↔ `.ejs`, `scripts/check-acceptance.mjs` ↔ `.ejs`, `scripts/record-agent-return.mjs` ↔ `.ejs`,
  `.claude/commands/ship.md` ↔ `ship.md.ejs` (docs line on the marker).
- **Examples**: one `npm run regen` after the last template edit.
- **Bake snapshots**: `record-agent-return`, `check-acceptance`, `acceptance-criteria` content is
  baked; rebake LAST (open PRs #2868/#2864 also rebake — regenerate again after they land).
- **Gate registry**: no new gate, no registry entry change.
- **Avoided (open PRs)**: hooks, check-tdd-evidence, pr-merged.ts, task-record-red.ts,
  tdd-reexecute.ts, pr-merged.test.ts, task-ship.test.ts, manifests, website hooks docs.
- **Ratchets**: publicApiSurface 1174 — no new TS export. Complexity 226 — new logic lives in
  small helpers, not in already-complex functions. Branch coverage floor 90.02% — every new branch
  has a test (marked/unmarked, all-marked refusal, recorder fallback, green/red/missing main CI,
  permitGitHub skip). No threshold/baseline edits.
- **Risks**: recorder fallback must not write ac-fit; `exact-pr` fast-forward mixed rollup; stale
  receipts; template drift (self-parity); snapshot churn.
- **Local gates**: targeted vitest suites per slice; pre-commit L1; full L2
  (`node scripts/check-all.mjs` at L2) in the foreground on the clean pushed tree with a PATH shim to
  this worktree's `dist/cli.js`; pre-push hooks as-is.
- **CI jobs**: 01-pr-fast (config-lint, security-early-fail, classify-changes, dependency-review,
  iac-scan, build-workspace, gate, docs-check, debt-gates, sonar-scan, gate-full, generated-gate-min,
  ci-required); 02-pr-extended (contract, integration, license, behavioral, bake-e2e,
  extended-required).

## Slices (vertical TDD)

1. Marker + ac-fit acceptance + all-marked refusal (lib + check-acceptance) — AC-2, AC-5, AC-4.
2. Recorder fallback + round message (ship-review, real recorder) — AC-1.
3. complete gate on merge-SHA main CI (task-advance-gates) — AC-3.
4. Docs line, regen, rebake.
