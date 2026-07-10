---
'@arbiter/cli': minor
---

Wave primitives T2-T5 of #1873 (ADR-103 leaf set). T2: `isStale` is now
liveness-first — a live same-boot lock is never stolen on age alone (the
double-gate hole), a dead pid is stale immediately, and the age backstop
applies only to EPERM unknown-user pids. T3: new `arbiter gate-exec [--key K]
-- <cmd...>` per-repo gate mutex — key hashed from the git common dir so all
worktrees of a repo converge on one flock(1) lock under XDG_RUNTIME_DIR;
kernel-side blocking wait and guaranteed release on SIGKILL/OOM; exit-code
passthrough; fail-closed E_GATE_MUTEX_UNSUPPORTED where flock is missing.
T4: new worktree link strategy `symlink-children` (now the node_modules
default) — per-child symlinks excluding `.vite`/`.cache`, so parallel
worktree builds stop corrupting one shared cache; `symlink`/`copy` configs
unchanged. T5: new `arbiter worktree prune [--stale <hours>] [--execute]`
zombie reaper — clean trees that are merged or inactive beyond the threshold;
dry-run by default; dirty trees never touched (INV-96); inactive-unmerged
candidates keep their branch.
