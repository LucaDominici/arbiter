---
generated: true
source: 'docs/REFERENCE/fix-on-red.md'
source_sha: '283a7aefc12b6e656536cee2e32c05ebb882fec1'
last_updated: '2026-06-16'
---

# Reference: Fix-on-Red Engine

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/fix-on-red.md](../docs/REFERENCE/fix-on-red.md)

# Reference: Fix-on-Red Engine

> **Target:** arbiter engine (deterministic half of the dual-side ship loop, ADR-093)
> **Module:** `src/ship/fix-on-red.ts`
> **Command:** `arbiter ship-on-red`
> **Invariant:** INV-96 — fail-closed on uncertainty

---

## Purpose

When a gate goes red during a ship, the **fix-on-red** engine decides the next action
deterministically. The model (driver, #1290) diagnoses the log and writes the fix; the
engine owns the policy: compute a stable failure signature, remember how many times it has
been seen, and either ask for one root-cause fix or escalate to a human. It never retries
blindly.

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

```bash
arbiter ship-on-red --check unit-test --log-file /tmp/red.log --id '#1289'
```

Prints the decision (`fix` / `escalate` / `escalate-uncertain`), the signature, the attempt
count, and the next action. Any _computed_ decision exits 0; only an IO/usage error
(unreadable log, missing task id) exits 1.

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
