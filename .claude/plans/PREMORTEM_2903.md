# Premortem — #2903 (step 1, C; §0 shared rules + §3)
Base `1d58be09`. Lines are 1d58be09; anchor by function name. Branched from the #2900 merge (`cef50e6b`).

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
## 3. #2903: TS evidence collector cannot produce coverage-summary.json (after #2900 merges)
### 3.1 Plan `.claude/plans/task-2903.md` front matter
```yaml
---
context:
  issue: '#2903'
  type: fix
  pipeline: 'plan → red → green → refactor → review → close'
  branch_convention: 'task/#2903-ts-coverage-summary'
  base_branch: main
  key_constraints:
    - 'Branch from #2900 merge; re-run RED there; regenerate bake after the rebase'
    - 'One argv, precedent debt-lib.mjs.ejs:618 / check-all.mjs.ejs:823 (json-summary, no --reporter)'
  red_team_warnings:
    - 'Dropping --reporter=silent alone still writes only coverage-final.json: change the reporter VALUE'
    - 'AC-2 test must use real vitest: never shim npx or PATH in the RED file'
  estimate: 'S'
premortem: .claude/plans/PREMORTEM_2903.md
files:
  - .claude/plans/task-2903.md
  - .claude/plans/PREMORTEM_2903.md
  - src/templates/scripts/evidence-collect.mjs.ejs
  - __tests__/scripts/evidence-collect-coverage-2903.test.ts
  - docs/REFERENCE/evidence-summary-schema.md
  - .arbiter/evidence/tdd/#2903.json
  # next 2 only if bake regenerates them (expected unchanged: TS-only EJS branch)
  - __tests__/integration/e2e/bake/__snapshots__/java-spring-L3.json
  - __tests__/integration/e2e/bake/__snapshots__/java-spring-L4.json
---
```
There is no runtime twin (`scripts/evidence-collect.mjs` is absent: dogfood does not run it), and no example renders it (all L1; the collector emits at L3+).
### 3.2 Map (1d58be09)
| Site | Today |
|---|---|
| `evidence-collect.mjs.ejs:108` `collectCoverage`, inside `<% if (language === 'typescript') %>` | `spawnSync('npx', ['vitest','run','--coverage','--coverage.reporter=json','--reporter=silent'])` |
| :113 `freshJson('coverage/coverage-summary.json','coverage')` | reads `total.lines.pct` and `total.branches.pct` → `coverageOk = line >= COVERAGE_THRESHOLD/100` |
| existing tests (11 files, 462 tests: render, check-all A03-008, gate-spine, nightly/monthly…) | all shim npx, and none pins the broken argv, so none changes |
### 3.3 RED: new file `__tests__/scripts/evidence-collect-coverage-2903.test.ts`
Copy `step1-c/red-2903.test.ts.txt` verbatim (91 lines; `npx eslint` exit 0). It renders the TS L3 collector, which it places in a temp
project with its own `package.json` and `vitest.config.ts` (so no bleed from the repo config) and `node_modules` symlinked. It runs the
**real** collector and real vitest, then asserts that `coverage/coverage-summary.json` exists, that no `coverage:` entry is in `failed_dimensions`, and that
`coverage` equals `{line:100, branch:100}` (60 s timeout; measured 1.1–1.4 s).
```
RED   $ npx vitest run __tests__/scripts/evidence-collect-coverage-2903.test.ts   # exit=1
      AssertionError: coverage-summary.json missing; collector stderr: … GATE FAIL …: expected false to be true
      Tests 1 failed (1)
TRIAL $ npm run build && (same, after 3.4)                                         # exit=0
      Tests 1 passed (1) · 11 related files: 462/462 passed
```
### 3.4 GREEN pseudo-diff
```diff
-  const r = spawnSync('npx', ['vitest', 'run', '--coverage', '--coverage.reporter=json', '--reporter=silent'], {
+  const r = spawnSync('npx', ['vitest', 'run', '--coverage', '--coverage.reporter=json-summary'], {
```
Stdout is already captured (`encoding:'utf-8'`), so a "silent" reporter was never needed. Docs: note the collector's coverage
invocation and its `coverage-summary.json` input in `docs/REFERENCE/evidence-summary-schema.md`.
### 3.5 Verification (foreground)
First, `git fetch && git rebase origin/main` (which contains #2900), then re-run the RED file (it must still fail as above) before the RED commit. §0 order, with
the targeted step `npx vitest run __tests__/scripts/evidence-collect-coverage-2903.test.ts __tests__/templates/evidence-collect-render.test.ts
__tests__/generators/check-all.test.ts __tests__/templates/debt-baseline-extended.test.ts`, then run `n2c2.sh <checkout> post` on a
render: argv (1) must write `coverage-summary.json`. Commit: `fix(evidence): TS collector requests json-summary coverage (#2903)`.
### 3.6 Premortem table
| Failure mode | Likelihood | Prevention |
|---|---|---|
| `--reporter=silent` dropped, `json` kept → summary still missing | High | change the value to `json-summary`; the RED asserts the file |
| RED reintroduces a shim (npx/PATH) → AC-2 void | Med | the reviewer greps the RED for `PATH`/shim; it only forwards `process.env` |
| Host scanners (`trivy`, mutation tooling) in the collector run slowly or hit the network on a CI runner | Med | coverage asserted independently of `obs_gate`; if slow, neutralise them via a PATH stub dir for **those** tools only (never vitest) |
| Branched from 1d58be09 → conflict/regen after #2900 | Med | branch from #2900's merge; bake after the rebase |
### 3.7 Reviewer threat model
(1) The positive control is real vitest plus `@vitest/coverage-v8` from repo node_modules, with no shim. (2) No bake lane is TS L3+,
so this RED is the **only** real-tooling control of the TS collector; bake cannot catch a regression here. (3) The fail-closed paths
(#2887/A03-008) are unchanged: a missing or stale summary still fails. (4) Thresholds are untouched. (5) Why not isolate `reportsDirectory`
like debt-lib's `.coverage-tmp`? The collector runs standalone; that is a design choice, not a defect.

