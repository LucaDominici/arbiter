---
'@arbiter/cli': minor
---

ADR-103 (#1873, T1 governance): worktree-isolated parallel execution carve-out.
Rule 50 (batch execution) gains a conditional exemption — parallel agents may
edit/commit/branch only when each runs in a dedicated worktree opened via
`arbiter worktree open`, on a distinct branch, with plan-manifest-disjoint
file-sets; dependency changes, main-tree edits and tags stay prohibited. The
edit lands dual-side (self file + claude template + codex template) with a
byte-parity test. The ADR also fixes the engine/primitive boundary for the
wave technique (no new TS engine; deterministic leaf primitives only), the
anti-deadlock lock order (gate-lock ≺ worktree-lock ≺ wave-claim, gate-exec is
a leaf), and the owner-ratified hybrid convergence model (governed repos: one
wave-PR; non-governed repos: N-PR + merge-train in the skill's cross-repo
appendix). `ship --batch` is deprecated at warn stage in favour of `/drain`
(wave-drain skill); the batch seam stays sync and untouched.
