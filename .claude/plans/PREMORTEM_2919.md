# Premortem #2919 — gate-mutex "ONE lock path" 30 s CI timeout (PR #2923 @ fd345dbe)

Class: `required R4-sensitive`, vertical `concurrency`. Read-only premortem, 2026-09-26. origin/main = `1d58be09`.
CI evidence: run 36204059653 attempt 1, job "Full Gate (L2, INV-59)": `Error: Test timed out in 30000ms` at
`gate-mutex.test.ts:90`; suite 267.6 s wall / 891.65 s test time, 1145 files. The test body is fully **synchronous**
(`execFileSync` ×3 + `gateLockPathFor` ×2), so vitest can only report the timeout after the body returns: real
wall time ≥30 s was spent inside those sync git spawns. No child hung forever (the worker would have stalled instead).

## 1. Does the hermetic env weaken what the tests prove?
- No new vacuity from the fixture change. `hermeticGit` affects only fixture setup (init/commit/worktree add); a
  failed setup still throws, so a broken fixture fails the test rather than passing it. The assertion still calls the real
  `gateLockPathFor` (`scripts/lib/gate-mutex.mjs:70-71`, `git rev-parse --git-common-dir`), and that call is unchanged.
- Existing hole, kept as-is: `gateLockPathFor` still inherits `process.env`. Measured on fd345dbe:
  `GIT_DIR=<arbiter>/.git npx vitest run gate-mutex.test.ts -t 'ONE lock path'` → **exit 0, 1 passed**. Both sides then
  resolve the *parent's* common dir, so the equality passes without testing anything. Before the PR the same env also
  passed vacuously and was worse, because the fixture wrote into the parent repo. Nothing asserts that the path is the fixture's own.

## 2. Is the lead credible for CI? — **No**
- The CI Full Gate is `node scripts/check-all.mjs L2 --json gate-result.json` (`.github/workflows/01-pr-fast.yml:431`), a plain
  step. No git hook is on the path, so git exports no `GIT_*` to it.
- `scripts/check-all.mjs` exports no `GIT_*`/`GIT_CONFIG_*`/`core.hooksPath`. Its only env handling is reading
  `ARBITER_HOOK_GIT_CWD` (:239, used as `cwd` at :350/:356/:497/:513), `CI`/`GITHUB_ACTIONS` (:146-147, :343),
  `ARBITER_SELECTIVE_GATE` (:344), and `VITEST_ROOT` for '#' paths (:311-319). None of these reaches git config.
- `core.hooksPath=.githooks` is set by `package.json:86` `prepare` in the checkout's **local** config. A fixture made
  with `git init` in `os.tmpdir()` has its own `.git` and never reads that config, so the repo's hooks cannot run there.
- The local pre-push path is scrubbed too: `.githooks/pre-push:22` and `.githooks/pre-commit:22`
  `unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR`. pre-push:242 then passes only
  `ARBITER_HOOK_GIT_CWD` into `gate-mutex.mjs run … check-all.mjs preflight`. The one leak still open is
  `GIT_CONFIG_PARAMETERS`/`GIT_CONFIG_COUNT` from a user's `git -c … push`. That is local only and does not happen in CI.
