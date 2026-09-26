# Premortem — #2932 (four delivery refusals print `Unexpected error`)

Base `d70eb7c7`. Lines are d70eb7c7; anchor by function name. §8 (sweep) is a follow-up, out of scope.

## 0. Decision and measured facts
- **Code:** one new `E_GATE_REFUSED` (no existing code fits: `E_TRAIN_SEALED`, `E_PR_NOT_MERGED`,
  `E_STALE_HOST_BINDING`, `E_PREMORTEM_REQUIRED` and `E_REVIEW_ROUNDS_EXHAUSTED` all name other policies).
  This is C3 +1, below the >1 alarm. Throw it with `ArbiterError.fromKey` (the `E_PR_NOT_MERGED` /
  `E_GREEN_DIRTY_TREE` pattern). `ArbiterError extends UserFacingError`, and `cli.ts`
  `_handleTopLevelError` prints `Error [E_GATE_REFUSED]: …` plus `arbiter explain`, exit 1.
- **i18n template is exactly `"{detail}"`.** Measured: with a `REFUSED — {detail}` headline,
  `ship-review.test.ts › fast-forward stops at refactor through the real review-completion gate`
  goes red: `task-ship.ts:962` embeds `err.message` in `advanced to X; next gate (Y) not yet
  satisfied: <reason>`, and the test pins `…: check-review-completion.mjs blocked`. With
  `{detail}`, every message stays byte-identical, and all existing regex pins hold (verified, see §3).
- **Error-catalog row is required.** Without it the CLI tells the user to run
  `arbiter explain E_GATE_REFUSED`, which prints `Unknown error code` (measured; the same gap exists
  today for `E_GREEN_DIRTY_TREE`, out of scope).
- **Refusal vs fault (AC-1/AC-2):** `runCli` throws `CliError {exitCode, stdout, stderr, timedOut}`
  and formats its message as `Command failed (exit N): … \n<stderr[:500]>`. The rule: coded only
  when `CliError && exitCode === 1 && !timedOut && /^(?:\[[\w-]+\] )?FAIL\b/m` matches stdout+stderr.
  `check-acceptance` writes `FAIL check-acceptance: …` to stderr; `check-review-completion` writes
  `[check-review-completion] FAIL: …` to stdout (INV-53: 0 PASS / 1 FAIL / 2 ERROR). Missing script,
  spawn error, timeout, exit 2 and exit 1 without a FAIL line all stay plain `Error` with `{ cause }`.
- **stdout FAIL text must be carried (AC-1).** `formatMessage` puts only `stderr[:500]` into the
  message, so a check-review-completion refusal would be coded but lose its FAIL line and remedy.
  In the coded branch, append the stdout FAIL lines not already in the message (measured: the
  "revert only the append" run fails exactly the stdout case).
- **`cause` must survive.** `correlatedReviewEnvelopes` (:1602) branches on
  `error.cause instanceof CliError && exitCode === 1`. `ArbiterError` has no `cause` constructor
  option, so set `err.cause = cause` after `fromKey`; tsc accepts this (measured).
