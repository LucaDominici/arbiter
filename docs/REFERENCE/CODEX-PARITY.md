---
title: 'Codex Governance Parity Reference'
doc_version: '1.1.0'
status: active
last_review: '2026-07-17'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

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

## Self-track coverage

Since the ADR-106 addendum (2026-07-17), the parity contract also covers arbiter's own
materialized codex track: `scripts/check-codex-self-parity.mjs` re-emits the track fresh
via the repo's own generator and resolved config, and verifies `.agents/**` + `.codex/**`
against it in the L2 gate (check-all), with every file classified as EMITTED-MATCH,
PINNED (dated + hashed pin), or RUNTIME-ARTIFACT. As a consequence, the Known Limitations
table in arbiter's own `.agents/CODEX.md` is now the generated, inventory-backed one —
the hand-maintained variant can no longer silently survive there. Operational details:
`docs/internal/METHOD/CODEX_PARITY_RUNBOOK.md` §Self-track parity.

## See Also

- `src/templates/codex/CODEX.md.ejs` — generated file for target projects
- `src/generators/codex-hooks.ts` — Codex hook bridge (codex-adapter.mjs)
- `AGENTS.md` §Invariants — full invariant list
