---
'@arbiter/cli': minor
---

wave-drain skill v2 + /drain v2 (T6 of #1873, dual-side): the parallel wave
protocol proven 2026-07-09/10 lands in the existing skill/command — ADR-103
legality header (worktree + distinct branch + disjoint file-sets), gate mutex
via `arbiter gate-exec` (flock(1), SIGKILL/OOM-safe, fail-closed serial
fallback), anti-stall split (deterministic gate-wait vs sweep-bounded
turn-stall), `conflicts-with:#N` serial lane, optional per-issue 3-hop plan
gate for `needs-plan`, cap `min(--max-parallel, nproc-2, wave)`, per-worktree
caches, REAL-diff fan-in order, end-of-wave zombie reaper. Convergence model
owner-ratified: governed repos ONE wave-PR; the cross-repo appendix documents
N-PR + merge-train for non-governed repos with explicit caveats. The
opus-4.8-harness-wave-orchestrator prompt is superseded; SKILL.md/drain.md
stay byte-equal to their templates (dogfood INV-45).
