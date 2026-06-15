---
title: 'Reference: Anti-fake-green guards'
doc_version: '1.0.0'
status: active
last_review: '2026-06-15'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: ['096-probe-incidental-discovery-loop']
---

# Reference: Anti-fake-green guards

A **fake-green** (falso-green) is any condition where a passing signal — a CI check, a score, a
gate — is satisfied by something _other than the real property it is supposed to attest_. These
guards each pick one such gap and make the signal depend, deterministically, on the real property.

> Doctrine: every guard **fails closed** (uncertainty ⇒ non-pass), treats **NO-DATA as not a pass**
> (an explicit skip, never green), is **self-audited** (a guard that can't detect its own violation
> is itself a fake-green), and **does not over-claim** (only shipped guards are listed here).

## Guards (this increment, #1412)

| Guard                                          | Fake-green it catches                                     | Detection                                                                                                                                                                                                                |
| ---------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `check-min-review-time.mjs` (#9)               | same-day / no-real-review merge — "review was decorative" | `gh` post-merge: **0 non-author approvals** (via `latestReviews`, not stale `reviews[]`) AND merge window < threshold (code 4h / doc 1h). Exempt: `min-review-exempt` label, dependabot patch/minor, trunk-solo+ADR-091. |
| `check-ownership-distribution.mjs` (#10 / O-9) | single-owner governance theater                           | `gh issue list`: % of open P0/P1 unassigned OR held by the **empirically dominant** assignee > threshold (default 30%). A configured `--owner` that matches nothing yields NO-DATA, never PASS.                          |
| `check-anti-fake-green.mjs`                    | a guard disarmed by being broken                          | Aggregate: file-scan child `exit 1` = hard fail; gh-audit child `exit 1` = advisory; **any child `exit 2` (broken) fails the aggregate unconditionally** — you cannot disarm a guard by breaking it.                     |

Pure verdict logic lives in `scripts/lib/anti-fake-green-core.mjs` (I/O-free), so the **N2
self-audit** (`__tests__/conformance/anti-fake-green-self-audit.test.ts`) exercises every guard
offline against synthetic violations — proving each still _detects_ its fake-green before it is
trusted in the gate.

## Exit-code contract (INV-53)

`0` = PASS / advisory · `1` = FAIL (`--enforce` + violations, or a hard/broken child) · `2` =
ERROR (the guard itself malfunctioned). **NO-DATA is `0`, never `2`** — a missing `gh` is an
environment condition, not a broken guard.

## Rollout

Report-only (advisory, exit 0) by default; promote to blocking with `--enforce` once trusted —
the `check-anti-proforma` precedent. Wired into `check-all.mjs` via the aggregate. Tracked under
epic #1411 (GKv2-1, #1412); the score-side veto for reality-contact (#8) is already Tier-1 in the
conformance engine.
