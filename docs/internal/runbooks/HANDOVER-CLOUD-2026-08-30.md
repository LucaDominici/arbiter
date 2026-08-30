---
title: 'Cloud handover — 2026-08-30 (owner on leave)'
doc_version: '1.0.0'
status: active
last_review: '2026-08-30'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/runbook']
related: ['PRODUCT/ADEQUACY-MAP.md', 'SYSTEM/CANON.md']
---

# Cloud handover — 2026-08-30

The local machine is off. This file replaces the local memory for the cloud session.

## State of main (ae40f0cf)

Merged 2026-08-29/30 via `pr-merge-watch`: #2407 (throughput repair, ADR-116), #2424 (ADEQUACY-MAP),
#2426 (#2408 #2415), #2432 (#2428 #2429), #2437 (#2409 #2410), #2438 (#2411 #2412 #2413 +
tabletop evidence). Milestones M-A..M-D exist with due dates; `docs/internal/PRODUCT/ADEQUACY-MAP.md`
§3.1 is the issue map. M-A open: #2433, #2397, #2414 (tracking). M-B open: #2434 #2353 #2416 #2417
(WIP on `wip/*` refs below) + #2367 #2353 #2318 #2310 #2305 #2291.

## WIP refs on origin (pushed with a logged hook bypass — NEVER merge without L1+L2)

| ref                           | issue | state when pushed                                            |
| ----------------------------- | ----- | ------------------------------------------------------------ |
| `wip/2353-update-optout`      | #2353 | RED + evidence + green commit; gates not run                 |
| `wip/2417-self-only-manifest` | #2417 | RED + evidence + green commit; gates not run                 |
| `wip/2416-plugin-add`         | #2416 | RED + evidence + green + unverified fixups (ADR-118 drafted) |
| `wip/2434-init-truth`         | #2434 | RED + evidence only; green unfinished                        |

Resume each: `git checkout -b 'task/#NNN-<slug>' origin/wip/<ref>`, `npm ci --ignore-scripts && npm run build`,
run the full check set (below), finish, then integrate on a train.

## The operating contract (verbatim from the overnight goal)

- One agent per issue, isolated worktree, exactly ONE `#NNN` per dispatch prompt.
- RED first: commit failing tests alone → `node dist/cli.js task record-red --task '#NNN' --test-path <file>` →
  `git add -f '.arbiter/evidence/tdd/#NNN.json'` → commit → implement → commit green.
- Template twins mirrored; `npm run examples:regenerate`; bake snapshots
  (`BAKE_UPDATE_SNAPSHOTS=1 npx vitest run --config vitest.integration.config.ts __tests__/integration/e2e/bake/`,
  then plain = 29/29); `node scripts/check-self-dogfood.mjs`.
- Before any report/integration, ALL of: `node scripts/check-all.mjs L1`, `check-fail-closed-audit.mjs`,
  `check-anti-telemetry.mjs`, `check-tdd-evidence.mjs`, the debt-ratchet invocation from `check-all.mjs`,
  `check-canon01-declination.mjs`, `PARITY_CHECK_LEVEL_ONLY=1 node scripts/check-local-ci-parity.mjs`,
  `check-codex-parity.mjs`, `check-codex-self-parity.mjs`, `check-script-cohesion.mjs`. Reds fixed at the root.
- Host pacing: heavy commands through `VITEST_MAX_WORKERS=4 node dist/cli.js gate-exec -- <cmd>`; ≤4 agents; one gate at a time.
- Integration: `train/<date>-<slug>` from fresh `origin/main`; merge in min-overlap order; generated files
  (examples, bake snapshots, wiki, llms.txt, INDEX.md, GAP.md, STATUS.md) regenerated, never hand-merged;
  regenerate in this order: build → examples → doc index → llms.txt → gap/status → wiki; ONE L1; push runs L2
  (never kill a push mid-L2 — #2427); PR via `--body-file` with `Closes #…`; `node scripts/pr-merge-watch.mjs
LucaDominici/arbiter <PR>` to MERGED; on red: job log / junit artifact; runner-load flakes (vitest worker
  crash, subprocess tests green alone) → `gh run rerun --failed` once + comment on #2397.
- Hard rules: no `--no-verify`/force/reset --hard on landing work; no weakened gates; Standard-tier, security
  and dependency changes ride alone; two strikes → root-cause note + `needs-human`.

## Lessons that cost a push cycle tonight

1. A new gate needs: CI_COVERAGE mapping in `check-local-ci-parity.mjs`, canon-01 declaration, CATALOG header
   (`check-script-cohesion`), codex parity baseline (`check-codex-parity.mjs --update-baseline`) and
   `.agents/CODEX.md` re-materialized when a skill/command is emitted.
2. A `src/templates/**` edit needs examples + bake snapshots before push.
3. `.dogfood-divergences.json` re-pins via `node scripts/check-self-dogfood.mjs --update-divergences` after
   extending the entry's reason text.
4. Rate limits hit ~01:30 and ~04:00 local; resume agents with `SendMessage` on the same id.

## Next in order

1. Finish the four WIP refs → `train/<date>-mb2` → PR → watcher.
2. M-B rest: #2367 #2318 #2310 #2305 #2291 (group by file overlap), then #2433 (M-A), #2397.
3. Run `/tabletop` on the remaining three catalogue scenarios; file findings with owners.
4. M-C: #2427 #2431 #2436 #2435 #2418 #2419 #2420 #2384 #2301 #2150 #2405.
5. KPI: `node scripts/ship-kpi.mjs --since 2026-08-29` after each train; update ADEQUACY-MAP §2 at M-A close.
