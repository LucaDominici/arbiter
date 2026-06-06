---
generated: true
source: 'docs/REFERENCE/CODEX-PARITY.md'
source_sha: '6535940a7a85a6c4854f2136b33f353bd8c9083b'
last_updated: '2026-06-06'
---

# Codex Governance Parity Reference

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/CODEX-PARITY.md](../docs/REFERENCE/CODEX-PARITY.md)

# Codex Governance Parity Reference

> **Status:** Gap is intentional — Codex has no hook/plugin extension point.
> Gate-time enforcement covers critical violations. This document tracks the gap.

## Overview

Arbiter generates governance for two Claude Code agents and OpenAI Codex. Claude Code
has a hook system that provides real-time per-edit enforcement; Codex does not.
The table below maps each Claude hook to its Codex workaround.

## Hook Parity Table

| Claude Hook                  | INV     | Severity | Codex Workaround                  | Gap                                    |
| ---------------------------- | ------- | -------- | --------------------------------- | -------------------------------------- |
| `check-no-any.mjs`           | INV-04  | HIGH     | `tsc --strict` at L1 gate         | Delayed: caught at commit, not edit    |
| `check-no-orphan-todo.mjs`   | INV-06  | MEDIUM   | `grep -rn 'TODO[^(]'` in gate     | Delayed: caught at commit              |
| `check-no-pii.mjs`           | INV-PII | HIGH     | `scripts/pii-scan.mjs` at L2 gate | Delayed: caught pre-push               |
| `pre-edit-ssot-guard.mjs`    | —       | LOW      | AGENTS.md hard-stop rule          | Behavioral only                        |
| `pre-edit-plan-anchor.mjs`   | —       | MEDIUM   | `.agents/plan/PLAN.json` protocol | Behavioral — plan enforced by workflow |
| `debug-state-on-failure.mjs` | —       | LOW      | None                              | No equivalent                          |
| `skill-forced-eval.mjs`      | —       | LOW      | None                              | No equivalent                          |
| `post-edit-dispatch.mjs`     | —       | LOW      | None                              | No equivalent                          |
| `guard-task-completion.mjs`  | —       | MEDIUM   | None                              | No equivalent                          |
| `check-circular-deps.mjs`    | INV-01  | HIGH     | `madge --circular src` at L1 gate | Delayed: caught at commit              |

## Decision Record

**Decision:** The parity gap is permanent until Codex ships a hook/plugin system.

**Rationale:**

- All HIGH-severity gaps are caught by the gate before merge
- Behavioral gaps (ssot-guard, guard-task-completion) require human discipline in both environments
- The `codex-adapter.mjs` polling mechanism cannot replicate per-edit hooks without
  introducing latency that degrades developer experience

**Future:** If Codex adds a `config.toml` hook system, extend `src/generators/codex-hooks.ts`
and `src/templates/codex/codex-adapter.mjs` to bridge the remaining gaps.

## Generated Output

When a target project is initialized with `arbiter init --tools codex`, the generated
`CODEX.md` (from `src/templates/codex/CODEX.md.ejs`) includes a **Known Limitations**
section listing this table inline for project developers.

## See Also

- `src/templates/codex/CODEX.md.ejs` — generated file for target projects
- `src/generators/codex-hooks.ts` — Codex hook bridge (codex-adapter.mjs)
- `AGENTS.md` §Invariants — full invariant list
