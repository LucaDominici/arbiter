---
title: 'Cloud handover — 2026-09-02 (runner still down; twenty-three validated landings queued)'
doc_version: '1.2.0'
status: active
last_review: '2026-09-04'
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
| 14  | #2481 | `task/#2450-fixture-inventory`           | row 9 | fixture-inventory table pinned to the compat MANIFEST  |
| 15  | #2505 | `task/#2467-orphan-ledger-detector`      | row 9 | orphan advisory-ledger entries detected, stale one cut |
| 16  | #2495 | `task/#2453-update-noop-flags`           | row12 | `update`'s silent `--no-adopt-*` no-ops deprecated     |
| 17  | #2488 | `task/#2476-stacked-pr-ci`               | main  | stacked PRs get a real CI run (the fail-open below)    |
| 18  | #2492 | `task/#2452-dryrun-preview-truth`        | main  | `init --dry-run` previews the plan the real run runs   |
| 19  | #2494 | `task/#2445-tabletop-probe-truth`        | row18 | tabletop probes 4 and 6 match their exit criteria      |
| 20  | #2499 | `task/#2454-go-example-coverage`         | row19 | Go tabletop probe stops claiming absent example cover  |
| 21  | #2497 | `task/#2468-adr-status-vocabulary`       | main  | the four `accepted` ADRs migrate to canonical `active` |
| 22  | #2502 | `task/#2466-twin-diff-doc-truth`         | main  | TESTING.md's twin-diff step made true, and gate-kept   |
| 23  | #2483 | `docs/handover-cloud-2026-09-02`         | main  | this runbook (docs-only)                               |

Rows 11-15 are **stacked on row 9** and are mutually independent (disjoint file sets), so row 9
merges first and GitHub then auto-retargets them to `main`. Row 16 is stacked on row 12 (both edit
`docs/DEPRECATIONS.md`), row 19 on row 18 and row 20 on row 19 (all three reach
`TABLETOP-SCENARIOS.md`). Rows 17, 18, 21, 22 and 23 are based on `main` and merge independently.
Every stack exists because the two heads share a file, never for convenience — a stacked PR pays a
real price (see #2476 below), so the ordering is load-bearing, not cosmetic. Merge protocol
unchanged: CI green per PR, merge in table order, `git fetch` between merges,
`node scripts/ship-kpi.mjs --since 2026-08-29` after each, ADEQUACY-MAP §2 refresh at M-A/M-B close.

## Findings that need attention before the queue does

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

### #2476 is fixed (row 15) — and fixing it uncovered more

`#2488` removes the base filter from both merge-gate workflows. Six further templates keep one and
carry no merge-gate aggregator, so the new rule does not bind them — including
`src/templates/github/workflows/five-lane/ci.yml.ejs`, which calls itself "CI (PR-blocking)" while suppressing run creation. Filed
as **#2485**. Widening the trigger also makes a same-head/different-base concurrency collision
reachable; its symptom is a _cancelled_ run, which is visible and never reads as green, so it was
deliberately left out of the minimal diff — filed as **#2486**.

### Governance findings filed later in the session

- **#2489 — a killed agent tombstones the spawn guard for 2 hours.** `pruneStaleSidecarEntries`
  filters only on TTL age; every entry records a `pid` that is never read. A container restart
  therefore blocks all further write-agent dispatches until the TTL expires. Verified: pid dead,
  entry 37 minutes old, guard still refusing.
- **#2493 — the SSOT one-shot bypass marker is repo-global and unscoped.** `pre-edit-ssot-guard`
  anchors on the harness's cwd, so a worktree agent must write the marker into the main checkout,
  and the marker names no target file. Under ADR-103's sanctioned parallel worktrees, one agent's
  bypass can be consumed by another agent's unrelated edit. The mechanism is verified; the race
  itself was **not** reproduced (this session serialises agents), so treat it as latent by design
  rather than as an observed incident.
- **#2487 — 16 `arbiter note` findings recovered from ephemeral spools** across seven shipped
  tasks, transcribed before the container could reclaim them. Captured, explicitly **not** triaged;
  some may duplicate existing issues. Its second acceptance criterion is the real point: a spool
  that lives only as long as its container keeps losing findings exactly when work is most
  autonomous.
- **#2482** — `gen-wiki.mjs` regenerates every page and prunes none, so a stale page left by a
  branch switch in a long-lived worktree fails wiki lint.
- **#2490 / #2491** — `init --json --dry-run` silently ignores `--json` and exits 0, so a CI
  consumer crashes on the parse rather than on a status check; and `doc-set-skeletons` is the one
  generator `init --dry-run` still cannot preview — a measured 5-path gap held open by an
  asserted-live test exception rather than hidden.
- **#2496 / #2498** — five ADRs still carry the non-canonical statuses `superseded` and `proposed`
  (deliberately left out of the `accepted` → `active` migration, because `superseded` means
  something none of the four canonical values does and should probably be admitted rather than
  flattened); and no GA stack has `backend-web-db` example-drift coverage, because
  `LIVING_EXAMPLES` is scoped to the `library` archetype **by design** — so materializing one Go
  example would have closed a symptom and left the structure untouched.
- **#2500 / #2501** — `check-doc-freshness.mjs` exits 1 on a pristine `HEAD` (8 docs stale by the
  coupling rule) and is wired into **neither** track's roster, so the red has been invisible since
  it was built; and `cross-model-review.test.ts` fails under CPU load because its assertion waits
  out a real 5s timeout, making a hard gate non-deterministic on a busy runner.
