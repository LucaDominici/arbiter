---
title: 'Cloud handover — 2026-08-31 (runner outage; seven validated landings queued)'
doc_version: '1.0.0'
status: active
last_review: '2026-08-31'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/runbook']
related: ['PRODUCT/ADEQUACY-MAP.md', 'SYSTEM/CANON.md']
---

# Cloud handover — 2026-08-31

Continuation of HANDOVER-CLOUD-2026-08-30. Main is still `ae40f0cf`; nothing merged since,
because the `docker-ci-build` runner pool has taken **no job since 2026-08-30T08:07Z**
(runner `arbiter-slot-build-4` died mid-checkout; nothing picked up work after). Escalated
with `needs-human` on #2397 at 09:38Z, one status update at 00:21Z. **Restarting the runner
host is the single blocker for every merge.**

## The merge queue (in order; each head L2-validated locally before push)

| # | PR    | branch                                   | carries                                            |
| - | ----- | ---------------------------------------- | -------------------------------------------------- |
| 1 | #2439 | `docs/handover-cloud-2026-08-30`         | previous handover runbook (docs-only)              |
| 2 | #2441 | `train/2026-08-30-mb2`                   | #2353 #2416 #2417 #2434 — the four WIP refs        |
| 3 | #2456 | `train/2026-08-30-mb3`                   | #2305 + tabletop evidence (3 scenarios, ref #2429) |
| 4 | #2457 | `task/#2367-experimental-tools-decision` | ADR-119: retire the 5 experimental generators      |
| 5 | #2459 | `train/2026-08-30-mc1`                   | #2431 flake root-fix + #2436 clean-main hygiene    |
| 6 | #2464 | `task/#2418-fail-closed-baseline`        | INV-96 baseline dated/owned/ratcheting, 184→156    |
| 7 | #2465 | `task/#2435-ship-phase-gates`            | 5 ungated phases gated; close documented           |

Stacking: 3–7 each base on the row above (5 on 4's branch, 6 and 7 both on 5). #2464 and
#2465 both touch `scripts/check-local-ci-parity.mjs`: whichever merges second needs a
base-branch merge + revalidation. Merge protocol: CI green per PR, merge in table order,
`git fetch` between merges, `node scripts/ship-kpi.mjs --since 2026-08-29` after each,
ADEQUACY-MAP §2 refresh at M-A/M-B close.

Still in flight when this was written: agents for **#2419** (meta-gates) and **#2420**
(registries/drills), both based on row 7's head (`6f11d495`); their branches follow the
same pattern (push → PR → back of the queue) if they finish green.

## What changed vs the 08-30 runbook

- All four WIP refs finished by dedicated agents (RED evidence preserved, gates run,
  ratchet reds root-fixed) and integrated as mb2. `publicApiSurface` baseline is now
  **1164**, each unit justified with consumer evidence per the c50e6d8e/#2288 precedent.
- The three remaining tabletop scenarios ran: **all three exit criteria NOT MET**.
  Findings filed and owned: #2442–#2446 (drain-wave), #2447–#2450 (consumer-upgrade),
  #2451–#2454 (brownfield), #2455 (evidence-landing friction). Milestones assigned
  (M-A = milestone 13, M-B = 14, M-C = 15, M-D = 16).
- ADR-119 retires cursor/copilot/gemini/windsurf/aider (all four promotion criteria
  unmet, no demand signal); gemini's review-provider role explicitly untouched.
- M-C progress: #2431 (two root causes: pool-derived budgets + stub EPIPE race),
  #2436 (ADR-120 stryker-tmp ignore; other ACs were checkout-local artifacts),
  #2418 (19 auditor files root-fixed incl. a report-truncation bug in the auditor),
  #2435 (phase gates + foreign-state refusal + required-job local-twin parity).
  New follow-ups filed: #2458, #2460–#2463.

## Environment facts this session learned (they cost push cycles)

1. **No `gh`, no api.github.com** in the cloud sandbox (proxy 403). All GitHub work goes
   through the GitHub MCP tools; `pr-merge-watch.mjs` cannot run — replicate merge-on-green
   via `pull_request_read`/`merge_pull_request`. GitHub **release downloads work**:
   `curl .../gitleaks/releases/download/v8.27.2/... | tar -xz -C /usr/local/bin gitleaks`
   fixed the gitleaks L2 red at the root (Ubuntu's apt 8.16 lacks the flags check-all uses).
2. **Idle container reclamation kills detached processes.** A `nohup` push died mid-L2
   twice. Long commands must run as harness-tracked background tasks (they keep the
   container alive and notify on completion); scheduled wakes land in a fresh container
   with disk intact.
3. **Evidence-only branches cannot pass the tdd-evidence branch floor** (#2455):
   `.arbiter/evidence/**` is not in the docs-only allowlist and the skip trailer is
   forbidden at L2+. Tabletop evidence rides a source train.
4. The milestone numbers are 13/14/15/16 (M-A..M-D); the GitHub MCP issue_write takes the
   number, and issue_read only shows the title.
5. Consumer-repo clones (viafera/haben/coach-system) were **denied by the session's
   permission classifier** — #2318/#2310/#2291 need either that permission or a local
   session. The repos themselves are reachable (list_repos, add_repo fine).

## Open backlog after the queue drains

- M-B: #2310 #2291 #2318 (need consumer repos — see fact 5), #2367 done via #2457.
- M-A: #2433, #2445, #2447–#2451 (docs-truth batch); #2414 tracking.
- M-C: #2419/#2420 (in flight), #2384 #2301 #2150 #2405 #2427, plus new #2455 #2458
  #2460–#2463.
- #2397: the runner outage post-mortem + the original nightly regression.
- Main's own push gate is red (pre-outage unit-test flake at `ae40f0cf`); its rerun is
  queued and should go green when the pool returns — verify before stacking anything new.
