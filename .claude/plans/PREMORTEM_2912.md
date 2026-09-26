# Premortem — arbiter #2911 then #2912 (step 1, B3 part b)

Base `8693d087` (origin/main, with #2898/#2899/#2904/#2905/#2906/#2917). #2910 (PR #2920, head
`0836553f`) is landing and touches `src/commands/task.ts` and `.arbiter/agents-dispatched.json`, so
**#2911 branches from main after #2910 merges; #2912 branches from #2911's merge.** Both edit
`scripts/record-agent-return.mjs` and its twin, so they must not overlap. Lines are 8693d087; anchor
by function name. Ship: `required` R1 (hooks/templates) for both; commit §N.1 of this file (redacted,
no workspace paths) as `.claude/plans/PREMORTEM_<id>.md` in the plan commit, as #2898/#2899 did.
## 0. Shared twin rules (both issues; #2898/#2905 precedent)
- Every script edit is made **identically** in `scripts/X.mjs` and `src/templates/scripts/X.mjs.ejs` (byte-identical
  today except check-agent-return/check-cross-model-review: Prettier wrapping only). `.claude/hooks/*.mjs`
  twins are real EJS: edit the template, then render; never hand-diverge.
- Gate facts (measured): publicApiSurface 1174/1174 counts `export` lines in `src/**` only; complexityViolations
  226 = `eslint src scripts --rule complexity:10` (**scripts count**, `.ejs` do not); coverage excludes `scripts/**`;
  jscpd ignores `src/templates/**` but scans `scripts/` (5%); check:i18n walks `src` only; the docs gate fires on
  `src/`/`__tests__/` diffs without a `docs/` change; commitlint header and body lines ≤ 100.
