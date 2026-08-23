---
title: 'Reference: Wave Primitives (gate-exec, symlink-children, prune --stale)'
doc_version: '1.0.0'
status: active
last_review: '2026-07-10'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: ['103-worktree-parallel-carveout']
---

# Reference: Wave Primitives (gate-exec, symlink-children, prune --stale)

> **ADR:** ADR-103 (worktree-isolated parallel execution carve-out)
> **Consumer:** the `wave-drain` skill / `/drain` command (multi-agent waves)
> **Boundary:** these are deterministic **leaf primitives** — no orchestration state, no
> issue awareness. The multi-issue decision loop stays model-side in the skill
> (w3c decision: no new TS engine).

## `arbiter gate-exec [--key K] -- <cmd...>` — per-repo gate mutex

Serializes expensive gates across N parallel worktree agents of the same repo.

- **Key:** hash of `git rev-parse --git-common-dir` — every worktree of a repo converges
  on ONE lock. Override with `--key` for non-repo scopes.
- **Lock file:** `$XDG_RUNTIME_DIR/arbiter/<key>-gate.lock` (fallback: OS tmpdir). Never
  inside the repo: per-worktree locks would be a null mutex; an in-repo lock dirties trees.
- **Mechanics:** delegates wait AND release to `flock(1)` with `--close` (`-o`). The wait is
  kernel-side and blocking (no poll/backoff); `-o` closes the lock fd before the wrapped command
  starts, so backgrounded descendants cannot retain the mutex. The flock holder still releases on
  fd death, including SIGKILL/OOM-kill, which no Node exit/signal handler can cover.
- **Exit code:** verbatim passthrough of the wrapped command; `2` for gate-exec's own
  errors.
- **Fail-closed:** without `flock(1)` (macOS base system, Windows) the command errors with
  `E_GATE_MUTEX_UNSUPPORTED` and the hint to run serially (`--max-parallel 1`) or install
  util-linux flock. There is deliberately NO lockfile emulation — it would reintroduce the
  SIGKILL hole.
- **Lock ordering (ADR-103 §4):** gate-exec is a **leaf** — it takes only the gate flock and
  is never invoked while `.arbiter/.lock` is held, so the one blocking lock is never acquired
  underneath a file lock. Total order: `gate-lock ≺ worktree-lock ≺ wave-claim`.

## `symlink-children` worktree link strategy — per-worktree build caches

Directory link strategy (now the `node_modules` default in `WorktreeConfig.links`): the
destination is a **real directory**; every top-level child of the source is symlinked
absolute, EXCEPT transient, tool-owned directories that their owner can delete. The current
exclusions are `.vite`, `.cache`, `.vite-temp`, and `.arbiter-test-scratch`; each worktree
creates these locally. A whole-dir `node_modules` symlink shares Vite/esbuild caches across
all worktrees — N concurrent builds corrupt them into non-deterministic spurious reds that
waste fix-on-red strikes.

- Idempotent and healing: re-running links children added to the main repo later.
- Fail-closed migration: a whole-dir symlink left by the old `symlink` strategy is refused
  with an explicit remove-and-retry message.
- Explicit `strategy: 'symlink'` / `'copy'` configs are unchanged.
- `arbiter worktree relink <task-id>` re-runs the configured link materialization for an
  already-open worktree, healing missing child links and warning about links whose source still
  does not exist.

## `arbiter worktree prune [--stale <hours>] [--execute]` — zombie reaper

On worker crash nobody closes the worktree; the dir, branch and open-log entry rot. The
reaper detects candidates from REAL state (open log + git), never memory:

> candidate = registered worktree with a CLEAN tree AND (branch fully merged OR no
> activity beyond `--stale` hours; default 24)

- **Dry-run by default** — `--execute` applies.
- A dirty tree is NEVER a candidate (INV-96), re-checked right before teardown.
- Merged candidates close normally (branch deleted); inactive-unmerged candidates close
  with `keepBranch` — committed work survives.
- Activity floor is `max(openedAt, last commit)`, so a just-opened branch with zero own
  commits is not reaped.
- Unreadable branches are skipped fail-closed (`branch-missing`), never guessed.

## `isLockStale` liveness-first (file-lock)

`src/utils/file-lock.ts` staleness order is liveness-first: a LIVE same-boot holder is
never stolen on age alone (the double-gate hole — a legitimate >1h gate used to be taken
over at `staleAgeMs`); a dead pid is stale immediately; the age backstop applies only to
EPERM `unknown-user` pids whose liveness cannot be probed.
