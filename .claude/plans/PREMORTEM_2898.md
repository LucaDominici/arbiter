# Premortem: arbiter #2898 shell failure signature (2026-09-25)

Base `origin/main` `47431fda`. Writer worktree `/home/luca/work/repos/arbiter.worktrees/2898-shell-signature` (branch `task/#2898-shell-signature`, clean, `.arbiter/checkout-binding.json` present, no `.claude/.task`). Ship rule `required` / `R1-hooks-templates`. Three read-only Sonnet specialists (twin/regen, test harness, gates/review risk), reconciled by the coordinator. RED, GREEN, one-sided drift, regen and bake were all executed in detached `/tmp/pm2898-red` at `47431fda`; that checkout has been removed.

## 0. Facts that shape the plan (verified)

1. **Admission blocker, orchestrator pre-step.** The #2898 body has 0 parseable AC (`parseAcceptanceBlocks` → `[]`, `validateIssueAcceptanceCoverage` → "no parseable acceptance criteria"). `check-acceptance --admit-issue 2898` will refuse the plan. Before the writer starts, the orchestrator appends this block to the issue body. It was checked to parse into 4 criteria:
   ```
   ## Acceptance criteria

   - AC-1: The shell failure signature accepts leading horizontal whitespace (spaces or tabs) before `FAIL:` in both the runtime list (`src/evidence/tdd.ts`) and the emitted list (`src/templates/scripts/lib/_tdd-receipt.ejs`).
   - AC-2: The shell signature never matches across a newline: `FAIL:` followed by a line break is refused.
   - AC-3: `FAIL-safe` prose, `FAILED:` and colon-less `FAIL <label>` lines are refused.
   - AC-4: One parity test asserts that the runtime and emitted lists accept and refuse the same inputs.
   ```
   The plan copies these verbatim as `AC-2898.1`..`AC-2898.4`.
2. **Twins.** The runtime list is `src/evidence/tdd.ts:66`. The emitted partial is `src/templates/scripts/lib/_tdd-receipt.ejs:9`, included by `check-tdd-evidence.mjs.ejs:116` and `claude/hooks/skill-forced-eval.mjs.ejs:36`. It is materialized in:
   - `.claude/hooks/skill-forced-eval.mjs:37`, which must be a byte-exact render (`check-self-dogfood` TEMPLATE_ROOTS);
   - `examples/{go,python,ts}-library/scripts/check-tdd-evidence.mjs:124`.

   The two lists are not byte-identical overall: cargo is `test result` in the runtime and `test[ ]result` in the template. The runtime also strips ANSI and the template does not. So parity is **behavioural** over a plain-text corpus.
3. **Unchanged, although named in the brief** (proven by the executed footprint):
   - `scripts/check-tdd-evidence.mjs` has no signature list; it delegates to `tsx src/cli.ts check tdd`. Only its template↔self `diffHash` in `.dogfood-divergences.json` moves.
   - `__tests__/fixtures/pack-contract-2597.json` pins a path-set digest, not content.
   - The hook manifests (`.arbiter/*hooks-manifest.json`) pin only rationale text.
   - No `__snapshots__` file holds the regex literal. The bake goldens hold file **hashes**.
4. **Third copy, out of reach.** `src/evidence/tdd-reexecute.ts:74` (GREEN `shellOutputFailure`) keeps `/^FAIL:[ \t]+\S.*$/m`. That file belongs to #2906, and the writer must not touch it. After this PR, RED accepts an indented `FAIL:` but GREEN does not treat one as a failure verdict. GREEN still refuses a non-zero exit (`:275-278`), so the gap only bites a shell test that exits 0 while printing an indented `FAIL:`. Orchestrator follow-up once #2906 lands.
5. **Old evidence is unaffected.**
   - `extractFailureIdentities` trims legacy matches (`tdd.ts:126`), so a column-0 identity is unchanged.
   - `compareFailure` (`tdd-reexecute.ts:396-425`) recomputes the recorded and fresh identities with the same current code.
   - A scan of 929 receipts (arbiter 613, haben 246, ripme 32, coach 21, viafera 17) found **0** logs with an indented `FAIL:` line. No first-match or identity change is possible on existing evidence.