- Bake snapshots store `contentHashes` by path; all 27 lanes hash `scripts/{record-agent-return,check-acceptance,
  check-review-completion,check-cross-model-review}.mjs` and `scripts/lib/evidence-binding.mjs`, so **all 27 change**
  in both PRs. List them one per line in `files:` (#2905 precedent, no glob):
  `ls __tests__/integration/e2e/bake/__snapshots__/*.json | sed 's/^/  - /'`.
- Verification order (foreground): RED file → `npm run build` → targeted vitest → `npm run typecheck
  && npm run lint` → the two debt gates → `npm run examples:regenerate && npm run examples:check` →
  `node scripts/check-self-dogfood.mjs` → `BAKE_UPDATE_SNAPSHOTS=1 npm run test:e2e:bake` then
  `npm run test:e2e:bake` → update `files:` with every regenerated path → commit snapshots **last** →
  `npx commitlint --from origin/main --to HEAD` → `node scripts/check-all.mjs L1` → `L2` once.
- `record-red` (after the RED commit, `npm run build` first): `node dist/cli.js lifecycle record-red --task '#<id>' --test-path <file> --test-command npx
  --test-arg vitest --test-arg run --test-arg <file>`
## 2. #2912: per-task review sidecar (start from #2911's merge; re-run RED there)
### 2.1 Plan `.claude/plans/task-2912.md`
Same `context:` shape with `issue: '#2912'`, `type: fix`, branch `task/#2912-sidecar-per-task`,
`premortem: .claude/plans/PREMORTEM_2912.md`; constraints: `'no new src export (1174/1174)'`,
`'legacy .arbiter/agents-dispatched.json read only on exact taskId match; never written again'`;
red_team_warnings: `'.gitignore ignores .arbiter/** — add the negation or per-task files are untrackable'`, `'check-all runs check-review-completion with no --task (CI: branch is the only identity)'`.
`files:` (all exist at 8693d087 unless marked new; write each path as its own YAML item):
- plans `.claude/plans/{task-2912,PREMORTEM_2912}.md`; src `src/commands/{task-state,cross-model-review,task}.ts`,
  `src/invariants/catalog.ts` + generated `GLOBAL_INVARIANTS.md`
- pairs (runtime + `src/templates/scripts/…ejs`): `scripts/{record-agent-return,check-review-completion,
  check-agent-return,check-cross-model-review}.mjs`, `scripts/lib/evidence-binding.mjs`; hooks `.claude/hooks/
  {stop-evidence-guard,guard-task-completion}.mjs`, `.claude/commands/ship.md` (templates under `src/templates/
  claude/`); `.gitignore` + `src/templates/root/.gitignore.ejs`; `.dogfood-divergences.json` only if a pin moves
- examples ×3 (go/python/ts-library): `scripts/{record-agent-return,check-review-completion,check-cross-model-review}
  .mjs`, `scripts/lib/evidence-binding.mjs`, `.claude/commands/ship.md`, `.gitignore`, `.arbiter-generated-manifest.json`
- tests: the RED file (new) + those of these that fail: `__tests__/scripts/{check-agent-return,check-cross-model-review,
  check-review-completion,record-agent-return-modes}`, `commands/{cross-model-review,ship-review,task-ship}`,
  `hooks/empirical/{completion-guard,stop-evidence-guard,stop-evidence-journey}`, `generators/gitignore`,
  `templates/{commands-claude,hooks-advanced-render,gitignore-render}`, `evidence/gate-evidence-consumers`,
  `integration/worktree-adopt` (`.test.ts`); docs `docs/design/cross-model-review-slot.md` (docs gate)
- `.arbiter/evidence/tdd/#2912.json`, `.arbiter/agents-dispatched/_2912.json` (new), 27 bake snapshots (§0)
### 2.2 Map (8693d087) — no shared path helper; every site hard-codes the single file
| Site | Role |
|---|---|
| `task-state.ts:68-77` `invalidateTaskReceipts(root, taskId)` | **deletes** the shared file unconditionally; reached from `lifecycle start` (`task.ts:524` `reanchorPlanGates`), `runTaskHostPreflight` (`task.ts:330`) and `worktree.ts:624` |
| `cross-model-review.ts:122/329/338` `readSidecar`, `writeExternalReviewSidecar` | read (ENOENT → null) / write |
| `task.ts:1523` `latestReviewerEnvelopeFor` | lstat, ENOENT → undefined |
| `record-agent-return.mjs` `writeReviewerPanel` (~:590), `check-cross-model-review.mjs:482` (`--record-panel`) | writers |
| `check-review-completion.mjs:54-56` (`--sidecar=` override), `:800-822` branch check (#2399), `:824` `resolveTaskContext` | reader; CI runs it from `check-all.mjs:425` **without `--task`** |
| `check-agent-return.mjs:43`, `.claude/hooks/stop-evidence-guard.mjs:138` | readers via `evidence-binding.mjs` `isForeignSidecar` |
| `.claude/hooks/guard-task-completion.mjs:44-52` | reader with its own inline taskId check (not the shared helper) |
`.gitignore:28` ignores `.arbiter/**`; the legacy file is tracked only because it was force-added
(`git check-ignore -v .arbiter/agents-dispatched/_2912.json` matches :28). No `.gitattributes` driver.
Sanitizer: `src/utils/task-id.ts` `sanitizeTaskId` and `scripts/lib/gate-evidence.mjs:459` both give `#2912 → _2912` (as `agent-returns/_<id>`).
### 2.3 RED: new file `__tests__/commands/review-sidecar-per-task-2912.test.ts`
Copy `step1-b3b/red-2912.test.ts.txt` (210 lines; `npx eslint` on it exit=0); before the RED commit retitle (c) to
"reader for task B resolves its per-task sidecar; a legacy file of task A stays foreign" (its body does
not test the legacy-match read). (a) reviewer-panel write lands at `agents-dispatched/_2912.json`;
(b) `invalidateTaskReceipts(root,'#2913')` leaves task #2911's committed legacy file byte-identical and
`git status --porcelain` empty; (c) foreign legacy → exit 1 (baseline), own per-task file → exit 0.
```
$ npx vitest run __tests__/commands/review-sidecar-per-task-2912.test.ts   # exit=1, 3 failed (3)
× (a) expected false to be true            (existsSync(agents-dispatched/_2912.json))
× (b) expected false to be true            (task A's legacy sidecar was deleted)
× (c) [check-review-completion] FAIL: dispatch sidecar is required for task #2914 (… belongs to task #2915 …)  expected 1 to be +0
```
GREEN-side additions: (d) legacy file with taskId B is read for B, and a legacy file **without** taskId
is not; (e) no `--task`, no status.json, branch `task/#2914-x` → finds `_2914.json` by branch;
(f) two per-task files on the same branch → exit 2; (g) `lifecycle start` for B deletes only `_B.json`.
### 2.4 GREEN pseudo-diff
```js
// scripts/lib/evidence-binding.mjs (+ .ejs) — the one .mjs resolver (not in src/: no API cost)
+export function dispatchSidecarPath(root, taskId) { return join(root, '.arbiter', 'agents-dispatched', `${sanitizeTaskId(taskId)}.json`) }
+export const LEGACY_DISPATCH_SIDECAR = ['.arbiter', 'agents-dispatched.json']
+// task known: per-task file; else legacy only if legacy.taskId === task (strict, absent taskId ≠ match)
+// task unknown (CI): per-task files whose branch === HEAD; 1 → it, 0 → legacy (existing checks), >1 → error
+export function locateDispatchSidecar(root, { task, branch }) { … }
// check-review-completion / check-agent-return / stop-evidence-guard / guard-task-completion: use it
//   (`--sidecar=` override unchanged; guard-task-completion adopts the shared helper, same verdicts)
// record-agent-return writeReviewerPanel, check-cross-model-review --record-panel:
-  writeAtomicContained(REPO_ROOT, ['.arbiter'], 'agents-dispatched.json', …)
+  writeAtomicContained(REPO_ROOT, ['.arbiter', 'agents-dispatched'], `${sanitizeTaskId(TASK_ID)}.json`, …)
// src (no new export): inline join(root,'.arbiter','agents-dispatched',`${sanitizeTaskId(id)}.json`)
// task-state.ts invalidateTaskReceipts:
-  rm(join(root, '.arbiter', 'agents-dispatched.json'))
+  rm(perTaskPath(root, taskId))                       // own file only
+  if (legacyTaskId(root) === taskId) rm(legacyPath)     // never another task's
// cross-model-review.ts read/write + task.ts:1523 → per-task path, legacy read on exact match
// .gitignore (+ template): !.arbiter/agents-dispatched/ and !.arbiter/agents-dispatched/*.json
```
Keep the tracked legacy file (nothing writes it after this PR, so it cannot conflict; deletion is a follow-up).
The pre-GREEN `lifecycle start` on this branch deletes it (the bug itself): before any commit run
`git checkout origin/main -- .arbiter/agents-dispatched.json`. Filenames only via `sanitizeTaskId` (no `/`, `..`).
### 2.5 Verification (foreground, in order)
§0 order, with the targeted step:
`npx vitest run __tests__/commands/review-sidecar-per-task-2912.test.ts $(grep -rln 'agents-dispatched' __tests__ | tr '\n' ' ')`
plus `npx vitest run __tests__/generators __tests__/scripts __tests__/hooks`; `node scripts/check-review-completion.mjs`
on the task branch (no `--task`) must find `_2912.json`; `git check-ignore .arbiter/agents-dispatched/_2912.json`
must exit 1. Commit: `fix(review): key the review-dispatch sidecar per task (#2912)`.
### 2.6 Premortem table
| Failure mode | Likelihood | Prevention |
|---|---|---|
| Per-task files ignored by `.arbiter/**` → never committed, CI reads nothing (silent fail-open) | High | gitignore negation in repo + template; `git check-ignore` exit 1 |
| No `--task` (local L2 on a task branch) finds no sidecar → vacuous pass | High | branch-scan resolver; test (e) (detached CI HEAD already reads absent at :814) |
| A reader left on the legacy path (6 readers, 2 writers, 3 runtimes) | High | `grep -rn "agents-dispatched.json" src scripts .claude src/templates` hits only the legacy constant |
| Legacy fallback fail-open (absent taskId treated as a match, like `isForeignSidecar`) | Med | strict equality; test (d) |
| New `src` export breaks 1174/1174 | Med | inline `join` + existing `sanitizeTaskId`; run the gate |
| Hook `.ejs` twins hand-edited, dogfood drift | Med | edit templates, render, `check-self-dogfood` |
| Bake/examples/manifests incomplete (hashes of 5 scripts in 27 lanes) | High | §0 regen order; snapshots last |
### 2.7 Reviewer threat model
(1) No task can delete or rewrite another task's sidecar (by construction: own path; legacy only on
exact match). (2) The legacy file is read only on strict taskId equality, never on absence. (3) In CI the
gate still fails closed when a dispatch exists for the branch; ambiguity is exit 2, not a pass.
(4) Per-task files are tracked on a fresh clone (gitignore negation in repo and template). (5) The
filename cannot escape `.arbiter/agents-dispatched/`. (6) Merging main into a task branch touches no
other task's sidecar (two branches → two files). (7) No new `src` export; twins, examples, snapshots regenerated.
