# Premortem — #2900 (step 1, C; §0 shared rules + §1)
Base `1d58be09`. Lines are 1d58be09; anchor by function name.

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
- New rule: each RED below failed for the stated reason at 1d58be09 and passed under a trial GREEN (temporary trial checkout, removed).
## 1. #2900: non-string skeptic verdict coerced into the quorum
### 1.1 Plan `.claude/plans/task-2900.md` front matter
```yaml
---
context:
  issue: '#2900'
  type: fix
  pipeline: 'plan → red → green → refactor → review → close'
  branch_convention: 'task/#2900-refutation-verdict-type'
  base_branch: main
  key_constraints:
    - 'One guard in envelopeVerdict (both callers route through it); twins byte-identical'
    - 'Do not touch main()/unaddressedAboveFloor: pre-existing complexity 24/20 in the 226 baseline'
  red_team_warnings:
    - 'Only the array case coerces (String(["UPHELD"]) === "UPHELD"); number/object already fail the regex'
    - 'Reject by type (typeof === string), do not widen or re-anchor the regex'
  estimate: 'S'
premortem: .claude/plans/PREMORTEM_2900.md
files:
  - .claude/plans/task-2900.md
  - .claude/plans/PREMORTEM_2900.md
  - scripts/check-refutation-verdicts.mjs
  - src/templates/scripts/check-refutation-verdicts.mjs.ejs
  - __tests__/scripts/refutation-verdict-type-2900.test.ts
  - docs/design/agent-return-provenance.md
  - .arbiter/evidence/tdd/#2900.json
  - __tests__/integration/e2e/bake/__snapshots__/java-spring-L3.json
  - __tests__/integration/e2e/bake/__snapshots__/java-spring-L4.json
---
```
### 1.2 Map (1d58be09)
| Site | Today |
|---|---|
| `check-refutation-verdicts.mjs` `envelopeVerdict(env, id)` :152-159 (twin identical) | `.filter(r => r.target === id && /^(UPHELD\|REFUTED)$/.test(String(r.verdict)))` → the array joins to `UPHELD` |
| callers of `envelopeVerdict` | `main()` quorum loop and `unaddressedAboveFloor()`; one fix covers both |
| existing pins | `__tests__/scripts/check-refutation-verdicts.test.ts` (34), `__tests__/templates/check-refutation-verdicts-render.test.ts` (5): no change needed |
### 1.3 RED: new file `__tests__/scripts/refutation-verdict-type-2900.test.ts`
Copy `step1-c/red-2900.test.ts.txt` verbatim (88 lines; `npx eslint` exit 0). It spawns the real script on the
issue's fixture (`_300/refutation-required.json` with `skeptics:3`, and 3 envelopes). Cases: array ×3 → exit 1 with
`0 skeptic verdict(s), need >= 3`; number and object → the same (these pass at base, as guards); a control with 3 string `UPHELD` → exit 0.
```
RED   $ npx vitest run __tests__/scripts/refutation-verdict-type-2900.test.ts     # exit=1
      Tests 1 failed | 3 passed (4)
      × AC-1: array verdict x3 is rejected, not coerced — AssertionError: expected +0 to be 1
TRIAL $ (same, after 1.4 applied to both twins)                                   # exit=0
      Tests 4 passed (4) · check-refutation-verdicts.test.ts 34/34 · …-render.test.ts 5/5
```
### 1.4 GREEN pseudo-diff (both twins, identical)
```diff
-      .filter((r) => r['target'] === id && /^(UPHELD|REFUTED)$/.test(String(r['verdict'])))
+      .filter((r) => r['target'] === id && typeof r['verdict'] === 'string' && /^(UPHELD|REFUTED)$/.test(r['verdict']))
```
Docs: one line in `docs/design/agent-return-provenance.md` saying that a verdict must be the string UPHELD or REFUTED, and that any other type is not counted.
### 1.5 Verification (foreground)
§0 order, with the targeted step `npx vitest run __tests__/scripts/refutation-verdict-type-2900.test.ts
__tests__/scripts/check-refutation-verdicts.test.ts __tests__/templates/check-refutation-verdicts-render.test.ts`,
then `diff scripts/check-refutation-verdicts.mjs src/templates/scripts/check-refutation-verdicts.mjs.ejs` (empty), and
the issue reproduction (fixture from the issue body): the issue fixture must exit 1. Commit: `fix(refutation): count only string verdicts toward the skeptic quorum (#2900)`.
### 1.6 Premortem table
| Failure mode | Likelihood | Prevention |
|---|---|---|
| Only one twin edited | High | `diff` empty; bake changes java-spring-L3/L4 only if the `.ejs` changed |
| Regex tightened instead of a type check (`String()` stays) | Med | `typeof` guard; the RED array case fails otherwise |
| "Cleanup while in there" in `main`/`unaddressedAboveFloor` moves the complexity ratchet | Med | one-line diff; run the complexity gate |
| Snapshot hash not regenerated for the 2 L3/L4 lanes | Med | §0 bake order; list both in `files:` |
### 1.7 Reviewer threat model
(1) Every consumer routes through `envelopeVerdict`, and no second coercion path exists (`grep -n "String(r" scripts/check-refutation-verdicts.mjs`).
(2) Arrays, numbers, objects, null and nested arrays all count 0. (3) Valid string verdicts are unchanged (control, 34 existing).
(4) Twins are byte-identical, and exactly 2 snapshots are regenerated. (5) No change to exit codes or messages.