6. **Gates.**
   - publicApi does not scan `tdd.ts` (`check-api-snapshot.mjs:26-31`).
   - The regex is linear and no ReDoS lint exists.
   - jscpd `minTokens 50` is unaffected.
   - The docs gate trips on `src/`/`__tests__/`. Precedent #2825 (the original shell signature) used `[skip-docs]` in a commit message.
   - The active eslint flat config does not enable `no-new-func`, and the test uses `node:vm` (precedent: `pr-tier-base-branch-filter.test.ts:21`).
## 1. Plan `files:` manifest (exact, from the executed footprint)

```
---
files:
  - .claude/plans/task-2898.md
  - src/evidence/tdd.ts
  - src/templates/scripts/lib/_tdd-receipt.ejs
  - .claude/hooks/skill-forced-eval.mjs
  - .dogfood-divergences.json
  - examples/go-library/scripts/check-tdd-evidence.mjs
  - examples/go-library/.arbiter-generated-manifest.json
  - examples/python-library/scripts/check-tdd-evidence.mjs
  - examples/python-library/.arbiter-generated-manifest.json
  - examples/ts-library/scripts/check-tdd-evidence.mjs
  - examples/ts-library/.arbiter-generated-manifest.json
  - __tests__/evidence/tdd-shell-signature-parity.test.ts
  - __tests__/integration/e2e/bake/__snapshots__/*.json   # all 27; java-spring-L3/L4 also change the hook hash
  - .arbiter/evidence/tdd/#2898.json
---
```
If `derive-plan-gates` rejects the glob, list the 27 snapshot files explicitly (`ls __tests__/integration/e2e/bake/__snapshots__/`). **Forbidden:** `src/evidence/tdd-reexecute.ts`, `src/commands/{cross-model-review,task}.ts`, `src/utils/error-catalog.ts`, `src/i18n/en.json`.

## 2. Steps (ordered)

```
cd /home/luca/work/repos/arbiter.worktrees/2898-shell-signature && export PATH="$PWD/node_modules/.bin:$PATH"
git fetch -q origin && git rev-parse origin/main    # expect 47431fda...; if moved, rebase first
npm run build
# write .claude/plans/task-2898.md: frontmatter §1, AC-2898.1..4 verbatim from fact 1, this brief as approach
node scripts/check-acceptance.mjs --plan .claude/plans/task-2898.md --admit-issue 2898
git add -f .claude/plans/task-2898.md && git commit -m 'docs(plan): #2898 shell signature plan [skip-docs]'
node dist/cli.js lifecycle start --id '#2898' --plan .claude/plans/task-2898.md   # take the tier Ship prints
node dist/cli.js ship '#2898'
```

