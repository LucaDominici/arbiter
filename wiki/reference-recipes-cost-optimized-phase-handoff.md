---
generated: true
source: 'docs/REFERENCE/recipes/cost-optimized-phase-handoff.md'
source_sha: 'cd06042d7e5a0b562145cd5f2eb5c577f6ef8e92'
last_updated: '2026-06-08'
---

# Cost-Optimized Phase Handoff (Phase 3.5)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/recipes/cost-optimized-phase-handoff.md](../docs/REFERENCE/recipes/cost-optimized-phase-handoff.md)

# Cost-Optimized Phase Handoff (Phase 3.5)

**Issue:** #703
**Commands:** `arbiter task advance --to red`, `arbiter task advance --post-clear --to red`

---

## What This Is

Planning phases (plan, red-team-review, red-team-rework) run on Opus — deep reasoning,
plan mode, full context. At the plan→implementation boundary, arbiter enforces a hard
session `/clear` to start the implementation phase on Sonnet with a clean context window.
This is the "Phase 3.5 hard model-switch handoff."

Benefits: Opus only where reasoning matters (cost optimization). Sonnet starts clean with
no scrollback baggage (context discipline). TDD cycle is fast.

---

## When It Fires

`arbiter task advance --to red` triggers the handoff gate when:

1. Current phase is `red-team-review` or `red-team-rework` (planning phases)
2. `ARBITER_POST_CLEAR` is **not** set (first crossing)
3. `status.handoffStrategy` is **not** yet set (not already handled)

On first crossing the gate **stops** with exit code 78 (`EX_HANDOFF`) and prints:

```
Plan complete. Run `/clear`, then re-invoke your task command (it will resume from disk).
```

---

## Files Written at STOP

| Path                                       | Content                                                   |
| ------------------------------------------ | --------------------------------------------------------- |
| `.claude/.task-<sanitized-id>/status.json` | `handoffStrategy`, `planningHandoffReady` (ISO timestamp) |
| `.claude/.task-handoff-ready`              | flat marker file (presence signals boundary was crossed)  |

---

## Resuming After /clear

In the new session (after `/clear`), re-invoke with `--post-clear`:

```bash
arbiter task advance --post-clear --to red
```

Or set the environment variable:

```bash
ARBITER_POST_CLEAR=1 arbiter task advance --to red
```

Post-clear re-entry:

1. Reads `planningHandoffReady` from `status.json` (confirms first crossing happened)
2. Records phase costs to `.arbiter/evidence/cost/<task-id>.json`
3. Runs budget assertion: first-phase input tokens must be < 50,000 (proves clean context)
4. Writes `postClearResumed` ISO timestamp to `status.json`
5. Advances to `red` normally

---

## Cost Evidence

`.arbiter/evidence/cost/<task-id>.json` — written on post-clear re-entry and flushed on
every `PreCompact` hook firing.

Schema (no PII — purely numeric):

```json
{
  "taskId": "#703",
  "byPhase": {
    "red": { "in": 12500, "out": 4200, "samples": 3 }
  },
  "totals": { "in": 12500, "out": 4200, "samples": 3 }
}
```

---

## Budget Assertion

Default threshold: **50,000 input tokens** (configurable via `.arbiter/config.json`
`cost.implBudgetTokens`).

| Condition                              | Result                       |
| -------------------------------------- | ---------------------------- |
| First-phase input tokens < threshold   | PASS                         |
| First-phase input tokens ≥ threshold   | FAIL — exit 79 (`EX_BUDGET`) |
| `samples = 0` (transcript unavailable) | WARN-only, do not block      |

---

## Escape Hatches

**Skip budget check** (when transcript is known-broken or unavailable):

```bash
arbiter task advance --post-clear --skip-budget --to red
# or
ARBITER_COST_BUDGET_SKIP=1 arbiter task advance --post-clear --to red
```

The skip is logged to `status.json` with a reason field. Use sparingly — the budget
assertion is the operationalization of the "clean context" invariant.

---

## Non-Claude-Code Hosts

When `CLAUDECODE` env is not set (CI, `--ni` sub-agent path, standalone terminals):
`detectHostCapabilities()` returns `modelSwitch=false`. The gate sets
`handoffStrategy='inline'` and continues without STOP — no boundary enforcement on
hosts that cannot switch models interactively. Budget assertion still runs on post-clear
re-entry if evidence is available.

---

## Troubleshooting

| Symptom                       | Cause                                                      | Fix                                                                                                   |
| ----------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Exit 78 again after `/clear`  | `--post-clear` flag missing                                | Add `--post-clear` flag                                                                               |
| Exit 79 (budget breach)       | Context not clean — over 50k input tokens                  | Verify you actually ran `/clear`; use `--skip-budget` with documented reason if transcript is wrong   |
| `warn: no transcript samples` | Transcript JSONL unavailable (older CC / path changed)     | Safe to ignore — budget auto-softens; assertion is warn-only when `samples=0`                         |
| Cost evidence file missing    | Transcript reader failed silently                          | Check `status.json` for `postClearResumed` — if set, re-entry succeeded; cost evidence is best-effort |
| Gate fires in CI              | `CLAUDECODE` not set but `ARBITER_POST_CLEAR` also not set | CI should either set `ARBITER_POST_CLEAR=1` to skip boundary or never advance from a planning phase   |

---

## Relationship to Claude Code's Native Model-Switch Menu

Claude Code's Opus plan mode shows a "clear context and continue" option at plan
completion. Arbiter's handoff gate is **complementary**, not competing:

- Claude Code clears context (session boundary)
- Arbiter records `planningHandoffReady`, writes cost evidence, verifies clean context

Both can fire. The order does not matter — arbiter reads disk state, not session state.

---

## Supported Claude Code Versions

The transcript JSONL probe (`~/.claude/projects/<cwd-encoded>/*.jsonl`) has been tested
on Claude Code ≥ 1.0. The format may drift across versions — `transcript-reader.ts`
wraps all reads in try/catch and degrades to `samples=0` (warn-only) on any parse
failure. Quarterly revalidation of the probe is a maintenance task.
