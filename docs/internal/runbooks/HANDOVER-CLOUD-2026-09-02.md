---
title: 'Cloud handover — 2026-09-02 (runner still down; fourteen validated landings queued)'
doc_version: '1.0.0'
status: active
last_review: '2026-09-02'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/runbook']
related: ['PRODUCT/ADEQUACY-MAP.md', 'SYSTEM/CANON.md']
---

# Cloud handover — 2026-09-02

Continuation of HANDOVER-CLOUD-2026-08-31. Main is still `ae40f0cf`. **Nothing has merged**, and
nothing can: the `docker-ci-build` pool has taken no job since 2026-08-30T08:07Z. Re-verified at
16:25Z — zero runs `in_progress`, and every scheduled run since (Nightly, Weekly, Heartbeat,
`_pr-staleness`, Generator Matrix, main's own PR Fast) shows `cancelled` at the 24-hour queue
expiry. The runner host is the owner's machine and is powered off; **restarting it is the single
blocker for every merge below.**

Everything in the queue is validated locally instead: L1 plus a full pre-push L2 on the exact
pushed head. Each PR body says so explicitly, so nobody later mistakes an empty check list for a
passing one.

## The merge queue (in order; each head L2-validated locally before push)

| #   | PR    | branch                                   | base  | carries                                                |
| --- | ----- | ---------------------------------------- | ----- | ------------------------------------------------------ |
| 1   | #2439 | `docs/handover-cloud-2026-08-30`         | main  | 08-30 handover runbook (docs-only)                     |
| 2   | #2441 | `train/2026-08-30-mb2`                   | main  | #2353 #2416 #2417 #2434 — the four WIP refs            |
| 3   | #2456 | `train/2026-08-30-mb3`                   | main  | #2305 + tabletop evidence (3 scenarios)                |
| 4   | #2457 | `task/#2367-experimental-tools-decision` | main  | ADR-119: retire the 5 experimental generators          |
| 5   | #2459 | `train/2026-08-30-mc1`                   | main  | #2431 flake root-fix + #2436 clean-main hygiene        |
| 6   | #2464 | `task/#2418-fail-closed-baseline`        | main  | INV-96 baseline dated/owned/ratcheting, 184 → 156      |
| 7   | #2465 | `task/#2435-ship-phase-gates`            | main  | 5 ungated ship phases gated; close documented          |
| 8   | #2469 | `docs/handover-cloud-2026-08-31`         | main  | 08-31 handover runbook (docs-only)                     |
| 9   | #2473 | `task/#2419-meta-gates`                  | main  | mandatory ADR enforces, hard bypass-ceremony           |
| 10  | #2474 | `task/#2420-registries-drills`           | main  | RESULTS completeness gate, honest drill count          |
| 11  | #2475 | `task/#2447-file-stability-truth`        | row 9 | file-stability.md describes the real update mechanism  |
| 12  | #2477 | `task/#2449-deprecations-source-scan`    | row 9 | orphan `@deprecated` scan; 3 live deprecations dated   |
| 13  | #2478 | `task/#2448-semver-breaking-log`         | row 9 | breaking-log cites 0.2.0, pinned to CHANGELOG headings |
| 14  | (TBD) | `task/#2450-fixture-inventory`           | row 9 | fixture-inventory table pinned to the compat MANIFEST  |

Rows 11-14 are **stacked on row 9** and each is independent of the others (disjoint file sets), so
row 9 merges first and GitHub then auto-retargets them to `main`. Merge protocol unchanged: CI
green per PR, merge in table order, `git fetch` between merges,
`node scripts/ship-kpi.mjs --since 2026-08-29` after each, ADEQUACY-MAP §2 refresh at M-A/M-B close.

## Two findings that need attention before the queue does

### #2479 — the Consumer Reliability Bar has been red for days (NEEDS THE OWNER)

`Consumer Reliability Bar` runs on `ubuntu-latest`, so the pool outage never touched it. It has
conclusion `failure` on **every** push to main from 2026-08-28 through 2026-08-30 — runs #59
through #65, unbroken. The log is unambiguous that this is not infrastructure:

```
[consumer-prepare] PASS — prepared 3 detached origin-free consumers
[consumer-reliability] FAIL — 3 pinned consumers verified
```

Secrets resolve, consumers are reachable, `npm ci` and `npm run build` both pass. The prepare phase
succeeds and the **verification** fails. This is a genuine reliability regression against the
pinned consumers, and it predates the outage by about a day and a half — the outage merely
camouflaged it, because every "CI is red" observation since has been about queued jobs.

Cannot be finished from a cloud session: identifying which consumer and which rows needs the
`consumer-reliability-reports` artifact (e.g. run 33290505711, artifact 9725816286) and almost
certainly the pinned private consumer repositories, which the cloud session's permission classifier
denies. **Do not relax the bar, unpin a consumer, or set `continue-on-error` to clear it.**

### #2476 — a stacked PR gets zero CI, silently

`01-pr-fast.yml` and `02-pr-extended.yml` filter `pull_request` on `branches: [main]`, which
matches the **base** branch. A PR based on a `task/**` or `train/**` branch therefore creates no
workflow run at all. It does not go red — it has nothing to go red, and reads as clean to anyone
checking for failing checks. Rows 11-14 above are all in exactly that state.

Coverage currently depends on merge order rather than on the gate. The fix must also land in the
`src/templates/github/workflows/*.ejs` twins (CANON-18), or every generated project keeps shipping
the same hole. Standard tier — rides alone.

## What changed vs the 08-31 runbook

- #2419 and #2420 finished and landed as rows 9-10. #2420 uncovered a live fail-open: two nightly
  jobs listed in `needs:` but absent from `RESULTS=()`, so every generated service project shipped
  a nightly that could not fail on them.
- Four M-A docs-truth items from the tabletop walks finished and landed as rows 11-14:
  #2447 (a documented `arbiter:custom` merge mechanism that does not exist anywhere in the
  codebase), #2449 (three live deprecations with no version and no removal window while the Active
  table read "none currently active"), #2448 (a breaking-changes row citing a never-released
  1.0.0), #2450 (fixture inventory listing 1 of 2 MANIFEST entries).
