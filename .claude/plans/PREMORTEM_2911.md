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
## 1. #2911: coded signal and remedy for three script refusals
### 1.1 Plan `.claude/plans/task-2911.md`, front matter (write the plan first; the plan-anchor hook refuses edits until it exists)
```yaml
---
context:
  issue: '#2911'
  type: feat
  pipeline: 'plan → red → green → refactor → review → close'
  branch_convention: 'task/#2911-coded-script-refusals'
  base_branch: main
  key_constraints:
    - 'Reuse each script''s fail()/FAIL:/exit 1-2 conventions; no new CLI option, no error catalog'
    - 'Twins identical (scripts ↔ src/templates/scripts); complexity <= 10 per function (scripts count)'
  red_team_warnings:
    - 'Keep the prefix "derived gates are missing or stale": 4 pins in ship-stale-base-2875/task-advance-gates'
    - 'agent-returns dir uses record-agent-return''s sanitizer (#42 → _42), not check-acceptance''s (42)'
  estimate: 'M'
premortem: .claude/plans/PREMORTEM_2911.md
files:
  - .claude/plans/task-2911.md
  - .claude/plans/PREMORTEM_2911.md
  - scripts/record-agent-return.mjs
  - src/templates/scripts/record-agent-return.mjs.ejs
  - scripts/check-acceptance.mjs
  - src/templates/scripts/check-acceptance.mjs.ejs
  - __tests__/scripts/coded-script-refusals-2911.test.ts
  - examples/go-library/scripts/record-agent-return.mjs
  - examples/go-library/scripts/check-acceptance.mjs
  - examples/go-library/.arbiter-generated-manifest.json
  - examples/python-library/scripts/record-agent-return.mjs
  - examples/python-library/scripts/check-acceptance.mjs
  - examples/python-library/.arbiter-generated-manifest.json
  - examples/ts-library/scripts/record-agent-return.mjs
  - examples/ts-library/scripts/check-acceptance.mjs
  - examples/ts-library/.arbiter-generated-manifest.json
  - .arbiter/evidence/tdd/#2911.json
  # + the 27 __tests__/integration/e2e/bake/__snapshots__/<lane>.json, one line each (§0)
---
```
No `src/` change → docs gate does not fire and publicApiSurface cannot move.
### 1.2 Map (8693d087)
| AC | Site | Today |
|---|---|---|
| 1 | `record-agent-return.mjs` `assertModeIdentity` :309-326 → `modeContext` :334 | taskId/branch/sha/state.branch compared as one JSON array → `null`; `nativeHostBindingError` (`.claude/hooks/lib.mjs:656`) already returns a precise string (e.g. `native host binding id is missing`, `native host session does not match binding`, `transcript_path is not the current session transcript…`) and it is **discarded**. `reportModeContextError` :342: `{error}` → stdout `FAIL:` exit 1 |
| 2 | `check-acceptance.mjs` `checkExplicitFitArg` :273-289 | `fail('--ac-fit artifact not found: …')`, exit 2. The NOT-TESTED ids live in the reviewer's return envelope `.arbiter/evidence/agent-returns/_<id>/<agent>-<n>.json` (`acceptanceFit.criteria[].verdict`), written by `recordAcceptanceFit` :462-473 with `NOTE: non-PASS … no ac-fit written` |
| 3 | `check-acceptance.mjs` `checkPlanDerivedGates` :240-269 | `validateDerivedGates` (`scripts/lib/gate-derivation.mjs:98`) returns only `ok`. Inputs: `state.derivedGates` (absent → missing), `state.derivedGatesPlan` (sha256 of the plan at anchor), the manifest, and `contract.authority` (stored inside each derived entry) |
No error-catalog/`arbiter explain` linkage exists in `scripts/`; keep it that way (decision).
### 1.3 RED: new file `__tests__/scripts/coded-script-refusals-2911.test.ts`
Copy `step1-b3b/red-2911.test.ts.txt` verbatim (237 lines; `npx eslint` on it exit=0). Harnesses mirror
`record-agent-return-modes.test.ts` and `check-acceptance.test.ts` (spawn the real script on a temp
git fixture). AC-1: bindingId missing → `/binding id is missing/` + `/lifecycle preflight/`. AC-2: real
NOT-TESTED verifier return recorded, then `--ac-fit` → `/AC-1/`, `/exact-main/`, `/independent
verifier/`. AC-3: `scripts/check-all.mjs` changed after anchoring → `/check-all\.mjs/`, `/verification
authority/`. Executed in a detached checkout of 8693d087 (node_modules symlinked, `npm run build` 0):
```
$ npx vitest run __tests__/scripts/coded-script-refusals-2911.test.ts   # exit=1, 3 failed (3)
× AC-1  expected '[record-agent-return] FAIL: task, bra…' to match /binding id is missing/i
× AC-2  expected 'FAIL check-acceptance: --ac-fit artif…' to match /AC-1/
× AC-3  expected 'FAIL check-acceptance: derived gates …' to match /check-all\.mjs/i
```
Re-run it at the post-#2910 base before the RED commit. GREEN-side additions (not in the RED file):
AC-1 `sha` drift names `sha` without the preflight remedy; AC-3 plan-bytes drift names `plan`.
### 1.4 GREEN pseudo-diff (both twins, identical)
```js
// record-agent-return.mjs — assertModeIdentity returns the cause, not null
-  if (JSON.stringify(actual) !== JSON.stringify(expected)) return null
+  if (parsed?.taskId !== TASK_ID) return { stale: `task (${parsed?.taskId} ≠ ${TASK_ID})` }
+  if (parsed?.branch !== stamped.branch || state.branch !== stamped.branch) return { stale: 'branch' }
+  if (parsed?.sha !== stamped.sha) return { stale: `sha (${parsed?.sha} ≠ ${stamped.sha})` }
   …
-  if (bindingError) return null
+  if (bindingError) return { stale: bindingError, binding: true }
// modeContext: name only the one cause (the four-cause sentence is the defect; no test pins it)
+  error: `stale ${r.stale}` +
+    (r.binding ? ` — run arbiter lifecycle preflight --id '${TASK_ID}' --worktree "${REPO_ROOT}"` : '')
// check-acceptance.mjs — checkExplicitFitArg, missing artifact only
+  const pending = notTestedCriteria(root, taskId)   // latest envelope in agent-returns/_<id>/ with acceptanceFit
+  if (pending.length > 0) fail(`--ac-fit artifact not found: ${fitArg}; the reviewer returned NOT-TESTED for ` +
+    `${pending.join(', ')}. Remedy: mark a CI-only criterion [exact-main] in the plan, or record an ` +
+    `independent verifier envelope (record-agent-return --mode ac-fit)`)
// checkPlanDerivedGates — name the input
+  const cause = !Array.isArray(stored) ? 'never anchored'
+    : planDrift(state) ? 'plan bytes changed'  // sha256 of raw file at plan.split('#')[0], as task.ts planContentHash; key absent → skip
+    : authorityDrift(stored, contract) ?? 'manifest-derived gate set changed'   // `verification authority scripts/check-all.mjs changed`
   fail(`derived gates are missing or stale (${cause}); re-anchor the plan with …`)
```
Split helpers so no function crosses complexity 10 (`notTestedCriteria`, `authorityDrift`,
`staleCause`); sort and dedupe ids. The directory sanitizer must equal record-agent-return's
`replace(/[^0-9A-Za-z-]/g, '_')`; the transcript-path cause from #4611 surfaces through `bindingError` unchanged.
### 1.5 Verification (foreground, in order)
§0 order, with the targeted step:
`npx vitest run __tests__/scripts/coded-script-refusals-2911.test.ts __tests__/scripts/record-agent-return-modes.test.ts __tests__/scripts/check-acceptance.test.ts __tests__/commands/ship-stale-base-2875.test.ts __tests__/commands/task-advance-gates.test.ts`
then `diff scripts/record-agent-return.mjs src/templates/scripts/record-agent-return.mjs.ejs` and the
same for check-acceptance (both empty). Commit: `feat(scripts): name the failed check and remedy in three script refusals (#2911)`.
### 1.6 Premortem table
| Failure mode | Likelihood | Prevention |
|---|---|---|
| Only the runtime or only the template edited | High | `diff` both pairs empty; examples:check; bake |
| Rewording breaks the 4 `/derived gates are missing or stale/` pins | High | keep the prefix, append the cause |
| AC-2 lookup misses the envelope (wrong sanitizer `42` vs `_42`) | High | reuse the recorder's rule; the RED file records a real NOT-TESTED return |
| Wrong cause when several drift at once | Med | fixed order task → branch → sha → binding; test one cause per fixture |
| New branching lifts a script function over complexity 10 (226 ratchet) | Med | small helpers; run the complexity gate before bake |
| Preflight remedy shown for task/sha drift (it cannot fix those) | Med | remedy only when `binding: true` |
| Snapshots/manifest out of date after a late template edit | Med | regenerate after the last edit; snapshots committed last |
### 1.7 Reviewer threat model
(1) Each of the four checks is reachable and named separately; the binding text is the hook library's
own string, not a paraphrase. (2) Preflight remedy appears only for binding causes. (3) NOT-TESTED ids
come from the task's own latest envelope (no foreign task, no stale round); a missing file with no
envelope keeps today's message and exit 2. (4) Exit codes unchanged (1 refusal / 2 artifact missing).
(5) The derived-gates cause comes from stored inputs, never guessed. (6) Twins, examples, 27 snapshots regenerated.