**RED.** Create `__tests__/evidence/tdd-shell-signature-parity.test.ts` byte-for-byte as below. This is the file that was executed.
```ts
// SPDX-License-Identifier: Apache-2.0
// #2898: the shell signature accepts leading horizontal whitespace before `FAIL:` and never
// spans a newline. The runtime list (src/evidence/tdd.ts) and the emitted list
// (src/templates/scripts/lib/_tdd-receipt.ejs, included by check-tdd-evidence and the
// skill-forced-eval hook) must accept and refuse the same inputs.
import { describe, it, expect } from 'vitest'
import { runInNewContext } from 'node:vm'
import { extractFailureSignature } from '../../src/evidence/tdd.js'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// The partial is plain JS declarations with no top-level side effects.
const emitted = runInNewContext(
  `(() => {\n${renderTemplate('scripts/lib/_tdd-receipt.ejs', makeConfig('/tmp/test'))}\nreturn { hasFailureSignature }\n})()`,
) as { hasFailureSignature: (log: string) => boolean }

const ACCEPT = [
  'FAIL: scanner did not report the expected violation',
  '  FAIL: stale project reaped (expected=1 actual=0)',
  '\tFAIL: tab-indented',
  'ok one\n  FAIL: second line indented\nok three',
]
const REFUSE = [
  'FAIL:\n  x', // label on the next line: [ \t] never crosses \n
  '  FAIL: \n', // nothing after the colon on the same line
  'FAIL-safe mode enabled',
  '  FAIL-safe: fallback engaged',
  'FAILED: 3',
  '  FAIL <label> (expected=1 actual=0)', // colon-less stays refused (owner decision)
  'this FAIL: is prose mid-line',
]

describe('#2898 shell failure signature', () => {
  it.each(ACCEPT)('runtime accepts %j as shell', (log) => {
    expect(extractFailureSignature(log)?.framework).toBe('shell')
  })
  it.each(REFUSE)('runtime refuses %j', (log) => {
    expect(extractFailureSignature(log)).toBeNull()
  })
  it.each([...ACCEPT, ...REFUSE])('runtime and emitted lists agree on %j', (log) => {
    expect(emitted.hasFailureSignature(log)).toBe(extractFailureSignature(log) !== null)
  })
  it('emitted list accepts every indented case', () => {
    expect(ACCEPT.filter((log) => !emitted.hasFailureSignature(log))).toEqual([])
  })
})
```
Executed at `47431fda`: `npx vitest run __tests__/evidence/tdd-shell-signature-parity.test.ts` → **exit 1, `Tests 4 failed | 19 passed (23)`**. The failures are the three indented/tab/multi-line runtime accepts (`expected undefined to be 'shell'`) and `emitted list accepts every indented case` (the 3 indented inputs are returned). Each failure is for the stated reason. The negatives and the parity rows already pass; they are guards. eslint and prettier on the file: exit 0.
```
git add __tests__/evidence/tdd-shell-signature-parity.test.ts && git commit -m 'test(#2898): indented shell FAIL: signature and runtime/emitted parity [skip-docs]'
node dist/cli.js lifecycle record-red --task '#2898' --test-path __tests__/evidence/tdd-shell-signature-parity.test.ts \
  --test-command npx --test-arg vitest --test-arg run --test-arg __tests__/evidence/tdd-shell-signature-parity.test.ts
git add -f '.arbiter/evidence/tdd/#2898.json' && git commit -m 'test(#2898): record red-phase evidence [skip-docs]'
```
The `record-red` line was **not executed**, because it writes evidence. Its flags were checked against `src/cli.ts:2011-2029`, and it matches the #2895 receipt (`test_command` = `npx vitest run <file>`). Expected `observed_failure`: `FAIL  |unit| __tests__/evidence/tdd-shell-signature-parity.test.ts` (vitest ranks before shell). **After this commit, do not touch the test file at all, not even with prettier.** The GREEN gate pins its blob, and #2906's relief is not on main.

**GREEN (one token, both twins, then the materialized copy).** This was executed; the drift check passes after it. Use `^[ \t]*`, not a lookbehind (simpler; identities trim anyway), and do not reorder the list.
```diff
--- src/evidence/tdd.ts:66
-  { framework: 'shell', pattern: /^FAIL:[ \t]+\S.*$/m },
+  { framework: 'shell', pattern: /^[ \t]*FAIL:[ \t]+\S.*$/m },
--- src/templates/scripts/lib/_tdd-receipt.ejs:9   (same edit at .claude/hooks/skill-forced-eval.mjs:37)
-  /^FAIL:[ \t]+\S.*$/m, // shell self-test
+  /^[ \t]*FAIL:[ \t]+\S.*$/m, // shell self-test
```

