# Premortem — #2904 (task-base review rounds) and #2905 (reviewer model/effort)

Base: Arbiter `41f3adc90a924939ff54dee3d05ec175bef53e64` (head of PR #2909 / #2906; main after its fast-forward).
Read-only run, 2026-09-26: 3 sonnet specialists + coordinator re-verification. RED files next to this file: `red-2904.cross-model-review-task-base-2904.test.ts`, `red-2905.external-review-model-effort-2905.test.ts`.

## 0. Reconciliation verdicts (read first)

1. **#2904 needs no file outside its set.** The task base resolves inside `cross-model-review.ts` via the existing
   `resolveReviewBase` fallback (`git rev-parse origin/main`, L554-560). `task-ship.ts` is untouched.
2. **#2905 cannot meet AC-2 inside the declared set (coordinator-verified). It is template→bake.** Extra files:
   `src/wizard/types.ts:9-19` (home of `CrossModelReviewConfig`; `schema.ts` only imports it);
   `scripts/record-agent-return.mjs:54-57,117-125` (`stampAgentProvenance`) + its `.ejs` twin (parity enforced by
   `check-self-dogfood.mjs:620-626`); `schemas/agent-return.schema.json:82-108` (`provenance` is
   `additionalProperties:false`, has `model`, lacks `effort`) + its `.ejs` twin; `examples/{python,ts,go}-library/`
   recorder+schema via `npm run examples:regenerate`. None is owned by #2904, so the sets stay disjoint and both
   writers run in parallel; fold these into #2905 (no preparatory PR). `arg()` reads flags by name, so an older baked
   target recorder silently drops `--provenance-model/-effort` instead of failing. Say so in the PR.
3. **Effort set.** Local `codex-cli 0.157.0` (Viafera pins 0.146.0) does **not** validate `model_reasoning_effort`
   client-side: `"bogus"` got past parsing and reached the API. `~/.codex/models_cache.json` lists
   `low,medium,high,xhigh,max` for gpt-6-luna, plus `ultra` for astra/sol; `minimal` exists nowhere. Fixed set = the
   union `low|medium|high|xhigh|max|ultra`. A model/effort mismatch is rejected API-side, and the doc says so.
4. **Issue text vs decision.** #2905 AC-1 says "overridable per run" under `ship.review.external.*`. The decision is
   `crossModelReview.{model,effort}` with no per-run override (the ceremony gate bans new CLI options); the PR body
   states the deviation. Do NOT add the keys to `configure.ts` `ALLOWED_PATHS`: that is out of scope and trips the
   METHODOLOGY_CATALOG parity gate. Editing `arbiter.json` is the one path.
5. **Docs gate** (`check-docs.mjs`: any `src/` change needs some `docs/` change), disjoint:
   #2904 → `docs/internal/SYSTEM/SHIP_REDESIGN_JOURNAL.md`; #2905 → `docs/design/cross-model-review-config.md`.
6. Stale worktree `/tmp/l2clean2906.Ko0c/wt` (496e835d, from the #2906 run) is still registered; left untouched.
## 1. #2904 — round ≥2 reviews acceptance fit against the task base
### Plan `files:` manifest
```
src/commands/cross-model-review.ts
src/commands/ship-review.ts
__tests__/commands/cross-model-review-task-base-2904.test.ts   (new, RED)
__tests__/commands/cross-model-review.test.ts                   (origin/main mocks + 2 labels)
docs/internal/SYSTEM/SHIP_REDESIGN_JOURNAL.md
```
### Code path (at 41f3adc)
- `planReviewRound` (`ship-review.ts:97-118`) sets `base = previous.lastReviewedSha` (null in round 1; state
  `review:{rounds,lastReviewedSha}` is set at `task.ts:519` and updated at `task.ts:~1699`). `task-ship.ts:1475` passes
  `baseSha: plan.base` to `runShipCrossModelReview` (`cross-model-review.ts:658-718`).
- **Defect:** `resolveReviewBase` (L554-560) returns `baseSha ?? origin/main`, so round ≥2 uses `lastReviewedSha` as
  both `Base SHA:` and the egressed `git diff --binary <prev>..<head>` (L694).
- `frozenReviewPrompt` (L575-601, private) prints `Base SHA:`/`Head SHA:`/`Diff:`, asks for acceptanceFit "for every
  criterion", then the RED evidence; #2906 appends the pinned-test line (L666-671). `reviewScopeLine`
  (`ship-review.ts:128-133`, exported; callers `task-ship.ts:319,342`) is the operator `Review scope:` text.
### RED (new dedicated file; executed)
`__tests__/commands/cross-model-review-task-base-2904.test.ts` = `red-2904.*.test.ts` verbatim. Mocks: `origin/main` →
`c…c` (task base), `options.baseSha` → `a…a` (previous round), HEAD → `b…b`.

| Test | Assertion |
|---|---|
| AC-1 egress + task base | `git diff --binary c..b` is called; the prompt has `Task base SHA (acceptance fit): c…` and `Task diff: c..b` |
| AC-1 labelled delta | the prompt has `Changed since last round (focus; previous reviewed candidate, not the task base): a..b` |
| AC-2 no mislabel | the prompt does not contain `Base SHA: a…` or `Diff: a…..` |
| AC-3 round-2 render order | the task-base line comes after `Task:`; `Task diff:` = task-base + 2 (Head SHA between); the delta line = `Task diff:` + 1 |
| AC-3 round 1 | task-base line present, no `Changed since last round` |
| AC-2 scope line | `reviewScopeLine(a,2,2)` matches `^changed since last round: git diff a..HEAD (round 2 of 2` |

Executed:
```
git -C /home/luca/work/repos/arbiter worktree add --detach /tmp/pm2904-red 41f3adc && ln -s \
  /home/luca/work/repos/arbiter.worktrees/2906-test-amend/node_modules /tmp/pm2904-red/node_modules
cd /tmp/pm2904-red && npx vitest run __tests__/commands/cross-model-review-task-base-2904.test.ts
→ exit=1, 6 failed (6), all AssertionErrors on today's output (`Base SHA: aaaa…`, diff `a..b`, scope `git diff aaaa…`)
```
No build needed; eslint 0. Record on the task branch after committing the file (dirty `__tests__` is refused):
`arbiter lifecycle record-red --task '#2904' --test-path __tests__/commands/cross-model-review-task-base-2904.test.ts`
### GREEN pseudo-diff
```ts
// cross-model-review.ts — resolveReviewBase: drop the baseSha param; it now resolves only the task base.
-function resolveReviewBase(repoRoot, baseSha) { const base = baseSha ?? runCli(rev-parse origin/main)…
+function resolveTaskBase(repoRoot: string): string { const base = runCli('git',['rev-parse','origin/main'],…).stdout.trim()
   if (base.length === 0) throw new Error('review base SHA is unavailable') ; return base }   // keep message
+function previousReviewedSha(baseSha: string | null | undefined): string | null {   // keeps runShip ≤10
+  if (baseSha === '') throw new Error('previous review base SHA is unavailable') ; return baseSha ?? null }
// runShipCrossModelReview
-const reviewBase = resolveReviewBase(repoRoot, options.baseSha)
+const reviewBase = resolveTaskBase(repoRoot)                 // task base, every round
-frozenReviewPrompt(options.taskId, reviewBase, reviewHead, brief, tddEvidence)
+frozenReviewPrompt(options.taskId, reviewBase, reviewHead, brief, tddEvidence, previousReviewedSha(options.baseSha))
 // egress stays `git diff --binary ${reviewBase}..${reviewHead}` → now the full task diff (unchanged line)
// frozenReviewPrompt(…, previousSha: string | null)
-`Base SHA: ${baseSha}`, `Head SHA: ${headSha}`, `Diff: ${baseSha}..${headSha}`,
+`Task base SHA (acceptance fit): ${baseSha}`, `Head SHA: ${headSha}`, `Task diff: ${baseSha}..${headSha}`,
+...(previousSha === null ? [] : [
+  `Changed since last round (focus; previous reviewed candidate, not the task base): ${previousSha}..${headSha}`]),
 // keep "Review scope is the frozen diff." → "Review scope is the frozen task diff; weigh the changed-since-last-round
 // range first, but judge acceptanceFit on the whole task diff." (one sentence, no new branch)
// ship-review.ts reviewScopeLine — same signature, label only (task-ship.ts untouched)
-`git diff ${base}..HEAD (round ${rounds} of ${maxRounds}) · ` +
+`changed since last round: git diff ${base}..HEAD (round ${rounds} of ${maxRounds}; acceptance fit uses the task base) · ` +
```
**Existing tests that break: GREEN dry-run, executed.** The sketch above was applied in a detached `41f3adc` worktree,
with `npm run build` for the CLI test. `tsc` passed and the RED file went 6/6 green. `cross-model-review.test.ts` lost
11 tests. The cause: `origin/main` is now resolved in every round, and several fixtures never answer it.
- L230-290 "builds the review prompt…": add an `rev-parse origin/main → BASE_SHA` branch to its mock, and relabel L269.
- L511 "resolves the first-round origin/main base": relabel to `Task base SHA (acceptance fit): ${BASE_SHA}`.
- L898 "does not reuse fulfilled cache evidence when the tree is dirty": add an `origin/main` branch to its own mock.
- #2906 AC-4 block (7 tests, a real git repo): in `redFixture` (~L1452) add `git(dir,['update-ref','refs/remotes/origin/main',red])`.
- L393 "rejects an empty review base" stays valid, because `previousReviewedSha` throws a message matching its regex.

After those fixes the run was 184/185. The last failure was the L898 mock, which the dry-run patch missed; it is the
same one-line fix. `ship-review.test.ts` and `task-ship.test.ts` were unchanged and passed. `pinnedTestChangeLine`
(complexity 12) predates this change and is already in the 226 baseline.
### Local verification, in order (stop before the full gate)
```
npx vitest run __tests__/commands/cross-model-review-task-base-2904.test.ts __tests__/commands/cross-model-review.test.ts __tests__/commands/ship-review.test.ts __tests__/commands/task-ship.test.ts
npx prettier --check <changed files> && npx tsc --noEmit && npx eslint src __tests__ scripts
node scripts/debt-report.mjs --gate --only-metric complexityViolations && node scripts/debt-report.mjs --gate --only-metric publicApiSurface  # ≤226; =1174
node scripts/check-duplication.mjs && node scripts/check-fail-closed-audit.mjs && node scripts/check-docs.mjs
npx commitlint --from origin/main                                       # conventional; body lines ≤100
npm test -- --coverage && node scripts/check-coverage-ratchet.mjs        # branch ≥ 90.42 − 0.4
```
### Premortem
| Failure mode | Likelihood | Prevention |
|---|---|---|
| The full task diff exceeds the egress cap, so `diffTruncated` is set and the reviewer misses the delta | Med | The delta line names the range explicitly. Check `diffTruncated` in a live round-2 run; if it truncates, the PR states the ceiling rather than hiding it |
| `origin/main` moved between rounds without a rebase, so `c..head` shows reverted main commits | Low | Same behaviour as round 1 today. Ship's rebase check (`task.ts:1613`) keeps `origin/main` an ancestor. Note it in the PR; `merge-base` is a follow-up |
| `runShipCrossModelReview` crosses complexity 10 | Low | One ternary, placed inside `frozenReviewPrompt` (a flat array). Rerun the complexity metric |
| New export added (for example exporting `frozenReviewPrompt` for a test) | Med | Forbidden (1174/1174). Tests drive `runShipCrossModelReview` (already exported); helpers stay private |
| Fixtures without `origin/main` throw before the prompt is built (11 tests, measured) | High | Apply the five fixture fixes listed above in the same GREEN commit |
| The `baseSha` param is left dead in `resolveReviewBase` | Med | Remove the param and rename the function (see the pseudo-diff) |
| The docs gate fails (pure logic change) | High if forgotten | Add a dated line to `SHIP_REDESIGN_JOURNAL.md` |
### Reviewer threat model (#2904)
- Will grep the rendered round-2 prompt for `Base SHA` bound to the previous SHA (AC-2 test). Will check the egressed argv
  is `taskBase..head` (AC-1 test), on round 2 exactly (#4610 r3 false CRITICAL; cite it in the PR).
- Will check the RED evidence and the task-base line no longer contradict, and flag verbatim pins (ours pin labels/order).
## 2. #2905 — crossModelReview.{model,effort}, default gpt-6-luna / max
### Plan `files:` manifest
```
src/wizard/types.ts                                        (CrossModelReviewConfig: model?, effort?)
src/config/schema.ts                                       (validateCrossModelEngine, private set)
src/integrations/external-review.ts                        (argv + recorderArgs)
scripts/record-agent-return.mjs                            (stamp model/effort)
src/templates/scripts/record-agent-return.mjs.ejs          (twin)
schemas/agent-return.schema.json                           (provenance.effort)
src/templates/scripts/schemas/agent-return.schema.json.ejs (twin)
examples/python-library/scripts/record-agent-return.mjs  examples/python-library/schemas/agent-return.schema.json  (regen)
examples/ts-library/scripts/record-agent-return.mjs  examples/ts-library/schemas/agent-return.schema.json  (regen)
examples/go-library/scripts/record-agent-return.mjs  examples/go-library/schemas/agent-return.schema.json  (regen)
__tests__/integrations/external-review-model-effort-2905.test.ts (new, RED)
docs/design/cross-model-review-config.md                   (D8 + key table)
```
### Code path (at 41f3adc)
- `invokeCodex` (`external-review.ts:398-445`, private): `codex exec --strict-config --ephemeral --ignore-user-config`
  + six `-c`, no `-m`/effort. `request.cfg` is the whole config. The only export is `invokeExternalReview` (L907);
  callers `cross-model-review.ts:55,624`. `recorderArgs` (L334-352) passes `--provenance-vendor/-cli/-cli-version/-dispatch`.
- `validateCrossModelReview` (`schema.ts:1444-1454`) fans out to `errors.push(string)` sub-validators; no catalog code.
- `resolveCrossModelReview` (`ship-profile.ts:392-405`) spreads the profile, so new fields reach `cfg` with no edit.
### RED (new dedicated file; executed)
`__tests__/integrations/external-review-model-effort-2905.test.ts` = `red-2905.*.test.ts` verbatim. `after(cmd, flag,
prefix?)` returns the argv element *immediately after* the flag, so a stray `-c` elsewhere cannot satisfy it.

| Test | Assertion |
|---|---|
| AC-1 defaults | the codex argv has `-m gpt-6-luna` and `-c model_reasoning_effort="max"` (adjacent pairs) |
| AC-1 configured | `{model:'gpt-6-sol', effort:'high'}` → `-m gpt-6-sol`, `model_reasoning_effort="high"` |
| AC-1 effort set | `validateConfig` rejects `effort:'max"; x=1'`, with an error naming `crossModelReview.effort` |
| AC-1 model token | `''`, `' '`, `'gpt 6'` are rejected, with an error naming `crossModelReview.model` |
| AC-2 recorder args | the recorder argv has `--provenance-model gpt-6-sol`, `--provenance-effort xhigh` |
| AC-2 stamped + schema | the real recorder in a temp git repo writes `provenance ⊇ {model:'gpt-6-luna', effort:'max'}`; the schema has `provenance.properties.effort` |

Executed:
```
git -C /home/luca/work/repos/arbiter worktree add --detach /tmp/pm2905-red 41f3adc && ln -s \
  /home/luca/work/repos/arbiter.worktrees/2906-test-amend/node_modules /tmp/pm2905-red/node_modules
cd /tmp/pm2905-red && npx vitest run __tests__/integrations/external-review-model-effort-2905.test.ts
→ exit=1, 6 failed (6): `expected undefined to be 'gpt-6-luna'`, `true to be false` ×2, provenance lacks model/effort
```
`arbiter lifecycle record-red --task '#2905' --test-path __tests__/integrations/external-review-model-effort-2905.test.ts`
### GREEN pseudo-diff
```ts
// src/wizard/types.ts — inside the existing interface (no new export line)
+  /** #2905 — reviewer model; absent → gpt-6-luna. */ model?: string
+  /** #2905 — codex model_reasoning_effort; absent → max. */ effort?: string
// src/config/schema.ts (module-private; call both from validateCrossModelReview)
+const CROSS_MODEL_EFFORTS: ReadonlySet<string> = new Set(['low','medium','high','xhigh','max','ultra'])
+const MODEL_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
+function validateCrossModelEngine(raw, errors) {
+  if (raw['model'] !== undefined && (typeof raw['model'] !== 'string' || !MODEL_TOKEN.test(raw['model'])))
+    errors.push('crossModelReview.model must be a non-empty model token (letters, digits, . _ : -)')
+  if (raw['effort'] !== undefined && !CROSS_MODEL_EFFORTS.has(raw['effort'] as string))
+    errors.push(`crossModelReview.effort must be one of ${[...CROSS_MODEL_EFFORTS].join(', ')}`)
+}
// src/integrations/external-review.ts — defaults live ONLY here (one private helper, used twice)
+const DEFAULT_REVIEW_MODEL = 'gpt-6-luna'; const DEFAULT_REVIEW_EFFORT = 'max'
+function reviewEngine(cfg: CrossModelReviewConfig): { model: string; effort: string } {
+  return { model: cfg.model ?? DEFAULT_REVIEW_MODEL, effort: cfg.effort ?? DEFAULT_REVIEW_EFFORT } }
 // invokeCodex argv, right after '--ignore-user-config':
+  '-m', engine.model, '-c', `model_reasoning_effort="${engine.effort}"`,
 // recorderArgs, after --provenance-dispatch:
+  '--provenance-model', engine.model, '--provenance-effort', engine.effort,
// scripts/record-agent-return.mjs AND the .ejs twin (identical edit)
+const PROVENANCE_MODEL = arg('provenance-model', argv); const PROVENANCE_EFFORT = arg('provenance-effort', argv)
+  if (PROVENANCE_MODEL !== null) provenance.model = PROVENANCE_MODEL
+  if (PROVENANCE_EFFORT !== null) provenance.effort = PROVENANCE_EFFORT
// schemas/agent-return.schema.json AND the .ejs twin: provenance.properties +"effort": {"type":"string","minLength":1}
// then: npm run examples:regenerate
```
Docs: add **D8** to `docs/design/cross-model-review-config.md`: keys, defaults, effort set and its source
(`models_cache.json`, CLI 0.157.0), the CLI does not validate effort, no per-run override (`arbiter.json` is the one
path), Arbiter's own `arbiter.json` out of scope (owner's egress consent), luna-max ≈825 s per review.
### Local verification, in order (stop before the full gate)
```
npx vitest run __tests__/integrations/external-review-model-effort-2905.test.ts __tests__/integrations/external-review.test.ts __tests__/scripts/check-agent-return.test.ts __tests__/scripts/check-cross-model-review.test.ts __tests__/config __tests__/commands/cross-model-review.test.ts
npm run examples:regenerate && npm run examples:check
node scripts/check-self-dogfood.mjs                                      # template ↔ baked twin parity
npx prettier --check <changed files> && npx tsc --noEmit && npx eslint src __tests__ scripts
node scripts/debt-report.mjs --gate --only-metric complexityViolations && node scripts/debt-report.mjs --gate --only-metric publicApiSurface  # ≤226; =1174
node scripts/check-duplication.mjs && node scripts/check-fail-closed-audit.mjs && node scripts/check-docs.mjs
npx commitlint --from origin/main
npm test -- --coverage && node scripts/check-coverage-ratchet.mjs
```
### Premortem
| Failure mode | Likelihood | Prevention |
|---|---|---|
| Writer stays inside the declared 3-file set, so AC-2 is unmet or the recorder writes `effort` against a strict schema and every external review fails | High | Use the §2 manifest. The AC-2 recorder test runs the real script and asserts the schema key |
| `.ejs` twin or examples not regenerated, so self-dogfood or examples:check fails in CI | High | Make identical edits, then `examples:regenerate`, `examples:check` and `check-self-dogfood` |
| The default is duplicated (schema `DEFAULT_CROSS_MODEL_REVIEW` plus `external-review.ts`) and drifts | Med | Put the default only in the `reviewEngine()` helper. Do not add fields to `DEFAULT_CROSS_MODEL_REVIEW`: that would make the wizard write them into every new config |
| A new export line (`export const EFFORTS` or a type) breaks 1174/1174 | Med | All constants and helpers stay private; fields go inside the existing interface |
| `invokeExternalReview` (complexity 9) goes over 10 | Med | Edit only the private `invokeCodex` and `recorderArgs`, which are flat arrays, and put `??` in `reviewEngine` |
| Effort set too narrow (luna-only) blocks `ultra` for sol/astra, or too loose (free string) lets TOML-breaking input through | Med | Use the union set, and cite its source in D8. The API rejects a model/effort mismatch; document that |
| Reviewer claims injection through `-m`/`-c` | Low | argv array (no shell); `MODEL_TOKEN` excludes spaces, quotes and `=`. The effort comes from the fixed set before interpolation |
| The PR claims a per-run override because the issue says "overridable per run" | Med | The PR body states the deviation and the ceremony-gate reason |
| Owner surprise: reviews now take about 825 s | Low | `timeoutMs` default 900 000 ms fits, but only barely. Note it in D8 and the PR; do not change the default |
### Reviewer threat model (#2905)
- **Provenance vs argv:** one `reviewEngine()` result feeds both (the repair-2858 class, "sidecars do not bind provenance").
- **Checked clean:** no exact codex-argv pin in `__tests__` (only `arrayContaining`). #2858 `expectedProvenance` picks
  `{vendor,dispatch,cli}` explicitly (`record-agent-return.mjs:604-605`), and `check-cross-model-review.mjs:445-452` checks only those three.
- **Strict schema:** an envelope with `effort` must pass `check-agent-return` and `check-cross-model-review`; run both.
- **Validation holes:** `''`, `' '`, `'a b'`, a quote, `=`, non-strings; the RED rows cover the main ones.
- **Never inherited:** `--ignore-user-config` is kept, and `-m`/effort are emitted even when config omits them.
- **Bake story:** targets get the recorder and schema via templates; an old target recorder ignores the unknown flags.

## 3. Gate facts (specialist 3)
`publicApiSurface` = count of `src/**/*.ts` lines starting with `export` (`debt-lib.mjs:381-388`), no tolerance.
Coverage: global branch 90.42 − 0.4 pp. jscpd: threshold 5, minTokens 50, `src`+`scripts`+`.claude/hooks`. Fail-closed
audit scans `src` only for swallowing `catch {}` (`??` is not flagged). Pre-push needs a fresh L2 stamp; no `--no-verify`.
