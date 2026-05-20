---
title: 'ADR-039: V1 Verification Bridge'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-039: V1 Verification Bridge

**Date:** 2026-05-13
**Status:** Accepted
**Reference:** Issue #253

## Context

arbiter needs a deterministic, CLI-only mechanism to validate a structured PLAN.json file against project invariants before a task branch is merged. Human reviewers miss invariant drift at scale; the review bridge closes that gap by making key checks machine-enforceable.

Four invariants were identified as automatable from existing arbiter GLOBAL_INVARIANTS.md:

- **INV-25 (EN-UI):** UI strings in frontend files must be English — no Italian stopwords.
- **INV-12 (NO-SKIP):** Test files must not introduce skip patterns (disabled/skipped test variants).
- **INV-16 (NO-ORPHAN):** Every TODO added by the plan must reference a task ID.
- **Scope (NO-DRIVEBY):** All files in the plan must fall within the declared `scope.paths` or `scope.boundaries`.

The REVIEW.json artifact must be persisted for audit and referenced by CI.

## Decision

Implement `arbiter verify plan <file>` as a CLI-only command (no MCP surface, per ADR-020) that:

1. Parses and validates PLAN.json via Zod (PlanJsonV1 schema).
2. Routes through a rule registry that applies only applicable rules.
3. Writes a REVIEW.json artifact to `.arbiter/plan/REVIEW.json` (pointer) and `.arbiter/plan/runs/<runId>/REVIEW.json` (immutable archive).
4. Exits 0 on APPROVED or SKIPPED, 2 on REJECTED or ERROR.

Plugin authors may inject extra rules via `extraRules` (plugin field `verifyPlanRules`). Duplicate rule IDs between plugins and built-ins produce an ERROR (REGISTRY) rather than silently overwriting.

The `review_bridge.enabled:false` flag short-circuits all evaluation and emits SKIPPED — allowing incremental adoption without blocking teams that have not yet populated PLAN.json.

## Rule design

Each rule is a plain object implementing `VerifyPlanRule` with:

- `applicability(plan)`: skips evaluation when the rule is not relevant (e.g., NO-SKIP only runs if the plan adds or modifies tests).
- `evaluate(plan)`: returns zero or more `RuleViolation` objects with severity ERROR or WARN.

WARN violations do not block by default; `fail_on_warn:true` in PLAN.json or the CLI flag promotes them to REJECTED.

## Consequences

- Plans that violate any of the 4 invariants are REJECTED before merge.
- REVIEW.json is append-only per run (immutable archive); the pointer is overwritten on each run.
- Plugin rules can extend the rule set without forking the core binary.
- The `.arbiter/plan/runs/` directory is gitignored; the pointer files are retained for CI inspection.
- No MCP surface added — CLI only.