**Regen and verification**, in this order. Every step below was run in `/tmp/pm2898-red` with the GREEN patch, except typecheck, lint, check tdd and commitlint.
```
npx vitest run __tests__/evidence/tdd-shell-signature-parity.test.ts   # exit 0, 23 passed
npx vitest run __tests__/evidence/tdd.test.ts __tests__/templates/check-tdd-evidence-render.test.ts __tests__/evidence/tdd-reexecute*.test.ts  # exit 0, 129 passed
npm run build                                               # exit 0
node scripts/check-self-dogfood.mjs --update-divergences    # EXITS 1 but writes the new diffHash (82b8b5… → e05809…)
node scripts/check-self-dogfood.mjs                         # must exit 0: "85 template(s) + 8 raw hook(s) checked"
npm run examples:regenerate && npm run examples:check       # check exit 0 (6 examples files change)
BAKE_UPDATE_SNAPSHOTS=1 npm run test:e2e:bake && npm run test:e2e:bake   # both exit 0, 32 tests; 27 goldens change
npm run typecheck && npm run lint
node dist/cli.js check tdd '#2898'                          # receipt replays under the widened extractor
node scripts/check-duplication.mjs && node scripts/check-api-snapshot.mjs
git diff --name-only origin/main...HEAD | grep -E 'tdd-reexecute|cross-model-review|commands/task\.ts|error-catalog|i18n/en\.json' && echo SCOPE-BLEED
npx commitlint --from origin/main --to HEAD
```
Run the L2/full gate in a detached `/tmp` checkout of the pushed head, not in the worktree (the #2896 lesson about untracked host files). The PR body names fact 4 and fact 2's ANSI gap as known and out of scope.

## 3. Premortem

| Failure mode | Likelihood | Prevention |
|---|---|---|
| Admission refuses the plan: the issue has 0 AC | Certain | Orchestrator appends the fact 1 block before the writer starts. The plan copies it verbatim as AC-2898.N |
| Bake goldens stale; dogfood PASS but `test:e2e:bake` red (#2891 class) | High | Update and replay bake in §2; commit all 27 |
| `.dogfood-divergences.json` not re-pinned, or the writer reads `--update-divergences` exit 1 as failure | High | Judge by the plain rerun (exit 0), not by the updater's exit code |
| Examples drift (`examples:check` red in CI) | High | `examples:regenerate` after build; 6 files |
| Only one twin changed | Medium | The parity rows fail when only the runtime is fixed (executed: exit 1, 4 failed); check-self-dogfood covers the hook copy |
| Hook copy hand-edited differently from the render | Medium | Identical one-token sed; check-self-dogfood byte check |
| Writer touches `tdd-reexecute.ts:74` to "fix the class" and collides with #2906 | Medium | Forbidden list in §1 and the scope-bleed grep; the gap is an orchestrator follow-up (fact 4) |
| RED test edited after record-red (formatting) → GREEN blob gate refuses | Medium | Freeze the file after the RED commit; prettier already exits 0 on it |
| Receipt not committed (gitignored) or docs gate red | Medium | `git add -f`; `[skip-docs]` in the commit messages (#2825 precedent) |
| #2906 lands first → rebase conflicts in hashes and goldens | Medium | After the rebase, rerun build, dogfood re-pin, examples regen and bake regen. Never hand-merge hashes |
| New tap/playwright RED log containing an indented `FAIL:` now classifies as shell → GREEN demands a `PASS:` verdict (`tdd-reexecute.ts:195-199`) | Low | Existing receipts: 0/929 affected. Keep list order; state it in the PR body |
| Wider regex matches prose in other runners' logs | Low | Only whitespace may precede `FAIL:`, and the colon is required; the mid-line, FAIL-safe and FAILED: negatives are executed |
| Newline-spanning match | Low | `[ \t]` classes plus `.` without `s`; the `FAIL:\n  x` and `  FAIL: \n` negatives are executed |
| Premortem decision stale after plan (#2899) | Low | Run `node dist/cli.js ship '#2898'` after `lifecycle start`; if the freeze refuses on `R7`, report it and do not bypass |

## 4. Reviewer threat model

The reviewer assumes the fix landed on one side only. They re-render `_tdd-receipt.ejs` and diff the shell line against `tdd.ts:66` and `.claude/hooks/skill-forced-eval.mjs:37`. They require the parity test to fail when the template is reverted alone. They feed newline-spanning (`FAIL:\n x`, `  FAIL: \n`), mid-line prose, `FAIL-safe`, `FAILED:` and colon-less inputs, and expect every one refused, while space- and tab-indented `FAIL:` must be accepted. They ask whether old receipts change identity or first-match framework: the answer is the trim at `tdd.ts:126` plus the 0/929 scan. They check that the RED fails at the base for the stated reason and that `check tdd '#2898'` passes after GREEN. They demand fresh bake goldens, the dogfood pin and the examples, with the manifest listing all of them. Any diff in the #2906 files is an instant reject. They will flag `tdd-reexecute.ts:74` and the ANSI asymmetry: pre-answer both in the PR body as known, out of scope, and tracked.
