---
'@arbiter/cli': patch
---

Wave F2 tranche 2 (#1838, epic #1836): CANON-14's dogfood allowlist becomes an
auto-diff registry, and derived website pages get a generator with an L1
freshness gate. `.dogfood-divergences.json` entries now pin the sha256 of the
exact approved template-vs-materialized diff (`diffHash`): new drift inside an
allowlisted file, a healed (stale) entry, or a dead entry (path no corpus
visits) all fail `check-self-dogfood.mjs` instead of being silently absorbed by
a whole-file skip — the class that let the guard-done-evidence vs
stop-evidence-guard divergence slip. At introduction the auto-diff caught 1
stale entry (`check-circular-deps.mjs`, template and copy had already
converged) and 3 dead entries (`review-code.md`, `gen-wiki.mjs`,
`check-wiki-lint.mjs` — never visited by any corpus), all removed. Re-pin after
a reviewed change with `--update-divergences`. New
`scripts/gen-derived-pages.mjs` emits the active-experiments table
(website/reference/experimental-policy.md, from src/experimental/registry.ts —
closing the TODO left by the F1 hand-fix of #1837) and the kit dimension count
(website/features/index.md, from src/kit/catalog.json — the 77-vs-78 class)
into marker-delimited regions, prettier-converged, with `--check` wired in L1.