- New issues filed: #2476, #2479 (above), plus #2466 drained from a findings spool.

## Environment lessons this session paid for

1. **The done-evidence freshness budget is 4 hours.** A gate run older than that is refused at
   push time (#2419 hit this at 2782 minutes). Chain the gate and the push in one command rather
   than gating, doing other work, then pushing.
2. **This box has 4 cores and a repo-wide gate flock.** Two agents plus a push chain produced an
   exit 144. Serialize: one push OR up to two agents, never both. Pushes get `nice -n 5`.
   A gate that dies with exit 144, an OOM, or a vitest pool crash is a contention artifact — re-run
   it serially; it is neither a pass nor a red. A coverage metric can genuinely sag under
   contention (tests time out, branches go uncovered), so a `coverageBranch` red measured under
   load deserves a serial re-run before it is believed.
3. **The shell's working directory resets between tool calls.** A `cd` in one call does not carry
   to the next, so any gate or push meant for a worktree needs its own explicit `cd` in the same
   command — otherwise it silently runs against the main checkout and measures the wrong tree.
4. **Stacked PRs get no CI at all** (#2476) — do not read their empty check list as green.
5. Agents report green confidently and still ship real defects that are only visible on reading
   the diff. Four caught this session: a test that would fail on correct content the day arbiter
   ships 1.0.0; an unmeasured complexity regression the agent never ran the ratchet for; an
   undrained findings spool; and a stale-evidence push refusal. Audit every claim against a tool
   result before pushing — the gates caught the rest, but only because nothing was bypassed.

## Open backlog after the queue drains

- **Needs the owner:** #2479 (consumer reliability, above). #2318 #2310 #2291 remain blocked on
  permission to the pinned private consumer repositories — reachable via `list_repos`/`add_repo`,
  but cloning them is denied by the session's permission classifier.
- **M-A:** #2433, #2445, #2451; #2414 tracking.
- **M-C:** #2476, #2479, #2384 #2301 #2150 #2405 #2427, plus #2455 #2458 #2460-#2463 #2466-#2468.
- **M-B:** #2452 #2453 #2454 (brownfield tabletop findings).
- #2397: the runner outage post-mortem plus the original nightly regression.
