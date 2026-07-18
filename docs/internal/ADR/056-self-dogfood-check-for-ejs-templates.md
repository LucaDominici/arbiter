---
title: 'ADR-056: Self-dogfood check for EJS templates (#239)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-31'
owner: ''
canonical_id: '056'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-056: Self-dogfood check for EJS templates (#239)

**Date:** 2026-05-11
**Status:** Accepted
**Reference:** Issue #239, INV-45

**Context:** arbiter generates `.claude/` configuration files from EJS templates under `src/templates/claude/`. Over time, the materialized `.claude/` files in the arbiter repository diverged from their template sources (extended with arbiter-specific hooks, batch workflow commands, CI runner notes). There was no automated check to detect this drift, risking template degradation where future improvements to the materialized files would not be back-ported to the templates shipped to target projects.

**Decision:** Add `scripts/check-self-dogfood.mjs` — a Node.js script that renders every EJS template under `src/templates/claude/` with arbiter's own config (read from `arbiter.json`), normalizes both rendered and materialized content via Prettier, and diffs them line by line. Files with intentional divergences are registered in `.dogfood-divergences.json` with documented reasons. Config-gated templates (e.g. `guard-done-evidence.mjs` when `evidenceHarness=false`) are skipped. Wire the check into `scripts/check-all.mjs` L2 block. Codify as INV-45 (governance tier, alwaysActive) in the invariant catalog and AGENTS.md.

**Consequences:** Future template modifications will be caught at L2 gate if the corresponding materialized file diverges without a documented reason in `.dogfood-divergences.json`. Intentional arbiter-internal extensions remain explicitly documented. The check prevents silent template drift in both directions.

## Amendment (2026-07-03, #1744) — promoted to the L1 anti-drift family

The check is promoted from the L2 extended block to the
**L1 anti-drift validator family** in `scripts/check-all.mjs`, so template↔materialized drift
is caught at commit time (pre-commit runs L1) rather than push time. The decision content above
is otherwise unchanged; "L2 block"/"L2 gate" wording reflects the original wiring. L2 still runs
the check via its L1 superset. Escape hatch for intentional local divergence remains
`.dogfood-divergences.json` (worktree checkouts are unaffected — pre-commit skips L1 there).

## Amendment (2026-07-18, #2026) — mutation lock scoped per checkout

`check-self-dogfood.test.ts` / `check-self-dogfood-external.test.ts` spawn the real
`check-self-dogfood.mjs` against the live checkout and transiently mutate a tracked file to
prove the gate goes red; `withRealRepoMutationLock` (`__tests__/helpers.ts`) serializes those
tests via the product's own `acquireLock` primitive. That lock previously pinned every checkout
to one GLOBAL file under `os.tmpdir()`, so under the ADR-103 parallel-worktree-lane carve-out
(`.claude/rules/50-batch-execution.md`), two unrelated checkouts would contend or time out on
each other through that shared tmp file. `dogfoodRepoMutationLockPath(repoRoot)` now suffixes
the lock filename with a `sha1` hash of the repo root, so distinct checkouts get distinct lock
files while repeated calls for the same checkout keep resolving to the same stable path.
