# Premortem — #2936 `crossModelReview` on Arbiter

Base `d70eb7c7`. Decision: AC-3 uses option B of §2.2 (orchestrator, within the owner decision of 2026-09-26, #2775).

### 2.1 Findings (d70eb7c7). The coordinator re-ran the RED, the defaults, `check-cross-model-review`, the degrade path, the Standard-only slot rule and the Q2 caller grep.
- **Q1 dispatch: yes, natively.** `openExplicitReviewRound` (`task-ship.ts:~1593`) calls `executeCodexReviewRound` whenever `configuredCodexSeat(profile, treatment)` holds. That requires the tier to have a slot: `externalSlotsForTier` gives only **Standard** a slot, and XS/S tiers get `REVIEW_ROUND_NO_SEAT`. `invokeExternalReview` (`external-review.ts:411-462`) runs `codex exec --strict-config --ephemeral --ignore-user-config -m <model> -c model_reasoning_effort="<effort>" -c shell_environment_policy.inherit="none" -c default_permissions="arbiter-cross-model-review" (extends ":read-only", filesystem :root=deny, :minimal=read, network.enabled=false) --skip-git-repo-check --output-schema <s> -o <out> -C <tmp sandbox> -`. The diff arrives on stdin (`cross-model-review.ts:41`). Codex writes only `-o` inside its temp dir. The envelope is recorded by `persistEnvelope` → `runCli('node', recorderArgs…, {cwd: repoRoot})` (`external-review.ts:470-490`) in the **Arbiter parent process**.
- **Q2 `reviewedTree`: does not apply to the seat.** Coordinator grep: the `evidenceStaleness` callers are `check-acceptance.mjs:575`, `check-cross-model-review.mjs:362,460` and `check-review-completion.mjs:733,862`, all host-side scripts. `evidence-binding.mjs:132` is reached only through `sourceChange`/`evidenceStaleness`, called by `task.ts` round open/complete and `check-cross-model-review.mjs`. Both are host-side with a writable `.git`. Codex runs with `-C` on a temp dir, with the repo denied, and executes nothing from `scripts/`. The #2926 caveat applies only to a verifier that runs `record-agent-return` *inside* a sandbox (the Opus fallback path), not to this seat.
- **Q3 `onUnavailable: degrade` does not degrade on the ship path.** Any non-fulfilled result, and any thrown error, becomes `FatalError('E_REVIEW_NO_DATA', "review round N: Codex reviewer returned no data (<reason>); no envelope was written and the round remains open")` (`task-ship.ts:1434-1438`, `:1487`, `:1497`). It is coded (not `Unexpected error`), but it **names no fallback**, so **AC-3 is unmet as written**. With `fail`, the plain `Error` at `external-review.ts:760-767` is re-wrapped by the same catch. The standalone `arbiter cross-model-review` throws a plain `Error` (`cross-model-review.ts:51-55`), outside the ship path.
- **Q4 Codex CLI:** `codex exec --ignore-user-config -s read-only -m gpt-6-luna -c model_reasoning_effort=low "reply OK"` → exit 0, `OK` (codex-cli 0.157.0). This was the simple probe. The seat's full argv (custom permission profile, `--strict-config`, `--output-schema`, stdin) has **not** been run live. That is the first live-proof item.
- **Gate side effect:** `check-cross-model-review.mjs` stops SKIPping and exits 1 with no active task (`FAIL: enabled crossModelReview has no task id in .claude/.task/status.json`, measured). It is wired `kind: warn` (`check-all.mjs:925`), so every task-less `check-all` on main shows a new **WARN**, not a block. `--require-fulfilled` is used only by the retry path, so later PRs do not need an envelope to pass gates. Trial GREEN: `check-self-dogfood` 0, `examples:check` 0. Bake, examples and `.dogfood-divergences` do not read Arbiter's `arbiter.json`. No test pins its absence.
- Defaults (#2905): `external-review.ts:334-335` `gpt-6-luna` / `max`; `schema.ts:83-90` `DEFAULT_CROSS_MODEL_REVIEW`. Keep `max`. There is no reason to deviate: low effort is only for the probe.
- Counters: 0 CLI options, 0 new `E_` codes (it reuses `E_REVIEW_NO_DATA`), C7 unchanged (the orchestrator runs ship). Config-only: `src/` Δ 0. Option B: `src/` +1/−1.
### 2.2 Owner decision needed before GREEN (AC-3)
- **A (config-only):** re-scope AC-3 to "coded `E_REVIEW_NO_DATA`, never `Unexpected error`; the orchestrator runs the verifier". AC-3 is then already true on base, so it gets no RED.
- **B (recommended, +1/−1 src):** append `; fall back to an independent verifier` to the `noReviewData` message. Keep the text model-neutral: it is public source. The writer asserts `/fall back to an independent verifier/`. The measurement used `…independent Opus verifier` in both the message and the regex, and the neutral string itself was **not** run: the added assertion fails on base (`expected [Function retry] to throw error matching /fall back to an independent … verifier/`, `Tests 1 failed | 64 skipped`, exit 1). With the trial message, all of `ship-review.test.ts` passes (`Tests 65 passed (65)`, exit 0). eslint 0 errors (pre-existing sonarjs warning at :847). Prettier is clean. The case lives in `ship-review.test.ts` (its fake-codex `retryWithFailingCodex` harness is file-local). **Gap:** `record-red` takes one `--test-path`, which is the config RED, so the AC-3 assertion never enters `.arbiter/evidence/tdd/#2936.json`. Record the base failure of the ship-review case in the PR body. B adds a `src/` diff, so the docs gate needs a `docs/` line, or the repo's `[skip-docs]` precedent.
### 2.3 Plan `.claude/plans/task-2936.md` front matter
```yaml
---
context:
  issue: '#2936'
  type: chore
  pipeline: 'plan → red → green → refactor → review → close'
  branch_convention: 'task/#2936-cross-model-review-on'
  base_branch: main
  key_constraints:
    - 'Owner consent 2026-09-26 (#2775): diff egress to OpenAI for Arbiter only; no template or consumer-default change'
    - 'Every CrossModelReviewConfig field explicit; model/effort = #2905 defaults gpt-6-luna/max'
  red_team_warnings:
    - 'degrade throws E_REVIEW_NO_DATA and leaves the round open; it does not auto-fall back (AC-3, owner option A/B)'
    - 'Only Standard-tier rounds get a Codex slot; XS/S rounds prove nothing'
  estimate: 'XS'
premortem: .claude/plans/PREMORTEM_2936.md
files:
  - .claude/plans/task-2936.md
  - .claude/plans/PREMORTEM_2936.md
  - arbiter.json
  - __tests__/config/arbiter-json-cross-model-review-2936.test.ts
  - src/commands/task-ship.ts              # option B only
  - __tests__/commands/ship-review.test.ts # option B only
  - .arbiter/evidence/tdd/#2936.json
---
```
### 2.4 RED `__tests__/config/arbiter-json-cross-model-review-2936.test.ts`
The field map is `satisfies Record<keyof Required<CrossModelReviewConfig>, true>`, so it cannot go stale. There are 5 cases: schema-valid (a guard, passes on base), block present, enabled+consent, exact key set, model/effort. `record-red`: `npm run build && node dist/cli.js lifecycle record-red --task '#2936' --test-path __tests__/config/arbiter-json-cross-model-review-2936.test.ts --test-command npx --test-arg vitest --test-arg run --test-arg __tests__/config/arbiter-json-cross-model-review-2936.test.ts`
| State | Result |
|---|---|
| base | exit 1, `Tests 4 failed \| 1 passed (5)`: × has a crossModelReview block, × enabled+consent, × declares every field explicitly, × #2905 defaults |
| enabled+consent+4 schema fields, model/effort implicit | `2 failed \| 3 passed`: × declares every field, × #2905 defaults |
| full GREEN | exit 0, `Tests 5 passed (5)` |
### 2.5 GREEN
```json
"crossModelReview": { "enabled": true, "diffEgressConsent": true, "providers": ["codex"],
  "slots": { "codeReview": 1, "redTeamReview": 0 }, "timeoutMs": 900000, "onUnavailable": "degrade",
  "model": "gpt-6-luna", "effort": "max" }
```
Then run `npx prettier --write arbiter.json`, because a `JSON.stringify` insert fails `prettier --check` (measured). Option B: the one-line message change from §2.2. Verification (foreground): `npm run build` → the two RED/target vitest files → `npm run typecheck && npm run lint` → `npx prettier --check arbiter.json` → `node scripts/check-self-dogfood.mjs` → `npm run examples:check` → (B only) the debt gates → `npx commitlint --from origin/main --to HEAD` → `node scripts/check-all.mjs L1` (expect the new cross-model WARN only).
### 2.6 Live proof (AC-2, AC-3; orchestrator, first real Standard-tier round after merge)
1. `codex login status` and the §2.1 probe. 2. In the delivery worktree: `node dist/cli.js ship --review-round`, with the task's usual flags, on a Standard-tier task. Expect `review round N: <verdict>`, with no hand-written envelope. 3. Evidence: `.arbiter/evidence/agent-returns/_<id>/codex-reviewer-*.json` and `.arbiter/agents-dispatched/_<id>.json` (codex-reviewer entry). Grep the run log for `Unexpected error` (expect 0). 4. AC-3: rerun with Codex made unavailable, e.g. `PATH=<dir without codex> node dist/cli.js ship --review-round --retry…`. Expect `E_REVIEW_NO_DATA … remains open` (+ the fallback wording under B), then dispatch the independent verifier as today. Record both outputs on #2936 and in CAMPAIGN_STATE.
### 2.7 Premortem table
| # | Failure | L | Guard |
|---|---|---|---|
| 1 | AC-3 closed on a false claim ("degrade names the fallback") | H | Owner picks §2.2 A or B before GREEN |
| 2 | Live proof run on an XS/S task, so no seat and a false "not dispatched" | M | Standard tier only |
| 3 | Full seat argv fails live (profile or `--output-schema` rejected by codex 0.157), and every round stops | M | §2.6 step 1-2 on #2932's round, before the metric window |
| 4 | WARN noise on task-less `check-all` gets read as a regression | M | State it in the PR body |
| 5 | Writer lowers effort or changes the model "for cost" | L | RED case 5 pins `max`/`gpt-6-luna` |
| 6 | Writer touches `DEFAULT_CROSS_MODEL_REVIEW` or templates | L | AC-4, RED on `arbiter.json` only |
### 2.8 Reviewer threat model
The PR body cites the owner's consent (#2775, 2026-09-26). The diff is `arbiter.json` only (plus option B's one line). No `src/config` or template change. No second `E_` code. The RED was recorded before `arbiter.json` changed. AC-2/AC-3 are marked "live proof pending" until §2.6 evidence exists.

