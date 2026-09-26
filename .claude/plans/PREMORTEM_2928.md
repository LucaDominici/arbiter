## 1. #2928: the bake-freshness freeze trusts content, not commit order
### 1.1 Plan `.claude/plans/task-2928.md` front matter
```yaml
---
context:
  issue: '#2928'
  type: fix
  pipeline: 'plan → red → green → refactor → review → close'
  branch_convention: 'task/#2928-bake-freshness-content'
  base_branch: main
  key_constraints:
    - 'No src/templates or bake __snapshots__ edits (#2913 regenerates them in parallel)'
    - 'No new export in src/** (publicApiSurface 1174/1174); no CLI verb; complexity <= 10'
  red_team_warnings:
    - 'Do not run the bake inside the freeze: ~27 s, and the #2863 pinned fixture has no package.json'
    - 'A bakeVerifiedSha for an older HEAD must never pass the freeze (exact equality with HEAD)'
  estimate: 'S'
premortem: .claude/plans/PREMORTEM_2928.md
files:
  - .claude/plans/task-2928.md
  - .claude/plans/PREMORTEM_2928.md
  - src/commands/task.ts
  - src/commands/task-state.ts
  - __tests__/integration/e2e/bake/fixture-bake.test.ts
  - __tests__/commands/bake-freshness-content-2928.test.ts
  - docs/REFERENCE/preventive-verification-contract.md
  - .arbiter/evidence/tdd/#2928.json
---
```
### 1.2 Map (d380fa35)
| Site | Role |
|---|---|
| `src/commands/task.ts:1745` `checkBakeAfterTemplates` | owes a bake if a derived gate `artifact-regenerate` = `BAKE_REGENERATE_COMMAND`; refuses if `git rev-list <last snapshot commit>..HEAD -- src/templates` is non-empty (commit order only) |
| `task.ts:1687`, `:1741-1742` | caller `assertReviewSubjectFrozen`; `BAKE_REGENERATE_COMMAND`, `BAKE_SNAPSHOTS` |
| `src/commands/task-state.ts:196` `greenVerifiedSha` | #2908 precedent for a "verified at HEAD" field; the new `bakeVerifiedSha?` sits next to it (a field on an already-exported interface adds no export line) |
| `__tests__/integration/e2e/bake/fixture-bake.test.ts:169-229` | the bake's own content check (renders each lane, compares contentHashes with the snapshot) |
| `__tests__/commands/ship-review.test.ts:458-493` | pinned #2863 AC-4 test (commit order, npm-less fixture). Must stay green unchanged |
| `docs/REFERENCE/preventive-verification-contract.md:81-83` | documents the freeze remedy (docs gate) |
### 1.3 RED: new file `__tests__/commands/bake-freshness-content-2928.test.ts`
Copy the coordinator RED file verbatim (138 lines; `npx eslint` exit 0). The fixture repo has
a derived bake gate. **AC-2 (#2903 shape):** it commits only `src/templates/scripts/evidence-collect.mjs.ejs`
with no snapshot commit, which is refused today. It then records `bakeVerifiedSha = HEAD` and expects
the review round to be recorded (`rounds: 1`). **AC-3:** a template commit with no rebake is refused.
A stale `bakeVerifiedSha` (`f…f`) is still refused. AC-3 passes today by design. Executed in a
detached d380fa35 checkout (build 0):
```
RED   $ npx vitest run __tests__/commands/bake-freshness-content-2928.test.ts   # exit=1, 1 failed | 1 passed (2)
      × AC-2  Error: review freeze: a src/templates commit is newer than the last bake snapshot commit; …
              ❯ checkBakeAfterTemplates src/commands/task.ts:1759
TRIAL $ (same checkout, §1.4 applied) npx vitest run …/bake-freshness-content-2928.test.ts          # exit=0, 2 passed (2)
      $ npx vitest run __tests__/commands/ship-review.test.ts __tests__/scripts/gate-derivation.test.ts  # exit=0, 73 passed
```
`record-red`: `node dist/cli.js lifecycle record-red --task '#2928' --test-path __tests__/commands/bake-freshness-content-2928.test.ts --test-command npx --test-arg vitest --test-arg run --test-arg __tests__/commands/bake-freshness-content-2928.test.ts`
The RED commit passes `npm run typecheck`: vitest does not typecheck and `tsconfig.json` excludes `__tests__`.
### 1.4 GREEN pseudo-diff (trial: 3 files, +68/−4)
```ts
// task-state.ts — UnifiedTaskState
+  /** #2928: HEAD at which the bake suite ran green, not in update mode, on a clean tree. */
+  bakeVerifiedSha?: string
// task.ts checkBakeAfterTemplates
-  const gates = readUnifiedState(dir)?.derivedGates ?? []
+  const state = readUnifiedState(dir); const gates = state?.derivedGates ?? []
   … if (!owesBake) return
+  if (state?.bakeVerifiedSha !== undefined && state.bakeVerifiedSha === git(['rev-parse', 'HEAD'])) return
   … commit-order fallback unchanged; append to the message (keep the existing command text, a pinned regex):
+  "; if the bake produces no snapshot diff, run `npm run test:e2e:bake` at HEAD on a clean tree instead"
// fixture-bake.test.ts — wrap each lane's body in bakeAndAssert(); on throw set anyFixtureFailed
+afterAll(() => {
+  if (UPDATE || anyFixtureFailed) return
+  if (readUnifiedState(repoRoot) === null) return     // coordinator addition: never create task state
+  if (git status --porcelain --untracked-files=no is non-empty) return   // same rule as #2908
+  writeUnifiedState(repoRoot, { bakeVerifiedSha: git rev-parse HEAD })  // FAIL-OPEN-INTENT on git error
+})
```
The two coordinator additions were **not** in the trial. Rerun RED and `ship-review` after adding them. Add a docs sentence at L81-83.
**Real-flow proof, required before review:** on the task branch, run `npm run test:e2e:bake` with a
clean tree. Check that `.claude/.task` state holds `bakeVerifiedSha` = `git rev-parse HEAD`. The RED
test injects the SHA, so this run is the only proof that the recorder actually fires.
### 1.5 Verification (foreground, in order)
§0 order, with this targeted step:
`npx vitest run __tests__/commands/bake-freshness-content-2928.test.ts __tests__/commands/ship-review.test.ts __tests__/scripts/gate-derivation.test.ts`
then run the real-flow proof (§1.4) and the two debt gates (`--only-metric`, expect 1174 and 226).
The docs gate needs the preventive-verification-contract change. Commit:
`fix(ship): trust a bake-verified HEAD over commit order in the review freeze (#2928)`.
### 1.6 Premortem table
| Failure mode | Likelihood | Prevention |
|---|---|---|
| The recorder never fires in the real flow (cwd, clean-tree check, the state root differs from the freeze's `dir`) | High | real-flow proof §1.4; recorder and freeze both read `readUnifiedState(<repo root>)` |
| A full `npm test` in a checkout with no task creates task state and makes hooks see an active task | Med | the recorder writes only when state already exists |
| `BAKE_UPDATE_SNAPSHOTS=1` run records a SHA it never verified | Med | `if (UPDATE) return` |
| A stale SHA lets a later template edit through | Med | exact HEAD equality; AC-3 stale sub-case |
| The refusal still names only the rebake, so #2903-shaped writers loop again | Med | append the "no diff → run the bake at HEAD" remedy; keep the old text |
| The #2863 pinned test changes behaviour | Low | fallback path unchanged; the 73 tests pass in the trial |
| A new export or CLI verb breaks 1174/1174 | Med if added | field on an existing interface only; re-measure |
### 1.7 Reviewer threat model
(1) Only a real green, non-update bake at the exact HEAD on a clean tree can bypass the commit-order
check. Nothing else writes `bakeVerifiedSha`: grep shows one writer, in `fixture-bake.test.ts`.
(2) A lane that fails, or a partial run (`-t` filter or shard) that skips lanes, must not record.
Check whether `anyFixtureFailed` alone covers skipped lanes. If it does not, also require
`ran === fixtures.length`. (3) Stale or foreign SHAs are refused. (4) The AC-3 refusal keeps the
existing remedy text. (5) No template or snapshot is touched, no export is added, complexity stays at 226.
(6) Docs describe both paths.
