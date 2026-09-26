# Premortem 2913b: arbiter #2913, direction "neither requires `context:`" (replaces PREMORTEM.md §2)
Base `d380fa35`. The issue comment of 2026-09-26 rewords AC-3 and rejects "both require": that would add a mandatory writer action (C7 Δ ≤ 0, #2775), and no code consumes the keys. `scripts/check-acceptance.mjs`, `lib.mjs` and their templates stay **untouched**. `red-2913.test.ts.txt` and `diff-2913.txt` are superseded. The `#2928` half of PREMORTEM.md (§1) is unchanged, and the file sets are still disjoint.
## 1. Plan `.claude/plans/task-2913.md` front matter
```yaml
---
context:
  issue: '#2913'
  type: fix
  pipeline: 'plan → red → green → refactor → review → close'
  branch_convention: 'task/#2913-plan-anchor-scope'
  base_branch: main
  key_constraints:
    - 'Reuse isPathInThisRepo (.claude/hooks/lib.mjs:290); no new path logic; lib.mjs and check-acceptance untouched'
    - 'Delete the self-only #689 Context Block section; admission gains no requirement'
  red_team_warnings:
    - 'The guard must run before any plan read and must not disarm in-repo edits (isPathInThisRepo("") is true)'
    - 'Re-pin the hook divergence with an honest reason naming exactly what stays self-only'
  estimate: 'S'
premortem: .claude/plans/PREMORTEM_2913.md
files:
  - .claude/plans/task-2913.md
  - .claude/plans/PREMORTEM_2913.md
  - .claude/hooks/pre-edit-plan-anchor.mjs
  - src/templates/claude/hooks/pre-edit-plan-anchor.mjs.ejs
  - .dogfood-divergences.json
  - docs/REFERENCE/plan-template.md
  - __tests__/hooks/plan-anchor-scope-2913.test.ts
  - __tests__/hooks/plan-anchor-context-block.test.ts
  - examples/go-library/.claude/hooks/pre-edit-plan-anchor.mjs
  - examples/go-library/.arbiter-generated-manifest.json
  - examples/python-library/.claude/hooks/pre-edit-plan-anchor.mjs
  - examples/python-library/.arbiter-generated-manifest.json
  - examples/ts-library/.claude/hooks/pre-edit-plan-anchor.mjs
  - examples/ts-library/.arbiter-generated-manifest.json
  - .arbiter/evidence/tdd/#2913.json
  - __tests__/integration/e2e/bake/__snapshots__/go-backend-web-gcr.json
  - __tests__/integration/e2e/bake/__snapshots__/go-bdd.json
  - __tests__/integration/e2e/bake/__snapshots__/go-library.json
  - __tests__/integration/e2e/bake/__snapshots__/java-backend-web-db-acr.json
  - __tests__/integration/e2e/bake/__snapshots__/java-backend-web-db-gradle.json
  - __tests__/integration/e2e/bake/__snapshots__/java-bdd-gradle.json
  - __tests__/integration/e2e/bake/__snapshots__/java-library-gradle.json
  - __tests__/integration/e2e/bake/__snapshots__/java-spring-L3.json
  - __tests__/integration/e2e/bake/__snapshots__/java-spring-L4.json
  - __tests__/integration/e2e/bake/__snapshots__/multi-lane-fe-be.json
  - __tests__/integration/e2e/bake/__snapshots__/python-backend-web-ecs.json
  - __tests__/integration/e2e/bake/__snapshots__/python-backend-web.json
  - __tests__/integration/e2e/bake/__snapshots__/python-bdd.json
  - __tests__/integration/e2e/bake/__snapshots__/python-data-pipeline.json
  - __tests__/integration/e2e/bake/__snapshots__/python-library.json
  - __tests__/integration/e2e/bake/__snapshots__/rust-bdd.json
  - __tests__/integration/e2e/bake/__snapshots__/rust-cli.json
  - __tests__/integration/e2e/bake/__snapshots__/rust-embedded.json
  - __tests__/integration/e2e/bake/__snapshots__/rust-library.json
  - __tests__/integration/e2e/bake/__snapshots__/ts-backend-web-db-ghcr.json
  - __tests__/integration/e2e/bake/__snapshots__/ts-backend-web-db-none.json
  - __tests__/integration/e2e/bake/__snapshots__/ts-backend-web-db.json
  - __tests__/integration/e2e/bake/__snapshots__/ts-bdd.json
  - __tests__/integration/e2e/bake/__snapshots__/ts-frontend-spa.json
  - __tests__/integration/e2e/bake/__snapshots__/ts-library.json
  - __tests__/integration/e2e/bake/__snapshots__/vue-frontend-spa.json
---
```
Snapshots: **26 of 27** move. `ts-codex-only` does not ship the Claude hook, so it does not move. Examples: the hook plus the manifest in each of the 3 examples.
## 2. RED: `__tests__/hooks/plan-anchor-scope-2913.test.ts`
Copy `step1-d/red-2913b.test.ts.txt` verbatim (93 lines; `npx eslint` exit 0). It spawns the real hook in a synthetic `red`-phase task repo on branch `task/#2913-…`.
AC-1 control: an in-repo edit (`package.json`) with no plan pointer exits 2. AC-1: the same no-pointer state with an absolute target in a non-git `/tmp` dir must exit 0 with empty stderr. AC-2: real `check-acceptance.mjs --plan plan.md` exits 0 on a plan with no `context:`; the hook must not refuse an in-repo edit under it with a Context Block message. AC-3 (pin, passes on base): the no-pointer refusal contains `node dist/cli.js lifecycle start --plan <path>`.
```
RED   (d380fa35, build 0) $ npx vitest run __tests__/hooks/plan-anchor-scope-2913.test.ts   # exit=1, 2 failed | 2 passed (4)
  × AC-1 outside repo  AssertionError: expected '[arbiter] PLAN ANCHOR: red phase requ…' to be ''
  × AC-2 admitted plan AssertionError: expected '[arbiter] PLAN ANCHOR: plan is missin…' not to match /Context Block|"context:"/
ISOLATION  guard only → 1 failed (AC-2) | 3 passed;  #689 deletion only → 1 failed (AC-1) | 3 passed
TRIAL GREEN (both, same checkout) → exit=0, 4 passed (4)
EXISTING  $ npx vitest run __tests__/hooks/{plan-anchor-context-block,plan-anchor-out-of-scope}.test.ts \
            __tests__/hooks/empirical/{plan-anchor,ssot-guard}.test.ts   # exit=1, 4 failed | 48 passed (52)
  × (all in plan-anchor-context-block.test.ts) plan missing Context Block entirely exits 2 · plan with context: but missing
    required fields exits 2 · error message lists missing fields · context block with no issue or issues field exits 2
```
`record-red`: `node dist/cli.js lifecycle record-red --task '#2913' --test-path __tests__/hooks/plan-anchor-scope-2913.test.ts --test-command npx --test-arg vitest --test-arg run --test-arg __tests__/hooks/plan-anchor-scope-2913.test.ts`
**Existing tests.** `plan-anchor-context-block.test.ts` is **deleted**: its one `describe` is "Context Block validation (#689)". 4 of its 9 cases assert the removed refusal. The other 5 are vacuous: 4 assert that a valid or legacy plan is accepted, which is now always true, and the 5th is the bypass case, already covered by `empirical/plan-anchor.test.ts:129`. `plan-anchor-out-of-scope.test.ts` stays **unchanged**: its fixture carries a Context Block, but no case asserts the refusal. `empirical/plan-anchor.test.ts` stays **unchanged**: it has no Context Block assertion.
## 3. GREEN pseudo-diff (trial: 2 source files, +8/−65, then regenerated artefacts)
```js
// .claude/hooks/pre-edit-plan-anchor.mjs AND src/templates/claude/hooks/pre-edit-plan-anchor.mjs.ejs (with `;`)
-import { readTaskState, getRepoRoot, resolveToolInputPath } from './lib.mjs'
+import { readTaskState, getRepoRoot, resolveToolInputPath, isPathInThisRepo } from './lib.mjs'
 const targetRaw = resolveToolInputPath()
+// #2913: the plan anchor guards only this repository; an edit outside it (e.g. /tmp) is not its business.
+if (!isPathInThisRepo(targetRaw)) process.exit(0)
 const root = getRepoRoot()                                   // plan read happens only below
// self hook only:
-// ─── Context Block validation (#689) ─── … (≈60 lines, through the REQUIRED_FIELDS refusal)
// docs/REFERENCE/plan-template.md L16-17, L90: "optional recovery anchor; not validated by any hook
//   or by admission"; drop "rejected at edit time"; the legacy marker is no longer needed
// .dogfood-divergences.json "hooks/pre-edit-plan-anchor.mjs": re-pin (diffHash e2b8f852… → 235082da…) and use this reason:
//   "Self-only: remedy commands say `node dist/cli.js lifecycle start` (template: `arbiter lifecycle start`);
//    explain id CANON-16 (template: CANON-14); try/catch fail-closed refusal on an unreadable plan file;
//    CANON-16 gate uses `!!targetRaw` + inline comments (template: `if (targetRaw)`), same logic; comments."
```
The trial re-diffed the files after Prettier normalisation. Exactly the items above remain self-only, and the Context Block section is gone. The old reason ("cosmetic, quotes only") was false both before and after the change.
## 4. Verification (foreground, in order; all measured on the trial unless marked)
1. `npm run build` (0). 2. `npx vitest run __tests__/hooks/plan-anchor-scope-2913.test.ts __tests__/hooks/plan-anchor-out-of-scope.test.ts __tests__/hooks/empirical/plan-anchor.test.ts __tests__/hooks/empirical/ssot-guard.test.ts` (trial, after deleting the context-block file: exit 0, 47 passed)
3. `node scripts/check-self-dogfood.mjs --update-divergences`, then `node scripts/check-self-dogfood.mjs` (0 after the re-pin; before the re-pin it failed with "divergence CHANGED")
4. `node scripts/check-hook-contracts.mjs` (OK, 34 hooks). 5. `node scripts/debt-report.mjs --gate complexityViolations --only-metric complexityViolations`: **226/226**. Same command for `publicApiSurface`: **1174/1174**. Neither moves.
6. `npm run examples:regenerate && npm run examples:check` (0; 6 example files move). 7. `BAKE_UPDATE_SNAPSHOTS=1 npm run test:e2e:bake`, then `npm run test:e2e:bake` (32/32 both; 26 snapshots move). 8. The §0 full gate at HEAD is left to the writer; it was not run here.
Commit: `fix(hooks): scope the plan anchor to the repo and drop the self-only context check (#2913)`. The docs gate fires (plan-template.md is in the diff).
**Ratchets and deleted tests.** Nothing counts tests or refuses a deleted test file. `debt-report`/`debt-lib` ratchet complexity, API surface, duplication and coverage, not test count. `check-coverage-ratchet` covers `src/` totals, not `.claude/hooks`. `check-bloat-ratchet` covers `src/` files and LOC. vitest collects tests by the glob `__tests__/**/*.test.ts`, with no manifest. `.arbiter/hooks-manifest.json` and `self-hooks-manifest.json` do not name #689 or the deleted file, and the hook stays HARD (the no-pointer and CANON-16 refusals remain). Grep finds no reference to `plan-anchor-context-block` outside the file itself.
## 5. Premortem table
| Failure mode | Likelihood | Prevention |
|---|---|---|
| The guard disarms in-repo edits (relative path, worktree, symlink) | Med | `isPathInThisRepo` resolves paths, short-circuits on HOOK_OWNER_ROOT, compares the git common dir, and fails closed to "in repo". AC-1 control case |
| The guard is placed after the plan read or the phase check, so /tmp edits are still refused | Med | place it right after `resolveToolInputPath()`; the isolation run proves AC-1 fails without it |
| The divergence is re-pinned with the old "cosmetic" reason | High | §3 reason text; the reviewer checks it against the normalised diff |
| Writer "fixes" the context-block test instead of deleting it, keeping dead assertions | Med | §2: delete; the bypass case is already covered in empirical |
| Admission or `lib.mjs` touched "for parity" | Low | the files list excludes them; `git diff --stat` must show neither |
| Snapshots or examples stale after a late template edit | Med | regenerate examples, then the bake; snapshots committed last |
| A template-side behaviour change was missed (CANON-14 vs CANON-16 explain id) | Low | pre-existing; mention it in the PR, do not fix it here (out of scope) |
| Legacy-marker guidance in the docs becomes dead text | Low | plan-template.md rewords the legacy section |
## 6. Reviewer threat model
(1) Nothing leaves this repo's control: the guard only returns exit 0 for targets whose git common dir differs from the hook's own. An empty or unresolvable path counts as in-repo. (2) No new refusal and no new writer action: the shipped hook only gains the guard, and admission is byte-identical. (3) The remaining refusals (no plan pointer, branch unresolvable, unreadable plan, CANON-16) are unchanged, and AC-3 pins the no-pointer remedy text. (4) The deleted test covered only the deleted code, and bypass coverage survives in empirical. (5) The dogfood reason matches the normalised diff line by line. (6) The gates do not move (226, 1174). 26 snapshots, 3 example hooks and 3 manifests are regenerated, not hand-edited.
Execution: detached scratch checkout at d380fa35, `node_modules` symlinked, then removed. No commit, push or comment was made.
