# Premortem — arbiter #2926: one "reviewed source changed" verdict

## 1. Decision: one predicate, owned by the completion binding, and the opener asks it
- `src/` cannot import `scripts/lib` (not in `files`, and #2328 says the engine keeps its own copy only for PASS gates).
  Precedent #2858: the opener already asks `check-review-completion.mjs --correlated-sha=<sha>` for the
  round verdict. **Extend that answer with `sourceChanged` (= `evidenceStaleness(repoRoot, sha) !== null`)
  and delete `reviewedSourceChanged`.** One helper, two callers, no parity test.
- AC-2 rule, inside `sourceChange`: compare HEAD with `reviewedTree(sha)`: `sha` merged with
  `merge-base(HEAD, origin/main)` via `git merge-tree --write-tree` (git ≥ 2.38). No `origin/main`, or the base is already
  in `sha` → `sha` itself (today's rule). merge-tree exit 1 (conflicts) → the tree with markers is compared, so a
  conflicted source path counts as changed. Exit ≥ 2 → "cannot compare", which fails closed.
- An old checker without `sourceChanged` → `staleReviewChecker` throws and names `arbiter update` (#2858 contract).

## 3. Plan `.claude/plans/task-2926.md` front matter (write it first; the plan-anchor hook refuses edits until it exists)
```yaml
---
context:
  issue: '#2926'
  type: fix
  pipeline: 'plan → red → green → refactor → review → close'
  branch_convention: 'task/#2926-shared-source-binding'
  base_branch: main
  key_constraints:
    - 'One predicate: evidence-binding sourceChange; opener reads it via the --correlated-sha answer'
    - 'Twins byte-identical (scripts ↔ src/templates/scripts); complexity <= 10 (scripts count)'
  red_team_warnings:
    - 'Base content = merge-base(HEAD, origin/main) only; a merged non-main branch still counts'
    - 'Two query-shape pins gain sourceChanged; never loosen them to toMatchObject'
  estimate: 'S'
premortem: .claude/plans/PREMORTEM_2926.md
files:
  - .claude/plans/task-2926.md
  - .claude/plans/PREMORTEM_2926.md
  - __tests__/commands/review-source-binding-2926.test.ts
  - scripts/lib/evidence-binding.mjs
  - src/templates/scripts/lib/evidence-binding.mjs.ejs
  - scripts/check-review-completion.mjs
  - src/templates/scripts/check-review-completion.mjs.ejs
  - src/commands/task.ts
  - src/commands/ship-review.ts
  - __tests__/scripts/check-review-completion.test.ts
  - __tests__/commands/review-sidecar-per-task-2912-green.test.ts
  - docs/internal/ADR/116-evidence-content-binding-train-ceremony-pr-ownership.md
  - examples/go-library/scripts/lib/evidence-binding.mjs
  - examples/go-library/scripts/check-review-completion.mjs
  - examples/go-library/.arbiter-generated-manifest.json
  - examples/python-library/scripts/lib/evidence-binding.mjs
  - examples/python-library/scripts/check-review-completion.mjs
  - examples/python-library/.arbiter-generated-manifest.json
  - examples/ts-library/scripts/lib/evidence-binding.mjs
  - examples/ts-library/scripts/check-review-completion.mjs
  - examples/ts-library/.arbiter-generated-manifest.json
  - .arbiter/evidence/tdd/#2926.json
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
  - __tests__/integration/e2e/bake/__snapshots__/ts-codex-only.json
  - __tests__/integration/e2e/bake/__snapshots__/ts-frontend-spa.json
  - __tests__/integration/e2e/bake/__snapshots__/ts-library.json
  - __tests__/integration/e2e/bake/__snapshots__/vue-frontend-spa.json
---
```

## 4. RED: new file `__tests__/commands/review-source-binding-2926.test.ts`
Copy `step1-e/red-2926.test.ts.txt` verbatim (183 lines; eslint reports no errors). The harness is `ship-review.test.ts` #2850 D6: the real
checker is copied in, and a PASS panel is recorded at `reviewed`. `mergeMain()` merges a main-only commit. AC-2: query `false`, no
"source changed since", opener `{rounds:1}`. AC-3 (#2908): test-only commit then merge → query `true`, completion
"source changed since", opener round 2. Both sides are asserted on the same fixture (AC-1).
```
RED (d380fa35, measured): npx vitest run __tests__/commands/review-source-binding-2926.test.ts
 × AC-2: merging main after a PASS round changes neither verdict
   AssertionError: expected undefined to be false  (:167 query(reviewed)['sourceChanged'])
 × AC-3: #2908 sequence (test-only commit, then merge main) is changed for both sides
   AssertionError: expected undefined to be true   (:178)
 Tests  2 failed (2)   EXIT=1
TRIAL GREEN (§5 applied in the same scratch checkout):
 Test Files  1 passed (1)   Tests  2 passed (2)   EXIT=0
```
Reason: the query carries no shared verdict (AC-1). Expected, not measured: on the base, AC-2's completion leg would fail too (plain diff).
`record-red` (after the RED commit, `npm run build` first):
`node dist/cli.js lifecycle record-red --task '#2926' --test-path __tests__/commands/review-source-binding-2926.test.ts --test-command npx --test-arg vitest --test-arg run --test-arg __tests__/commands/review-source-binding-2926.test.ts`

## 5. GREEN pseudo-diff (trial-applied; `cp` each script onto its `.ejs` twin, which is byte-identical today)
```diff
# scripts/lib/evidence-binding.mjs  sourceChange()
+  const reviewed = reviewedTree(root, sha)
+  if (reviewed === null) return `cannot compare the tree against ${short(sha)}`
-  const diff = git(root, ['diff', '--quiet', sha, 'HEAD', ...
+  const diff = git(root, ['diff', '--quiet', reviewed, 'HEAD', ...
+/** #2926 — sha merged with the base content HEAD already carries; only branch-authored changes count. */
+function reviewedTree(root, sha) {
+  const base = git(root, ['merge-base', 'HEAD', 'origin/main'])
+  if (base.status !== 0) return sha
+  const baseSha = String(base.stdout).trim()
+  if (git(root, ['merge-base', '--is-ancestor', baseSha, sha]).status === 0) return sha
+  const merged = git(root, ['merge-tree', '--write-tree', sha, baseSha])
+  if (merged.status !== 0 && merged.status !== 1) return null
+  return String(merged.stdout).split('\n')[0].trim()
+}
# scripts/check-review-completion.mjs  reportCorrelated()
+  const sourceChanged = evidenceStaleness(repoRoot, correlatedSha) !== null
-  process.stdout.write(`${JSON.stringify({ envelopes, seats })}\n`)
+  process.stdout.write(`${JSON.stringify({ envelopes, seats, sourceChanged })}\n`)
# src/commands/ship-review.ts  ReviewRoundEnvelope
+  /** #2926 — check-review-completion's content-binding verdict for `sha` against HEAD. */
+  sourceChanged?: boolean
# src/commands/task.ts
-    sourceChanged: reviewedSourceChanged(dir, previous.lastReviewedSha),
+    sourceChanged: latestReviewerEnvelope?.sourceChanged !== false,
-function reviewedSourceChanged(...) { runCli('git', ['diff', ...]) ... }        # deleted whole
-  const envelopes = correlatedReviewEnvelopes(...)  → const { envelopes, sourceChanged } = ...
-  return ... { sha: frozenSha, findings }           → { sha: frozenSha, findings, sourceChanged }
 correlatedReviewEnvelopes(): returns { envelopes, sourceChanged }; its JSON parse is extracted to
+function parseCorrelatedAnswer(stdout)  # complexity 11 → split; throws staleReviewChecker unless
+                                        # sourceChanged is boolean
# pins: check-review-completion.test.ts:240 → {..., sourceChanged: true} (deadbeef does not resolve)
#       review-sidecar-per-task-2912-green.test.ts:186 → {..., sourceChanged: false}
# docs: ADR 116 — one paragraph: base-merged content is not a source change; one predicate, opener queries it.
```
Also update the stale comments in `ship-review.ts:93` and `check-review-completion.mjs` `queryCorrelated` ("reviewedSourceChanged decision").

## 6. Verification (foreground, in this order; step1-b3b §0)
1. `npx vitest run __tests__/commands/review-source-binding-2926.test.ts` → RED as in §4; commit; `npm run build`; `record-red`.
2. GREEN, then `npm run build && npx vitest run __tests__/commands/review-source-binding-2926.test.ts __tests__/scripts/check-review-completion.test.ts __tests__/scripts/evidence-binding.test.ts __tests__/commands/ship-review.test.ts __tests__/commands/review-sidecar-per-task-2912*.test.ts __tests__/commands/task-advance-gates.test.ts __tests__/commands/task-ship.test.ts __tests__/scripts/check-agent-return.test.ts __tests__/integrations/external-review.test.ts`
   (trial: 7 command files 194/194 after the 2 pins; the scripts batch was green except the :240 pin).
3. `npm run typecheck && npm run lint`; `npx eslint src scripts --rule 'complexity: [error, 10]'` → **226** (trial: 226 → 226).
4. publicApiSurface: `git ls-files 'src/**' | grep -E '\.m?ts$' | xargs cat | grep -c '^export'` → **1174** (limit 1174;
   trial unchanged: no new `export` line, only a field added to an existing interface).
5. `npm run examples:regenerate && npm run examples:check`; `node scripts/check-self-dogfood.mjs`.
6. `BAKE_UPDATE_SNAPSHOTS=1 npm run test:e2e:bake` then `npm run test:e2e:bake`; add each regenerated path to `files:`; commit the snapshots **last**.
7. Docs gate: the ADR 116 edit covers the `src/` diff. `npx commitlint --from origin/main --to HEAD` (header and body lines ≤ 100).
8. `node scripts/check-all.mjs L1` → `L2` once. Before the review round: `grep -n "review round" <ship output>` (the #2908 lesson: do not `tail`).

## 7. Premortem table
| # | Failure | Likelihood | Guard |
|---|---|---|---|
| 1 | Unpinned query-shape fakes break (`toEqual({envelopes,seats})`) | High (2 found) | Step 2 runs the listed files; `grep -rn "seats: {}" __tests__` |
| 2 | Consumer repo keeps an old checker → opener throws `staleReviewChecker` | Med | Intended (#2858); message names `arbiter update`; examples regenerated |
| 3 | git < 2.38 (no `merge-tree --write-tree`) → exit 129 → "cannot compare" after any merge of main | Low | Fails closed (re-review); state it in the ADR |
| 4 | `.arbiter` conflicts in merge-tree mark exit 1 | High | Accepted: excluded paths are not diffed; only source conflicts count |
| 5 | Other `evidenceStaleness` consumers (cross-model, acceptance, agent-return, stop hook) inherit the rule | Certain | Intended. Trial: 22 consumer files, 647 pass; the 11 failures (build-kernel-plugin, check-self-dogfood, cross-model-review CLI) also fail on the base without `dist/` |
| 6 | Twin drift | Med | `cp` script → `.ejs`; `diff` both pairs = empty |
| 7 | Writer "fixes" the `task.ts:1506` short-circuit here | Med | Out of scope (§0): follow-up issue |
| 8 | Conflict with #2928 (`task.ts`) or #2913 (bake snapshots) | Med | Later lander merges main, then rebakes; snapshots committed last |
| 9 | `dim-render`/`global-kit-render` fail in the scratch checkout | n/a | They fail on d380fa35 without the change (missing `src/kit/derived.json` before build) |

## 8. Reviewer threat model
- **Forged base**: a local `refs/remotes/origin/main` pointing at an unreviewed commit exempts its content. The trust level
  is the same as the in-tree checker, and `#2875` fetches origin/main before a round. The reviewer should confirm that no fetch is added to the lib, which would make it slow and network-dependent.
- **Merged side branch**: only `merge-base(HEAD, origin/main)` is exempt. A merged feature branch still counts. AC-3's test-only commit must count.
- **Fail-open drift**: every git error must return a reason (lib) or `true`/throw (opener). `sourceChanged` missing must throw, not default.
- **Scope creep**: `task.ts` changes stay inside the review-round functions. `checkBakeAfterTemplates` must not be touched (#2928).
- **Vacuous RED**: both cases assert the opener's state and the completion output, not only the query field.