- **Gates (measured on the trial GREEN):** publicApiSurface 1174/1174 unchanged (no new export);
  complexity 226 unchanged; `tsc --noEmit` 0; eslint 0 errors; `check-no-raw-strings` OK with the
  inventory unchanged (#2910 touched `_migration-inventory.json`; this change does not need to);
  `check:i18n` OK. No `scripts/` or `src/templates/` change, so there are **no twins, examples,
  kernel copies or bake snapshots**, and self-dogfood/examples/bake cannot move. The docs gate fires
  (`src/` diff), so add one bullet to `docs/REFERENCE/ship-driver.md` § "Coded delivery-path refusals".
- Step-1 counters: mandatory writer actions Δ0, CLI options Δ0, `E_` codes +1.

## 1. Plan `.claude/plans/task-2932.md`, front matter
```yaml
---
context:
  issue: '#2932'
  type: fix
  pipeline: 'plan → red → green → refactor → review → close'
  branch_convention: 'task/#2932-coded-gate-refusals'
  base_branch: main
  key_constraints:
    - 'One new code E_GATE_REFUSED via ArbiterError.fromKey + error-catalog row; i18n text is "{detail}"'
    - 'Coded only for CliError exit 1 + FAIL line, not timed out; other failures stay Error'
    - 'Coded detail appends stdout FAIL lines: CliError.message carries stderr only'
  red_team_warnings:
    - 'Keep every message byte-identical: task-ship.ts:962 embeds err.message and ship-review pins it'
    - 'Preserve err.cause = CliError: correlatedReviewEnvelopes branches on cause.exitCode === 1'
  estimate: 'S'
premortem: .claude/plans/PREMORTEM_2932.md
files:
  - .claude/plans/task-2932.md
  - .claude/plans/PREMORTEM_2932.md
  - src/commands/task.ts
  - src/i18n/en.json
  - src/utils/error-catalog.ts
  - docs/REFERENCE/ship-driver.md
  - __tests__/commands/coded-refusals-2932.test.ts
  - .arbiter/evidence/tdd/#2932.json
---
```
Commit this file's §0 and §5 (redacted, no workspace paths) as `.claude/plans/PREMORTEM_2932.md` in
the plan commit, as #2898/#2899 did.

## 2. RED: new file `__tests__/commands/coded-refusals-2932.test.ts`
Copy the prepared RED file verbatim (216 lines, prettier-formatted, `npx eslint` exit 0). Every
case spawns the **built `dist/cli.js`** (the real `_handleTopLevelError`); in-process calls are used
only to seed state (`runTaskInit`, `writeUnifiedState`):
| Case | CLI | Fixture | Asserts |
|---|---|---|---|
| AC-1 #2903 derived-stale (`runRequiredTaskChecker`) | `lifecycle resume --dir` | real `check-acceptance.mjs` + `scripts/lib`, anchored, then the `check-all.mjs` authority is edited | no `Unexpected error`; `^Error [E_GATE_REFUSED]:`; `derived gates are missing or stale`; `lifecycle start --plan`; exit 1 |
| AC-1 base currency (`assertBaseCurrent`) | `ship --review-round --dir` | bare origin with main one commit ahead, tracking ref deleted (2875 shape) | same, plus `git merge --no-edit origin/main` |
| AC-1 acceptance-anchor (`checkAcceptancePlanGate`) | `lifecycle advance --to red --dir` | plan without an anchor, tracked at HEAD (2587 shape) | same, plus `acceptance-anchor gate: … FAIL` |
| AC-1 bake freeze (`checkBakeAfterTemplates`) | `ship --review-round --dir` | `src/templates` commit with no snapshot commit, bake gate in `derivedGates` | same, plus the rebake command |
| AC-1 stdout FAIL (check-review-completion shape) | `lifecycle resume` | stub checker prints `[check-x] FAIL: token-2932, …` on stdout, exit 1 | coded, and stderr carries that line |
| AC-2 ×2 (pass on base; guard) | `lifecycle resume` | stub checker: `exit 2` with a FAIL line, and a crash (exit 1, no FAIL line) | `Unexpected error:` stays; no `E_GATE_REFUSED` |

`record-red` (after the RED commit, `npm run build` first):
`node dist/cli.js lifecycle record-red --task '#2932' --test-path __tests__/commands/coded-refusals-2932.test.ts --test-command npx --test-arg vitest --test-arg run --test-arg __tests__/commands/coded-refusals-2932.test.ts`

## 3. Evidence (scratch checkout of d70eb7c7, `npm run build` before each run)
**Base, RED file only → exit 1, 5 failed | 2 passed (7); all 5 fail at `not.toContain('Unexpected error')`:**
```
× #2903 derived-stale: the required checker FAIL (exit 1) is E_GATE_REFUSED with its remedy
× base currency: a review round on a stale base is E_GATE_REFUSED naming the merge
× acceptance-anchor: a malformed plan refused on red entry is E_GATE_REFUSED
× bake freeze: a template commit newer than the snapshots is E_GATE_REFUSED naming the rebake
× a checker that prints its FAIL on stdout (check-review-completion shape) carries that text
```
Each fails at `expect(stderr).not.toContain('Unexpected error')` with the real text, for example
`Unexpected error: check-acceptance.mjs blocked the lifecycle transition: Command failed (exit 1): node …
--check-derived-current\nFAIL check-acceptance: derived gates are missing or stale (verification authority
scripts/check-all.mjs changed); re-anchor the plan with \`arbiter lifecycle start --plan <path>\``, and
`Unexpected error: review round refused: HEAD has not merged origin/main. Run \`git merge --no-edit origin/main\`…`.
**Trial GREEN (116-line trial diff) → exit 0, 7 passed (7).**
**Isolation (each site reverted alone, rest of GREEN kept):** base-currency → only its case ×;
bake → only its case ×; anchor → only its case ×; required-checker → only derived-stale ×;
stdout append → only the stdout case × (`Error [E_GATE_REFUSED]: check-acceptance.mjs blocked …` without the line).
(The first four isolations predate the stdout case; the append is a separate helper.)
**Naive GREEN** (code every checker failure) → only the two AC-2 cases ×. So each AC-1 case is pinned
to its own site, and AC-2 catches over-coding.
**Neighbour pins under the final trial GREEN: 21 files, 426 tests, 0 failed:** ship-stale-base-2875,
bake-freshness-content-2928, task-admission-red-2587, task-advance-gates, ship-review,
coded-refusals-2910(+r2), task, task.cov, task-handoff-gate, cross-model-review,
green-gate-head-2908-r2, ship-premortem(-read-time-2899), ship-train, utils/errors, explain.cov,
help-surface, `__tests__/i18n`.

## 4. GREEN (pseudo-diff; the exact trial diff is saved)
```ts
// src/commands/task.ts — two private helpers placed after runRequiredTaskChecker, no export
function gateRefusal(detail: string, cause?: unknown): ArbiterError {
  const err = ArbiterError.fromKey('E_GATE_REFUSED', 'errors.E_GATE_REFUSED', { detail })
  if (cause !== undefined) err.cause = cause
  return err
}
const FAIL_LINE = /^(?:\[[\w-]+\] )?FAIL\b/m
function checkerFailure(detail: string, err: unknown): Error {   // #2932 AC-2
  if (err instanceof CliError && err.exitCode === 1 && !err.timedOut &&
      FAIL_LINE.test(`${err.stdout}\n${err.stderr}`)) return gateRefusal(withStdoutFail(detail, err), err)
  return new Error(detail, { cause: err })
}
function withStdoutFail(detail: string, err: CliError): string {   // message carries stderr only
  const lines = err.stdout.split('\n').filter((l) => FAIL_LINE.test(l) && !detail.includes(l))
  return [detail, ...lines].join('\n')
}
// assertBaseCurrent, checkBakeAfterTemplates: throw new Error(`…`) → throw gateRefusal(`…`)
// checkAcceptancePlanGate catch: new Error(msg, { cause: err })  → checkerFailure(msg, err)
// runRequiredTaskChecker catch:  new Error(msg, { cause: err })  → checkerFailure(msg, err)
// src/i18n/en.json (after E_GREEN_DIRTY_TREE_HINT):  "E_GATE_REFUSED": "{detail}"
// error-catalog.ts: row before E_PR_NOT_MERGED (summary, the 4 triggers, 'run the named remedy')
// ship-driver.md § Coded delivery-path refusals: one E_GATE_REFUSED bullet (4 triggers; faults stay)
```
Leave the missing-script refusals (`:2000`, `:2047`) as faults: AC-2 names "missing script".

## 5. Premortem table
| # | Failure | Likelihood | Guard |
|---|---|---|---|
| 1 | A headline in the i18n text changes `err.message` and breaks pins that embed it (ship-review, stop messages) | High if ignored (measured) | `"{detail}"`; ship-review in the targeted run |
| 2 | Over-coding: a timeout, exit 2 or crash becomes E_GATE_REFUSED and hides a fault | Medium | `checkerFailure` predicate; the 2 AC-2 cases; the naive-GREEN run proves they bite |
| 3 | `cause` dropped → `correlatedReviewEnvelopes` stops mapping exit 1 to its stale-checker remedy | Medium | `err.cause = cause`; ship-review + cross-model-review green |
| 4 | Writer adds a 2nd code (one per site) → C3 +4, review alarm | Medium | One code; a site differs only in `detail` |
| 5 | `explain` prints "Unknown error code" for the code the CLI tells the user to explain | High if skipped (measured) | error-catalog row; `node dist/cli.js explain E_GATE_REFUSED` |
| 6 | RED run against a stale `dist/` (the cases spawn `dist/cli.js`) → false RED or false GREEN | Medium | `npm run build` before every RED/GREEN run and before `record-red`; #2910's recorded RED also spawns `dist/cli.js` (precedent) |
| 7 | Anchor gate: a `gh` NO DATA exit 1 with a FAIL line is now coded | Low | Correct by AC-1: a refusal that names repair; the 2587 `/NO DATA/` pin still passes |
| 8 | Complexity or API growth from the helpers | Low | Measured 226 / 1174 unchanged; helpers are private |
| 9 | Docs gate red without a docs change | High if skipped | ship-driver.md bullet in `files:` |
| 10 | stdout FAIL line lost (message = stderr[:500] only) → coded but remedy-less | High if skipped (measured) | `withStdoutFail`; stdout RED case. Stderr past 500 chars is still truncated (pre-existing, accepted) |

## 6. Verification (foreground, in order)
`npm run build` → `npx vitest run __tests__/commands/coded-refusals-2932.test.ts` (7/7) →
`npx vitest run __tests__/commands/{ship-stale-base-2875,bake-freshness-content-2928,task-admission-red-2587,task-advance-gates,ship-review,coded-refusals-2910,coded-refusals-2910-r2,task,cross-model-review,ship-train}.test.ts __tests__/utils/errors.test.ts __tests__/coverage/explain.cov.test.ts __tests__/i18n`
→ `npm run typecheck && npm run lint` → `node scripts/debt-report.mjs --gate publicApiSurface --only-metric publicApiSurface` (1174)
and the complexity ratchet (226) → `npm run check:i18n` → `node dist/cli.js explain E_GATE_REFUSED` →
step-1 counters vs `d70eb7c7` (C7 Δ0, C2 Δ0, C3 +1) → `npx commitlint --from origin/main --to HEAD`
→ `node scripts/check-all.mjs L1` → `L2` once. There are no examples/bake/self-dogfood steps: the diff has no template or script.

## 7. Reviewer threat model
- Every changed `throw` keeps its exact text; only the class changes (plus the stdout FAIL append).
- The predicate must use `exitCode === 1` **and** a FAIL line **and** `!timedOut`; reject `!== 0`, stderr-only
  matching (check-review-completion writes FAIL to stdout), and any string-match on `err.message`.
- `cause` is set on the coded path; the fault path still passes `{ cause: err }`.
- The RED goes through `dist/cli.js`, not `runTaskShip`/`runTaskResume` in-process, and asserts
  `not.toContain('Unexpected error')` for derived-stale and base-currency (the owner's ask).
- One code, one i18n key, one catalog row; no new export, CLI option or writer action.
- Out of scope, and must not creep in: the sweep sites in §8.