- **#2503 — every dispatched agent stalls waiting on a background gate run that cannot wake it.**
  Measured from this run's own nudge messages: **11 distinct agents**, one of them four times,
  worst single stall about two hours. The dispatch contract already tells agents to poll to
  completion and each was given that instruction verbatim, so the affordance is wrong rather than
  the instruction unread — backgrounding is the only way to run a 25-minute gate without tripping a
  tool timeout, and a subagent has no wake mechanism at all. CLOSER-mode Rule 7 already names this
  failure, which is the evidence that prose alone has not fixed it.

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

## What changed vs v1.1.0 of this runbook

- Five more landings joined the queue as rows 15, 16 and 20-22: #2505 (orphan advisory-ledger
  detector), #2495 (`update`'s silent no-op flags), #2499 (the Go tabletop probe), #2497 (ADR status
  vocabulary) and #2502 (the twin-diff doc step). The queue is 18 rows no longer — it is 23.
- Two of those are worth reading for the judgement rather than the diff. #2499's agent found that
  the coverage gap it was sent to close is **structural** — `LIVING_EXAMPLES` is library-only by
  design — and documented the gap instead of papering over it with one example, promoting the real
  question to #2498. #2502's agent found that the twin-diff doc step's true root cause was that
  `self-validation.mjs` matched neither the `check-*` nor the `record-*` parity rule, so a manual
  `diff` was the only thing holding the twins together; it tightened the gate rather than widening
  a divergence pin.
- Six further issues filed: #2496, #2498, #2500, #2501, #2503 (above), and the queue's own
  ordering note now records why each stack exists.
- **The runner pool is unchanged.** Re-verified 2026-09-04T01:47Z: `origin/main` is still
  `ae40f0cf`, nothing has merged, and every run since remains `queued` or `pending`. Four days.

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
5. **A container restart leaves the worktree intact but tombstones the spawn guard.** Commits in
   `.claude/worktrees/<name>` survive — resume in place, never restart the task from scratch. The
   dead dispatch's sidecar entry does not survive gracefully: clear it after verifying the pid is
   dead (#2489).
6. **A doc edit is never just a doc edit.** Adding or retitling a file under `docs/` changes the
   generated repo-root `llms.txt` (and possibly `docs/INDEX.md`); forgetting to regenerate fails a
   drift check _and_ a unit test, which then cascades into coverage and both ratchets. One full
   ~25-minute gate cycle was lost to exactly this.
7. **Verify a snapshot rebake's diff scope.** `BAKE_UPDATE_SNAPSHOTS=1` blesses whatever the
   current output happens to be; confirm every changed hash is one you intended before committing.
8. Agents report green confidently and still ship real defects that are only visible on reading
   the diff. Caught this session: a test that would fail on correct content the day arbiter
   ships 1.0.0; an unmeasured complexity regression the agent never ran the ratchet for; an
   undrained findings spool; a stale-evidence push refusal; a regenerated `llms.txt`; and a stale
   fixture-snapshot set. Audit every claim against a tool result before pushing — the gates caught
   the rest, but only because nothing was bypassed. One agent corrected _me_ on a misdiagnosis and
   was right; verify a correction as carefully as a claim.
9. **A one-shot check-in is not a heartbeat.** A self-scheduled reminder that fires once and
   disables itself leaves the run dead the moment it is answered without being re-armed. That cost
   this session about nine and a half idle hours between 16:10Z and 01:47Z, with an agent queue
   ready to dispatch and nothing dispatching it. Use a **recurring** routine as the keep-alive and
   treat one-shots as extras; a run whose liveness depends on remembering to re-arm will eventually
   forget.
10. **A subagent cannot be woken by anything it starts.** A backgrounded gate run notifies the
    orchestrator, never the agent that launched it, so an agent that ends its turn to "wait for the
    monitor" waits forever. Measured 11 times this session (#2503). Instruct agents to poll in the
    foreground, and re-instruct on the nudge — the second telling is often needed.

## Open backlog after the queue drains

- **Needs the owner:** #2479 (consumer reliability, above). #2318 #2310 #2291 remain blocked on
  permission to the pinned private consumer repositories — reachable via `list_repos`/`add_repo`,
  but cloning them is denied by the session's permission classifier.
- **M-A:** #2433, #2451; #2414 tracking. (#2445 shipped as row 19.)
- **M-C:** #2479, then the drain queue #2384 #2301 #2150 #2405 #2427, plus #2455 #2458
  #2460-#2463, and the new #2485 #2486 #2487 #2489 #2493 #2496 #2500 #2501 #2503. (#2419 is row 9,
  #2467 row 15, #2476 row 17, #2466 row 22, #2468 row 21.)
- **M-B:** the brownfield tabletop findings shipped as rows 16 and 20 (#2453, #2454); what remains
  is #2490 #2491 #2498. (#2452 is row 18.)
- #2397: the runner outage post-mortem plus the original nightly regression.
