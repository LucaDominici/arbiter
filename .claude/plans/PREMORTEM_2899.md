# Premortem — #2899 (required, R3-standard-multi-area)

## 1. #2899: premortem decision computed at read time

### 1.1 Plan (`.claude/plans/task-2899.md`), front matter
`pre-edit-plan-anchor` refuses **every** Edit/Write (even `/tmp`, #2913) until the plan has this
`context:` block (all 8 keys). Write the plan first.
```yaml
---
context:
  issue: '#2899'
  type: fix
  pipeline: 'plan → red → green → refactor → review → close'
  branch_convention: 'task/#2899-premortem-read-time'
  base_branch: main
  key_constraints:
    - 'Decision = evaluatePremortem(current manifest, treatment); never written to status.json'
    - 'No new export (publicApiSurface 1174/1174); complexity <= 10 per function'
  red_team_warnings:
    - 'Three readers of state.premortem: checkPremortemRequired, premortemFor, premortemLogSuffix'
  estimate: 'S'
files:
  - src/commands/task.ts
  - src/commands/task-ship.ts
  - src/commands/task-state.ts
  - __tests__/commands/ship-premortem-read-time-2899.test.ts
  - __tests__/commands/ship-premortem.test.ts
  - __tests__/commands/ship-review.test.ts
  - __tests__/commands/ship-stale-base-2875.test.ts
  - __tests__/commands/pr-merged.test.ts
  - docs/REFERENCE/plan-template.md
  - docs/REFERENCE/state-file.md
  - .claude/plans/PREMORTEM_2899.md
premortem: .claude/plans/PREMORTEM_2899.md
---
```
Ship will say `required R3-standard-multi-area`: as #2898/#2906 did, commit §1 of this file
(redacted, no workspace paths) as `.claude/plans/PREMORTEM_2899.md` in the plan commit.

### 1.2 Map (fc28e8aa)
| Symbol | Where | Today |
|---|---|---|
| `premortemFor` | task-ship.ts:1743 | `phase !== 'plan'` → returns persisted `state.premortem`; at plan writes `{premortem}` |
| `checkPremortemRequired` | task.ts:1660 (called by `assertReviewSubjectFrozen` :1579) | trusts `state.premortem.decision/.reason` |
| `premortemLogSuffix` | task.ts:902 (4 call sites at `complete`) | **3rd reader, not in the issue**: `premortem=<d> rounds=<n>` |
| `evaluatePremortem`, `readPlanManifest`, `parsePremortemRef` | ship-tier.ts:244/608, exported at :289 | pure; fail-closed: undefined treatment or empty manifest → `required` |
| `state.premortem` / `.treatment` | task-state.ts:176/158 | shallow-merged writes keep old keys; treatment stays persisted |
| `--premortem` | cli.ts:2288 → `TaskShipOptions.premortem` (task-ship.ts:543) | only honoured at the plan step |

### 1.3 `--premortem` decision (smallest option): persist the *input*, not the decision
The freeze runs in a later process (`lifecycle review-round` has no `--premortem`), so "same
invocation only" is fail-open; front matter collides with `premortem: <path>`. Chosen: optional
`premortemForced?: true` on `UnifiedTaskState`, written by `ship --premortem`, read by all consumers
as `{ force: true }`; sticky (fail-closed), no export, not a forbidden file. Trial GREEN typechecked.

### 1.4 RED: new file `__tests__/commands/ship-premortem-read-time-2899.test.ts`
Skeleton (coordinator RED skeleton) (176 lines, eslint-clean, copy verbatim): ship-review.test.ts harness
(plan with `files:` → TDD evidence → `green` → `ship({advance})` → `ship({reviewRound})`) plus a
stale `required/R7-empty-manifest` injected via `writeUnifiedState` (the pre-plan first `ship`).
- **AC-1** deterministic manifest (`src/commands/task-ship.ts`, `…/ship-tier.ts`) → freeze `not.toThrow()`.
- **AC-2** manifest `src/templates/hooks/pre-push.sh.ejs` (fixture string) → `toMatch(/R1-hooks-templates/)`.
- **AC-3** plan-step `ship` → no `premortem` in status.json; stale key + deterministic → no throw.
- GREEN-side additions: **AC-1b** `ship({premortem:true})` at plan, later freeze without the flag →
  throws `/PREMORTEM REQUIRED \(forced\)/`; **AC-3b** `premortemLogSuffix` ignores a stale key.

Executed in a throwaway worktree (fc28e8aa, node_modules symlinked, no build needed):
```
$ npx vitest run __tests__/commands/ship-premortem-read-time-2899.test.ts   # exit=1
× AC-1  expected [Function] to not throw an error but 'UserFacingError: PREMORTEM REQUIRED (…' was thrown
× AC-2  expected 'PREMORTEM REQUIRED (R7-empty-manifest…' to match /R1-hooks-templates/
× AC-3  expected { decision: 'required', …(7) } to be undefined
Tests  3 failed (3)
```
All three fail on the bug's assertion, not on imports. After the RED commit (`npm run build` first):
`node dist/cli.js lifecycle record-red --task '#2899' --test-path __tests__/commands/ship-premortem-read-time-2899.test.ts --test-command npx --test-arg vitest --test-arg run --test-arg __tests__/commands/ship-premortem-read-time-2899.test.ts`

### 1.5 GREEN pseudo-diff
```ts
// task-state.ts (UnifiedTaskState): keep `premortem?` (tolerated legacy key, never read)
+  /** #2899 — `ship --premortem` was given; the decision itself is never stored. */
+  premortemForced?: true

// task.ts: one private helper shared by the two task.ts readers
+function currentPremortem(dir: string, state: UnifiedTaskState | null): PremortemDecision | null {
+  if (state?.treatment === undefined) return null      // not ship-driven: no decision (as before)
+  const manifest = state.plan.length > 0 ? [...(readPlanManifest(dir, state.plan) ?? [])] : []
+  return evaluatePremortem(manifest, state.treatment, state.premortemForced ? { force: true } : {})
+}
 function checkPremortemRequired(dir) {
   const state = readUnifiedState(dir)
-  if (state?.premortem?.decision !== 'required') return
+  const decision = currentPremortem(dir, state)
+  if (decision?.decision !== 'required') return
   … unchanged ref check …
-  const rule = state.premortem.reason
+  const rule = decision.reason
 function premortemLogSuffix(dir) {
-  if (!state?.premortem) return ''
-  return ` premortem=${state.premortem.decision} …`
+  const decision = currentPremortem(dir, state); if (!decision) return ''
+  return ` premortem=${decision.decision} rounds=…`
// import: add evaluatePremortem (+ type PremortemDecision) to the existing ship-tier import line

// task-ship.ts premortemFor: print-only, never reads or writes state.premortem
-  if (phase !== 'plan') return state?.premortem
+  // hasShipLifecycleMutation (task-ship.ts:1623) must include opts.premortem: today a bare
+  // `ship --premortem` is a read-only request and never reaches premortemFor
+  if (opts.premortem && state?.premortemForced !== true) writeUnifiedState(root, { premortemForced: true })
+  if (phase !== 'plan') return undefined
   const decision = evaluatePremortem(manifest, treatment,
-    opts.premortem ? { force: true } : {})
+    opts.premortem || state?.premortemForced ? { force: true } : {})
-  if (JSON.stringify(state?.premortem) !== JSON.stringify(decision)) writeUnifiedState(…)
   return decision
```
The `treatment === undefined → null` guard is required: without it the trial GREEN made every
non-ship `lifecycle review-round` fail closed. Docs: plan-template.md §Premortem (computed at read
time, never stored, `--premortem` → `premortemForced`); state-file.md (legacy key ignored).
pr-merged.test.ts:530-548 injects `premortem`; rewrite with a real manifest. Force reason is `forced`.

### 1.6 Fixture blast radius (trial GREEN; commands + coverage suites, 2623 tests)
Without fixture edits ship-review.test.ts alone had 36 failures (plans without `files:` → R7). With
`---\nfiles:\n  - review.test.ts\n---\n` added to its shared plan fixtures (:176, :725), 11 remain,
all expected: ship-review 8 (3 more R7 fixtures, 3 sensitive → R4, the #2890 AC-3 block injecting
`premortem` at :293-352), ship-stale-base-2875 2 (R7), ship-premortem :144 (`toBeUndefined()` now).
Fix: manifests for R7 fixtures, a `PREMORTEM_*` path for R4 ones, and `required` via a real hooks
manifest or `ship({premortem:true})`, never an injected key. Never weaken an assertion.

### 1.7 Local verification (foreground, in order)
```
npx vitest run __tests__/commands/ship-premortem-read-time-2899.test.ts   # 5/5 green
npx vitest run __tests__/commands/ship-premortem.test.ts __tests__/commands/ship-review.test.ts \
  __tests__/commands/ship-stale-base-2875.test.ts __tests__/commands/pr-merged.test.ts
npm run typecheck && npm run lint
node scripts/debt-report.mjs --gate --only-metric publicApiSurface       # must stay 1174
node scripts/debt-report.mjs --gate --only-metric complexityViolations   # must stay <= 226
npx vitest run __tests__/commands __tests__/coverage                     # 0 failures
node scripts/check-all.mjs L1
node scripts/check-all.mjs L2          # builds dist; docs gate, duplication, fail-closed, coverage
```
Commit: `fix(ship): compute the premortem decision at read time (#2899)`; body lines ≤ 100.

### 1.8 Premortem table
| Failure mode | Likelihood | Prevention |
|---|---|---|
| A reader still trusts the stale key (`premortemLogSuffix` missed) | High | grep `\.premortem\b` in src/ must hit only the type; AC-3b test |
| Force lost across processes (fail-open) | High | `premortemForced` boolean; AC-1b test |
| Non-ship tasks now refused at the freeze (undefined treatment → required) | High (seen in trial) | `treatment === undefined → null` guard |
| Writer "fixes" 11 red tests by weakening assertions or deleting the #2890 block | Med | §1.6 recipe; reviewer diffs every changed `expect` |
| Print and freeze disagree (resolved vs persisted treatment) | Med | both use `evaluatePremortem`; freeze uses `state.treatment`, which `persistShipTreatment` rewrites on every ship call |

### 1.9 Reviewer threat model
(1) No `state.premortem` read is left (`grep -n "\.premortem\b" src`); a stale key flips nothing.
(2) `--premortem` at plan still blocks a later freeze in a new process. (3) A task with no treatment
never newly blocks. (4) Empty-manifest fail-closed still holds at the freeze (no fail-open).
(5) Fixture edits add manifests and relax no claim. (6) The log suffix stays for ship-driven tasks.

