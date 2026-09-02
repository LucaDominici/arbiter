---
title: 'Reference: Fix-on-Red Engine'
doc_version: '1.0.0'
status: active
last_review: '2026-06-11'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: ['088-ship-as-orchestration-entrypoint']
---

# Reference: Fix-on-Red Engine

> **Target:** arbiter engine (deterministic half of the dual-side ship loop, ADR-093)
> **Module:** `src/ship/fix-on-red.ts` — **removed** in the T2 command-surface cut
> **Command:** "arbiter ship-on-red" — **removed**; no longer registered in `src/cli.ts`
> **Invariant:** INV-96 — fail-closed on uncertainty

---

## Status

The deterministic CLI engine described below (the "arbiter ship-on-red" binary, its
`src/ship/fix-on-red.ts` implementation, and the persisted `attempts.json` it owned) was
cut wholesale in the T2 command-surface reduction. **The policy design is preserved here**
because `.arbiter/ship/TICK_PROMPT.md` (emitted by `src/generators/ship-driver.ts`) still
directs the ship-driver agent to apply it — but there is no longer a helper binary to
compute the signature or track strikes; the driver agent must reason through the algorithm
itself and keep its own count for the life of a task. This is a known gap left by the T2
cut, not a design decision — treat any doc/template still invoking "arbiter ship-on-red"
literally as a bug pending a follow-up (re-implement the engine, or fold the policy into
driver prose only).

When a gate goes red during a ship, the **fix-on-red policy** decides the next action
deterministically. The model (driver, #1290) diagnoses the log and writes the fix; the
policy below governs the decision: compute a stable failure signature, remember how many
times it has been seen, and either ask for one root-cause fix or escalate to a human. It
never retries blindly.

## Failure signature

`failure_signature = <check-name>:<error-class>`

- **check-name** — the gate that went red (`lint`, `unit-test`, `jscpd`, …). Must already
  be a slug (`^[a-z0-9][a-z0-9-]*$`); anything else is rejected (fail-closed).
- **error-class** — the error _family_, derived from the log and stripped of all positional
  noise (paths, `:line:col`, hex/sha, timestamps, durations, numbers) so it is **stable
  across line-number noise** and **scoped to the failure type** (a `TypeError` and a
  `ReferenceError` never collapse to one signature).

If no error class can be derived, the signature is _uncertain_ and the engine escalates.

## 2-strike rule

Attempts are remembered per task in `.arbiter/ship/<task-id>/attempts.json`
(schema-validated, atomic write, gitignored local state):

| Strike                                                  | Decision             | Next action                                                            |
| ------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------- |
| 1st of a signature                                      | `fix`                | Reproduce the failed gate locally before push, then fix the root cause |
| 2nd of the same signature                               | `escalate`           | Apply the `needs-human` label and STOP — **never a 3rd retry**         |
| uncertain signature / unreadable state / failed persist | `escalate-uncertain` | STOP and hand off — cannot safely retry (INV-96)                       |

These are floor invariants at every autonomy level (ADR-093): the 2nd strike always
escalates, and the engine always emits the reproduce-before-push step on the first red.

**Reproduce-before-push presumes a local twin (#2435).** The step is only performable when
the red CI job has something to run locally, so every job the required `ci-required` check
depends on must resolve to a Makefile target of the same name, an explicit local command, or
an explicit CI-only exemption. Those declarations live in exactly one place —
`CI_ONLY_REQUIRED_JOBS` and `REQUIRED_JOB_LOCAL_TWIN` in `scripts/check-local-ci-parity.mjs`,
each CI-only entry carrying the reason no local twin can exist — and
`checkRequiredJobLocalTwins` fails the gate when a required job resolves to none of them. A
job named there as CI-only (the GitHub dependency-review API, the hosted Sonar analysis, the
PR-diff classifiers) is exempt from this floor: on its red, escalate rather than attempt a
reproduction that does not exist.

## attempts.json schema (`ShipAttemptsV1`)

```json
{
  "$schemaVersion": 1,
  "task_id": "#1289",
  "attempts": [
    { "signature": "unit-test:typeerror", "count": 1, "first_seen": "…", "last_seen": "…" }
  ],
  "updated_at": "2026-06-11T00:00:00.000Z"
}
```

A present-but-invalid, wrong-`task_id`, or unknown-`$schemaVersion` file loads as a failure
(the driver escalates) — it never silently resets a live strike counter. An absent file is
empty state (count starts at 0).

## CLI

**Removed.** There is no "arbiter ship-on-red" binary anymore — the helper that printed
the decision (`fix` / `escalate` / `escalate-uncertain`) given a check name, log file, and
task id was deleted with `src/ship/`. The driver agent must derive the same decision
itself: compute the failure signature per the rule above, read/update
`.arbiter/ship/<task-id>/attempts.json` directly, and apply the strike table below.

## Autonomy gating (#1291)

The fix decision is gated by the resolved autonomy level (`--autonomy` flag >
`arbiter.json automation.autonomy` > `L0`; the session/profile precedence legs land
with #1261):

| Level   | Fix decision behavior                                                      |
| ------- | -------------------------------------------------------------------------- |
| L0 / L1 | `ASK the human before applying this fix — …` (no autonomous attempt)       |
| L2      | apply the fix autonomously; `Autopush: refused — hand the push to a human` |
| L3      | `Autopush: authorized` — the driver may push the green fix                 |

Escalation decisions never consult autonomy: the 2-strike floor and the
reproduce-before-push step hold at every level (ADR-093 floor invariants).

## What stays out

The engine is **not a hook**. The existing hooks — no `--no-verify`, gate-before-push,
no-commit-to-main — remain the floor the fix must not violate.
