---
files:
  - .claude/hooks/lib.mjs
  - .claude/hooks/pre-spawn-worktree-guard.mjs
  - src/templates/claude/hooks/lib.mjs.ejs
  - src/templates/claude/hooks/pre-spawn-worktree-guard.mjs
  - packages/kernel/hooks/lib.mjs
  - examples/ts-library/.claude/hooks/lib.mjs
  - examples/ts-library/.claude/hooks/pre-spawn-worktree-guard.mjs
  - examples/go-library/.claude/hooks/lib.mjs
  - examples/go-library/.claude/hooks/pre-spawn-worktree-guard.mjs
  - examples/python-library/.claude/hooks/lib.mjs
  - examples/python-library/.claude/hooks/pre-spawn-worktree-guard.mjs
  - __tests__/hooks/empirical/pre-spawn-worktree-guard.test.ts
---

# #2489 — spawn-guard tombstone: close the residue

## Premise, corrected against the live tree

This issue's plan-review FAIL rejected the change **as written**: the producer recorded
`pid: process.pid` — the hook's own pid, dead the moment it is written — so pruning on liveness
would have emptied the sidecar on every dispatch and silently disabled a hard control.

That objection no longer holds on this tree. **#2588 (closed 2026-09-13) executed retargeting
option 1 from that same comment**: the producer now records a *session* pid, not the hook's.

- `.claude/hooks/pre-spawn-worktree-guard.mjs:38-49` — `sessionPid()` reads `CLAUDE_PID` and
  explicitly returns `undefined` when it names the hook itself (`process.pid`) or its launcher
  (`process.ppid`), so a transient pid is never recorded; such an entry stays age-only.
- `.claude/hooks/lib.mjs:611-631` — `pruneStaleSidecarEntries` prunes by TTL **and** on `ESRCH`
  only; `EPERM` and every other outcome keep the slot.
- Green on this HEAD: `npx vitest run __tests__/hooks/sidecar-liveness.test.ts
  __tests__/hooks/empirical/pre-spawn-worktree-guard.test.ts` — 2 files, 34 tests passed.

So AC-1, AC-2, AC-4 and AC-5 are already satisfied. This change closes the residue: AC-3's
recorded rationale, and the one surviving operator-facing defect from the issue thread.

## Acceptance criteria

- [ ] AC-1: an entry whose pid is no longer alive is pruned inside the TTL; the TTL stays the
      backstop when liveness cannot be determined. (satisfied by #2588 — verified, not re-built)
- [ ] AC-2: liveness is checked with `process.kill(pid, 0)` in a try/catch, never a real signal; a
      pid that cannot be checked falls back to the TTL. (satisfied by #2588 — verified)
- [ ] AC-3: pid reuse cannot resurrect an entry — either pair the pid with its start time, or
      record in the code why the reuse risk is tolerable. Closed here by the second branch: a
      reused pid can only make a dead entry probe alive, which keeps the entry until the TTL —
      the pre-existing fail-closed behaviour. Reuse cannot produce the dangerous direction (a live
      entry probing `ESRCH`), so no start-time pairing is added and the reasoning is written into
      `pruneStaleSidecarEntries`.
- [ ] AC-4: a test proves both directions — dead-pid pruned inside TTL, live-pid not pruned inside
      TTL. (satisfied by #2588 — `__tests__/hooks/sidecar-liveness.test.ts`)
- [ ] AC-5: the emitted twin is updated in the same change and the generated kernel copy is
      regenerated, never hand-edited.
- [ ] AC-6: when the guard refuses a dispatch because the sidecar is occupied, the stderr message
      names the sidecar path it actually read. Today it says "already active on the main working
      tree" while the blocking entry can live in a worktree sidecar, sending the operator to a
      file that reads `[]`. Added from the owner comment on this issue ("the guard's message
      should name the sidecar file it actually read"); that bad inference cost two refused
      dispatches in the recorded incident.

## Non-goals

- Not changing `SIDECAR_TTL_MS` or removing the TTL.
- Not fixing the `inWorktree` predicate (#2564).
- Not redesigning the sidecar record shape. No new field is added; entries already on disk keep
  their exact meaning.
- Not adding a dependency or a `ps` subprocess.
- Not touching `post-subagent-release.mjs` correlation.

## Files / contracts touched

See the `files:` manifest above. `lib.mjs` is rendered from `src/templates/claude/hooks/lib.mjs.ejs`
into `packages/kernel/hooks/lib.mjs` and the three examples; `pre-spawn-worktree-guard.mjs` is a
verbatim template copy present in `src/templates/` and the examples, but not in the kernel. Both
propagate through `npm run regen`.

## Proof

1. RED: a new case in `__tests__/hooks/empirical/pre-spawn-worktree-guard.test.ts` asserts the
   rejection stderr contains the sidecar path the hook read. Fails on current HEAD.
2. GREEN: guard message names `join(root, SIDECAR_PATH)`.
3. The 34 existing sidecar/guard tests stay green — no behaviour change to pruning.
4. `npm run regen` and `node scripts/check-all.mjs preflight` clean (twin/kernel/example parity).

## Rollback

Single revert of the PR merge commit. No state format change, no migration: the sidecar record
shape and prune semantics are untouched, so an old and a new hook interoperate on the same file.

## Smallest executable implementation

One comment paragraph in `pruneStaleSidecarEntries` (AC-3) plus one interpolated path in the
guard's rejection string (AC-6), mirrored into the template twins and regenerated.