- The RED reproduces a *constructed* hostile env, not the CI env. The fix is therefore sound hardening that probably will not cure the CI failure.
- Other plausible 30 s causes, most likely first:
  (a) **Fork/exec starvation under the L2 fork pool**: 3 sync git + 2 rev-parse spawns from a large Node worker, competing
  with subprocess-heavy siblings (coverage on; 891 s of test time in 267 s of wall time means the pool was heavily oversubscribed).
  (b) **tmpdir/disk I/O load**: `mkdtemp`, `realpathSync`, `worktree add` checkout, and fsync on a runner disk shared by
  ~1145 files that make temp repos.
  (c) Leftover `flock`/holder processes from other files (e.g. the 8 s holders in this file's later tests) adding CPU
  pressure. This is not lock contention: the test takes no flock.
  (d) Git auto-maintenance/`gc --auto` on commit. Unlikely for an empty repo.
- Consequence: AC-1 ("never depends on the 30 s default under contention") is **not met**. The PR says "No timeout
  raised", and AC-2 was measured only on an unloaded machine.

## 3. Is the RED file sound? — Fails for the stated reason, with two defects
Commands (temp detached checkouts, `node_modules` symlinked from `/home/luca/work/repos/arbiter/node_modules`):
```
git fetch -q origin main                                              # exit 0
git worktree add -q --detach /tmp/prem-2919-main 1d58be09             # exit 0
git worktree add -q --detach /tmp/prem-2919-fix  fd345dbe             # exit 0
cp <wt>/__tests__/scripts/gate-mutex-hermetic-2919.test.ts /tmp/prem-2919-main/__tests__/scripts/   # exit 0
ln -s /home/luca/work/repos/arbiter/node_modules /tmp/prem-2919-{main,fix}/node_modules              # exit 0, 0
(main) npx vitest run __tests__/scripts/gate-mutex-hermetic-2919.test.ts  # exit 1: line 46 existsSync(marker) true≠false (hooks ran)
(fix)  npx vitest run __tests__/scripts/gate-mutex-hermetic-2919.test.ts  # exit 0: 1 passed
(fix)  npx vitest run __tests__/scripts/gate-mutex.test.ts -t 'NO SUCH TEST'   # exit 0: 17 skipped  <- vacuity probe
(fix)  GIT_DIR=<arbiter>/.git npx vitest run …gate-mutex.test.ts -t 'ONE lock path'  # exit 0 <- see §1
git -C arbiter branch --list wt                                       # exit 0, empty (parent not polluted)
git worktree remove --force /tmp/prem-2919-main ; …-fix ; git worktree prune   # exit 0, 0, 0; list shows none
```
- Defect R1: if the target test is renamed, `-t` matches nothing, the inner vitest exits 0, no hook runs, and the RED
  **passes vacuously**. It should also assert that the inner stdout matches `/1 passed/`.
- Defect R2: the RED spawns a full nested `npx vitest` inside a sync test that runs under the default 30 s `testTimeout`.
  Under the same L2 load it can **reproduce #2919 in a new file**. It needs an explicit per-test timeout, or it should
  call `git` directly with the hostile env instead of nesting vitest.

## 4. Premortem table
| Failure mode | Likelihood | Prevention |
|---|---|---|
| Merged, CI stall recurs (the lead is not the CI cause) | High | Give the test an explicit timeout justified by measurement (AC-1); keep the issue open until 20 loaded runs are green |
| New RED file times out under L2 (nested vitest) | Med | Explicit timeout, or test `hermeticGit`-style git directly without nesting |
| RED passes vacuously after a rename | Med | Assert that the inner stdout contains `1 passed` |
| Assertion vacuous under an inherited `GIT_DIR` | Low (hooks unset it) | Add a non-vacuity check: `rev-parse --git-common-dir` from `sub` equals `<dir>/.git` |
| AC-2 claimed from an unloaded machine | High | Measure under load (`stress-ng`, or `--pool=forks` alongside the full suite) or on the CI runner |
| Hermetic env hides a real prod bug in `gate-mutex.mjs` | Low | Prod code is untouched; the prod env inheritance is intentional |
Reviewer threat model: (1) a fix that looks causal but has no CI evidence, closing #2919 while the flake stays;
(2) green tests that stay green because they test nothing (R1, §1 GIT_DIR); (3) a new sync, subprocess-heavy test
added to the same loaded pool that caused the flake; (4) AC-2 evidence that does not match the "loaded runner" condition.

## 5. Verdict — **Proceed with named amendment "A-2919-bounded"**
Keep the hermetic hardening, but (i) measure the test's p99 under load and give it an explicit timeout (AC-1), and
record a loaded 20-run result (AC-2); (ii) RED: assert `/1 passed/` and add an explicit timeout; (iii) add the
common-dir non-vacuity assertion; (iv) reword the PR "Cause" as *hardening; CI cause unconfirmed*, and do not
close #2919 on merge (use `Refs #2919`) until a loaded measurement shows the stall is gone.
