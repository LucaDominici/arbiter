# Premortem — arbiter #2900 ∥ #2908, then #2903 (step 1, C)
Base `1d58be09` (origin/main, includes #2911/#2912). Read-only run, 2026-09-26. Lines are 1d58be09;
anchor by function name. Ship: commit §N.1 of this file (redacted, no workspace paths) as
`.claude/plans/PREMORTEM_<id>.md` in the plan commit (#2898/#2899/#2911 precedent).
**Order:** #2900 (script + `.ejs` + 2 bake snapshots) and #2908 (`src/commands/task.ts`, `task-state.ts`)
run in parallel; file sets are disjoint (#2908 hashes into no snapshot). #2903 branches from **#2900's merge**, then re-runs its RED.
## 0. Shared rules and gates (measured at 1d58be09)
- Twins: every script edit is made **identically** in `scripts/X.mjs` and `src/templates/scripts/X.mjs.ejs`
  (`diff` empty); hooks are real EJS: edit the template, render, and never hand-diverge.
- publicApiSurface **1174/1174**. It counts `export` lines in `src/**`, so none of the three may add one.
  complexityViolations **226/226** = `eslint src scripts --rule complexity:10` (scripts count, `.ejs` do not); unchanged under all 3 trials.
- Docs gate (`scripts/check-docs.mjs`, TRIGGER `src/`, `__tests__/`) **fires on all three**, because each adds a
  `__tests__/` file. Touch the named docs file; the `[skip-docs]` precedent on evidence commits (1d58be09) is the fallback, not the plan.
- Bake: snapshots hash rendered files. Only `java-spring-L3.json` and `java-spring-L4.json` render
  `check-refutation-verdicts.mjs` and `evidence-collect.mjs` (L3+ only). No example (all L1) carries either script.
- Verification order (foreground): RED file → `npm run build` → targeted vitest → `npm run typecheck && npm run lint`
  → `node scripts/debt-report.mjs --gate publicApiSurface` and `--gate complexityViolations` → `npm run examples:regenerate
  && npm run examples:check` → `node scripts/check-self-dogfood.mjs` → `BAKE_UPDATE_SNAPSHOTS=1 npm run test:e2e:bake`
  then `npm run test:e2e:bake` → `files:` updated with every regenerated path → snapshots committed **last**
  → `npx commitlint --from origin/main --to HEAD` (header and body lines ≤ 100) → `node scripts/check-all.mjs L1` → `L2` once.
- `record-red` (after the RED commit, `npm run build` first): `node dist/cli.js lifecycle record-red --task '#<id>'
  --test-path <file> --test-command npx --test-arg vitest --test-arg run --test-arg <file>`
- New rule: each RED below failed for the stated reason at 1d58be09 and passed under a trial GREEN (`/tmp/pmc-<n>`, removed).
## 2. #2908: GREEN execution gate re-run at the reviewed / landed HEAD
### 2.1 Plan `.claude/plans/task-2908.md` front matter
```yaml
---
context:
  issue: '#2908'
  type: fix
  pipeline: 'plan → red → green → refactor → review → close'
  branch_convention: 'task/#2908-green-gate-head'
  base_branch: main
  key_constraints:
    - 'Read-time: always re-run GREEN at freeze/complete when TDD evidence exists; stored SHA never read to decide'
    - 'No new CLI action or flag (counter C7); no new src export (1174/1174); complexity <= 10'
  red_team_warnings:
    - '.claude/.task/ is gitignored: status.json is a record, never delivery evidence on its own'
    - 'GREEN re-run goes AFTER the clean-tree check in assertReviewSubjectFrozen'
  estimate: 'M'
premortem: .claude/plans/PREMORTEM_2908.md
files:
  - .claude/plans/task-2908.md
  - .claude/plans/PREMORTEM_2908.md
  - src/commands/task.ts
  - src/commands/task-state.ts
  - __tests__/commands/green-gate-head-2908.test.ts
  - docs/CONTRIBUTING.md
  - .arbiter/evidence/tdd/#2908.json
---
```
No bake snapshot hashes `task.ts`, no example or template changes, and no existing test changes (799/799 unchanged).
### 2.2 Map (1d58be09)
| Site | Today |
|---|---|
| `checkGreenExecutionGate` :2078 → `verifyGreenExecution` (`src/evidence/tdd-reexecute.ts:371`) | re-runs the recorded `test_command`; sole caller is the `refactor` phase gate :1875; no SHA recorded (:1896 writes only `phase`) |
| `assertReviewSubjectFrozen` :1654 (via `runTaskReviewRound` :1779) | plan tracked, contract, clean tree, base, bake, premortem: never GREEN |
| `complete` phase gate :1887 | `checkCompletionEvidence` → `checkPrMergedGate`; never GREEN |
| delivery record | `premortemLogSuffix` :968 (#2890 AC-5) appended to the `complete ← PR #n MERGED` line in `.claude/.task/log.md` |
| `UnifiedTaskState` `task-state.ts:122` | plain interface + `normalize()`, no zod: an optional field is not a schema break |
### 2.3 RED: new file `__tests__/commands/green-gate-head-2908.test.ts`
Copied verbatim from the premortem RED draft (120 lines; `npx eslint` exit 0). It uses a real git repo and the real `verifyGreenExecution`
(`test_command: ['node','review.test.ts']`), then `runTaskAdvance({to:'refactor'})` at X. AC-2: `greenVerifiedSha === X`. Control: freeze at X
is accepted (rounds 1). AC-1/AC-3: the pinned test is broken at Y, freeze Y throws `/GREEN/` (rounds 0), the test is restored at Z, freeze
is accepted, and `greenVerifiedSha === Z`. `complete` is covered GREEN-side only (it needs PR mocks). tsconfig excludes `__tests__`, so the missing field is no Test-Amend.
```
RED   $ npx vitest run __tests__/commands/green-gate-head-2908.test.ts            # exit=1
      Tests 2 failed | 1 passed (3)
      × AC-2 … expected undefined to be '00e2d5a2…'      (greenVerifiedSha never set)
      × AC-1/AC-3 … expected [Function] to throw          (freeze accepted the broken HEAD)
TRIAL $ (same, after 2.4, RED file untouched)                                     # exit=0
      Tests 3 passed (3) · sweep of 25 files (task-advance-gates, ship-review, task-ship, cross-model-review,
      ship-stale-base-2875, coded-refusals-2910, evidence/*, task-state, task-phase-migration, integration/gate): 799/799
```
### 2.4 GREEN pseudo-diff (trial, 56 lines src; publicApiSurface 1174, complexity 226 unchanged)
```ts
// task-state.ts UnifiedTaskState: record only, never read to decide (#2899)
+  greenVerifiedSha?: string
// task.ts
-import { loadTddEvidence, extractFailureSignature } from '../evidence/tdd.js'
+import { loadTddEvidence, extractFailureSignature, tddEvidencePath } from '../evidence/tdd.js'
+function checkGreenExecutionAtHead(dir) {             // read-time: guard = committed evidence, not state
+  const taskId = readTaskIdFromDisk(dir) ?? 'unknown'
+  if (!existsSync(tddEvidencePath(taskId, dir))) return  // no TDD evidence → untouched, as before
+  checkGreenExecutionGate(dir)                          // ALWAYS re-run at the real HEAD
+  recordGreenVerifiedHead(dir)                          // git rev-parse HEAD → writeUnifiedState; FAIL-OPEN-INTENT record only
+}
+function greenExecutionLogSuffix(dir) { const s = readUnifiedState(dir)?.greenVerifiedSha; return s ? ` green=${s.slice(0,7)}` : '' }
 assertReviewSubjectFrozen: … clean-tree check
+  checkGreenExecutionAtHead(dir)
 refactor gate:  checkGreenExecutionGate(dir)
+  recordGreenVerifiedHead(dir)
 complete gate:
+  checkGreenExecutionAtHead(dir)                       // before checkCompletionEvidence / PR check
 appendReviewLog and the `complete ← PR #n MERGED` line: + greenExecutionLogSuffix(dir)   // AC-2 delivery record
```
Docs: add a `docs/CONTRIBUTING.md` bullet after `E_SPEC_TEST_CONFLICT`: GREEN is re-run at freeze and at complete, and the SHA appears as `green=` in the log.
### 2.5 Verification (foreground)
§0 order (skip examples and bake: no template changes; run `check-self-dogfood` anyway), with the targeted step
`npx vitest run __tests__/commands/green-gate-head-2908.test.ts __tests__/commands/task-advance-gates.test.ts
__tests__/commands/ship-review.test.ts __tests__/commands/task-ship.test.ts __tests__/commands/cross-model-review.test.ts
__tests__/commands/ship-stale-base-2875.test.ts __tests__/evidence __tests__/integration/gate`, and `npm run check:i18n`.
Commit: `fix(lifecycle): re-run the GREEN gate at review freeze and complete (#2908)`.
### 2.6 Premortem table
| Failure mode | Likelihood | Prevention |
|---|---|---|
| Skip keyed on stored `greenVerifiedSha` (forgeable, gitignored) | High | guard = committed evidence file; the field is never read for decisions (reviewer greps readers) |
| Unconditional gate breaks fixtures without TDD evidence (first trial: 36 broke) | High | evidence-exists guard; 799/799 sweep |
| GREEN run before the clean-tree check (artifacts dirty the tree) | Med | place it after `dirty` |
| A new flag or command to "record GREEN" (C7 violation) | Med | none added; automatic at freeze/complete |
| `complete` re-runs a slow suite on every retry | Med | accepted cost = one `test_command`; state it in docs |
### 2.7 Reviewer threat model
(1) No decision reads `greenVerifiedSha` (`grep -n greenVerifiedSha src`: the only reads are the log suffix). (2) Deleting the
evidence file to skip GREEN is a tracked change, and the `verification` gates (`checkChainTddEvidenceGate`) still refuse it. (3) `taskId` unknown →
path `…/unknown.json` absent → skip: the same as the pre-#2908 behaviour, since the refactor entry already requires a seeded id. (4) The fail-open
covers only the SHA record (no git), never the GREEN verdict. (5) `close`/`verification` deliberately untouched (AC-1 names freeze and
complete). (6) No CI replay (non-goal). (7) `verifyGreenExecution`'s #2906 worktree replay is used as-is (blob changed → replay).
