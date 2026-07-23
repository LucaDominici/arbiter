---
'@arbiter/cli': minor
---

New `pr-tooling` generator (#2098) emits `scripts/pr-merge-watch.mjs` (a bounded
merge-on-green PR watcher — merges (0), hard-fails on a real red check (1), or
times out (2), never loops forever) and `scripts/capacity-probe.mjs` (a
combined local-load + gate-queue-depth + remote-runner-busy saturation
advisory), sharing one `scripts/lib/waiter-count.mjs` fd-count helper. Both
are always-on, project-agnostic orchestration tools (not gate infrastructure).
`arbiter gate-exec` also gains a queue-depth advisory line (no behavior
change) pointing at `ARBITER_PREPUSH_BYPASS` once >= 2 processes are already
queued on the mutex.
