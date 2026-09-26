# Premortem — #2910 (required, R3-standard-multi-area)

## 2. #2910: coded refusals (start from #2899's merge commit; re-run RED there)

**Plan** `.claude/plans/task-2910.md`: same `context:` block shape as the #2899 plan with `issue: '#2910'`,
`type: feat`, branch `task/#2910-coded-refusals`; `premortem: .claude/plans/PREMORTEM_2910.md`
(Ship will say `required R3`). `files:` `src/commands/task.ts`, `src/commands/task-ship.ts`,
`src/commands/pr-merged.ts`, `src/utils/error-catalog.ts`, `src/i18n/en.json`,
`__tests__/commands/coded-refusals-2910.test.ts`, `__tests__/i18n/_migration-inventory.json` (only
if `npm run check:i18n` demands it), `docs/REFERENCE/ship-driver.md`, both plan files. None forbidden.

**Map (fc28e8aa).** AC-1: `staleBindingMessage` task.ts:340, thrown as bare `Error` by
`assertNativeCheckoutIdentity` (:363; bindingId/worktreePath/branch) and
`assertNativeTranscriptAttestation` (:381; session) → cli.ts:2556 `Unexpected error:`. AC-2:
`qualificationPrerequisiteFailure` pr-merged.ts:202 (no SHAs) → `prGateRefusal` task.ts:848 →
`UserFacingError`, printed `Error: NOT MERGED — …` with no code and no catalog row. AC-3:
`closeAction` task-ship.ts:252 already names `scripts/pr-merge-watch.mjs <owner/repo> <pr>` for
`trunk-solo && pr-ff`, the only exact-pr route (Arbiter's profile). Peer-review/gated-review land
by a normal PR merge (`LANDING_CONTRACT`, a forbidden template), so do **not** widen it; AC-3 gets a
GREEN-side pin only. AC-4: `openExplicitReviewRound` task-ship.ts:1595 returns `{ plan }` silently
with no seat. `_writeArbiterError` prints `\nError [CODE]: msg` + `arbiter explain CODE`; exit 1.

**RED**, new file `__tests__/commands/coded-refusals-2910.test.ts` = the coordinator RED skeleton
(236 lines, eslint-clean; plan fixture carries `files:` so #2899's freeze cannot mask AC-4). Needs
`npm run build` (AC-5 spawns `dist/cli.js`). Executed in a throwaway worktree at fc28e8aa:
```
$ npm run build && npx vitest run __tests__/commands/coded-refusals-2910.test.ts   # build 0, exit=1
× AC-1  expected Error: native host binding is stale — run… to be an instance of ArbiterError
× AC-2  expected 'Merged PR head/merge refs do not matc…' to contain 'aaaa…'   (evaluateMerged)
× AC-4  expected 'Phase: refactor' to match /no reviewer/i
× AC-5  expected 'Unexpected error: native host binding…' not to contain 'Unexpected error:'
Tests  4 failed (4)
```
GREEN-side addition: **AC-5 for AC-2** via pr-merged.test.ts's `runTaskAdvance({to:'complete',readPrs})`
harness → `ArbiterError`, `code === 'E_PR_NOT_MERGED'`; **AC-3 pin**: trunk-solo/pr-ff at close
contains the lander (passes at base; keep it out of the RED file). Pin "stderr starts with" as
`stderr.trimStart()` matching `^Error \[E_…\]:` (renderer unchanged). `record-red` after the RED commit, with `--test-path` set to the RED file.

**GREEN pseudo-diff**
```ts
// task.ts
-function staleBindingMessage(taskId, worktree): string
+function staleBindingError(taskId, worktree, field: 'session'|'worktree'|'branch'|'task'): ArbiterError {
+  return ArbiterError.fromKey('E_STALE_HOST_BINDING', 'errors.E_STALE_HOST_BINDING', { field, taskId, worktree }) }
+function staleBindingField(bound, live) { worktreePath≠ → 'worktree'; branch≠ → 'branch'; else 'task' }
 assertNativeCheckoutIdentity:     throw staleBindingError(id, wt, staleBindingField(binding, live))
 assertNativeTranscriptAttestation: throw staleBindingError(id, wt, 'session')
 prGateRefusal: return ArbiterError.fromKey('E_PR_NOT_MERGED', 'errors.E_PR_NOT_MERGED', { detail })
// en.json E_STALE_HOST_BINDING: "native host binding is stale ({field} no longer matches) — run arbiter
//   lifecycle preflight --id '{taskId}' --worktree \"{worktree}\"" (worktree-adopt.test.ts:318-326 pins it)
// pr-merged.ts exact-pr branch:
+  return `Merged PR head ${candidate.headRefOid} ≠ merge commit ${candidate.mergeCommit.oid}: a merge-commit
+    merge cannot satisfy pr-ff completion; land with a fast-forward (scripts/pr-merge-watch.mjs).`
// error-catalog.ts: rows E_STALE_HOST_BINDING, E_PR_NOT_MERGED (code, summary, detail, recovery)
// openExplicitReviewRound no-seat branch: return { plan, note: t(…) or const }; ShipResult gets
//   `reviewNote?`; buildShipStepLines: note goes to lines[0], template still printed after it
```
AC-4 is a stdout line, not a throw (exit 0 unchanged). No new `export` line; `ArbiterError` extends `UserFacingError`, so
the rethrows at task.ts:951 and init.ts:241 still match.

**Verify (foreground, in order):** the new file → `npx vitest run __tests__/utils/errors.test.ts
__tests__/integration/worktree-adopt.test.ts __tests__/commands/pr-merged.test.ts
__tests__/commands/ship-review.test.ts __tests__/behavioral/help-surface.test.ts` →
`npm run typecheck && npm run lint && npm run check:i18n` → the two debt gates (`publicApiSurface`, `complexityViolations`) →
`npx vitest run __tests__/commands __tests__/integration` → `node scripts/check-all.mjs L1` → `L2`.

| Failure mode | Likelihood | Prevention |
|---|---|---|
| RED written against fc28e8aa lines after #2899 moved them | High | branch from #2899's merge; anchor by function name |
| Widening `closeAction` to peer-review (wrong lander) | Med | AC-3 is a pin, no code change |
| Reworded stale text breaks worktree-adopt.test.ts pins | High | keep the prefix and the exact preflight command |
| Raw string fails `check:i18n` (new refusal text outside `t()`) | Med | refusal text in en.json via `fromKey`; run check:i18n early |
| AC-4 note replaces the template (`reviewSummary` is exclusive with the panel) | Med | separate `reviewNote` field; test asserts template index > 0 |
| `buildActiveShipResult` (complexity 15) grows | Med | thread the note with one conditional spread; ratchet counts functions (stays 226) |

**Reviewer threat model** (sibling plain `Error`s task.ts:352/355/276 → PARKING, not converted): (1) does any path still reach `Unexpected error:` for a stale binding
(both throw sites, bindingId-only drift → `task`)? (2) are both SHAs real values from the snapshot,
and is the pr-ff sentence shown only for `exact-pr`? (3) does `arbiter explain E_…` resolve for both
new codes? (4) AC-3 is unchanged code: the PR says why
(pr-merge-watch is the only exact-pr route; widening would misroute peer-review repos)? (5) is the no-seat note printed only when nothing was
dispatched, never next to a real Codex/external seat? (6) `--json` output still valid?
